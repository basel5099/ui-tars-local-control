// Preserve missing usage as unknown, never as a measured zero-token inference.
export function readUsage(usage) {
  const input = usage?.prompt_tokens;
  const output = usage?.completion_tokens;
  const total = usage?.total_tokens;
  if (![input, output, total].every(n => Number.isSafeInteger(n) && n >= 0) || total !== input + output) return null;
  return { input, output, total };
}
