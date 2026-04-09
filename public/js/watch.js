import { appState } from './state.js';
import * as dom from './dom.js';
import { parseJsonSafe, uid } from './json-utils.js';
import { getPathValue, collectJsonPaths } from './json-path.js';
import { getActiveTab, saveActiveFromDom } from './session.js';

export const WATCH_STORAGE_KEY = 'json-workspace-watch-v1';

const WATCH_VALUE_MAX = 4000;

export function loadWatchEntries() {
  try {
    const raw = localStorage.getItem(WATCH_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.expr === 'string')
      .map((x) => ({ id: typeof x.id === 'string' ? x.id : uid(), expr: x.expr.trim() }))
      .filter((x) => x.expr);
  } catch {
    return [];
  }
}

function persistWatchEntries() {
  try {
    localStorage.setItem(
      WATCH_STORAGE_KEY,
      JSON.stringify(appState.watchEntries.map((w) => ({ id: w.id, expr: w.expr })))
    );
  } catch {
    /* ignore */
  }
}

function formatWatchValue(v) {
  if (v === undefined) return '(undefined)';
  try {
    if (typeof v === 'function') return '[Function]';
    const str =
      v !== null && typeof v === 'object'
        ? JSON.stringify(v, null, 2)
        : JSON.stringify(v);
    return str.length > WATCH_VALUE_MAX
      ? `${str.slice(0, WATCH_VALUE_MAX)}\n… (truncated)`
      : str;
  } catch {
    return String(v);
  }
}

function refreshWatchPathSuggestionsClear() {
  if (!dom.watchDatalist) return;
  dom.watchDatalist.replaceChildren();
}

/** @param {unknown} root */
function refreshWatchPathSuggestions(root) {
  if (!dom.watchDatalist) return;
  dom.watchDatalist.replaceChildren();
  const out = [];
  collectJsonPaths(root, '', out);
  const uniq = [...new Set(out)].sort((a, b) => a.localeCompare(b));
  for (const path of uniq) {
    const opt = document.createElement('option');
    opt.value = path;
    dom.watchDatalist.appendChild(opt);
  }
}

export function updateWatch() {
  saveActiveFromDom();
  const t = getActiveTab();
  const parsed = t ? parseJsonSafe(t.text) : { ok: false, error: 'No tab' };

  if (parsed.ok) {
    refreshWatchPathSuggestions(parsed.value);
  } else {
    refreshWatchPathSuggestionsClear();
  }

  if (!dom.watchListEl) return;

  dom.watchListEl.replaceChildren();

  for (const w of appState.watchEntries) {
    const li = document.createElement('li');
    li.className = 'watch-item';

    const head = document.createElement('div');
    head.className = 'watch-expr';
    const code = document.createElement('code');
    code.textContent = w.expr;
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'watch-remove';
    rm.setAttribute('aria-label', 'Remove watch');
    rm.textContent = '×';
    rm.addEventListener('click', () => {
      appState.watchEntries = appState.watchEntries.filter((x) => x.id !== w.id);
      persistWatchEntries();
      updateWatch();
    });
    head.appendChild(code);
    head.appendChild(rm);

    const pre = document.createElement('pre');
    pre.className = 'watch-value';

    if (!parsed.ok) {
      pre.classList.add('watch-err');
      pre.textContent =
        'error' in parsed && parsed.error
          ? `Invalid JSON: ${parsed.error}`
          : 'Invalid JSON';
    } else {
      const res = getPathValue(parsed.value, w.expr);
      if (!res.ok) {
        pre.classList.add('watch-err');
        pre.textContent = res.error ?? 'Path error';
      } else {
        pre.textContent = formatWatchValue(res.value);
      }
    }

    li.appendChild(head);
    li.appendChild(pre);
    dom.watchListEl.appendChild(li);
  }
}

export function addWatchFromInput() {
  if (!dom.watchInput) return;
  const expr = dom.watchInput.value.trim();
  if (!expr) return;
  appState.watchEntries.push({ id: uid(), expr });
  dom.watchInput.value = '';
  persistWatchEntries();
  updateWatch();
}
