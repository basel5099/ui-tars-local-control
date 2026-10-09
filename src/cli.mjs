import fs from 'node:fs';
import { health, startTask, getStatus, stopTask, getScreenshot } from './jobs.mjs';
const [command, ...args] = process.argv.slice(2);
try {
  let result;
  if (command === 'health') result = await health();
  else if (command === 'windows') {
    const { windows } = await import('./desktop.mjs');
    result = await windows();
    if (args[0]) result = result.filter(w => w.title.toLowerCase().includes(args[0].toLowerCase()));
  } else if (command === 'start' && args[0] === '--file' && args[1]) result = await startTask(JSON.parse(fs.readFileSync(args[1], 'utf8').replace(/^\uFEFF/, '')));
  else if (command === 'status') result = await getStatus(args[0], Number(args[1] || 0));
  else if (command === 'stop') result = stopTask(args[0]);
  else if (command === 'screenshot') {
    const shot = getScreenshot(args[0]); result = { path: shot.file, captured_at: shot.captured_at, final: shot.final };
  } else throw new Error('Usage: cli.mjs health | windows [title] | start --file request.json | status JOB_ID [wait_seconds] | stop JOB_ID | screenshot JOB_ID');
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
