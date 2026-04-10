import { parseJsonSafe } from '@/lib/json-utils';
import { parseJsTs } from '@/lib/parse-js-ts';
import type { TabLanguage } from '@/lib/workspace-types';

/** TypeScript-only syntax hints when both TS and JS parsers accept the file. */
const TS_HINT =
  /\b(?:interface|enum|namespace|implements|satisfies|import\s+type|export\s+type|asserts\s+|infer\s+|keyof\s+|readonly\s+\w+\s*[:\[\(])\b/;

const TS_TYPE_ALIAS = /\btype\s+[A-Za-z_$][\w$]*\s*=/;

/** Common type annotations (not exhaustive). */
const TS_ANNOTATION =
  /:\s*(?:string|number|boolean|bigint|symbol|any|unknown|never|void|object|readonly|this)\b/;

export function detectTabLanguage(text: string): TabLanguage {
  const t = text.trim();
  if (!t) return 'json';

  const json = parseJsonSafe(t);
  if (json.ok) return 'json';

  const ts = parseJsTs(t, 'typescript');
  const js = parseJsTs(t, 'javascript');

  if (!ts.ok && !js.ok) return 'javascript';

  if (ts.ok && !js.ok) return 'typescript';

  if (!ts.ok && js.ok) return 'javascript';

  // Both parsers accept — TS is a superset for most syntax; look for TS-only features.
  if (TS_HINT.test(t) || TS_TYPE_ALIAS.test(t) || TS_ANNOTATION.test(t)) {
    return 'typescript';
  }

  return 'javascript';
}
