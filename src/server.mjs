import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { health, startTask, taskSchema, getStatus, stopTask, getScreenshot, jobIdSchema } from './jobs.mjs';

const server = new McpServer({ name: 'ui-tars-local-control', version: '1.0.0' });
const text = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });
const wrap = fn => async args => {
  try { return await fn(args); }
  catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
};
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
server.registerTool('health', {
  description: 'Check the local UI-TARS model and active task. Does not load the model or take screenshots.', inputSchema: {}, annotations: readOnly,
}, wrap(async () => text(await health())));
server.registerTool('list_windows', {
  description: 'List visible Windows application targets. Select one returned window_id for a bounded task.',
  inputSchema: { title_contains: z.string().optional() }, annotations: readOnly,
}, wrap(async ({ title_contains }) => {
  const { windows } = await import('./desktop.mjs');
  let list = await windows();
  if (title_contains) list = list.filter(w => w.title.toLowerCase().includes(title_contains.toLowerCase()));
  return text(list);
}));
server.registerTool('run_task', {
  description: 'Delegate an authorized GUI task to the local UI-TARS model in ONE selected window. Returns a job_id immediately. Local worker handles screenshots and actions. May modify the selected app. Avoid external submissions, credentials, deletion, purchases, and security settings; use direct tools for those steps. Include a clear visible success condition. One task at a time. F8 stops. Never run concurrently with another desktop controller.',
  inputSchema: taskSchema.shape,
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
}, wrap(async args => text(await startTask(args))));
server.registerTool('get_status', {
  description: 'Get compact task progress or result without screenshots or full action history. completed means the local model reported completion; verify the outcome independently. Use wait_seconds to reduce polling.',
  inputSchema: { job_id: jobIdSchema, wait_seconds: z.number().int().min(0).max(20).default(0) }, annotations: readOnly,
}, wrap(async ({ job_id, wait_seconds }) => text(await getStatus(job_id, wait_seconds))));
server.registerTool('stop_task', {
  description: 'Request an immediate stop of a local task. No further action starts after the worker sees the request; the current input may finish. Poll get_status until terminal.',
  inputSchema: { job_id: jobIdSchema }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, wrap(async ({ job_id }) => text(stopTask(job_id))));
server.registerTool('get_screenshot', {
  description: 'Return the latest saved target-window screenshot for verification or recovery. Images consume context; request only when needed. Includes timestamp and whether it was captured after task termination.',
  inputSchema: { job_id: jobIdSchema }, annotations: readOnly,
}, wrap(async ({ job_id }) => {
  const shot = getScreenshot(job_id);
  return { content: [{ type: 'text', text: JSON.stringify({ captured_at: shot.captured_at, final: shot.final, path: shot.file }) }, { type: 'image', mimeType: 'image/png', data: shot.data }] };
}));
await server.connect(new StdioServerTransport());
