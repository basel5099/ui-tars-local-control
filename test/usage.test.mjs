import test from 'node:test';
import assert from 'node:assert/strict';
import { readUsage } from '../src/usage.mjs';
test('token measurement distinguishes valid provider usage from missing counts', () => {
  assert.deepEqual(readUsage({ prompt_tokens: 120, completion_tokens: 9, total_tokens: 129 }), { input: 120, output: 9, total: 129 });
  for (const usage of [undefined, {}, { total_tokens: 0 }, { prompt_tokens: -1, completion_tokens: 1, total_tokens: 0 }, { prompt_tokens: 5, completion_tokens: 2, total_tokens: 8 }]) assert.equal(readUsage(usage), null);
});
