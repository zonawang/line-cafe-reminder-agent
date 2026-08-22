import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReminderSchedule, ReminderTimeError } from './reminderTime.js';

const now = Date.parse('2026-08-22T10:00:00+08:00');

test('calculates a reminder before a future visit', () => {
  assert.deepEqual(
    buildReminderSchedule({
      visitTime: '2026-08-22T14:00:00+08:00',
      remindMinutesBefore: 60,
      nowMs: now
    }),
    {
      visitAt: '2026-08-22T06:00:00.000Z',
      remindAt: '2026-08-22T05:00:00.000Z'
    }
  );
});

test('supports a zero-minute lead time for quick end-to-end tests', () => {
  const result = buildReminderSchedule({
    visitTime: '2026-08-22T10:05:00+08:00',
    remindMinutesBefore: 0,
    nowMs: now
  });
  assert.equal(result.visitAt, result.remindAt);
});

test('rejects reminders that are too soon or over 30 days away', () => {
  assert.throws(
    () => buildReminderSchedule({
      visitTime: '2026-08-22T10:00:20+08:00',
      remindMinutesBefore: 0,
      nowMs: now
    }),
    (error) => error instanceof ReminderTimeError && error.code === 'too_soon'
  );
  assert.throws(
    () => buildReminderSchedule({
      visitTime: '2026-09-30T10:00:00+08:00',
      remindMinutesBefore: 0,
      nowMs: now
    }),
    (error) => error instanceof ReminderTimeError && error.code === 'too_far'
  );
});
