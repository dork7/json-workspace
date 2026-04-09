export function getPathValue(
  root: unknown,
  path: string
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    let s = path.trim();
    if (!s || s === '$') return { ok: true, value: root };
    s = s.replace(/^\$\.?/, '');
    if (s === '') return { ok: true, value: root };

    let cur: unknown = root;
    let i = 0;
    while (i < s.length) {
      if (s[i] === '.') {
        i++;
        continue;
      }
      if (s[i] === '[') {
        const end = s.indexOf(']', i);
        if (end === -1) return { ok: false, error: 'Missing ] in path' };
        const inner = s.slice(i + 1, end).trim();
        i = end + 1;
        let key: string | number;
        if (inner.startsWith('"') || inner.startsWith("'")) {
          const normalized = inner.startsWith("'")
            ? `"${inner.slice(1, -1).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
            : inner;
          key = JSON.parse(normalized) as string;
        } else if (/^-?\d+$/.test(inner)) {
          key = Number(inner);
        } else {
          key = inner;
        }
        if (cur == null || typeof cur !== 'object') {
          return { ok: true, value: undefined };
        }
        cur = (cur as Record<string | number, unknown>)[key];
      } else {
        let j = i;
        while (j < s.length && s[j] !== '.' && s[j] !== '[') j++;
        if (j === i) {
          i++;
          continue;
        }
        const key = s.slice(i, j);
        i = j;
        if (cur == null || typeof cur !== 'object') {
          return { ok: true, value: undefined };
        }
        cur = (cur as Record<string, unknown>)[key];
      }
    }
    return { ok: true, value: cur };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export const MAX_JSON_PATH_SUGGESTIONS = 5000;

export function pathSegmentForObjectKey(key: string): string {
  const s = String(key);
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(s)) return s;
  return `["${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

export function joinJsonPath(prefix: string, segment: string): string {
  if (!prefix) return segment;
  if (segment.startsWith('[')) return prefix + segment;
  return `${prefix}.${segment}`;
}

export function collectJsonPaths(value: unknown, prefix: string, out: string[]): void {
  if (out.length >= MAX_JSON_PATH_SUGGESTIONS) return;
  out.push(prefix === '' ? '$' : prefix);

  if (value !== null && typeof value === 'object') {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const p = joinJsonPath(prefix, `[${i}]`);
        collectJsonPaths(value[i], p, out);
      }
    } else {
      for (const k of Object.keys(value as object)) {
        const p = joinJsonPath(prefix, pathSegmentForObjectKey(k));
        collectJsonPaths((value as Record<string, unknown>)[k], p, out);
      }
    }
  }
}
