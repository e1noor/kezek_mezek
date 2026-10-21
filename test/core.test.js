import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyTelegramInitData } from '../src/auth.js';
import { parseLighthouseAssignment } from '../src/lighthouse.js';
import { datesForRule, starterRules, weekStartFor } from '../src/schedule.js';

test('Telegram identity is accepted only with a fresh valid signature', async () => {
  const token = 'test-token';
  const now = 1791100000;
  const entries = [['auth_date', String(now)], ['signature', 'telegram-ed25519-signature'], ['user', JSON.stringify({ id: 123, first_name: 'Aruzhan' })]];
  const check = entries.map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  const raw = new URLSearchParams([...entries, ['hash', hash]]).toString();
  assert.equal((await verifyTelegramInitData(raw, token, now)).id, 123);
  assert.equal(await verifyTelegramInitData(raw.replace('Aruzhan', 'Elnur'), token, now), null);
  assert.equal(await verifyTelegramInitData(raw, token, now + 86401), null);
});

test('Lighthouse submission deadline stays separate from defense dates', () => {
  const parsed = parseLighthouseAssignment(`📋 New Assignment Posted!\n\n📚 Subject: Design and Analysis of Algorithms\n📝 Assignment: Assignment 2 is due\n👨‍🏫 Instructor: Rakhymbayeva Zhaniya\n📅 Due Date: 2026-10-07 23:59`);
  assert.deepEqual(parsed, {
    subject: 'Design and Analysis of Algorithms', title: 'Assignment 2',
    instructor: 'Rakhymbayeva Zhaniya', submissionDueAt: '2026-10-07 23:59'
  });
  assert.equal(parseLighthouseAssignment('Feedback for Assignment 2'), null);
});

test('starter schedule excludes Saturday lecture and uses corrected Monday OS time', () => {
  assert.ok(starterRules.some(([name, day, start, end]) => name === 'Operating Systems' && day === 1 && start === '11:00' && end === '13:00'));
  assert.ok(!starterRules.some(([, day]) => day === 6));
  assert.deepEqual(datesForRule({ weekday: 1 }, '2026-10-04', 10), ['2026-10-05', '2026-10-12']);
  assert.equal(weekStartFor('2026-10-07 23:59'), '2026-10-05');
  assert.deepEqual(datesForRule({ weekday: 1 }, '2026-10-05', 7), ['2026-10-05']);
});
