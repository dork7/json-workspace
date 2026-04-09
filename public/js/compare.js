import * as dom from './dom.js';
import { applyViewMode } from './tree.js';

/**
 * Side-by-side line diff: same line index compared; only rows where lines differ.
 */
export function renderSideBySide(aText, bText, nameA, nameB) {
  if (!dom.compareTitleA || !dom.compareTitleB || !dom.compareLinesA || !dom.compareLinesB) return;
  dom.compareTitleA.textContent = nameA;
  dom.compareTitleB.textContent = nameB;
  dom.compareLinesA.replaceChildren();
  dom.compareLinesB.replaceChildren();

  const al = aText.split('\n');
  const bl = bText.split('\n');
  const n = Math.max(al.length, bl.length);

  for (let i = 0; i < n; i++) {
    const la = al[i];
    const lb = bl[i];
    if (la === lb) continue;

    const lineNo = `L${i + 1}`;
    const left = document.createElement('div');
    left.className = 'diff-line diff-left';
    left.textContent = `${lineNo}\t${la ?? ''}`;

    const right = document.createElement('div');
    right.className = 'diff-line diff-right';
    right.textContent = `${lineNo}\t${lb ?? ''}`;

    dom.compareLinesA.appendChild(left);
    dom.compareLinesB.appendChild(right);
  }

  if (dom.compareLinesA.childElementCount === 0) {
    const left = document.createElement('div');
    left.className = 'diff-line diff-empty';
    left.textContent = 'No differing lines.';
    const right = document.createElement('div');
    right.className = 'diff-line diff-empty';
    right.textContent = 'No differing lines.';
    dom.compareLinesA.appendChild(left);
    dom.compareLinesB.appendChild(right);
  }
}

export function showCompareView() {
  dom.mainToolbar?.classList.add('hidden');
  dom.editorSection?.classList.add('hidden');
  dom.compareSection?.classList.remove('hidden');
}

export function hideCompareView() {
  dom.compareSection?.classList.add('hidden');
  dom.mainToolbar?.classList.remove('hidden');
  dom.editorSection?.classList.remove('hidden');
  applyViewMode();
}
