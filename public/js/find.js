import { appState } from './state.js';
import * as dom from './dom.js';

export function clearFind() {
  appState.findMatches = [];
  appState.findMatchIndex = -1;
  if (dom.findStatus) dom.findStatus.textContent = '';
}

export function runFind() {
  if (!dom.searchInTab || !dom.jsonTextarea) return;
  const q = dom.searchInTab.value;
  const text = dom.jsonTextarea.value;
  appState.findMatches = [];
  if (!q) {
    clearFind();
    return;
  }
  let i = 0;
  while (true) {
    const idx = text.indexOf(q, i);
    if (idx === -1) break;
    appState.findMatches.push({ start: idx, end: idx + q.length });
    i = idx + 1;
  }
  appState.findMatchIndex = appState.findMatches.length ? 0 : -1;
  updateFindUi();
  scrollToMatch();
}

export function updateFindUi() {
  if (!dom.findStatus || !dom.searchInTab) return;
  const total = appState.findMatches.length;
  if (total === 0) {
    dom.findStatus.textContent = dom.searchInTab.value ? 'No matches' : '';
    return;
  }
  dom.findStatus.textContent = `${appState.findMatchIndex + 1} / ${total}`;
}

export function scrollToMatch() {
  if (!dom.jsonTextarea) return;
  if (appState.findMatchIndex < 0 || appState.findMatchIndex >= appState.findMatches.length) return;
  const m = appState.findMatches[appState.findMatchIndex];
  dom.jsonTextarea.focus();
  dom.jsonTextarea.setSelectionRange(m.start, m.end);
}

export function findNext(delta) {
  if (appState.findMatches.length === 0) return;
  appState.findMatchIndex =
    (appState.findMatchIndex + delta + appState.findMatches.length) % appState.findMatches.length;
  updateFindUi();
  scrollToMatch();
}
