import assert from 'node:assert/strict';
import test from 'node:test';

import { retryKeyForReminder } from './retryKey.js';

test('creates a stable UUID-shaped LINE retry key', () => {
  const first = retryKeyForReminder('reminder-123');
  assert.equal(first, retryKeyForReminder('reminder-123'));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.notEqual(first, retryKeyForReminder('reminder-456'));
});
