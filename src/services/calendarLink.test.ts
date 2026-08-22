import assert from 'node:assert/strict';
import test from 'node:test';

import { createGoogleCalendarLink } from './calendarLink.js';

test('creates a Google Calendar template with UTC start and end', () => {
  const link = createGoogleCalendarLink({
    cafe: { title: '測試咖啡', uri: 'https://maps.google.com/test' },
    startTime: '2026-08-22T14:00:00+08:00',
    durationMinutes: 90
  });
  const url = new URL(link);
  assert.equal(url.hostname, 'calendar.google.com');
  assert.equal(url.searchParams.get('dates'), '20260822T060000Z/20260822T073000Z');
  assert.equal(url.searchParams.get('location'), '測試咖啡');
});
