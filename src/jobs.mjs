import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { DATA, ROOT, BASE_URL, MODEL, terminalStates } from './config.mjs';

export const taskSchema = z.object({
  task: z.string().min(1).max(6000),
  window_id: z.number().int().positive(),
  max_steps: z.number().int().min(1).max(60).default(15),
  timeout_seconds: z.number().int().min(10).max(600).default(180),
  request_id: z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/).optional(),
}).strict();
export const jobIdSchema = z.string().uuid();
const lockPath = path.join(DATA, 'active.lock');
export const jobPath = id => path.join(DATA, 'jobs', jobIdSchema.parse(id));
export function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}
export function readJob(id) { return JSON.parse(fs.readFileSync(path.join(jobPath(id), 'status.json'), 'utf8')); }
export function saveJob(job) { atomicJson(path.join(jobPath(job.job_id), 'status.json'), job); }
export function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
export function releaseLock(id) {
  try { if (JSON.parse(fs.readFileSync(lockPath, 'utf8')).job_id === id) fs.unlinkSync(lockPath); } catch { }
}
function activeJob() {
  if (!fs.existsSync(lockPath)) return null;
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const job = readJob(lock.job_id);
  if (terminalStates.has(job.status)) { releaseLock(job.job_id); return null; }
  if (Date.now() - Date.parse(job.started_at) > 15000 && !alive(job.worker_pid)) {
    Object.assign(job, { status: 'failed', message: 'Worker exited unexpectedly; no automatic replay.', ended_at: new Date().toISOString() });
    saveJob(job); releaseLock(job.job_id); return null;
  }
  return job;
}

export async function health() {
  let modelReady = false;
  try {
    const response = await fetch(`${BASE_URL}/models`, { signal: AbortSignal.timeout(2500), redirect: 'error' });
    const body = await response.json();
    modelReady = response.ok && body.data?.some(item => item.id === MODEL);
  } catch { }
  fs.mkdirSync(path.join(DATA, 'jobs'), { recursive: true });
  const active = activeJob();
  return { model_ready: modelReady, model: MODEL, endpoint: BASE_URL, active_job: active?.job_id || null, emergency_stop: 'F8', data_directory: DATA };
}

export async function startTask(raw) {
  const input = taskSchema.parse(raw);
  fs.mkdirSync(path.join(DATA, 'jobs'), { recursive: true });
  if (input.request_id) {
    for (const id of fs.readdirSync(path.join(DATA, 'jobs'))) {
      if (!jobIdSchema.safeParse(id).success) continue;
      const old = readJob(id);
      if (old.request_id === input.request_id) {
        if (old.task !== input.task || old.window_id !== input.window_id) throw new Error('request_id already belongs to another task.');
        return summary(old);
      }
    }
  }
  if (activeJob()) throw new Error('A desktop task is already active. Wait for it or stop it first.');
  const { getWindow } = await import('./desktop.mjs');
  const target = await getWindow(input.window_id);
  const id = randomUUID();
  let lock;
  try { lock = fs.openSync(lockPath, 'wx'); } catch { throw new Error('Another desktop task claimed control. Try status first.'); }
  try {
    fs.writeFileSync(lock, JSON.stringify({ job_id: id })); fs.closeSync(lock); lock = undefined;
    const dir = jobPath(id); fs.mkdirSync(dir);
    const job = { ...input, job_id: id, status: 'queued', started_at: new Date().toISOString(), steps: 0, model_calls: 0, local_tokens: 0, local_prompt_tokens: 0, local_completion_tokens: 0, usage_calls: 0, target_pid: target.pid, target_process: target.process, target_title: target.title, message: 'Starting local worker.', verified: false };
    saveJob(job);
    const log = fs.openSync(path.join(dir, 'worker.log'), 'a');
    let child;
    try {
      child = spawn(process.execPath, [path.join(ROOT, 'src', 'worker.mjs'), id], { cwd: ROOT, detached: true, windowsHide: true, stdio: ['ignore', log, log], env: process.env });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    } finally { fs.closeSync(log); }
    job.worker_pid = child.pid;
    saveJob(job); child.unref();
    return summary(job);
  } catch (error) {
    if (lock !== undefined) fs.closeSync(lock);
    releaseLock(id); throw error;
  }
}

export function summary(job) {
  return {
    job_id: job.job_id, status: job.status, target_title: job.target_title, steps: job.steps,
    model_calls: job.model_calls, local_tokens: job.local_tokens,
    local_prompt_tokens: job.local_prompt_tokens ?? null, local_completion_tokens: job.local_completion_tokens ?? null,
    local_usage_complete: job.model_calls > 0 && job.usage_calls === job.model_calls,
    message: job.message, last_action: job.last_action, model_summary: job.model_summary,
    verified: false, screenshot_available: Boolean(job.screenshot),
    elapsed_seconds: Math.round(((job.ended_at ? Date.parse(job.ended_at) : Date.now()) - Date.parse(job.started_at)) / 1000),
  };
}

export async function getStatus(id, waitSeconds = 0) {
  jobIdSchema.parse(id);
  const deadline = Date.now() + Math.min(20, Math.max(0, waitSeconds)) * 1000;
  let job;
  do {
    activeJob(); job = readJob(id);
    if (terminalStates.has(job.status) || Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, 300));
  } while (true);
  return summary(job);
}
export function stopTask(id) {
  const job = readJob(id);
  if (!terminalStates.has(job.status)) fs.writeFileSync(path.join(jobPath(id), 'stop'), 'Requested by caller');
  return { ...summary(job), stop_requested: !terminalStates.has(job.status) };
}
export function getScreenshot(id) {
  const job = readJob(id);
  const file = path.join(jobPath(id), 'latest.png');
  if (!job.screenshot || !fs.existsSync(file)) throw new Error('No screenshot is available yet.');
  return { file, data: fs.readFileSync(file).toString('base64'), captured_at: job.screenshot_at, final: terminalStates.has(job.status) && job.final_screenshot === true };
}
