import assert from 'node:assert/strict';
import test from 'node:test';

import { createPendingPostbackData, parsePendingPostbackData } from './pendingActionData.js';

test('pending action postback data round-trips', () => {
  const data = createPendingPostbackData('confirm', 'abc123');
  assert.deepEqual(parsePendingPostbackData(data), { action: 'confirm', pendingId: 'abc123' });
});

test('unrelated postback data is rejected', () => {
  assert.equal(parsePendingPostbackData('feature=other&action=confirm&id=1'), undefined);
});
