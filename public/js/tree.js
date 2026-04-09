import * as dom from './dom.js';
import { parseJsonSafe } from './json-utils.js';
import { getActiveTab, saveActiveFromDom } from './session.js';

export function getEditViewMode() {
  const c = document.querySelector('input[name="edit-view"]:checked');
  return c ? c.value : 'text';
}

export function applyViewMode() {
  const mode = getEditViewMode();
  const textPane = document.querySelector('.text-pane');
  const treeOnly = document.querySelectorAll('.tree-only');
  if (mode === 'text') {
    textPane?.classList.remove('hidden');
    dom.treePane?.classList.add('hidden');
    dom.toolbarSearch?.classList.remove('hidden');
    treeOnly.forEach((el) => el.classList.add('hidden'));
  } else {
    saveActiveFromDom();
    textPane?.classList.add('hidden');
    dom.treePane?.classList.remove('hidden');
    dom.toolbarSearch?.classList.add('hidden');
    treeOnly.forEach((el) => el.classList.remove('hidden'));
    renderTree();
  }
}

/** True when a JSON value is “non-empty”: scalars (incl. null), or non-empty object/array. */
function hasMeaningfulChildValue(v) {
  if (v === undefined) return false;
  if (v === null) return true;
  if (typeof v !== 'object') return true;
  if (Array.isArray(v)) return v.length > 0;
  return Object.keys(v).length > 0;
}

/**
 * @param {unknown} value
 * @returns {HTMLElement}
 */
function renderValue(value) {
  if (value !== null && typeof value === 'object') {
    const det = document.createElement('details');
    det.open = true;
    const sum = document.createElement('summary');
    sum.className = 'json-summary';
    if (Array.isArray(value)) {
      sum.textContent = `Array(${value.length})`;
      if (hasMeaningfulChildValue(value)) sum.classList.add('json-summary-has-value');
      const box = document.createElement('div');
      box.className = 'json-children';
      value.forEach((item) => {
        const line = document.createElement('div');
        line.className = 'json-array-item';
        line.appendChild(renderValue(item));
        box.appendChild(line);
      });
      det.appendChild(sum);
      det.appendChild(box);
    } else {
      const keys = Object.keys(value);
      sum.textContent = `{${keys.length} keys}`;
      if (hasMeaningfulChildValue(value)) sum.classList.add('json-summary-has-value');
      const box = document.createElement('div');
      box.className = 'json-children';
      keys.forEach((k) => {
        const line = document.createElement('div');
        line.className = 'json-key-line';
        const kSpan = document.createElement('span');
        kSpan.className = 'json-key';
        if (hasMeaningfulChildValue(value[k])) kSpan.classList.add('json-key-has-value');
        kSpan.textContent = `${k}: `;
        line.appendChild(kSpan);
        line.appendChild(renderValue(value[k]));
        box.appendChild(line);
      });
      det.appendChild(sum);
      det.appendChild(box);
    }
    return det;
  }
  const el = document.createElement('span');
  el.className = 'json-scalar';
  el.textContent = JSON.stringify(value);
  return el;
}

export function renderTree() {
  if (!dom.jsonTree) return;
  dom.jsonTree.replaceChildren();
  const t = getActiveTab();
  if (!t) return;
  const p = parseJsonSafe(t.text);
  if (!p.ok) {
    const err = document.createElement('div');
    err.className = 'tree-error';
    err.textContent = `Invalid JSON: ${p.error}`;
    dom.jsonTree.appendChild(err);
    return;
  }
  dom.jsonTree.appendChild(renderValue(p.value));
}
