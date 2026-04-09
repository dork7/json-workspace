/**
 * Resolve a path against parsed JSON root. Supports `$.a.b`, `a.b`, `items[0]`, `["x-y"]`.
 * @param {unknown} root
 * @param {string} path
 */
export function getPathValue(root, path) {
  try {
    let s = path.trim();
    if (!s || s === '$') return { ok: true, value: root };
    s = s.replace(/^\$\.?/, '');
    if (s === '') return { ok: true, value: root };

    let cur = root;
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
        let key;
        if (inner.startsWith('"') || inner.startsWith("'")) {
          const normalized = inner.startsWith("'")
            ? `"${inner.slice(1, -1).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
            : inner;
          key = JSON.parse(normalized);
        } else if (/^-?\d+$/.test(inner)) {
          key = Number(inner);
        } else {
          key = inner;
        }
        if (cur == null || typeof cur !== 'object') {
          return { ok: true, value: undefined };
        }
        cur = cur[key];
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
        cur = cur[key];
      }
    }
    return { ok: true, value: cur };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export const MAX_JSON_PATH_SUGGESTIONS = 5000;

/** @param {string} key */
export function pathSegmentForObjectKey(key) {
  const s = String(key);
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(s)) return s;
  return `["${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

/**
 * @param {string} prefix
 * @param {string} segment
 */
export function joinJsonPath(prefix, segment) {
  if (!prefix) return segment;
  if (segment.startsWith('[')) return prefix + segment;
  return `${prefix}.${segment}`;
}

/**
 * All paths compatible with getPathValue (root as `$`, then `a`, `a.b`, `a[0]`, `["x-y"]`, …).
 * @param {unknown} value
 * @param {string} prefix
 * @param {string[]} out
 */
export function collectJsonPaths(value, prefix, out) {
  if (out.length >= MAX_JSON_PATH_SUGGESTIONS) return;
  out.push(prefix === '' ? '$' : prefix);

  if (value !== null && typeof value === 'object') {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const p = joinJsonPath(prefix, `[${i}]`);
        collectJsonPaths(value[i], p, out);
      }
    } else {
      for (const k of Object.keys(value)) {
        const p = joinJsonPath(prefix, pathSegmentForObjectKey(k));
        collectJsonPaths(value[k], p, out);
      }
    }
  }
}
