/**
 * Turn a Babel AST into a JSON-serializable plain object so path tools (watch, paths) work.
 */
const SKIP = new Set([
  'loc',
  'start',
  'end',
  'range',
  'extra',
  'innerComments',
  'leadingComments',
  'trailingComments',
  'tokens',
]);

const MAX_DEPTH = 22;
const MAX_ARRAY = 400;

export function astToPlainObject(node: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[Max depth]';
  if (node == null) return node;
  if (typeof node !== 'object') return node;
  if (Array.isArray(node)) {
    return node
      .slice(0, MAX_ARRAY)
      .map((x) => astToPlainObject(x, depth + 1));
  }
  const n = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof n.type === 'string') out.type = n.type;
  for (const key of Object.keys(n)) {
    if (SKIP.has(key)) continue;
    const v = n[key];
    if (v === undefined) continue;
    if (v === null) {
      out[key] = null;
      continue;
    }
    if (typeof v === 'object' && v !== null) {
      if (Array.isArray(v)) {
        out[key] = v
          .slice(0, MAX_ARRAY)
          .map((x) => astToPlainObject(x, depth + 1));
      } else if ('type' in (v as object)) {
        out[key] = astToPlainObject(v, depth + 1);
      } else {
        out[key] = astToPlainObject(v, depth + 1);
      }
    } else {
      out[key] = v;
    }
  }
  return out;
}
