import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { BASE_URL, MODEL, LAUNCHER } from './config.mjs';
import { readJob, saveJob, jobPath, releaseLock } from './jobs.mjs';
import { captureWindow, getWindow, activeHandle, focusWindow, stopKeyPressed, nut } from './desktop.mjs';
import { validateAction, translateBox } from './guard.mjs';
import { SYSTEM_PROMPT } from './prompt.mjs';
import { readUsage } from './usage.mjs';
const require = createRequire(import.meta.url);
const { GUIAgent, UITarsModelVersion, StatusEnum } = require('@ui-tars/sdk');
const { NutJSOperator } = require('@ui-tars/operator-nut-js');
const id = process.argv[2];
const job = readJob(id);
const dir = jobPath(id);
const controller = new AbortController();
let reason, agent, lastSnapshot, fatal, lastAction, repeatCount = 0;
const trace = value => fs.appendFileSync(path.join(dir, 'trace.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n');
const update = fields => { Object.assign(job, fields); saveJob(job); };
const abort = why => { if (!reason) { reason = why; controller.abort(); agent?.stop(); } };
const check = () => {
  if (fs.existsSync(path.join(dir, 'stop')) || stopKeyPressed()) abort('stopped');
  if (Date.now() - Date.parse(job.started_at) >= job.timeout_seconds * 1000) abort('timed_out');
  if (reason) throw new Error(reason);
  if (fatal) throw new Error(fatal);
};
const watch = setInterval(() => { try { check(); } catch { } }, 100);
const watchdog = setTimeout(() => {
  update({ status: reason || 'timed_out', message: 'Worker stopped at its hard time limit.', ended_at: new Date().toISOString() });
  releaseLock(id); process.exit(1);
}, job.timeout_seconds * 1000 + 10000);

async function snapshot(final = false) {
  const shot = await captureWindow(job.window_id, job.target_pid);
  fs.writeFileSync(path.join(dir, 'latest.png'), Buffer.from(shot.base64, 'base64'));
  update({ screenshot: 'latest.png', screenshot_at: new Date().toISOString(), final_screenshot: final, target_title: shot.title });
  return shot;
}

class ScopedOperator extends NutJSOperator {
  async screenshot() { check(); lastSnapshot = await snapshot(); return { base64: lastSnapshot.base64, scaleFactor: 1 }; }
  async execute(params) {
    if (params.parsedPrediction.action_type === 'user_stop') return { status: StatusEnum.USER_STOPPED };
    try {
      check();
      if (activeHandle() !== job.window_id) throw new Error('Focus changed; task stopped before the next action.');
      const current = await getWindow(job.window_id);
      if (current.pid !== job.target_pid) throw new Error('Window process changed.');
      const region = await current.window.getRegion();
      if (['left','top','width','height'].some(k => Math.abs(region[k] - lastSnapshot.region[k]) > 2)) throw new Error('Window moved since the screenshot. Retry with a fresh task.');
      const action = params.parsedPrediction;
      validateAction(action);
      if (action.action_type === 'finished' || action.action_type === 'call_user') {
        update({ model_summary: (action.thought || '').slice(0, 1200) });
        return { status: action.action_type === 'finished' ? StatusEnum.END : StatusEnum.CALL_USER };
      }
      if (job.steps >= job.max_steps) { abort('step_limit'); throw new Error('Step limit reached.'); }
      const signature = JSON.stringify([action.action_type, action.action_inputs]);
      repeatCount = signature === lastAction ? repeatCount + 1 : 1; lastAction = signature;
      if (repeatCount >= 4) throw new Error('The local model repeated the same action four times; review required.');
      const inputs = { ...action.action_inputs };
      for (const key of ['start_box', 'end_box']) if (inputs[key]) inputs[key] = translateBox(inputs[key], lastSnapshot.crop, lastSnapshot.fullWidth, lastSnapshot.fullHeight);
      if (/click|single|double|scroll/.test(action.action_type) && !inputs.start_box) throw new Error('Pointer action is missing coordinates.');
      trace({ action: action.action_type, inputs: action.action_inputs });
      check();
      let output;
      if (action.action_type === 'type') {
        // The upstream Windows operator restores the clipboard after only 50 ms.
        // Native text input preserves clipboard contents and supports cancellation.
        nut.keyboard.config.autoDelayMs = 10;
        for (const char of String(inputs.content || '').replace(/\\n/g, '\n')) {
          check();
          if (activeHandle() !== job.window_id) throw new Error('Focus changed during text entry.');
          if (char === '\n') {
            await nut.keyboard.pressKey(nut.Key.Enter); await nut.keyboard.releaseKey(nut.Key.Enter);
          } else await nut.keyboard.type(char);
        }
      } else output = await super.execute({ ...params, parsedPrediction: { ...action, action_inputs: inputs }, screenWidth: lastSnapshot.fullWidth, screenHeight: lastSnapshot.fullHeight, scaleFactor: 1 });
      update({ steps: job.steps + 1, last_action: action.action_type, message: 'Local model is working.' });
      return output;
    } catch (error) { fatal = error.message; throw error; }
  }
}

try {
  update({ worker_pid: process.pid, status: 'starting', message: 'Checking local model.' });
  let ready = false;
  try { const r = await fetch(`${BASE_URL}/models`, { signal: AbortSignal.timeout(2000), redirect: 'error' }); ready = r.ok && (await r.json()).data?.some(m => m.id === MODEL); } catch { }
  if (!ready) {
    if (!LAUNCHER) throw new Error(`Local model ${MODEL} is not ready at ${BASE_URL}. Start it first or configure a model launcher.`);
    await promisify(execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', LAUNCHER, '-ModelOnly'], { windowsHide: true, timeout: Math.min(120000, job.timeout_seconds * 1000), signal: controller.signal });
  }
  check();
  const target = await getWindow(job.window_id);
  if (target.pid !== job.target_pid) throw new Error('Window identity changed before starting.');
  focusWindow(job.window_id);
  await new Promise(resolve => setTimeout(resolve, 400));
  check();
  if (activeHandle() !== job.window_id) throw new Error('Could not focus the selected window. Bring it to the front and retry.');
  update({ status: 'running', message: 'Running locally. F8 stops the task.' });
  agent = new GUIAgent({
    operator: new ScopedOperator(), uiTarsVersion: UITarsModelVersion.V1_5, systemPrompt: SYSTEM_PROMPT,
    model: {
      baseURL: BASE_URL, apiKey: 'local', model: MODEL, temperature: 0, max_tokens: 512, timeout: 60000,
      fetch: async (url, options) => {
        if (new URL(url).origin !== new URL(BASE_URL).origin) throw new Error('Blocked non-local model request.');
        const response = await fetch(url, { ...options, redirect: 'error' });
        if (response.ok) {
          const result = await response.clone().json();
          const usage = readUsage(result.usage);
          let images = null;
          try { images = JSON.parse(options.body).messages.flatMap(m => Array.isArray(m.content) ? m.content : []).filter(c => c.type === 'image_url').length; } catch { }
          trace({ model_usage: usage, request_images: images, screenshot_width: lastSnapshot?.crop.width, screenshot_height: lastSnapshot?.crop.height });
          update({ model_calls: job.model_calls + 1, local_tokens: job.local_tokens + (usage?.total || 0), local_prompt_tokens: (job.local_prompt_tokens || 0) + (usage?.input || 0), local_completion_tokens: (job.local_completion_tokens || 0) + (usage?.output || 0), usage_calls: (job.usage_calls || 0) + (usage ? 1 : 0) });
        }
        return response;
      },
    },
    maxLoopCount: job.max_steps + 1, loopIntervalInMs: 700, signal: controller.signal,
    retry: { model: { maxRetries: 0 }, execute: { maxRetries: 0 }, screenshot: { maxRetries: 0 } },
    logger: { log() {}, info() {}, warn: (...args) => console.error(...args), error: (...args) => console.error(...args) },
    onData: ({ data }) => {
      if (data.status === 'error') fatal ||= data.error?.message || data.errMsg || 'UI-TARS SDK error';
      job.sdk_status = data.status;
      for (const item of data.conversations || []) if (item.from === 'gpt') trace({ prediction: item.value });
    },
    onError: ({ error }) => { fatal ||= error?.message || 'UI-TARS SDK error'; },
  });
  await agent.run(job.task);
  const status = reason || (fatal ? 'needs_attention' : job.sdk_status === 'end' ? 'completed' : job.sdk_status === 'call_user' ? 'needs_attention' : job.steps >= job.max_steps ? 'step_limit' : 'failed');
  try { if (activeHandle() === job.window_id) await snapshot(true); } catch { }
  update({ status, message: fatal || (status === 'completed' ? 'Local model reported completion. Review the final screenshot to verify.' : job.model_summary || `Task ended: ${status}`), ended_at: new Date().toISOString() });
} catch (error) {
  update({ status: reason || 'failed', message: error.message.slice(0, 1800), ended_at: new Date().toISOString() });
} finally {
  clearInterval(watch); clearTimeout(watchdog);
  try { await nut.keyboard.releaseKey(nut.Key.LeftControl, nut.Key.LeftAlt, nut.Key.LeftShift); } catch { }
  releaseLock(id);
}
