import { astToPlainObject } from '@/lib/ast-plain';
import { parseJsonSafe } from '@/lib/json-utils';
import { parseJsTs } from '@/lib/parse-js-ts';
import type { TabLanguage } from '@/lib/workspace-types';

export function getWatchRoot(
  text: string,
  lang: TabLanguage
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (lang === 'json') return parseJsonSafe(text);
  const p = parseJsTs(text, lang);
  if (!p.ok) return { ok: false, error: p.error };
  return { ok: true, value: astToPlainObject(p.ast) };
}
