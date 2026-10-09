import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ROOT, terminalStates } from '../src/config.mjs';
import { jobPath, readJob } from '../src/jobs.mjs';

const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
const expectedFile = option('--result-file');
const output = option('--output');
if (!args.includes('--result-file') || !args.includes('--output')) throw new Error('Usage: node bench/local.mjs --result-file FIXTURE_OUTPUT --output REPORT_JSON');
if (fs.existsSync(expectedFile)) throw new Error('Use a fresh fixture output path so a previous result cannot pass verification.');
const client = new Client({ name: 'ui-tars-benchmark', version: '1.0.0' });
let active, terminal = false;
const exchanges = [];
async function call(name, parameters) {
  const response = await client.callTool({ name, arguments: parameters });
  const text = response.content.find(c => c.type === 'text')?.text;
  // Store measurements only; request/response text can contain private paths.
  exchanges.push({ tool: name, request_utf8_bytes: Buffer.byteLength(JSON.stringify(parameters)), response_utf8_bytes: Buffer.byteLength(text || '') });
  if (response.isError) throw new Error(text);
  return JSON.parse(text);
}
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'src/server.mjs')], env: process.env, stderr: 'pipe' }));
  const health = await call('health', {});
  if (!health.model_ready) throw new Error('Start the model before benchmarking; startup is excluded from task timing.');
  const targets = (await call('list_windows', { title_contains: 'UI-TARS Local Control Test' })).filter(w => w.available && w.title === 'UI-TARS Local Control Test' && w.process.toLowerCase() === 'desktopfixture.exe');
  if (targets.length !== 1) throw new Error('Open exactly one DesktopFixture test window.');
  const started = performance.now();
  active = await call('run_task', { task: 'Type LOCAL CONTROL OK in the text box, click Confirm, and finish when the label reads Confirmed: LOCAL CONTROL OK.', window_id: targets[0].window_id, max_steps: 15, timeout_seconds: 180, request_id: randomUUID() });
  let status = active;
  do { status = await call('get_status', { job_id: active.job_id, wait_seconds: 20 }); } while (!terminalStates.has(status.status));
  terminal = true;
  const elapsed = performance.now() - started;
  const verified = fs.existsSync(expectedFile) && fs.readFileSync(expectedFile, 'utf8') === 'LOCAL CONTROL OK';
  const job = readJob(active.job_id);
  const traceFile = path.join(jobPath(active.job_id), 'trace.jsonl');
  const trace = fs.existsSync(traceFile) ? fs.readFileSync(traceFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  const usage = trace.filter(row => 'model_usage' in row).map(row => ({ usage: row.model_usage, request_images: row.request_images, width: row.screenshot_width, height: row.screenshot_height }));
  const report = {
    schema_version: 1, date: new Date().toISOString().slice(0,10), task: 'Type LOCAL CONTROL OK and click Confirm in the disposable WinForms fixture',
    condition: 'local_ui_tars_delegation', model: health.model, status: status.status, independently_verified: verified,
    elapsed_ms: Math.round(elapsed), actions: status.steps, model_calls: status.model_calls,
    local_prompt_tokens: status.local_prompt_tokens, local_completion_tokens: status.local_completion_tokens, local_total_tokens: status.local_tokens, local_usage_complete: status.local_usage_complete,
    cloud_billed_tokens: null, cloud_screenshots_returned: 0,
    verification: verified ? 'Fresh fixture output file exactly matched LOCAL CONTROL OK. No screenshot was sent to the supervising model during this runner.' : 'Fresh fixture output was absent or did not match LOCAL CONTROL OK.',
    model_requests: usage, mcp_exchanges: exchanges,
  };
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (!verified || status.status !== 'completed') process.exitCode = 1;
} finally {
  if (active && !terminal) { try { await call('stop_task', { job_id: active.job_id }); } catch { } }
  await client.close();
}
