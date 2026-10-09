import fs from 'node:fs';
// GPT-4.1 high-detail image-input reference only, per the official vision guide.
// This is not the tokenizer or billed usage of the current Codex model.
export function imageTokens(width, height) {
  if (![width, height].every(n => Number.isFinite(n) && n > 0)) throw new Error('Missing valid image dimensions.');
  const fit = Math.min(1, 2048 / Math.max(width, height));
  width *= fit; height *= fit;
  if (Math.min(width, height) > 768) {
    const scale = 768 / Math.min(width, height);
    width = Math.floor(width * scale); height = Math.floor(height * scale);
  }
  return 85 + 170 * Math.ceil(width / 512) * Math.ceil(height / 512);
}
export function estimate(report) {
  const requests = report.model_requests;
  if (!requests?.length || requests.some(r => !Number.isSafeInteger(r.request_images) || r.request_images < 0)) throw new Error('Image-request measurements are incomplete.');
  return {
    basis: 'Counterfactual replay of the recorded local screenshot loop using GPT-4.1 high-detail image token accounting; no cloud model ran this replay.',
    source: 'https://developers.openai.com/api/docs/guides/images-vision#calculating-costs',
    image_appearances_in_requests: requests.reduce((sum, r) => sum + r.request_images, 0),
    reference_image_input_tokens: requests.reduce((sum, r) => sum + imageTokens(r.width, r.height) * r.request_images, 0),
    local_delegation_cloud_images: report.cloud_screenshots_returned,
    optional_final_screenshot_reference_tokens: imageTokens(requests.at(-1).width, requests.at(-1).height),
    excludes: ['text input', 'system/tool definitions', 'assistant output', 'reasoning', 'context replays by the supervising client', 'cache discounts', 'setup and development work'],
    cloud_billed_tokens: null,
  };
}
if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  console.log(JSON.stringify(estimate(report), null, 2));
}
