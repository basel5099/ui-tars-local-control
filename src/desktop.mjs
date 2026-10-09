import { createRequire } from 'node:module';
import path from 'node:path';
import { assertAllowedApp, logicalScreenSize } from './guard.mjs';
const require = createRequire(import.meta.url);
export const nut = require('@computer-use/nut-js');
export const { Jimp } = require('jimp');
const koffi = require('koffi');
const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
const visible = user32.func('bool __stdcall IsWindowVisible(uintptr_t hwnd)');
const iconic = user32.func('bool __stdcall IsIconic(uintptr_t hwnd)');
const foreground = user32.func('uintptr_t __stdcall GetForegroundWindow()');
const showWindow = user32.func('bool __stdcall ShowWindow(uintptr_t hwnd, int command)');
const setForeground = user32.func('bool __stdcall SetForegroundWindow(uintptr_t hwnd)');
const windowPid = user32.func('uint32_t __stdcall GetWindowThreadProcessId(uintptr_t hwnd, _Out_ uint32_t *pid)');
const asyncKey = user32.func('int16_t __stdcall GetAsyncKeyState(int key)');
const openProcess = kernel32.func('uintptr_t __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)');
const processPath = kernel32.func('bool __stdcall QueryFullProcessImageNameW(uintptr_t process, uint32_t flags, _Out_ uint16_t *name, _Inout_ uint32_t *size)');
const close = kernel32.func('bool __stdcall CloseHandle(uintptr_t handle)');

export function stopKeyPressed() { return (asyncKey(0x77) & 0x8000) !== 0; }
export function activeHandle() { return Number(foreground()); }
export function focusWindow(id) {
  if (iconic(id)) showWindow(id, 9);
  return setForeground(id);
}
export function processForWindow(handle) {
  const pid = [0]; windowPid(handle, pid);
  const p = openProcess(0x1000, false, pid[0]);
  if (!p) throw new Error('Cannot inspect the selected window process.');
  try {
    const buffer = Buffer.alloc(65536); const size = [32768];
    if (!processPath(p, 0, buffer, size)) throw new Error('Cannot read the selected process path.');
    return { pid: pid[0], process: path.win32.basename(buffer.toString('utf16le', 0, size[0] * 2)) };
  } finally { close(p); }
}

export async function windows() {
  const result = [];
  for (const w of await nut.getWindows()) {
    const id = Number(w.windowHandle); // Pinned nut-js 4.x window handle.
    if (!visible(id)) continue;
    try {
      const title = await w.getTitle(); const region = await w.getRegion();
      if (!title || region.width < 80 || region.height < 60) continue;
      const info = processForWindow(id);
      let available = true;
      try { assertAllowedApp(info.process, title); } catch { available = false; }
      result.push({ window_id: id, title, ...info, minimized: iconic(id), available });
    } catch { }
  }
  return result;
}

export async function getWindow(id) {
  const window = (await nut.getWindows()).find(w => Number(w.windowHandle) === id);
  if (!window || !visible(id)) throw new Error('Selected window is no longer available. Run list_windows again.');
  const title = await window.getTitle(); const info = processForWindow(id);
  assertAllowedApp(info.process, title);
  return { window, title, ...info };
}

export async function captureWindow(id, expectedPid) {
  const selected = await getWindow(id);
  if (expectedPid && selected.pid !== expectedPid) throw new Error('Window identity changed.');
  if (activeHandle() !== id) throw new Error('Focus changed. The task has stopped; select the intended window again.');
  const region = await selected.window.getRegion();
  const rgb = await (await nut.screen.grab()).toRGB();
  const { width: fullWidth, height: fullHeight } = logicalScreenSize(rgb.width, rgb.height, rgb.pixelDensity);
  const image = Jimp.fromBitmap({ width: rgb.width, height: rgb.height, data: Buffer.from(rgb.data) });
  image.resize({ w: fullWidth, h: fullHeight });
  const crop = { left: Math.max(0, Math.round(region.left)), top: Math.max(0, Math.round(region.top)), width: 0, height: 0 };
  crop.width = Math.min(fullWidth, Math.round(region.left + region.width)) - crop.left;
  crop.height = Math.min(fullHeight, Math.round(region.top + region.height)) - crop.top;
  if (crop.width < 80 || crop.height < 60) throw new Error('Move the selected window onto the primary display and retry.');
  image.crop({ x: crop.left, y: crop.top, w: crop.width, h: crop.height });
  return { base64: (await image.getBuffer('image/png')).toString('base64'), scaleFactor: 1, crop, fullWidth, fullHeight, region, title: selected.title };
}
