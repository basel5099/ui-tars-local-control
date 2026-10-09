import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.mjs';
import { imageTokens } from './estimate.mjs';
const [resultFile, output] = process.argv.slice(2);
if (!resultFile || !output) throw new Error('Usage: node bench/report-direct.mjs FIXTURE_OUTPUT REPORT_JSON');
const state = JSON.parse(fs.readFileSync(path.join(ROOT, 'bench/private/direct-state.json'), 'utf8'));
const verified = fs.readFileSync(resultFile, 'utf8') === 'LOCAL CONTROL OK';
const report = {
  schema_version: 1, date: new Date().toISOString().slice(0,10),
  condition: 'direct_supervisor_via_fixture_only_harness',
  task: 'Type LOCAL CONTROL OK and click Confirm in the disposable WinForms fixture',
  independently_verified: verified, actions: state.actions.length,
  cloud_screenshots_returned: state.observations.length,
  screenshots: state.observations,
  local_model_tokens: 0,
  cloud_billed_tokens: null,
  reference_image_input_tokens_once_each: state.observations.reduce((n, s) => n + imageTokens(s.width, s.height), 0),
  reference_model: 'GPT-4.1 high detail; a reference estimate, not the model or billed usage of the supervising Codex session',
  excludes: ['text', 'tool definitions', 'assistant output', 'reasoning', 'context replays', 'cache discounts', 'setup and development'],
  verification: 'Supervisor inspected every screenshot and confirmed the final label. The fresh fixture output file also exactly matched LOCAL CONTROL OK.',
};
if (!verified || state.actions.length !== 3 || state.observations.length !== 4) throw new Error('Baseline was incomplete; do not publish it as a successful comparison.');
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
