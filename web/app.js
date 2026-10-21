const app = document.querySelector('#app');
const toastElement = document.querySelector('#toast');
const telegram = window.Telegram?.WebApp;
telegram?.ready();
telegram?.expand();

const state = { view: 'home', id: null, stack: [], boot: null, data: null, admin: null, tab: 'overview', demo: false, demoId: 1001, modal: null, pendingDeletion: null, showAllDates: false };
let extraDayCounter = 0;
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const shortDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const icons = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/></svg>',
  admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 10h8M8 14h8"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3-7 8-7s8 3 8 7"/></svg>'
};

function escape(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function prettyDate(value, options = { weekday: 'short', month: 'short', day: 'numeric' }) {
  if (!value) return 'No date';
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}
function dayNumber(value) { return value.slice(8, 10).replace(/^0/, ''); }
function initials(name) { return String(name || '?').trim().slice(0, 1).toUpperCase(); }
function styleColor(color) { return /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#6375F0'; }
function feedback(message) { toastElement.textContent = message; toastElement.classList.add('show'); clearTimeout(feedback.timer); feedback.timer = setTimeout(() => toastElement.classList.remove('show'), 3300); }

async function api(path, options = {}) {
  const headers = { ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers };
  if (telegram?.initData) headers['X-Telegram-Init-Data'] = telegram.initData;
  if (state.demo) headers['X-Demo-User'] = String(state.demoId);
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

async function refreshBootstrap() { state.boot = await api('/api/bootstrap'); }
async function refreshAdmin() { state.admin = await api('/api/admin/overview'); }

async function loadView() {
  if (state.view === 'subject') state.data = await api(`/api/subjects/${state.id}`);
  else if (state.view === 'assignment') state.data = await api(`/api/assignments/${state.id}`);
  else if (state.view === 'session') state.data = await api(`/api/sessions/${state.id}`);
  else if (state.view === 'admin') await refreshAdmin();
  else state.data = null;
}

async function navigate(view, id = null, push = true) {
  if (push && (state.view !== view || state.id !== id)) state.stack.push({ view: state.view, id: state.id });
  state.view = view; state.id = id; if (view === 'assignment') state.showAllDates = false;
  app.innerHTML = '<div class="loading"><div class="brand-mark">K<span>●</span></div><p>Loading…</p></div>';
  try { await loadView(); render(); window.scrollTo(0, 0); }
  catch (error) { feedback(error.message); state.view = 'home'; state.id = null; render(); }
}

function goBack() {
  if (state.modal) { state.modal = null; render(); return; }
  const previous = state.stack.pop();
  if (previous) navigate(previous.view, previous.id, false);
  else navigate('home', null, false);
}
telegram?.BackButton?.onClick(goBack);

function shell(content) {
  const user = state.boot.user;
  const active = state.view === 'home' || state.view === 'subject' || state.view === 'assignment' || state.view === 'session' ? 'home' : state.view;
  const navButton = (id, icon, label) => `<button data-action="nav" data-view="${id}" class="${active === id ? 'active' : ''}">${icons[icon]}<span>${label}</span></button>`;
  telegram?.BackButton?.[state.stack.length || state.modal ? 'show' : 'hide']();
  return `<nav class="bottom-nav" aria-label="Main navigation">${navButton('home', 'home', 'Home')}${navButton('schedule', 'calendar', 'Schedule')}${user.is_admin ? navButton('admin', 'admin', 'Admin') : ''}${navButton('profile', 'user', 'Profile')}</nav>
    <div class="shell"><header class="topbar"><div class="brand"><span class="brand-mark">K<span>●</span></span><span>kezek mezek</span></div><div class="top-right"><span class="avatar" title="${escape(user.display_name)}">${escape(initials(user.display_name))}</span></div></header>${content}<p class="footer-note">Made for calmer defense days · Times in Qyzylorda</p></div>${state.modal || ''}`;
}

function cardSubject(subject) {
  const icon = initials(subject.name);
  return `<button class="subject-card" data-action="subject" data-id="${subject.id}"><span class="subject-icon" style="background:${styleColor(subject.color)}">${escape(icon)}</span><b>${escape(subject.name)}</b><small>${subject.assignment_count} assignment${subject.assignment_count === 1 ? '' : 's'} <span aria-hidden="true">→</span></small></button>`;
}

function homeView() {
  const user = state.boot.user;
  const upcoming = state.boot.schedule.filter(rule => rule.kind === 'practical').slice(0, 7);
  return `<section class="hero"><div><div class="eyebrow" style="color:#a8e8c9">WELCOME BACK, ${escape(user.display_name.split(' ')[0].toUpperCase())}</div><h1>Know your place.<br>Own your turn.</h1><p>Assignment defenses without searching through chat. Pick a subject, choose a class day, and take a free spot.</p></div><div class="hero-art"><div class="ticket"><i></i><i></i><i></i><strong>#04</strong></div></div></section>
    <div class="section-heading"><div><h2>Your subjects</h2><p>Choose a course to see its assignments</p></div><span class="tag green">${state.boot.subjects.length} courses</span></div>
    <div class="subject-grid">${state.boot.subjects.map(cardSubject).join('') || '<div class="empty">No subjects yet.</div>'}</div>
    <div class="section-heading"><div><h2>Practical classes</h2><p>Queues follow these class days</p></div><button class="text-link" data-action="nav" data-view="schedule">Full schedule →</button></div>
    <div class="schedule-strip">${upcoming.map(rule => `<div class="schedule-pill"><b>${escape(rule.subject_name)}</b><span>${weekdays[rule.weekday]} · ${rule.start_time}–${rule.end_time}</span></div>`).join('')}</div>`;
}

function scheduleView() {
  const groups = [1, 2, 3, 4, 5, 6, 0].map(day => ({ day, rules: state.boot.schedule.filter(rule => rule.weekday === day && rule.kind === 'practical') }));
  return `<div class="page-head"><div class="eyebrow">SE-2514 · PRACTICAL CLASSES</div><h1>Weekly schedule</h1><p>Defense queues follow these practical classes.</p></div>
    ${groups.map(group => `<div class="date-title"><span>${weekdays[group.day]}</span><span>${group.rules.length} class${group.rules.length === 1 ? '' : 'es'}</span></div><div class="stack">${group.rules.map(rule => `<div class="list-card"><div class="session-card"><span class="subject-icon" style="background:${styleColor(rule.subject_color)};margin:0">${escape(initials(rule.subject_name))}</span><div><h3>${escape(rule.subject_name)}</h3><p>${rule.start_time}–${rule.end_time}${rule.room ? ' · ' + escape(rule.room) : ''}</p></div></div><span class="tag">Practical</span></div>`).join('') || '<div class="empty"><p>No practical class</p></div>'}</div>`).join('')}`;
}

function subjectView() {
  const { subject, assignments } = state.data;
  return `<div class="breadcrumb"><button data-action="nav" data-view="home">Home</button><span>›</span><span>${escape(subject.name)}</span></div><div class="page-head"><div class="eyebrow">SUBJECT</div><h1>${escape(subject.name)}</h1><p>${assignments.length} assignment${assignments.length === 1 ? '' : 's'} available</p></div>
    <div class="stack">${assignments.map(item => `<button class="list-card" data-action="assignment" data-id="${item.id}"><div><h3>${escape(item.title)}</h3><p>${item.submission_due_at ? `Submission due ${escape(prettyDate(item.submission_due_at))} · ` : ''}${item.session_count} defense dates</p></div><span class="chevron">›</span></button>`).join('') || '<div class="empty"><strong>No assignments yet</strong><p>New Lighthouse notices and admin additions will appear here.</p></div>'}</div>`;
}

function assignmentView() {
  const { assignment, sessions, my_booking: myBooking } = state.data;
  const groups = new Map();
  for (const session of sessions) {
    const key = session.session_date;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(session);
  }
  const dateGroups = [...groups.entries()];
  const visibleGroups = state.showAllDates ? dateGroups : dateGroups.slice(0, 4);
  return `<div class="breadcrumb"><button data-action="nav" data-view="home">Home</button><span>›</span><button data-action="subject" data-id="${assignment.subject_id}">${escape(assignment.subject_name)}</button><span>›</span><span>${escape(assignment.title)}</span></div>
    <div class="page-head"><div class="eyebrow">ASSIGNMENT</div><h1>${escape(assignment.title)}</h1><p>${escape(assignment.subject_name)}</p></div>
    <div class="detail-banner"><b>📥 Submission due</b><p>${assignment.submission_due_at ? escape(prettyDate(assignment.submission_due_at, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })) + ' at ' + escape(assignment.submission_due_at.slice(11)) : 'Not specified'}</p><span class="muted">This is the Moodle submission deadline, not your defense date.</span>${assignment.notes ? `<p>${escape(assignment.notes)}</p>` : ''}</div>
    <div class="section-heading"><div><h2>Choose a defense day</h2><p>${dateGroups.length ? `Available dates: ${escape(dateGroups.map(([date]) => prettyDate(date, { month: 'short', day: 'numeric' })).join(' · '))}. ` : ''}One spot per assignment.</p></div></div>
    ${myBooking ? `<div class="notice" style="background:#e7f8ef;color:#357556">Your spot: #${myBooking.position} on ${escape(prettyDate(myBooking.session_date))}. Leave it before choosing another day.</div>` : ''}
    ${visibleGroups.map(([date, items]) => `<div class="date-title"><span>${escape(prettyDate(date, { weekday: 'long', month: 'long', day: 'numeric' }))}</span><span>${items.length} session${items.length === 1 ? '' : 's'}</span></div><div class="stack">${items.map(session => `<button class="list-card" data-action="session" data-id="${session.id}"><div class="session-card"><span class="date-tile">${dayNumber(date)}</span><div><strong>${session.start_time}–${session.end_time}</strong><small>${session.room ? escape(session.room) + ' · ' : ''}${session.taken}/${session.capacity} spots taken</small></div></div>${myBooking?.session_id === session.id ? '<span class="tag green">Your day</span>' : '<span class="chevron">›</span>'}</button>`).join('')}</div>`).join('') || '<div class="empty"><strong>No defense days yet</strong><p>An admin can add a practical class for this subject.</p></div>'}
    ${dateGroups.length > 4 ? `<button class="button secondary" style="width:100%;margin-top:18px" data-action="toggle-dates">${state.showAllDates ? 'Show fewer dates' : `Show all ${dateGroups.length} dates`}</button>` : ''}`;
}

function sessionView() {
  const { session, entries, my_booking: myBooking } = state.data;
  const byPosition = new Map(entries.map(item => [item.position, item]));
  const own = entries.find(item => Number(item.telegram_id) === Number(state.boot.user.telegram_id));
  const bookedElsewhere = myBooking && Number(myBooking.session_id) !== Number(session.id);
  return `<div class="breadcrumb"><button data-action="nav" data-view="home">Home</button><span>›</span><button data-action="assignment" data-id="${session.assignment_id}">${escape(session.assignment_title)}</button><span>›</span><span>Queue</span></div>
    <div class="queue-head"><div><div class="eyebrow" style="color:#9fdfc0">DEFENSE QUEUE</div><h1>${escape(prettyDate(session.session_date, { weekday: 'long', month: 'long', day: 'numeric' }))}</h1><p>${escape(session.subject_name)} · ${session.start_time}–${session.end_time}${session.room ? ' · ' + escape(session.room) : ''}</p></div><div class="queue-count"><strong>${entries.length}</strong><span>of ${session.capacity}</span></div></div>
    ${own ? `<div class="notice" style="background:#e7f8ef;color:#357556">You have spot #${own.position}. Tap another free spot to move, or tap yours to leave.</div>` : bookedElsewhere ? `<div class="notice">You already have spot #${myBooking.position} on ${escape(prettyDate(myBooking.session_date))}. <button class="text-link" data-action="session" data-id="${myBooking.session_id}">Go to your queue</button> and leave it before choosing this day.</div>` : '<div class="notice">Tap any free number to take your place. You can change it later.</div>'}
    <div class="legend"><span><i class="dot"></i>Free</span><span><i class="dot taken"></i>Taken</span><span><i class="dot mine"></i>Yours</span></div>
    <div class="queue-grid">${Array.from({ length: session.capacity }, (_, index) => {
      const number = index + 1;
      const entry = byPosition.get(number);
      const mine = entry && Number(entry.telegram_id) === Number(state.boot.user.telegram_id);
      return `<button class="seat ${mine ? 'mine' : entry ? 'taken' : 'free'}" data-action="${mine ? 'leave' : entry ? 'none' : 'claim'}" data-position="${number}" ${entry && !mine || bookedElsewhere ? 'disabled' : ''}><span class="num">${number}</span><span class="seat-text"><b>${entry ? escape(entry.display_name) : 'Available'}</b><small>${mine ? 'Your spot' : entry ? 'Taken' : bookedElsewhere ? 'Choose one day' : 'Tap to join'}</small></span></button>`;
    }).join('')}</div>
    ${state.boot.user.is_admin ? `<div class="section-heading"><h3>Admin controls</h3></div><div class="row-actions" style="justify-content:flex-start"><button class="button secondary" data-action="admin-session-edit">Edit this queue</button><button class="button" data-action="admin-place">Place a student</button></div><div class="admin-list" style="margin-top:12px">${entries.map(entry => `<div class="admin-card"><div><strong>#${entry.position} ${escape(entry.display_name)}</strong><span>${escape(entry.telegram_username ? '@' + entry.telegram_username : 'Telegram ID ' + entry.telegram_id)}</span></div><button class="button danger tiny" data-action="admin-remove" data-user="${entry.telegram_id}">Remove</button></div>`).join('')}</div>` : ''}`;
}

function profileView() {
  const user = state.boot.user;
  return `<div class="page-head"><div class="eyebrow">YOUR ACCOUNT</div><h1>Profile</h1><p>Your queue spots are tied to your Telegram account.</p></div><div class="detail-banner"><div class="session-card"><span class="avatar" style="width:52px;height:52px;font-size:19px">${escape(initials(user.display_name))}</span><div><b>${escape(user.display_name)}</b><p>${user.telegram_username ? '@' + escape(user.telegram_username) : 'Telegram ID ' + user.telegram_id}</p></div></div></div><button class="button secondary" data-action="edit-name">Edit displayed name</button><div class="notice">Changing your name updates it in all of your queue spots.</div>`;
}

function adminView() {
  const data = state.admin;
  const tabs = ['overview', 'subjects', 'schedule', 'assignments', 'queues', 'students', 'lighthouse'];
  const toolbar = `<div class="admin-tabs">${tabs.map(tab => `<button data-action="admin-tab" data-tab="${tab}" class="${state.tab === tab ? 'active' : ''}">${tab === 'queues' ? 'Queues' : tab.charAt(0).toUpperCase() + tab.slice(1)}</button>`).join('')}</div>`;
  let content = '';
  if (state.tab === 'overview') content = `<div class="admin-stats"><div class="stat"><strong>${data.subjects.filter(x => !x.archived).length}</strong><span>Subjects</span></div><div class="stat"><strong>${data.assignments.filter(x => !x.archived).length}</strong><span>Assignments</span></div><div class="stat"><strong>${data.students.length}</strong><span>Students</span></div></div><div class="section-heading"><h2>Quick actions</h2></div><div class="stack"><button class="list-card" data-action="open-form" data-type="assignment"><div><h3>＋ Add an assignment</h3><p>For midterms, finals, electives, and missing notices</p></div><span class="chevron">›</span></button><button class="list-card" data-action="open-form" data-type="schedule"><div><h3>＋ Add a practical class</h3><p>Its defense queue appears for the assignment week</p></div><span class="chevron">›</span></button><button class="list-card" data-action="open-form" data-type="subject"><div><h3>＋ Add a subject</h3><p>Make an elective available to your group</p></div><span class="chevron">›</span></button></div>`;
  if (state.tab === 'subjects') content = `<div class="section-heading"><h2>Subjects</h2><button class="button tiny" data-action="open-form" data-type="subject">＋ Add</button></div><div class="admin-list">${data.subjects.map(item => adminRow(item.name, `${item.archived ? 'Archived' : 'Visible'} · ${item.color}`, 'subject', item.id)).join('')}</div>`;
  if (state.tab === 'schedule') content = `<div class="section-heading"><h2>Practical classes</h2><button class="button tiny" data-action="open-form" data-type="schedule">＋ Add</button></div><div class="admin-list">${data.rules.map(item => adminRow(item.subject_name, `${weekdays[item.weekday]} ${item.start_time}–${item.end_time} · ${item.room || 'No room'}${item.active ? '' : ' · Inactive'}`, 'schedule', item.id)).join('')}</div>`;
  if (state.tab === 'assignments') content = `<div class="section-heading"><h2>Assignments</h2><button class="button tiny" data-action="open-form" data-type="assignment">＋ Add</button></div><div class="admin-list">${data.assignments.map(item => adminRow(item.title, `${item.subject_name} · ${item.source}${item.archived ? ' · Archived' : ''}`, 'assignment', item.id)).join('')}</div>`;
  if (state.tab === 'queues') content = `<div class="section-heading"><h2>Defense queues</h2></div><div class="admin-list">${data.sessions.map(item => `<div class="admin-card"><div><strong>${escape(item.assignment_title)}</strong><span>${escape(item.subject_name)} · ${prettyDate(item.session_date)} ${item.start_time} · ${item.taken}/${item.capacity} taken</span></div><div class="row-actions"><button class="button secondary tiny" data-action="session" data-id="${item.id}">View</button><button class="button tiny" data-action="open-form" data-type="session" data-id="${item.id}">Edit places</button></div></div>`).join('') || '<div class="empty">No queues yet.</div>'}</div>`;
  if (state.tab === 'students') content = `<div class="section-heading"><h2>Registered students</h2><span class="tag">${data.students.length}</span></div><div class="admin-list">${data.students.map(item => `<div class="admin-card"><div><strong>${escape(item.display_name)}</strong><span>${item.telegram_username ? '@' + escape(item.telegram_username) : 'Telegram ID ' + item.telegram_id}${data.admins.some(a => a.telegram_id === item.telegram_id) ? ' · Admin' : ''}</span></div>${!data.admins.some(a => a.telegram_id === item.telegram_id) ? `<button class="button secondary tiny" data-action="make-admin" data-user="${item.telegram_id}">Make admin</button>` : ''}</div>`).join('')}</div>`;
  if (state.tab === 'lighthouse') content = `<div class="section-heading"><h2>Lighthouse connection</h2></div><div class="detail-banner"><b>${data.source ? 'Connected source: ' + escape(data.source.label) : 'Waiting for a Lighthouse notice'}</b><p>${data.source ? 'Future assignment notices from this chat are published automatically.' : 'After you connect this bot to only the Lighthouse chat, the next assignment notice will appear below for one-time approval.'}</p></div><div class="admin-list">${data.events.map(item => `<div class="admin-card"><div><strong>${escape(item.sender_name || 'Bot message')}</strong><span>${escape(item.text.slice(0, 190))}</span><span>Status: ${item.status}</span></div>${item.status === 'pending' ? `<button class="button tiny" data-action="approve-source" data-id="${item.id}">Trust source</button>` : item.status === 'error' ? `<button class="button secondary tiny" data-action="retry-source" data-id="${item.id}">Retry</button>` : ''}</div>`).join('') || '<div class="empty"><strong>No notices received yet</strong><p>Only new messages appear after connection.</p></div>'}</div>`;
  return `<div class="page-head"><div class="eyebrow">CONTROL ROOM</div><h1>Manage the queue</h1><p>Subjects, defense days, spots, and Lighthouse in one place.</p></div>${toolbar}${content}`;
}

function adminRow(name, detail, type, id) {
  return `<div class="admin-card"><div><strong>${escape(name)}</strong><span>${escape(detail)}</span></div><div class="row-actions"><button class="button secondary tiny" data-action="open-form" data-type="${type}" data-id="${id}">Edit</button>${type === 'assignment' ? `<button class="button danger tiny" data-action="delete-assignment" data-id="${id}">Delete</button>` : ''}</div></div>`;
}

function onboarding() {
  return `<div class="onboard-wrap"><div class="onboard-card"><div class="brand-mark">K<span>●</span></div><div class="eyebrow">WELCOME TO KEZEK MEZEK</div><h1>What should we call you?</h1><p>This name will appear beside your place in the defense queue. We will remember it for your Telegram account.</p><form id="name-form"><div class="field"><label for="display-name">Your name</label><input id="display-name" name="display_name" autocomplete="name" maxlength="60" placeholder="e.g. Elnur" required autofocus></div><button class="button" type="submit">Continue →</button></form></div></div>`;
}

function modal(title, fields, formType, itemId = '') {
  const deleteButton = formType === 'assignment' && itemId
    ? `<button class="button danger delete-assignment-action" type="button" data-action="delete-assignment" data-id="${itemId}">Delete entire assignment</button>` : '';
  state.modal = `<div class="modal-backdrop" data-action="close-modal"><div class="modal" role="dialog" aria-modal="true" aria-label="${escape(title)}"><div class="modal-head"><h2>${escape(title)}</h2><button class="icon-btn" type="button" data-action="close-modal" aria-label="Close">×</button></div><form id="admin-form" data-type="${formType}" data-id="${itemId}">${fields}<div class="modal-actions"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button" type="submit">Save changes</button></div>${deleteButton}</form></div></div>`;
  render();
}

function field(name, label, value = '', type = 'text', extra = '') {
  return `<div class="field"><label for="f-${name}">${escape(label)}</label><input id="f-${name}" name="${name}" type="${type}" value="${escape(value ?? '')}" ${extra}></div>`;
}
function selectField(name, label, options, value) {
  return `<div class="field"><label for="f-${name}">${escape(label)}</label><select name="${name}" id="f-${name}">${options.map(([id, text]) => `<option value="${escape(id)}" ${String(id) === String(value) ? 'selected' : ''}>${escape(text)}</option>`).join('')}</select></div>`;
}
function checkField(name, label, checked) { return `<label class="check-field"><input name="${name}" type="checkbox" ${checked ? 'checked' : ''}>${escape(label)}</label>`; }

function extraDayRow(day = {}) {
  const key = ++extraDayCounter;
  const locked = Number(day.taken) > 0;
  const rowField = (name, label, value, type, extra = '') => `<div class="field"><label for="extra-${key}-${name}">${label}</label><input id="extra-${key}-${name}" data-extra-field="${name}" type="${type}" value="${escape(value || '')}" ${extra}></div>`;
  return `<div class="extra-day" data-extra-day data-id="${day.id || ''}">
    <div class="extra-day-head"><strong>${day.session_date ? escape(prettyDate(day.session_date, { weekday: 'short', month: 'short', day: 'numeric' })) : 'New defense day'}</strong><button class="text-link" type="button" data-action="remove-defense-day" ${locked ? 'disabled' : ''}>Remove</button></div>
    ${rowField('session_date', 'Date', day.session_date, 'date', `required ${locked ? 'disabled' : ''}`)}
    <div class="split">${rowField('start_time', 'Start', day.start_time, 'time', `required ${locked ? 'disabled' : ''}`)}${rowField('end_time', 'End', day.end_time, 'time', `required ${locked ? 'disabled' : ''}`)}</div>
    ${rowField('room', 'Room (optional)', day.room, 'text', 'maxlength="60"')}
    ${locked ? `<p class="muted">${day.taken} spot${day.taken === 1 ? '' : 's'} taken. Clear them before changing this date or time.</p>` : ''}
  </div>`;
}

async function openForm(type, id) {
  const admin = state.admin;
  const subjectOptions = admin.subjects.filter(x => !x.archived).map(x => [x.id, x.name]);
  let item, fields, title;
  if (type === 'subject') {
    item = admin.subjects.find(x => x.id === Number(id)) || {};
    title = id ? 'Edit subject' : 'Add subject';
    fields = field('name', 'Subject name', item.name, 'text', 'required maxlength="120"') + field('color', 'Color', item.color || '#6375F0', 'color') + (id ? checkField('archived', 'Archive this subject', item.archived) : '');
  } else if (type === 'schedule') {
    item = admin.rules.find(x => x.id === Number(id)) || {};
    title = id ? 'Edit practical class' : 'Add practical class';
    fields = selectField('subject_id', 'Subject', subjectOptions, item.subject_id) + selectField('weekday', 'Day', [1,2,3,4,5,6,0].map(day => [day, weekdays[day]]), item.weekday ?? 1) + `<div class="split">${field('start_time', 'Start', item.start_time || '10:00', 'time', 'required')}${field('end_time', 'End', item.end_time || '10:50', 'time', 'required')}</div>` + field('room', 'Room (optional)', item.room) + (id ? checkField('active', 'Active every week', item.active) : '');
  } else if (type === 'assignment') {
    item = admin.assignments.find(x => x.id === Number(id)) || {};
    title = id ? 'Edit assignment' : 'Add assignment';
    const extraDays = id ? (await api(`/api/admin/assignments/${id}/days`)).days : [];
    fields = selectField('subject_id', 'Subject', subjectOptions, item.subject_id) + field('title', 'Assignment title', item.title, 'text', 'required maxlength="160"') + field('instructor', 'Instructor (optional)', item.instructor) + field('submission_due_at', 'Moodle submission due (optional)', item.submission_due_at?.replace(' ', 'T') || '', 'datetime-local') + field('defense_week_start', 'Defense week (choose any date in that week)', item.defense_week_start || '', 'date') + '<p class="muted">Leave blank to use the submission deadline week.</p>' + (id ? `<div class="extra-days-heading"><div><strong>Additional defense days</strong><p class="muted">Add any date. Set the time and room for its queue.</p></div><button class="button secondary tiny" type="button" data-action="add-defense-day">＋ Add date</button></div><div id="extra-days">${extraDays.map(extraDayRow).join('')}</div>` : '') + `<div class="field"><label for="f-notes">Notes (optional)</label><textarea name="notes" id="f-notes">${escape(item.notes || '')}</textarea></div>` + (id ? checkField('archived', 'Archive this assignment', item.archived) : '');
  } else if (type === 'session') {
    item = admin.sessions.find(x => x.id === Number(id)) || {};
    if (!id || !item.id) return;
    title = 'Edit places';
    fields = `<div class="notice">${escape(item.assignment_title)} · ${escape(prettyDate(item.session_date))} · ${escape(item.start_time)}–${escape(item.end_time)}</div>` + field('capacity', 'Number of places', item.capacity || 25, 'number', 'required min="1" max="200"');
  } else return;
  modal(title, fields, type, id || '');
}

function render() {
  if (!state.boot) return;
  if (!state.boot.user.display_name) { app.innerHTML = onboarding(); return; }
  const views = { home: homeView, schedule: scheduleView, subject: subjectView, assignment: assignmentView, session: sessionView, admin: adminView, profile: profileView };
  app.innerHTML = shell((views[state.view] || homeView)());
}

function confirmModal(message, action, data = '') {
  state.modal = `<div class="modal-backdrop" data-action="close-modal"><div class="modal" role="dialog" aria-modal="true"><h2>${escape(message)}</h2><div class="modal-actions"><button class="button secondary" data-action="close-modal">Cancel</button><button class="button danger" data-action="${action}" ${data}>Confirm</button></div></div></div>`;
  render();
}

async function deleteAssignmentModal(id) {
  await refreshAdmin();
  const item = state.admin.assignments.find(assignment => assignment.id === id);
  if (!item) throw new Error('Assignment not found. Refresh the list.');
  state.pendingDeletion = { id, title: item.title, bookingCount: Number(item.booking_count) };
  const sessions = Number(item.session_count);
  const bookings = Number(item.booking_count);
  state.modal = `<div class="modal-backdrop" data-action="close-modal"><div class="modal" role="dialog" aria-modal="true" aria-label="Delete assignment">
    <h2>Delete ${escape(item.title)}?</h2>
    <div class="warning">This permanently deletes the entire assignment, all ${sessions} defense queue${sessions === 1 ? '' : 's'}, and ${bookings} booked spot${bookings === 1 ? '' : 's'}.</div>
    <div class="modal-actions"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button danger" type="button" data-action="confirm-delete-assignment">Delete entire assignment</button></div>
  </div></div>`;
  render();
}

async function handleClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  if (action === 'close-modal') {
    if (target.classList.contains('modal-backdrop') && event.target !== target) return;
    state.modal = null; state.pendingDeletion = null; render(); return;
  }
  try {
    if (action === 'nav') await navigate(target.dataset.view);
    else if (['subject','assignment','session'].includes(action)) await navigate(action, Number(target.dataset.id));
    else if (action === 'toggle-dates') { state.showAllDates = !state.showAllDates; render(); }
    else if (action === 'admin-tab') { state.tab = target.dataset.tab; render(); }
    else if (action === 'open-form') await openForm(target.dataset.type, target.dataset.id);
    else if (action === 'delete-assignment') await deleteAssignmentModal(Number(target.dataset.id));
    else if (action === 'confirm-delete-assignment') {
      const deletion = state.pendingDeletion;
      if (!deletion) throw new Error('Reopen the delete confirmation.');
      target.disabled = true;
      await api(`/api/admin/assignments/${deletion.id}`, { method: 'DELETE', body: JSON.stringify({ confirm_title: deletion.title, expected_bookings: deletion.bookingCount }) });
      state.pendingDeletion = null;
      state.modal = null;
      await refreshBootstrap(); await refreshAdmin();
      render(); feedback('Assignment deleted.');
    }
    else if (action === 'add-defense-day') {
      const form = target.closest('form');
      const subjectId = Number(form.elements.subject_id.value);
      const rule = state.admin.rules.find(item => item.subject_id === subjectId && item.active);
      const day = { start_time: rule?.start_time || '10:00', end_time: rule?.end_time || '10:50', room: rule?.room || '' };
      form.querySelector('#extra-days').insertAdjacentHTML('beforeend', extraDayRow(day));
      form.querySelector('#extra-days .extra-day:last-child input[type="date"]').focus();
    }
    else if (action === 'remove-defense-day') target.closest('[data-extra-day]').remove();
    else if (action === 'claim') {
      target.disabled = true;
      state.data = await api(`/api/sessions/${state.id}/claim`, { method: 'POST', body: JSON.stringify({ position: Number(target.dataset.position) }) });
      feedback(`Spot #${target.dataset.position} is yours.`); render();
    } else if (action === 'leave') confirmModal('Leave this queue?', 'confirm-leave');
    else if (action === 'confirm-leave') { state.modal = null; state.data = await api(`/api/sessions/${state.id}/claim`, { method: 'DELETE' }); feedback('Your spot is free again.'); render(); }
    else if (action === 'edit-name') modal('Edit displayed name', field('display_name', 'Your name', state.boot.user.display_name, 'text', 'required maxlength="60"'), 'profile');
    else if (action === 'admin-session-edit') { await refreshAdmin(); openForm('session', state.id); }
    else if (action === 'admin-place') {
      await refreshAdmin();
      modal('Place a student', selectField('telegram_id', 'Registered student', state.admin.students.map(x => [x.telegram_id, x.display_name]), '') + field('position', 'Spot number', '', 'number', `required min="1" max="${state.data.session.capacity}"`), 'queue');
    } else if (action === 'admin-remove') confirmModal('Remove this student?', 'confirm-remove', `data-user="${target.dataset.user}"`);
    else if (action === 'confirm-remove') { state.modal = null; await api('/api/admin/queue', { method: 'DELETE', body: JSON.stringify({ session_id: state.id, telegram_id: Number(target.dataset.user) }) }); state.data = await api(`/api/sessions/${state.id}`); feedback('Spot removed.'); render(); }
    else if (action === 'make-admin') confirmModal('Give this student admin access?', 'confirm-admin', `data-user="${target.dataset.user}"`);
    else if (action === 'confirm-admin') { state.modal = null; await api('/api/admin/admins', { method: 'POST', body: JSON.stringify({ telegram_id: Number(target.dataset.user) }) }); await refreshAdmin(); feedback('Admin added.'); render(); }
    else if (action === 'approve-source') confirmModal('Trust this Lighthouse chat?', 'confirm-source', `data-id="${target.dataset.id}"`);
    else if (action === 'confirm-source') { state.modal = null; await api('/api/admin/lighthouse/approve', { method: 'POST', body: JSON.stringify({ event_id: Number(target.dataset.id) }) }); await refreshAdmin(); await refreshBootstrap(); feedback('Lighthouse source approved.'); render(); }
    else if (action === 'retry-source') { await api('/api/admin/lighthouse/retry', { method: 'POST', body: JSON.stringify({ event_id: Number(target.dataset.id) }) }); await refreshAdmin(); await refreshBootstrap(); feedback('Assignment imported.'); render(); }
  } catch (error) { target.disabled = false; feedback(error.message); }
}

async function handleSubmit(event) {
  const form = event.target;
  if (form.id !== 'name-form' && form.id !== 'admin-form') return;
  event.preventDefault();
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  const data = Object.fromEntries(new FormData(form));
  try {
    if (form.id === 'name-form') {
      await api('/api/profile', { method: 'PUT', body: JSON.stringify(data) });
      await refreshBootstrap(); render(); feedback('Welcome to Kezek Mezek!'); return;
    }
    const type = form.dataset.type, id = form.dataset.id;
    if (['subject','schedule','assignment','session'].includes(type)) {
      for (const key of ['archived','active']) if (type === 'subject' && key === 'archived' && id || type === 'schedule' && key === 'active' && id || type === 'assignment' && key === 'archived' && id) data[key] = form.elements[key]?.checked || false;
      if (data.submission_due_at) data.submission_due_at = data.submission_due_at.replace('T', ' ');
      if (type === 'assignment' && id) data.additional_days = [...form.querySelectorAll('[data-extra-day]')].map(row => ({
        ...(row.dataset.id ? { id: Number(row.dataset.id) } : {}),
        ...Object.fromEntries([...row.querySelectorAll('[data-extra-field]')].map(input => [input.dataset.extraField, input.value]))
      }));
      const plural = { subject: 'subjects', schedule: 'schedule', assignment: 'assignments', session: 'sessions' }[type];
      const saved = await api(`/api/admin/${plural}${id ? '/' + id : ''}`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) });
      if (type === 'session' && saved.session_id) state.id = Number(saved.session_id);
      await refreshBootstrap(); await refreshAdmin();
      if (state.view === 'session') state.data = await api(`/api/sessions/${state.id}`);
    } else if (type === 'queue') {
      await api('/api/admin/queue', { method: 'PUT', body: JSON.stringify({ session_id: state.id, telegram_id: Number(data.telegram_id), position: Number(data.position) }) });
      state.data = await api(`/api/sessions/${state.id}`);
    } else if (type === 'profile') {
      await api('/api/profile', { method: 'PUT', body: JSON.stringify(data) });
      await refreshBootstrap();
    }
    state.modal = null; render(); feedback('Saved.');
  } catch (error) { button.disabled = false; feedback(error.message); }
}

app.addEventListener('click', handleClick);
app.addEventListener('submit', handleSubmit);

async function init() {
  try {
    const meta = await api('/api/meta');
    state.demo = !telegram?.initData && meta.demo && ['localhost', '127.0.0.1'].includes(location.hostname);
    if (!telegram?.initData && !state.demo) {
      app.innerHTML = '<div class="onboard-wrap"><div class="onboard-card"><div class="brand-mark">K<span>●</span></div><h1>Open in Telegram</h1><p>Open the bot, then tap Open App to join a queue.</p><a class="button" href="https://t.me/kezek_mezek_bot">Open @kezek_mezek_bot</a></div></div>';
      return;
    }
    await refreshBootstrap(); render();
  } catch (error) {
    app.innerHTML = `<div class="onboard-wrap"><div class="onboard-card"><h1>Could not open the app</h1><p>${escape(error.message)}</p><button class="button" onclick="location.reload()">Try again</button></div></div>`;
  }
}

init();
