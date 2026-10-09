import test from 'node:test';
import assert from 'node:assert/strict';
import { imageTokens, estimate } from './estimate.mjs';
test('image reference estimate accounts for tiles, resizing, and replay multiplicity', () => {
  assert.equal(imageTokens(700, 450), 425);
  assert.equal(imageTokens(2048, 4096), 1105);
  assert.throws(() => imageTokens(0, 450));
  const result = estimate({ model_requests: [1,2,3,4].map(n => ({ width: 700, height: 450, request_images: n })), cloud_screenshots_returned: 0 });
  assert.equal(result.reference_image_input_tokens, 4250);
  assert.equal(result.cloud_billed_tokens, null);
  assert.throws(() => estimate({ model_requests: [] }));
});
