import assert from 'node:assert/strict';
import test from 'node:test';

process.env.LINE_CHANNEL_SECRET = 'test';
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test';
process.env.GOOGLE_CLOUD_PROJECT = 'test-project';

const { bearerToken } = await import('./taskAuth.js');

test('extracts a bearer token case-insensitively', () => {
  assert.equal(bearerToken('bearer abc.def.ghi'), 'abc.def.ghi');
});

test('rejects non-bearer authorization', () => {
  assert.equal(bearerToken('Basic abc'), undefined);
  assert.equal(bearerToken(undefined), undefined);
});
