import assert from 'node:assert/strict';
import test from 'node:test';

process.env.LINE_CHANNEL_SECRET = 'test';
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test';
process.env.GOOGLE_CLOUD_PROJECT = 'test-project';

const { geminiActionAgentInternals } = await import('./geminiActionAgent.js');

test('parses a save function call', () => {
  assert.deepEqual(
    geminiActionAgentInternals.parseDecision(
      [{ name: 'save_cafe', args: { cafe_number: 2 } }],
      ''
    ),
    { name: 'save_cafe', cafeNumber: 2 }
  );
});

test('parses a planned visit and applies the default duration', () => {
  assert.deepEqual(
    geminiActionAgentInternals.parseDecision(
      [{
        name: 'plan_cafe_visit',
        args: { cafe_number: 1, start_time: '2026-08-22T14:00:00+08:00' }
      }],
      ''
    ),
    {
      name: 'plan_cafe_visit',
      cafeNumber: 1,
      startTime: '2026-08-22T14:00:00+08:00',
      durationMinutes: 90
    }
  );
});

test('parses a scheduled reminder including zero-minute lead time', () => {
  assert.deepEqual(
    geminiActionAgentInternals.parseDecision(
      [{
        name: 'schedule_cafe_reminder',
        args: {
          cafe_number: 2,
          visit_time: '2026-08-22T18:05:00+08:00',
          remind_minutes_before: 0
        }
      }],
      ''
    ),
    {
      name: 'schedule_cafe_reminder',
      cafeNumber: 2,
      visitTime: '2026-08-22T18:05:00+08:00',
      durationMinutes: 90,
      remindMinutesBefore: 0
    }
  );
});

test('parses a reminder cancellation', () => {
  assert.deepEqual(
    geminiActionAgentInternals.parseDecision(
      [{ name: 'cancel_cafe_reminder', args: { reminder_number: 1 } }],
      ''
    ),
    { name: 'cancel_cafe_reminder', reminderNumber: 1 }
  );
});

test('falls back to model text when no function applies', () => {
  assert.deepEqual(
    geminiActionAgentInternals.parseDecision(undefined, '請先傳送位置。'),
    { name: 'none', reply: '請先傳送位置。' }
  );
});
