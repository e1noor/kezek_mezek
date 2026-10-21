import assert from 'node:assert/strict';

const base = process.env.APP_BASE || 'http://127.0.0.1:8787';
async function request(path, user = 1001, method = 'GET', body, extraHeaders = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { 'X-Demo-User': String(user), ...(body ? { 'content-type': 'application/json' } : {}), ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, data: await response.json() };
}
const get = async (path, user) => {
  const result = await request(path, user);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data;
};
const change = async (path, user, method, body) => {
  const result = await request(path, user, method, body);
  assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result.data));
  return result.data;
};

const admin = await get('/api/bootstrap', 1001);
assert.equal(admin.user.is_admin, true);
await get('/api/bootstrap', 1002);
await get('/api/bootstrap', 1003);
assert.equal((await request('/api/admin/overview', 1002)).status, 403);
const anonymous = await fetch(base + '/api/bootstrap');
assert.equal(anonymous.status, 401);
await change('/api/profile', 1001, 'PUT', { display_name: 'Aruzhan Demo' });
await change('/api/profile', 1002, 'PUT', { display_name: 'Elnur Demo' });
await change('/api/profile', 1003, 'PUT', { display_name: 'Dana Demo' });

const os = admin.subjects.find(item => item.name === 'Operating Systems');
assert.ok(os);
const stamp = Date.now();
const created = await change('/api/admin/assignments', 1001, 'POST', {
  subject_id: os.id, title: `Smoke Test ${stamp}`, submission_due_at: '2026-10-07 23:59'
});
const detail = await get(`/api/assignments/${created.id}`, 1001);
let monday = detail.sessions.find(item => new Date(`${item.session_date}T00:00:00Z`).getUTCDay() === 1);
let tuesday = detail.sessions.find(item => new Date(`${item.session_date}T00:00:00Z`).getUTCDay() === 2);
assert.ok(monday && tuesday, 'Monday and Tuesday practical sessions exist');
assert.ok(detail.sessions.every(item => [1, 2].includes(new Date(`${item.session_date}T00:00:00Z`).getUTCDay())), 'Only OS practical days are offered');
assert.equal(monday.capacity, 25);
assert.equal(detail.assignment.submission_due_at, '2026-10-07 23:59');
assert.equal((await request('/api/admin/sessions', 1001, 'POST', {
  assignment_id: created.id, session_date: '2026-10-04', start_time: '10:00', end_time: '10:50', capacity: 25
})).status, 400, 'An arbitrary Sunday queue cannot be added');

const extraDay = { session_date: '2026-10-08', start_time: '15:00', end_time: '15:50', room: 'Extra room' };
const assignmentEdit = { subject_id: os.id, title: `Smoke Test ${stamp}`, submission_due_at: '2026-10-07 23:59', defense_week_start: '2026-10-05' };
await change(`/api/admin/assignments/${created.id}`, 1001, 'PUT', { ...assignmentEdit, additional_days: [extraDay] });
const extraSessions = (await get(`/api/assignments/${created.id}`, 1002)).sessions;
const added = extraSessions.find(item => item.session_date === extraDay.session_date && item.start_time === extraDay.start_time);
assert.ok(added, 'The extra date appears on the assignment page');
assert.equal(added.room, 'Extra room');
const savedDays = await get(`/api/admin/assignments/${created.id}/days`, 1001);
assert.equal(savedDays.days[0].id, added.id);
assert.equal((await request(`/api/admin/assignments/${created.id}/days`, 1002)).status, 403);
await change(`/api/sessions/${added.id}/claim`, 1003, 'POST', { position: 1 });
await change(`/api/admin/assignments/${created.id}`, 1001, 'PUT', {
  ...assignmentEdit, defense_week_start: '2026-10-12', additional_days: [{ id: added.id, ...extraDay }]
});
assert.ok((await get(`/api/assignments/${created.id}`, 1003)).sessions.some(item => item.id === added.id),
  'A booked extra day survives a defense week change');
await change(`/api/admin/assignments/${created.id}`, 1001, 'PUT', {
  ...assignmentEdit, additional_days: [{ id: added.id, ...extraDay }]
});
assert.equal((await request(`/api/admin/assignments/${created.id}`, 1001, 'PUT',
  { ...assignmentEdit, additional_days: [] })).status, 409, 'A booked extra day cannot be removed');
await change(`/api/sessions/${added.id}/claim`, 1003, 'DELETE');
await change(`/api/admin/assignments/${created.id}`, 1001, 'PUT', { ...assignmentEdit, additional_days: [] });
assert.ok(!(await get(`/api/assignments/${created.id}`, 1002)).sessions.some(item => item.id === added.id));
const restoredSessions = (await get(`/api/assignments/${created.id}`, 1001)).sessions;
monday = restoredSessions.find(item => item.session_date === '2026-10-05');
tuesday = restoredSessions.find(item => item.session_date === '2026-10-06');

await change(`/api/sessions/${monday.id}/claim`, 1001, 'POST', { position: 4 });
const collision = await request(`/api/sessions/${monday.id}/claim`, 1002, 'POST', { position: 4 });
assert.equal(collision.status, 409);
await change(`/api/sessions/${monday.id}/claim`, 1002, 'POST', { position: 2 });
const secondDay = await request(`/api/sessions/${tuesday.id}/claim`, 1002, 'POST', { position: 1 });
assert.equal(secondDay.status, 409, 'A student cannot take a second day for the same assignment');
assert.match(secondDay.data.error, /already have a spot for this assignment/i);
assert.equal((await get(`/api/sessions/${tuesday.id}`, 1002)).my_booking.session_id, monday.id);
assert.equal((await get(`/api/sessions/${monday.id}`, 1001)).entries.length, 2);
assert.equal((await get(`/api/sessions/${tuesday.id}`, 1001)).entries.length, 0);
await change('/api/admin/queue', 1001, 'PUT', { session_id: monday.id, telegram_id: 1002, position: 5 });
assert.equal((await get(`/api/sessions/${monday.id}`, 1001)).entries.find(e => e.telegram_id === 1002).position, 5);
assert.equal((await request('/api/admin/queue', 1001, 'PUT', { session_id: tuesday.id, telegram_id: 1002, position: 1 })).status, 409);
await change(`/api/sessions/${monday.id}/claim`, 1002, 'DELETE');
await change(`/api/sessions/${tuesday.id}/claim`, 1002, 'POST', { position: 1 });
assert.equal((await get(`/api/sessions/${tuesday.id}`, 1001)).entries.length, 1);
assert.equal((await request('/api/admin/queue', 1002, 'PUT', { session_id: monday.id, telegram_id: 1001, position: 6 })).status, 403);

const oldAssignment = await change('/api/admin/assignments', 1001, 'POST', {
  subject_id: os.id, title: `Past Schedule ${stamp}`, defense_week_start: '2020-10-05'
});
const pastMonday = (await get(`/api/assignments/${oldAssignment.id}`, 1002)).sessions.find(item => item.session_date === '2020-10-05');
assert.ok(pastMonday, 'A past practical day remains visible');
await change(`/api/sessions/${pastMonday.id}/claim`, 1002, 'POST', { position: 3 });
assert.equal((await get(`/api/sessions/${pastMonday.id}`, 1002)).entries[0].position, 3);

const sourceText = `📋 New Assignment Posted!\n📚 Subject: Design and Analysis of Algorithms\n📝 Assignment: Imported ${stamp} is due\n👨‍🏫 Instructor: Rakhymbayeva Zhaniya\n📅 Due Date: 2026-10-07 23:59`;
const webhook = await request('/telegram/webhook', 1001, 'POST', {
  business_message: { message_id: stamp, chat: { id: 987654 }, from: { id: 876543, is_bot: true, first_name: 'X — Lighthouse' }, text: sourceText }
}, { 'X-Telegram-Bot-Api-Secret-Token': 'local-demo-secret' });
assert.equal(webhook.status, 200);
const pending = await get('/api/admin/overview', 1001);
const candidate = pending.events.find(item => item.message_id === stamp);
if (!pending.source) {
  assert.ok(candidate && candidate.status === 'pending');
  await change('/api/admin/lighthouse/approve', 1001, 'POST', { event_id: candidate.id });
} else {
  assert.equal(pending.source.chat_id, 987654);
  assert.equal(pending.source.bot_id, 876543);
}
const imported = await get('/api/admin/overview', 1001);
assert.ok(imported.assignments.some(item => item.title === `Imported ${stamp}` && item.source === 'lighthouse'));

const deleteDetails = imported.assignments.find(item => item.id === oldAssignment.id);
assert.equal(deleteDetails.booking_count, 1);
const deletion = { confirm_title: deleteDetails.title, expected_bookings: 1 };
assert.equal((await request(`/api/admin/assignments/${oldAssignment.id}`, 1002, 'DELETE', deletion)).status, 403);
assert.equal((await request(`/api/admin/assignments/${oldAssignment.id}`, 1001, 'DELETE',
  { ...deletion, confirm_title: 'Wrong assignment' })).status, 409);
assert.equal((await request(`/api/admin/assignments/${oldAssignment.id}`, 1001, 'DELETE',
  { ...deletion, expected_bookings: 0 })).status, 409);
await change(`/api/admin/assignments/${oldAssignment.id}`, 1001, 'DELETE', deletion);
assert.equal((await request(`/api/assignments/${oldAssignment.id}`, 1002)).status, 404);
assert.equal((await request(`/api/sessions/${pastMonday.id}`, 1002)).status, 404);
assert.ok(!(await get(`/api/subjects/${os.id}`, 1002)).assignments.some(item => item.id === oldAssignment.id));

console.log('Smoke checks passed: profile, timetable, extra defense day, booked-day protection, assignment deletion, one spot per assignment, seat conflict, admin move, Lighthouse approval and import.');
