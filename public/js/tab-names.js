import { parseJsonSafe } from './json-utils.js';

export const TAB_NAME_MAX = 28;

export function truncateTabLabel(str, max = TAB_NAME_MAX) {
  const s = String(str).trim();
  if (!s) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Short label from valid JSON: preferred keys (name, title, …), else first key(s), arrays, scalars.
 * @returns {string | null} null if text is not valid JSON
 */
export function deriveTabName(text) {
  const p = parseJsonSafe(text);
  if (!p.ok) return null;
  const v = p.value;
  if (v === null) return 'null';
  if (typeof v !== 'object') {
    return truncateTabLabel(JSON.stringify(v));
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return truncateTabLabel(`[${v.length}]`);
  }
  const keys = Object.keys(v);
  if (keys.length === 0) return '{}';
  const prefer = ['name', 'title', 'label', 'id', 'key', 'slug', 'type'];
  for (const k of prefer) {
    if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
    const val = v[k];
    if (val === null || val === undefined) continue;
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      return truncateTabLabel(String(val));
    }
  }
  if (keys.length === 1) {
    return truncateTabLabel(keys[0]);
  }
  const first = keys[0];
  return truncateTabLabel(`${first} +${keys.length - 1}`);
}
