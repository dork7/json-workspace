import { appState } from './state.js';
import * as dom from './dom.js';
import { uid, formatJsonString, minifyJsonString, displayTextForCompare } from './json-utils.js';
import { getActiveTab, saveActiveFromDom } from './session.js';
import { getEditViewMode, renderTree, applyViewMode } from './tree.js';
import { updateWatch, loadWatchEntries, addWatchFromInput } from './watch.js';
import {
  newTab,
  renderTabList,
  refreshTabNameFromContent,
  scheduleTabNameRefresh,
} from './tabs.js';
import { clearFind, runFind, findNext } from './find.js';
import { renderSideBySide, showCompareView, hideCompareView } from './compare.js';

// —— Tabs ——
dom.btnNewTab?.addEventListener('click', newTab);

// —— Editor (textarea) ——
dom.jsonTextarea?.addEventListener('input', () => {
  const t = getActiveTab();
  if (t && dom.jsonTextarea) t.text = dom.jsonTextarea.value;
  updateWatch();
  scheduleTabNameRefresh();
});

dom.jsonTextarea?.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || getEditViewMode() !== 'text') return;
  e.preventDefault();
  const ta = dom.jsonTextarea;
  if (!ta) return;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const v = ta.value;
  ta.value = v.slice(0, start) + '\t' + v.slice(end);
  const pos = start + 1;
  ta.selectionStart = ta.selectionEnd = pos;
  const t = getActiveTab();
  if (t) t.text = ta.value;
  updateWatch();
  scheduleTabNameRefresh();
});

document.querySelectorAll('input[name="edit-view"]').forEach((r) => {
  r.addEventListener('change', applyViewMode);
});

// —— Tree toolbar ——
dom.btnCollapseAll?.addEventListener('click', () => {
  dom.jsonTree?.querySelectorAll('details').forEach((d) => {
    d.open = false;
  });
});

dom.btnExpandAll?.addEventListener('click', () => {
  dom.jsonTree?.querySelectorAll('details').forEach((d) => {
    d.open = true;
  });
});

// —— Format / Minify ——
dom.btnFormat?.addEventListener('click', () => {
  saveActiveFromDom();
  const t = getActiveTab();
  if (!t) return;
  const out = formatJsonString(t.text);
  if (out === null) {
    alert('Invalid JSON — cannot format.');
    return;
  }
  t.text = out;
  if (dom.jsonTextarea) dom.jsonTextarea.value = out;
  dom.jsonTextarea?.focus();
  clearFind();
  if (getEditViewMode() === 'tree') renderTree();
  updateWatch();
  refreshTabNameFromContent(t);
});

dom.btnMinify?.addEventListener('click', () => {
  saveActiveFromDom();
  const t = getActiveTab();
  if (!t) return;
  const out = minifyJsonString(t.text);
  if (out === null) {
    alert('Invalid JSON — cannot minify.');
    return;
  }
  t.text = out;
  if (dom.jsonTextarea) dom.jsonTextarea.value = out;
  dom.jsonTextarea?.focus();
  clearFind();
  if (getEditViewMode() === 'tree') renderTree();
  updateWatch();
  refreshTabNameFromContent(t);
});

// —— Watch ——
dom.btnWatchAdd?.addEventListener('click', addWatchFromInput);
dom.watchInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addWatchFromInput();
  }
});

// —— Find in tab ——
dom.searchInTab?.addEventListener('input', runFind);
dom.btnFindNext?.addEventListener('click', () => findNext(1));
dom.btnFindPrev?.addEventListener('click', () => findNext(-1));

// —— Compare ——
dom.btnCompare?.addEventListener('click', () => {
  saveActiveFromDom();
  const idA = dom.compareA?.value;
  const idB = dom.compareB?.value;
  const ta = appState.tabs.find((t) => t.id === idA);
  const tb = appState.tabs.find((t) => t.id === idB);
  if (!ta || !tb) return;

  const textA = displayTextForCompare(ta.text);
  const textB = displayTextForCompare(tb.text);

  renderSideBySide(textA, textB, ta.name, tb.name);
  showCompareView();
});

dom.btnCloseCompare?.addEventListener('click', hideCompareView);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !dom.compareSection?.classList.contains('hidden')) {
    hideCompareView();
  }
});

// —— Init ——
(function init() {
  const id = uid();
  appState.tabs = [{ id, name: '', text: '{\n  \n}' }];
  appState.activeId = id;
  if (dom.jsonTextarea) dom.jsonTextarea.value = appState.tabs[0].text;
  refreshTabNameFromContent(appState.tabs[0]);
  appState.watchEntries = loadWatchEntries();
  renderTabList();
  applyViewMode();
  updateWatch();
})();
