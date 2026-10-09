export function assertAllowedApp(processName, title = '') {
  if (/^(?:cmd|powershell|pwsh|windowsterminal|conhost|codex|chatgpt|lockapp|logonui|credentialuibroker|consent|sechealthui|msmpeng|1password|bitwarden|keepass(?:xc)?|lastpass)\.exe$/i.test(processName) || /password|passwort|sign[ -]?in|log[ -]?in|anmelden|windows security|windows-sicherheit/i.test(title)) {
    throw new Error('This application requires direct user control.');
  }
}

export function translateBox(box, crop, fullWidth, fullHeight) {
  const values = JSON.parse(box);
  if (!Array.isArray(values) || ![2, 4].includes(values.length) || values.some(v => !Number.isFinite(v) || v < 0 || v > 1)) {
    throw new Error('The model returned invalid or out-of-window coordinates.');
  }
  return JSON.stringify(values.map((v, i) => i % 2 === 0
    ? (crop.left + Math.min(crop.width - 2, Math.max(1, v * crop.width))) / fullWidth
    : (crop.top + Math.min(crop.height - 2, Math.max(1, v * crop.height))) / fullHeight));
}

export function validateAction(action) {
  const allowed = new Set(['click', 'left_click', 'left_single', 'left_double', 'double_click', 'right_click', 'right_single', 'type', 'hotkey', 'scroll', 'wait', 'finished', 'call_user', 'user_stop']);
  if (!allowed.has(action.action_type)) throw new Error(`Unsupported action: ${action.action_type}`);
  if (action.action_type === 'hotkey') {
    const keys = String(action.action_inputs?.key || action.action_inputs?.hotkey || '').toLowerCase().split(/[\s+]+/);
    if (!keys.length || keys.some(k => /^(?:win|windows|meta|super|cmd|command|os|leftwin|rightwin|leftcmd|rightcmd|delete|del)$/.test(k)) || (keys.includes('alt') && keys.some(k => ['tab', 'f4', 'esc', 'space'].includes(k)))) {
      throw new Error('This shortcut leaves the selected window or requires direct user control.');
    }
  }
  if (action.action_type === 'type' && String(action.action_inputs?.content || '').length > 8000) {
    throw new Error('Text input exceeds the per-action limit.');
  }
}
export function logicalScreenSize(width, height, density) {
  if (![width, height, density?.scaleX, density?.scaleY].every(n => Number.isFinite(n) && n > 0)) throw new Error('Invalid screen dimensions or pixel density.');
  // Windows rounds logical width and height separately at fractional DPI scales.
  return { width: Math.round(width / density.scaleX), height: Math.round(height / density.scaleY) };
}
