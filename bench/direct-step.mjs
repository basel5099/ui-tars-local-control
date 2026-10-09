// Test-only supervisor baseline. Cannot target any app except DesktopFixture.exe.
import fs from 'node:fs';
import path from 'node:path';
import { windows, getWindow, activeHandle, focusWindow, captureWindow, nut } from '../src/desktop.mjs';
import { ROOT } from '../src/config.mjs';

const [command, ...args] = process.argv.slice(2);
const dir = path.join(ROOT, 'bench/private');
const stateFile = path.join(dir, 'direct-state.json');
fs.mkdirSync(dir, { recursive: true });
const targets = (await windows()).filter(w => w.title === 'UI-TARS Local Control Test' && w.process.toLowerCase() === 'desktopfixture.exe');
if (targets.length !== 1) throw new Error('Exactly one disposable DesktopFixture window must be open.');
const target = targets[0];
let record;
if (command === 'observe') {
  focusWindow(target.window_id);
  await new Promise(resolve => setTimeout(resolve, 400));
  record = { window_id: target.window_id, pid: target.pid, actions: [], observations: [] };
} else {
  record = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  if (record.window_id !== target.window_id || record.pid !== target.pid || activeHandle() !== target.window_id) throw new Error('Fixture identity/focus changed; observe again.');
  const region = await (await getWindow(target.window_id)).window.getRegion();
  if (['left','top','width','height'].some(k => Math.abs(region[k] - record.region[k]) > 2)) throw new Error('Fixture moved; observe again.');
  if (record.actions.length >= 3) throw new Error('Baseline permits only click, fixed test text, and click.');
  if (command === 'click' && [0,2].includes(record.actions.length)) {
    const [x,y] = args.map(Number);
    if (![x,y].every(n => Number.isFinite(n) && n > 0 && n < 1)) throw new Error('Click coordinates must be normalized within the observed fixture.');
    await nut.mouse.setPosition(new nut.Point(Math.round(record.crop.left + x * record.crop.width), Math.round(record.crop.top + y * record.crop.height)));
    await nut.mouse.click(nut.Button.LEFT);
    record.actions.push({ action: 'click', x, y });
  } else if (command === 'type' && record.actions.length === 1) {
    await nut.keyboard.type('LOCAL CONTROL OK');
    record.actions.push({ action: 'type', text: 'LOCAL CONTROL OK' });
  } else throw new Error('Allowed sequence: observe; click X Y; type; click X Y. Inspect each screenshot before the next step.');
}
await new Promise(resolve => setTimeout(resolve, 200));
const shot = await captureWindow(target.window_id, target.pid);
const screenshot = path.join(dir, `direct-${record.observations.length}.png`);
fs.writeFileSync(screenshot, Buffer.from(shot.base64, 'base64'));
record.region = shot.region; record.crop = shot.crop;
record.observations.push({ width: shot.crop.width, height: shot.crop.height });
fs.writeFileSync(stateFile, JSON.stringify(record, null, 2));
console.log(JSON.stringify({ screenshot, actions: record.actions.length, observation: record.observations.length, width: shot.crop.width, height: shot.crop.height }));
