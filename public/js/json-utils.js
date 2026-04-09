export function uid() {
  return crypto.randomUUID?.() ?? `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function parseJsonSafe(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function formatJsonString(text) {
  const p = parseJsonSafe(text);
  if (!p.ok) return null;
  return JSON.stringify(p.value, null, 2);
}

export function minifyJsonString(text) {
  const p = parseJsonSafe(text);
  if (!p.ok) return null;
  return JSON.stringify(p.value);
}

/** Pretty JSON for compare; invalid JSON returns raw text */
export function displayTextForCompare(text) {
  const f = formatJsonString(text);
  return f !== null ? f : text;
}
