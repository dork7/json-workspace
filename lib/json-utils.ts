import type { TabLanguage } from '@/lib/workspace-types';

export function uid(): string {
  return crypto.randomUUID?.() ?? `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function parseJsonSafe(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function formatJsonString(text: string): string | null {
  const p = parseJsonSafe(text);
  if (!p.ok) return null;
  return JSON.stringify(p.value, null, 2);
}

export function minifyJsonString(text: string): string | null {
  const p = parseJsonSafe(text);
  if (!p.ok) return null;
  return JSON.stringify(p.value);
}

export function displayTextForCompare(
  text: string,
  lang: TabLanguage = 'json'
): string {
  if (lang === 'json') {
    const f = formatJsonString(text);
    return f !== null ? f : text;
  }
  return text;
}
