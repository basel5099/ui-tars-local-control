import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const configFile = process.env.UI_TARS_CONFIG || path.join(ROOT, 'control.config.json');
const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, '')) : {};

export function resolveSettings(settings = {}, env = process.env) {
  const baseURL = env.UI_TARS_BASE_URL || settings.base_url || 'http://127.0.0.1:8080/v1';
  checkLocalUrl(baseURL);
  return {
    data: path.resolve(env.UI_TARS_CONTROL_DATA || settings.data_directory || path.join(ROOT, 'data')),
    baseURL: baseURL.replace(/\/+$/, ''),
    model: env.UI_TARS_MODEL || settings.model || 'ui-tars-1.5-7b',
    launcher: env.UI_TARS_LAUNCHER || settings.launcher || null,
  };
}
const settings = resolveSettings(config);
export const DATA = settings.data;
export const BASE_URL = settings.baseURL;
export const MODEL = settings.model;
export const LAUNCHER = settings.launcher;

export function checkLocalUrl(value) {
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('UI-TARS Local Control only sends screenshots to a loopback model endpoint.');
  }
  return url;
}
export const terminalStates = new Set(['completed', 'needs_attention', 'failed', 'stopped', 'timed_out', 'step_limit']);
