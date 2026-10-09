import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLocalUrl, resolveSettings } from '../src/config.mjs';
import { translateBox, validateAction, assertAllowedApp } from '../src/guard.mjs';
import { taskSchema, jobIdSchema } from '../src/jobs.mjs';

test('cropped screenshot coordinates map to the physical target', () => {
  const converted = JSON.parse(translateBox('[0.5,0.5,0.5,0.5]', { left: 100, top: 200, width: 800, height: 600 }, 2000, 1000));
  assert.deepEqual(converted, [0.25, 0.5, 0.25, 0.5]);
  const edge = JSON.parse(translateBox('[1,1]', { left: 100, top: 200, width: 800, height: 600 }, 2000, 1000));
  assert.ok(edge[0] * 2000 < 900 && edge[1] * 1000 < 800);
  for (const value of ['[2,0]', '[null,0]', '[0]', '{}', 'bad']) assert.throws(() => translateBox(value, {}, 1, 1));
});
test('screenshots cannot be redirected to a remote model endpoint', () => {
  checkLocalUrl('http://127.0.0.1:8080/v1');
  checkLocalUrl('http://[::1]:8080/v1');
  for (const url of ['https://example.com/v1', 'http://127.0.0.1.evil.test', 'http://user:pass@localhost']) assert.throws(() => checkLocalUrl(url));
});
test('portable settings use local defaults and environment overrides', () => {
  assert.equal(resolveSettings({}, {}).launcher, null);
  const settings = resolveSettings({ model: 'saved-model', base_url: 'http://localhost:8081/v1/', launcher: 'start.ps1' }, { UI_TARS_MODEL: 'override' });
  assert.equal(settings.model, 'override');
  assert.equal(settings.baseURL, 'http://localhost:8081/v1');
  assert.equal(settings.launcher, 'start.ps1');
  assert.throws(() => resolveSettings({ base_url: 'https://example.com/v1' }, {}));
});
test('tasks are bounded and identifiers cannot escape job storage', () => {
  assert.equal(taskSchema.parse({ task: 'Test', window_id: 1 }).max_steps, 15);
  for (const update of [{ max_steps: 0 }, { max_steps: 1000 }, { timeout_seconds: 9000 }, { task: '' }, { window_id: -1 }]) assert.throws(() => taskSchema.parse({ task: 'Test', window_id: 1, ...update }));
  assert.throws(() => jobIdSchema.parse('../../other'));
});
test('unsafe shortcuts and unsupported actions fail closed', () => {
  validateAction({ action_type: 'hotkey', action_inputs: { key: 'ctrl a' } });
  for (const key of ['win r', 'alt tab', 'ctrl alt delete', 'leftwin r']) assert.throws(() => validateAction({ action_type: 'hotkey', action_inputs: { key } }));
  assert.throws(() => validateAction({ action_type: 'shell', action_inputs: {} }));
  for (const app of ['Codex.exe', 'powershell.exe', 'LockApp.exe', 'Bitwarden.exe']) assert.throws(() => assertAllowedApp(app));
  assertAllowedApp('notepad.exe', 'Untitled - Notepad');
});
