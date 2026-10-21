export const TIME_ZONE = 'Asia/Qyzylorda';

export const starterSubjects = [
  { name: 'Operating Systems', color: '#4F82D9' },
  { name: 'Design and Analysis of Algorithms', color: '#6867DD' },
  { name: 'Web Technologies I (Frontend)', color: '#A670D7' },
  { name: 'Introduction to Finance', color: '#D29650' },
  { name: 'Kazakh (Russian) Language I (Advanced)', color: '#D57891' }
];

// JS weekday: Sunday 0, Monday 1, ... Saturday 6. Only practical classes are seeded.
export const starterRules = [
  ['Operating Systems', 1, '11:00', '13:00', 'IEC-308'],
  ['Operating Systems', 2, '17:00', '17:50', 'C.1.2141K'],
  ['Design and Analysis of Algorithms', 1, '14:00', '15:50', 'C.1.2124'],
  ['Design and Analysis of Algorithms', 2, '16:00', '16:50', 'C.1.223K'],
  ['Web Technologies I (Frontend)', 1, '16:00', '17:50', 'C.1.245K'],
  ['Web Technologies I (Frontend)', 3, '19:00', '19:50', 'C.1.3264L'],
  ['Introduction to Finance', 2, '18:00', '19:50', 'C.1.223P'],
  ['Introduction to Finance', 3, '17:00', '17:50', 'C.1.2226P'],
  ['Introduction to Finance', 4, '14:00', '15:50', 'C.1.3234L'],
  ['Kazakh (Russian) Language I (Advanced)', 4, '16:00', '17:50', 'C.1.256P']
];

export function localToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const pick = type => parts.find(part => part.type === type).value;
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

export function weekStartFor(dateValue) {
  const date = new Date(`${String(dateValue).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid defense week date.');
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

export function datesForRule(rule, fromDate, days = 56) {
  const result = [];
  const date = new Date(`${fromDate}T00:00:00Z`);
  for (let offset = 0; offset < days; offset++) {
    if (date.getUTCDay() === Number(rule.weekday)) result.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return result;
}
