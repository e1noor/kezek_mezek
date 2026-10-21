import { getIdentity } from './auth.js';
import { parseLighthouseAssignment } from './lighthouse.js';
import { datesForRule, localToday, starterRules, starterSubjects, weekStartFor } from './schedule.js';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const reply = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});
const required = (value, label, max = 120) => {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new HttpError(400, `${label} is required (max ${max} characters).`);
  return text;
};
const optional = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const int = (value, label) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new HttpError(400, `Invalid ${label}.`);
  return number;
};
const capacityValue = value => {
  const capacity = int(value, 'capacity');
  if (capacity > 200) throw new HttpError(400, 'Capacity cannot exceed 200.');
  return capacity;
};
const bool = value => value ? 1 : 0;
const dateValue = value => {
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new HttpError(400, 'Invalid date.');
  return value;
};
const timeValue = value => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value || '')) throw new HttpError(400, 'Invalid time.');
  return value;
};
const dueValue = value => {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new HttpError(400, 'Invalid submission due date.');
  return value;
};

function additionalDaysValue(value) {
  if (!Array.isArray(value) || value.length > 20) throw new HttpError(400, 'Add at most 20 extra defense days.');
  const seen = new Set();
  return value.map(item => {
    if (!item || typeof item !== 'object') throw new HttpError(400, 'Invalid extra defense day.');
    const day = {
      id: item.id ? int(item.id, 'defense day') : null,
      session_date: dateValue(item.session_date),
      start_time: timeValue(item.start_time),
      end_time: timeValue(item.end_time),
      room: optional(item.room, 60)
    };
    if (day.end_time <= day.start_time) throw new HttpError(400, 'Defense end time must be after start time.');
    const key = day.session_date + ' ' + day.start_time;
    if (seen.has(key)) throw new HttpError(400, 'The same defense time was added twice.');
    seen.add(key);
    return day;
  });
}

async function bodyOf(request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 16000) throw new HttpError(413, 'Request is too large.');
  try { return await request.json(); } catch { throw new HttpError(400, 'Invalid JSON.'); }
}

async function seed(db) {
  const count = await db.prepare('SELECT COUNT(*) AS count FROM subjects').first();
  if (count.count) return;
  await db.batch(starterSubjects.map(item => db.prepare('INSERT OR IGNORE INTO subjects (name, color) VALUES (?, ?)').bind(item.name, item.color)));
  const subjects = await db.prepare('SELECT id, name FROM subjects').all();
  const ids = new Map(subjects.results.map(item => [item.name, item.id]));
  await db.batch(starterRules.map(([name, day, start, end, room]) => db.prepare(
    "INSERT OR IGNORE INTO schedule_rules (subject_id, weekday, start_time, end_time, room, kind) VALUES (?, ?, ?, ?, ?, 'practical')"
  ).bind(ids.get(name), day, start, end, room)));
}

async function upsertUser(db, telegram) {
  await db.prepare(`INSERT INTO users (telegram_id, telegram_first_name, telegram_username)
    VALUES (?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET telegram_first_name = excluded.telegram_first_name,
      telegram_username = excluded.telegram_username, updated_at = CURRENT_TIMESTAMP`)
    .bind(telegram.id, optional(telegram.first_name, 80), optional(telegram.username, 80) || null).run();
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(telegram.id).first();
}

async function isAdmin(db, env, id) {
  if (Number(env.ADMIN_TELEGRAM_ID) === Number(id)) return true;
  return !!(await db.prepare('SELECT 1 FROM admins WHERE telegram_id = ?').bind(id).first());
}

function needAdmin(context) {
  if (!context.admin) throw new HttpError(403, 'Admin access required.');
}

function needProfile(context) {
  if (!context.user.display_name) throw new HttpError(403, 'Set your name first.');
}

async function ensureSessions(db, assignmentId, subjectId, defenseWeekStart) {
  const weekStart = defenseWeekStart || (await db.prepare('SELECT defense_week_start FROM assignments WHERE id = ?').bind(assignmentId).first())?.defense_week_start;
  if (!weekStart) throw new HttpError(500, 'Defense week is missing.');
  const rules = await db.prepare("SELECT * FROM schedule_rules WHERE subject_id = ? AND active = 1 AND kind = 'practical'").bind(subjectId).all();
  const statements = [];
  for (const rule of rules.results) {
    for (const date of datesForRule(rule, weekStart, 7)) {
      statements.push(db.prepare(`INSERT OR IGNORE INTO defense_sessions
        (assignment_id, session_date, start_time, end_time, room, schedule_rule_id)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(assignmentId, date, rule.start_time, rule.end_time, rule.room, rule.id));
    }
  }
  if (statements.length) await db.batch(statements);
}

async function assignmentDetail(db, id, userId) {
  const assignment = await db.prepare(`SELECT a.*, s.name AS subject_name, s.color AS subject_color
    FROM assignments a JOIN subjects s ON s.id = a.subject_id WHERE a.id = ?`).bind(id).first();
  if (!assignment || assignment.archived) throw new HttpError(404, 'Assignment not found.');
  await ensureSessions(db, id, assignment.subject_id);
  const sessions = await db.prepare(`SELECT ds.*, COUNT(q.id) AS taken FROM defense_sessions ds
    LEFT JOIN queue_entries q ON q.session_id = ds.id
    WHERE ds.assignment_id = ?
    GROUP BY ds.id ORDER BY ds.session_date, ds.start_time LIMIT 80`)
    .bind(id).all();
  const myBooking = await db.prepare(`SELECT q.session_id, q.position, ds.session_date
    FROM queue_entries q JOIN defense_sessions ds ON ds.id = q.session_id
    WHERE ds.assignment_id = ? AND q.telegram_id = ? LIMIT 1`).bind(id, userId).first();
  return { assignment, sessions: sessions.results, my_booking: myBooking || null };
}

async function sessionDetail(db, id, userId) {
  const session = await db.prepare(`SELECT ds.*, a.title AS assignment_title, a.submission_due_at,
      s.name AS subject_name, s.color AS subject_color
    FROM defense_sessions ds JOIN assignments a ON a.id = ds.assignment_id
    JOIN subjects s ON s.id = a.subject_id WHERE ds.id = ?`).bind(id).first();
  if (!session) throw new HttpError(404, 'Queue not found.');
  const entries = await db.prepare(`SELECT q.position, q.telegram_id, u.display_name, u.telegram_username
    FROM queue_entries q JOIN users u ON u.telegram_id = q.telegram_id
    WHERE q.session_id = ? ORDER BY q.position`).bind(id).all();
  const myBooking = await db.prepare(`SELECT q.session_id, q.position, ds.session_date
    FROM queue_entries q JOIN defense_sessions ds ON ds.id = q.session_id
    WHERE ds.assignment_id = ? AND q.telegram_id = ? LIMIT 1`).bind(session.assignment_id, userId).first();
  return { session, entries: entries.results, my_booking: myBooking || null };
}

async function claimPosition(db, sessionId, userId, position) {
  const session = await db.prepare('SELECT * FROM defense_sessions WHERE id = ?').bind(sessionId).first();
  if (!session) throw new HttpError(404, 'Queue not found.');
  if (position > session.capacity) throw new HttpError(400, 'Position is outside this queue.');
  const student = await db.prepare('SELECT display_name FROM users WHERE telegram_id = ?').bind(userId).first();
  if (!student?.display_name) throw new HttpError(400, 'Student must open the app and set a name first.');
  try {
    await db.prepare(`INSERT INTO queue_entries (session_id, telegram_id, position)
      VALUES (?, ?, ?)
      ON CONFLICT(session_id, telegram_id) DO UPDATE SET position = excluded.position,
        updated_at = CURRENT_TIMESTAMP`).bind(sessionId, userId, position).run();
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(String(error))) throw new HttpError(409, 'That position was just taken. Choose another.');
    if (/One spot per assignment/i.test(String(error))) throw new HttpError(409, 'You already have a spot for this assignment. Leave that queue before choosing another day.');
    throw error;
  }
}

async function importAssignment(db, parsed) {
  const existingSubject = await db.prepare('SELECT id FROM subjects WHERE name = ? COLLATE NOCASE').bind(parsed.subject).first();
  let subjectId = existingSubject?.id;
  if (!subjectId) {
    const created = await db.prepare('INSERT INTO subjects (name) VALUES (?)').bind(parsed.subject).run();
    subjectId = created.meta.last_row_id;
  }
  const found = await db.prepare(`SELECT id FROM assignments WHERE subject_id = ? AND title = ? COLLATE NOCASE
    AND COALESCE(submission_due_at, '') = COALESCE(?, '') LIMIT 1`)
    .bind(subjectId, parsed.title, parsed.submissionDueAt).first();
  if (found) return found.id;
  const defenseWeek = weekStartFor(parsed.submissionDueAt || localToday());
  const created = await db.prepare(`INSERT INTO assignments
    (subject_id, title, instructor, submission_due_at, defense_week_start, source)
    VALUES (?, ?, ?, ?, ?, 'lighthouse')`)
    .bind(subjectId, parsed.title, parsed.instructor, parsed.submissionDueAt, defenseWeek).run();
  await ensureSessions(db, created.meta.last_row_id, subjectId, defenseWeek);
  return created.meta.last_row_id;
}

async function handleBusinessMessage(db, message) {
  const text = message.text || message.caption || '';
  const parsed = parseLighthouseAssignment(text);
  const from = message.from;
  if (!parsed || !from?.is_bot || !message.chat?.id || !message.message_id) return;
  const source = await db.prepare('SELECT * FROM lighthouse_source WHERE id = 1').first();
  const trusted = source && Number(source.chat_id) === Number(message.chat.id) && Number(source.bot_id) === Number(from.id);
  await db.prepare(`INSERT OR IGNORE INTO lighthouse_events
    (chat_id, message_id, bot_id, sender_name, text, status)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(message.chat.id, message.message_id, from.id, optional(from.first_name || from.username, 100), text.slice(0, 8000), trusted ? 'error' : 'pending').run();
  if (!trusted) return;
  const event = await db.prepare('SELECT * FROM lighthouse_events WHERE chat_id = ? AND message_id = ?')
    .bind(message.chat.id, message.message_id).first();
  if (event.status === 'imported') return;
  try {
    const assignmentId = await importAssignment(db, parsed);
    await db.prepare("UPDATE lighthouse_events SET status = 'imported', assignment_id = ? WHERE id = ?")
      .bind(assignmentId, event.id).run();
  } catch (error) {
    console.error('Lighthouse import failed', error);
    await db.prepare("UPDATE lighthouse_events SET status = 'error' WHERE id = ?").bind(event.id).run();
  }
}

async function telegramWebhook(request, env) {
  if (!env.WEBHOOK_SECRET || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
    throw new HttpError(403, 'Invalid webhook secret.');
  }
  const update = await bodyOf(request);
  const botToken = String(env.BOT_TOKEN || '').trim();
  if (update.business_message) await handleBusinessMessage(env.DB, update.business_message);
  const forwarded = update.message;
  const originalBot = forwarded?.forward_origin?.sender_user;
  const forwardedAssignment = parseLighthouseAssignment(forwarded?.text || forwarded?.caption || '');
  if (forwardedAssignment && originalBot?.is_bot && Number(forwarded.from?.id) === Number(env.ADMIN_TELEGRAM_ID)) {
    const existingSource = await env.DB.prepare('SELECT * FROM lighthouse_source WHERE id = 1').first();
    if (!existingSource && /lighthouse/i.test(`${originalBot.first_name || ''} ${originalBot.username || ''}`)) {
      await env.DB.prepare('INSERT INTO lighthouse_source (id, chat_id, bot_id, label) VALUES (1, ?, ?, ?)')
        .bind(originalBot.id, originalBot.id, optional(originalBot.first_name || originalBot.username, 100)).run();
    }
    const assignmentId = await importAssignment(env.DB, forwardedAssignment);
    if (botToken && env.DEV_AUTH !== '1') await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: forwarded.chat.id, text: `Assignment imported (#${assignmentId}).` })
    });
  }
  if (/^\/(start|id)(?:@\w+)?(?:\s|$)/.test(update.message?.text || '') && !update.message.from?.is_bot && botToken && env.DEV_AUTH !== '1') {
    const chatId = update.message.chat.id;
    const isId = /^\/id(?:@\w+)?(?:\s|$)/.test(update.message.text);
    const markup = !isId && env.APP_URL ? { inline_keyboard: [[{ text: 'Open Kezek Mezek', web_app: { url: env.APP_URL } }]] } : undefined;
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: isId ? `Your Telegram ID: ${update.message.from.id}` : 'Welcome! Open the Mini App to join a defense queue.', reply_markup: markup })
    });
  }
  return reply({ ok: true });
}

async function api(request, env, path) {
  if (path === '/api/meta' && request.method === 'GET') return reply({ demo: env.DEV_AUTH === '1', timeZone: 'Asia/Qyzylorda' });
  const identity = await getIdentity(request, env);
  if (!identity) throw new HttpError(401, 'Open this app from Telegram.');
  const user = await upsertUser(env.DB, identity);
  const context = { user, admin: await isAdmin(env.DB, env, identity.id) };
  const db = env.DB;

  if (path === '/api/bootstrap' && request.method === 'GET') {
    await seed(db);
    const subjects = await db.prepare(`SELECT s.*, COUNT(DISTINCT a.id) AS assignment_count
      FROM subjects s LEFT JOIN assignments a ON a.subject_id = s.id AND a.archived = 0
      WHERE s.archived = 0 GROUP BY s.id ORDER BY s.name`).all();
    const schedule = await db.prepare(`SELECT r.*, s.name AS subject_name, s.color AS subject_color
      FROM schedule_rules r JOIN subjects s ON s.id = r.subject_id
      WHERE r.active = 1 AND s.archived = 0 ORDER BY r.weekday, r.start_time`).all();
    return reply({ user: { ...user, is_admin: context.admin }, subjects: subjects.results, schedule: schedule.results, today: localToday() });
  }

  if (path === '/api/profile' && request.method === 'PUT') {
    const body = await bodyOf(request);
    const name = required(body.display_name, 'Name', 60);
    await db.prepare('UPDATE users SET display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?').bind(name, user.telegram_id).run();
    return reply({ ok: true, display_name: name });
  }

  const subjectMatch = path.match(/^\/api\/subjects\/(\d+)$/);
  if (subjectMatch && request.method === 'GET') {
    needProfile(context);
    const subject = await db.prepare('SELECT * FROM subjects WHERE id = ? AND archived = 0').bind(Number(subjectMatch[1])).first();
    if (!subject) throw new HttpError(404, 'Subject not found.');
    const assignments = await db.prepare(`SELECT a.*,
      (SELECT COUNT(*) FROM defense_sessions ds WHERE ds.assignment_id = a.id) AS session_count
      FROM assignments a WHERE a.subject_id = ? AND a.archived = 0 ORDER BY a.created_at DESC, a.id DESC`)
      .bind(subject.id).all();
    return reply({ subject, assignments: assignments.results });
  }

  const assignmentMatch = path.match(/^\/api\/assignments\/(\d+)$/);
  if (assignmentMatch && request.method === 'GET') {
    needProfile(context);
    return reply(await assignmentDetail(db, Number(assignmentMatch[1]), user.telegram_id));
  }

  const sessionMatch = path.match(/^\/api\/sessions\/(\d+)$/);
  if (sessionMatch && request.method === 'GET') {
    needProfile(context);
    return reply(await sessionDetail(db, Number(sessionMatch[1]), user.telegram_id));
  }

  const claimMatch = path.match(/^\/api\/sessions\/(\d+)\/claim$/);
  if (claimMatch && request.method === 'POST') {
    needProfile(context);
    const payload = await bodyOf(request);
    await claimPosition(db, Number(claimMatch[1]), user.telegram_id, int(payload.position, 'position'));
    return reply(await sessionDetail(db, Number(claimMatch[1]), user.telegram_id));
  }

  const releaseMatch = path.match(/^\/api\/sessions\/(\d+)\/claim$/);
  if (releaseMatch && request.method === 'DELETE') {
    needProfile(context);
    await db.prepare('DELETE FROM queue_entries WHERE session_id = ? AND telegram_id = ?')
      .bind(Number(releaseMatch[1]), user.telegram_id).run();
    return reply(await sessionDetail(db, Number(releaseMatch[1]), user.telegram_id));
  }

  if (path.startsWith('/api/admin/')) {
    needAdmin(context);
    return adminApi(request, db, path);
  }
  throw new HttpError(404, 'Not found.');
}

async function adminApi(request, db, path) {
  const method = request.method;
  if (path === '/api/admin/overview' && method === 'GET') {
    const [subjects, rules, assignments, sessions, students, admins, source, events] = await Promise.all([
      db.prepare('SELECT * FROM subjects ORDER BY archived, name').all(),
      db.prepare(`SELECT r.*, s.name AS subject_name FROM schedule_rules r JOIN subjects s ON s.id = r.subject_id ORDER BY weekday, start_time`).all(),
      db.prepare(`SELECT a.*, s.name AS subject_name,
        (SELECT COUNT(*) FROM defense_sessions ds WHERE ds.assignment_id = a.id) AS session_count,
        (SELECT COUNT(*) FROM queue_entries q JOIN defense_sessions ds ON ds.id = q.session_id
          WHERE ds.assignment_id = a.id) AS booking_count
        FROM assignments a JOIN subjects s ON s.id = a.subject_id ORDER BY a.id DESC LIMIT 200`).all(),
      db.prepare(`SELECT ds.*, a.title AS assignment_title, s.name AS subject_name,
        (SELECT COUNT(*) FROM queue_entries q WHERE q.session_id = ds.id) AS taken
      FROM defense_sessions ds JOIN assignments a ON a.id = ds.assignment_id
      JOIN subjects s ON s.id = a.subject_id WHERE a.archived = 0
        ORDER BY ds.session_date DESC, ds.start_time LIMIT 200`).all(),
      db.prepare('SELECT telegram_id, display_name, telegram_username FROM users WHERE display_name IS NOT NULL ORDER BY display_name').all(),
      db.prepare('SELECT telegram_id FROM admins').all(),
      db.prepare('SELECT * FROM lighthouse_source WHERE id = 1').first(),
      db.prepare("SELECT * FROM lighthouse_events WHERE status IN ('pending', 'error') ORDER BY id DESC LIMIT 20").all()
    ]);
    return reply({ subjects: subjects.results, rules: rules.results, assignments: assignments.results,
      sessions: sessions.results, students: students.results, admins: admins.results, source, events: events.results });
  }

  if (path === '/api/admin/subjects' && method === 'POST') {
    const data = await bodyOf(request);
    const name = required(data.name, 'Subject', 120);
    const color = /^#[0-9a-fA-F]{6}$/.test(data.color || '') ? data.color : '#6375F0';
    const result = await db.prepare('INSERT INTO subjects (name, color) VALUES (?, ?)').bind(name, color).run();
    return reply({ id: result.meta.last_row_id }, 201);
  }
  const subjectEdit = path.match(/^\/api\/admin\/subjects\/(\d+)$/);
  if (subjectEdit && method === 'PUT') {
    const data = await bodyOf(request);
    await db.prepare('UPDATE subjects SET name = ?, color = ?, archived = ? WHERE id = ?')
      .bind(required(data.name, 'Subject', 120), /^#[0-9a-fA-F]{6}$/.test(data.color || '') ? data.color : '#6375F0', bool(data.archived), Number(subjectEdit[1])).run();
    return reply({ ok: true });
  }

  if (path === '/api/admin/schedule' && method === 'POST') {
    const data = await bodyOf(request);
    const start = timeValue(data.start_time), end = timeValue(data.end_time);
    if (end <= start) throw new HttpError(400, 'End time must be after start time.');
    const weekday = Number(data.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new HttpError(400, 'Invalid weekday.');
    const result = await db.prepare(`INSERT INTO schedule_rules (subject_id, weekday, start_time, end_time, room, kind)
      VALUES (?, ?, ?, ?, ?, 'practical')`)
      .bind(int(data.subject_id, 'subject'), weekday, start, end, optional(data.room, 60)).run();
    const activeAssignments = await db.prepare('SELECT id FROM assignments WHERE subject_id = ? AND archived = 0')
      .bind(int(data.subject_id, 'subject')).all();
    for (const assignment of activeAssignments.results) await ensureSessions(db, assignment.id, int(data.subject_id, 'subject'));
    return reply({ id: result.meta.last_row_id }, 201);
  }
  const ruleEdit = path.match(/^\/api\/admin\/schedule\/(\d+)$/);
  if (ruleEdit && method === 'PUT') {
    const data = await bodyOf(request);
    const ruleId = Number(ruleEdit[1]);
    const prior = await db.prepare('SELECT * FROM schedule_rules WHERE id = ?').bind(ruleId).first();
    if (!prior) throw new HttpError(404, 'Practical class not found.');
    const start = timeValue(data.start_time), end = timeValue(data.end_time);
    if (end <= start) throw new HttpError(400, 'End time must be after start time.');
    const weekday = Number(data.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new HttpError(400, 'Invalid weekday.');
    const subjectId = int(data.subject_id, 'subject');
    const changedSlot = subjectId !== prior.subject_id || weekday !== prior.weekday || start !== prior.start_time || !data.active;
    if (changedSlot) {
      const booked = await db.prepare(`SELECT 1 FROM defense_sessions ds JOIN queue_entries q ON q.session_id = ds.id
        WHERE ds.schedule_rule_id = ? LIMIT 1`).bind(ruleId).first();
      if (booked) throw new HttpError(409, 'Students have joined this class. Move their spots before changing its day or time.');
      await db.prepare('DELETE FROM defense_sessions WHERE schedule_rule_id = ?').bind(ruleId).run();
    }
    await db.prepare(`UPDATE schedule_rules SET subject_id = ?, weekday = ?, start_time = ?, end_time = ?, room = ?, active = ? WHERE id = ?`)
      .bind(subjectId, weekday, start, end, optional(data.room, 60), bool(data.active), ruleId).run();
    if (!changedSlot) await db.prepare('UPDATE defense_sessions SET end_time = ?, room = ? WHERE schedule_rule_id = ?')
      .bind(end, optional(data.room, 60), ruleId).run();
    if (data.active) {
      const activeAssignments = await db.prepare('SELECT id FROM assignments WHERE subject_id = ? AND archived = 0')
        .bind(subjectId).all();
      for (const assignment of activeAssignments.results) await ensureSessions(db, assignment.id, subjectId);
    }
    return reply({ ok: true });
  }

  if (path === '/api/admin/assignments' && method === 'POST') {
    const data = await bodyOf(request);
    const subjectId = int(data.subject_id, 'subject');
    const submissionDue = dueValue(data.submission_due_at);
    const defenseWeek = weekStartFor(data.defense_week_start ? dateValue(data.defense_week_start) : submissionDue || localToday());
    const result = await db.prepare(`INSERT INTO assignments (subject_id, title, instructor, submission_due_at, defense_week_start, notes)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(subjectId, required(data.title, 'Assignment', 160), optional(data.instructor, 100), submissionDue, defenseWeek, optional(data.notes, 1000)).run();
    await ensureSessions(db, result.meta.last_row_id, subjectId, defenseWeek);
    return reply({ id: result.meta.last_row_id }, 201);
  }
  const assignmentDays = path.match(/^\/api\/admin\/assignments\/(\d+)\/days$/);
  if (assignmentDays && method === 'GET') {
    const assignmentId = Number(assignmentDays[1]);
    const assignment = await db.prepare('SELECT id FROM assignments WHERE id = ?').bind(assignmentId).first();
    if (!assignment) throw new HttpError(404, 'Assignment not found.');
    const days = await db.prepare(`SELECT id, session_date, start_time, end_time, room,
      (SELECT COUNT(*) FROM queue_entries q WHERE q.session_id = ds.id) AS taken
      FROM defense_sessions ds WHERE assignment_id = ? AND is_additional = 1
      ORDER BY session_date, start_time`).bind(assignmentId).all();
    return reply({ days: days.results });
  }
  const assignmentEdit = path.match(/^\/api\/admin\/assignments\/(\d+)$/);
  if (assignmentEdit && method === 'DELETE') {
    const assignmentId = Number(assignmentEdit[1]);
    const data = await bodyOf(request);
    const assignment = await db.prepare(`SELECT a.title,
      (SELECT COUNT(*) FROM queue_entries q JOIN defense_sessions ds ON ds.id = q.session_id
        WHERE ds.assignment_id = a.id) AS booking_count
      FROM assignments a WHERE a.id = ?`).bind(assignmentId).first();
    if (!assignment) throw new HttpError(404, 'Assignment not found.');
    if (data.confirm_title !== assignment.title) throw new HttpError(409, 'Assignment changed. Reopen the delete confirmation.');
    if (Number(data.expected_bookings) !== Number(assignment.booking_count)) {
      throw new HttpError(409, 'Bookings changed. Reopen the delete confirmation.');
    }
    await db.prepare('DELETE FROM assignments WHERE id = ?').bind(assignmentId).run();
    return reply({ ok: true });
  }
  if (assignmentEdit && method === 'PUT') {
    const data = await bodyOf(request);
    const subjectId = int(data.subject_id, 'subject');
    const assignmentId = Number(assignmentEdit[1]);
    const prior = await db.prepare('SELECT subject_id, defense_week_start FROM assignments WHERE id = ?').bind(assignmentId).first();
    if (!prior) throw new HttpError(404, 'Assignment not found.');
    const defenseWeek = weekStartFor(data.defense_week_start ? dateValue(data.defense_week_start) : prior.defense_week_start || data.submission_due_at || localToday());
    if (defenseWeek !== prior.defense_week_start) {
      const weekEnd = new Date(`${defenseWeek}T00:00:00Z`);
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
      const occupiedOutside = await db.prepare(`SELECT 1 FROM defense_sessions ds JOIN queue_entries q ON q.session_id = ds.id
        WHERE ds.assignment_id = ? AND ds.is_additional = 0
          AND (ds.session_date < ? OR ds.session_date >= ?) LIMIT 1`)
        .bind(assignmentId, defenseWeek, weekEnd.toISOString().slice(0, 10)).first();
      if (occupiedOutside) throw new HttpError(409, 'Move or remove booked spots before changing the defense week.');
    }
    if (subjectId !== prior.subject_id) {
      const occupied = await db.prepare(`SELECT 1 FROM defense_sessions ds JOIN queue_entries q ON q.session_id = ds.id
        WHERE ds.assignment_id = ? LIMIT 1`).bind(assignmentId).first();
      if (occupied) throw new HttpError(409, 'Move or remove booked spots before changing the subject.');
    }
    const requestedDays = data.additional_days === undefined ? null : additionalDaysValue(data.additional_days);
    const dayStatements = [];
    if (requestedDays) {
      const existingResult = await db.prepare('SELECT * FROM defense_sessions WHERE assignment_id = ? AND is_additional = 1')
        .bind(assignmentId).all();
      const existing = new Map(existingResult.results.map(day => [day.id, day]));
      const kept = new Set();
      for (const day of requestedDays) {
        if (day.id) {
          const old = existing.get(day.id);
          if (!old || kept.has(day.id)) throw new HttpError(400, 'Invalid extra defense day.');
          kept.add(day.id);
          if (day.session_date !== old.session_date || day.start_time !== old.start_time || day.end_time !== old.end_time) {
            const booked = await db.prepare('SELECT 1 FROM queue_entries WHERE session_id = ? LIMIT 1').bind(day.id).first();
            if (booked) throw new HttpError(409, 'Move or remove booked spots before changing this defense day.');
          }
          dayStatements.push(db.prepare(`UPDATE defense_sessions SET session_date = ?, start_time = ?, end_time = ?, room = ?
            WHERE id = ? AND assignment_id = ? AND is_additional = 1`)
            .bind(day.session_date, day.start_time, day.end_time, day.room, day.id, assignmentId));
        } else {
          dayStatements.push(db.prepare(`INSERT INTO defense_sessions
            (assignment_id, session_date, start_time, end_time, room, is_additional)
            VALUES (?, ?, ?, ?, ?, 1)`)
            .bind(assignmentId, day.session_date, day.start_time, day.end_time, day.room));
        }
      }
      for (const old of existing.values()) {
        if (kept.has(old.id)) continue;
        const booked = await db.prepare('SELECT 1 FROM queue_entries WHERE session_id = ? LIMIT 1').bind(old.id).first();
        if (booked) throw new HttpError(409, 'Move or remove booked spots before deleting this defense day.');
        dayStatements.unshift(db.prepare('DELETE FROM defense_sessions WHERE id = ? AND assignment_id = ? AND is_additional = 1')
          .bind(old.id, assignmentId));
      }
    }
    await db.batch([db.prepare(`UPDATE assignments SET subject_id = ?, title = ?, instructor = ?, submission_due_at = ?,
      defense_week_start = ?, notes = ?, archived = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(subjectId, required(data.title, 'Assignment', 160), optional(data.instructor, 100), dueValue(data.submission_due_at), defenseWeek, optional(data.notes, 1000), bool(data.archived), assignmentId), ...dayStatements]);
    if (defenseWeek !== prior.defense_week_start || subjectId !== prior.subject_id) {
      await db.prepare(`DELETE FROM defense_sessions WHERE assignment_id = ? AND schedule_rule_id IS NOT NULL
        AND id NOT IN (SELECT session_id FROM queue_entries)`).bind(assignmentId).run();
    }
    await ensureSessions(db, assignmentId, subjectId, defenseWeek);
    return reply({ ok: true });
  }

  if (path === '/api/admin/sessions' && method === 'POST') {
    throw new HttpError(400, 'Defense queues follow practical classes. Add a practical class or an assignment instead.');
  }
  const sessionEdit = path.match(/^\/api\/admin\/sessions\/(\d+)$/);
  if (sessionEdit && method === 'PUT') {
    const data = await bodyOf(request);
    const id = Number(sessionEdit[1]);
    const current = await db.prepare('SELECT id FROM defense_sessions WHERE id = ?').bind(id).first();
    if (!current) throw new HttpError(404, 'Queue not found.');
    const taken = await db.prepare('SELECT MAX(position) AS max_position FROM queue_entries WHERE session_id = ?').bind(id).first();
    const capacity = capacityValue(data.capacity);
    if (capacity < Number(taken.max_position || 0)) throw new HttpError(400, 'Capacity is smaller than an occupied position.');
    await db.prepare('UPDATE defense_sessions SET capacity = ? WHERE id = ?').bind(capacity, id).run();
    return reply({ ok: true, session_id: id });
  }

  if (path === '/api/admin/queue' && method === 'PUT') {
    const data = await bodyOf(request);
    await claimPosition(db, int(data.session_id, 'session'), int(data.telegram_id, 'student'), int(data.position, 'position'));
    return reply({ ok: true });
  }
  if (path === '/api/admin/queue' && method === 'DELETE') {
    const data = await bodyOf(request);
    await db.prepare('DELETE FROM queue_entries WHERE session_id = ? AND telegram_id = ?')
      .bind(int(data.session_id, 'session'), int(data.telegram_id, 'student')).run();
    return reply({ ok: true });
  }
  if (path === '/api/admin/admins' && method === 'POST') {
    const data = await bodyOf(request);
    const telegramId = int(data.telegram_id, 'student');
    const student = await db.prepare('SELECT 1 FROM users WHERE telegram_id = ? AND display_name IS NOT NULL').bind(telegramId).first();
    if (!student) throw new HttpError(400, 'That person must open the app first.');
    await db.prepare('INSERT OR IGNORE INTO admins (telegram_id) VALUES (?)').bind(telegramId).run();
    return reply({ ok: true });
  }

  if (path === '/api/admin/lighthouse/approve' && method === 'POST') {
    const data = await bodyOf(request);
    const event = await db.prepare("SELECT * FROM lighthouse_events WHERE id = ? AND status = 'pending'").bind(int(data.event_id, 'event')).first();
    if (!event) throw new HttpError(404, 'Pending Lighthouse message not found.');
    await db.prepare(`INSERT INTO lighthouse_source (id, chat_id, bot_id, label)
      VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET chat_id = excluded.chat_id, bot_id = excluded.bot_id,
      label = excluded.label, approved_at = CURRENT_TIMESTAMP`)
      .bind(event.chat_id, event.bot_id, event.sender_name).run();
    const matching = await db.prepare("SELECT * FROM lighthouse_events WHERE status = 'pending' AND chat_id = ? AND bot_id = ?")
      .bind(event.chat_id, event.bot_id).all();
    for (const item of matching.results) {
      const parsed = parseLighthouseAssignment(item.text);
      if (!parsed) continue;
      try {
        const assignmentId = await importAssignment(db, parsed);
        await db.prepare("UPDATE lighthouse_events SET status = 'imported', assignment_id = ? WHERE id = ?")
          .bind(assignmentId, item.id).run();
      } catch (error) {
        console.error('Lighthouse approval import failed', error);
        await db.prepare("UPDATE lighthouse_events SET status = 'error' WHERE id = ?").bind(item.id).run();
      }
    }
    return reply({ ok: true });
  }

  if (path === '/api/admin/lighthouse/retry' && method === 'POST') {
    const data = await bodyOf(request);
    const event = await db.prepare("SELECT * FROM lighthouse_events WHERE id = ? AND status = 'error'").bind(int(data.event_id, 'event')).first();
    const source = await db.prepare('SELECT * FROM lighthouse_source WHERE id = 1').first();
    if (!event || !source || Number(event.chat_id) !== Number(source.chat_id) || Number(event.bot_id) !== Number(source.bot_id)) {
      throw new HttpError(404, 'Trusted Lighthouse notice not found.');
    }
    const parsed = parseLighthouseAssignment(event.text);
    if (!parsed) throw new HttpError(400, 'Could not read this notice. Edit the assignment manually.');
    const assignmentId = await importAssignment(db, parsed);
    await db.prepare("UPDATE lighthouse_events SET status = 'imported', assignment_id = ? WHERE id = ?").bind(assignmentId, event.id).run();
    return reply({ ok: true, assignment_id: assignmentId });
  }

  throw new HttpError(404, 'Admin action not found.');
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    try {
      if (path === '/telegram/webhook' && request.method === 'POST') return await telegramWebhook(request, env);
      if (path.startsWith('/api/')) return await api(request, env, path);
      return env.ASSETS.fetch(request);
    } catch (error) {
      if (error instanceof HttpError) return reply({ error: error.message }, error.status);
      console.error('Request failed', error);
      if (/UNIQUE constraint failed/i.test(String(error))) return reply({ error: 'This item already exists.' }, 409);
      if (/FOREIGN KEY constraint failed/i.test(String(error))) return reply({ error: 'Referenced item does not exist.' }, 400);
      return reply({ error: 'Something went wrong. Please try again.' }, 500);
    }
  }
};
