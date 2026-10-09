import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ROOT } from '../src/config.mjs';
import { nut } from '../src/desktop.mjs';
import path from 'node:path';
const client = new Client({ name: 'ui-tars-lifecycle-test', version: '1.0.0' });
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(r.content[0].text);
  return JSON.parse(r.content[0].text);
};
let active;
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'src', 'server.mjs')], env: process.env, stderr: 'pipe' }));
  const list = await call('list_windows', { title_contains: 'UI-TARS Local Control Test' });
  assert.equal(list.length, 1);
  const request = { task: 'Wait for the label to change. Do not click or type. Use wait() while the label is unchanged.', window_id: list[0].window_id, max_steps: 10, timeout_seconds: 60, request_id: randomUUID() };
  active = await call('run_task', request);
  const duplicate = await call('run_task', request);
  assert.equal(duplicate.job_id, active.job_id);
  const conflict = await client.callTool({ name: 'run_task', arguments: { ...request, request_id: randomUUID() } });
  assert.equal(conflict.isError, true);
  await call('stop_task', { job_id: active.job_id });
  let status = await call('get_status', { job_id: active.job_id, wait_seconds: 10 });
  assert.equal(status.status, 'stopped');
  assert.equal(status.steps, 0);
  console.log('MCP duplicate suppression, single-task ownership, and stop-before-input passed.');
  active = await call('run_task', { ...request, request_id: randomUUID() });
  for (let i = 0; i < 50; i++) {
    status = await call('get_status', { job_id: active.job_id });
    if (status.status === 'running') break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.equal(status.status, 'running');
  await nut.keyboard.pressKey(nut.Key.F8);
  await new Promise(r => setTimeout(r, 350));
  await nut.keyboard.releaseKey(nut.Key.F8);
  status = await call('get_status', { job_id: active.job_id, wait_seconds: 10 });
  assert.equal(status.status, 'stopped');
  console.log('F8 emergency stop passed.');
} finally {
  await nut.keyboard.releaseKey(nut.Key.F8);
  if (active) { try { await call('stop_task', { job_id: active.job_id }); } catch { } }
  await client.close();
}
