import type { TabLanguage } from '@/lib/workspace-types';
import { parseJsonSafe } from './json-utils';

export const TAB_NAME_MAX = 28;

export function truncateTabLabel(str: string, max = TAB_NAME_MAX): string {
  const s = String(str).trim();
  if (!s) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

export function deriveTabName(text: string): string | null {
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
    const val = (v as Record<string, unknown>)[k];
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

function deriveJsTsTabLabel(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const patterns: RegExp[] = [
    /export\s+default\s+function\s+([A-Za-z_$][\w$]*)/,
    /export\s+async\s+function\s+([A-Za-z_$][\w$]*)/,
    /export\s+function\s+([A-Za-z_$][\w$]*)/,
    /function\s+([A-Za-z_$][\w$]*)\s*\(/,
    /class\s+([A-Za-z_$][\w$]*)/,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{/,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1]) return truncateTabLabel(m[1]);
  }
  const firstLine = t.split(/\r?\n/).find((l) => l.trim()) ?? '';
  return truncateTabLabel(firstLine.slice(0, 40));
}

export function deriveTabLabel(text: string, lang: TabLanguage): string | null {
  if (lang === 'json') return deriveTabName(text);
  return deriveJsTsTabLabel(text);
}
