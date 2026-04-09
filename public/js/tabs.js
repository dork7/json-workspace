import { appState } from './state.js';
import * as dom from './dom.js';
import { uid } from './json-utils.js';
import { deriveTabName } from './tab-names.js';
import { getActiveTab, saveActiveFromDom } from './session.js';
import { getEditViewMode, renderTree } from './tree.js';
import { updateWatch } from './watch.js';
import { clearFind } from './find.js';

export function renderTabList() {
  if (!dom.tabList) return;
  dom.tabList.replaceChildren();
  for (const tab of appState.tabs) {
    const li = document.createElement('li');
    li.className = 'tab-item' + (tab.id === appState.activeId ? ' active' : '');
    li.role = 'tab';
    li.ariaSelected = tab.id === appState.activeId ? 'true' : 'false';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tab-btn';
    btn.textContent = tab.name;
    btn.addEventListener('click', () => selectTab(tab.id));

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tab-close';
    close.setAttribute('aria-label', 'Close tab');
    close.textContent = '×';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });

    li.appendChild(btn);
    li.appendChild(close);
    dom.tabList.appendChild(li);
  }
  populateCompareSelects();
}

export function populateCompareSelects() {
  if (!dom.compareA || !dom.compareB) return;
  dom.compareA.replaceChildren();
  dom.compareB.replaceChildren();
  for (const tab of appState.tabs) {
    const oa = document.createElement('option');
    oa.value = tab.id;
    oa.textContent = tab.name;
    dom.compareA.appendChild(oa);
    const ob = document.createElement('option');
    ob.value = tab.id;
    ob.textContent = tab.name;
    dom.compareB.appendChild(ob);
  }
  if (appState.tabs.length >= 2) {
    dom.compareA.value = appState.tabs[0].id;
    dom.compareB.value = appState.tabs[1].id;
  } else if (appState.tabs.length === 1) {
    dom.compareA.value = appState.tabs[0].id;
    dom.compareB.value = appState.tabs[0].id;
  }
}

export function refreshTabNameFromContent(tab) {
  if (!tab) return;
  const name = deriveTabName(tab.text);
  if (name === null) return;
  if (tab.name === name) return;
  tab.name = name;
  renderTabList();
}

export function scheduleTabNameRefresh() {
  if (appState.tabNameRefreshTimer !== null) clearTimeout(appState.tabNameRefreshTimer);
  appState.tabNameRefreshTimer = setTimeout(() => {
    appState.tabNameRefreshTimer = null;
    refreshTabNameFromContent(getActiveTab());
  }, 350);
}

export function selectTab(id) {
  saveActiveFromDom();
  appState.activeId = id;
  const tab = getActiveTab();
  if (tab && dom.jsonTextarea) dom.jsonTextarea.value = tab.text;
  renderTabList();
  clearFind();
  if (getEditViewMode() === 'tree') renderTree();
  updateWatch();
}

export function closeTab(id) {
  if (appState.tabs.length <= 1) return;
  const idx = appState.tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  appState.tabs.splice(idx, 1);
  if (appState.activeId === id) {
    appState.activeId = appState.tabs[Math.max(0, idx - 1)].id;
    if (dom.jsonTextarea) dom.jsonTextarea.value = getActiveTab()?.text ?? '';
  }
  renderTabList();
  clearFind();
  if (getEditViewMode() === 'tree') renderTree();
  updateWatch();
}

export function newTab() {
  saveActiveFromDom();
  const id = uid();
  appState.tabs.push({ id, name: '', text: '{\n  \n}' });
  appState.activeId = id;
  if (dom.jsonTextarea) dom.jsonTextarea.value = appState.tabs[appState.tabs.length - 1].text;
  refreshTabNameFromContent(getActiveTab());
  clearFind();
  if (getEditViewMode() === 'tree') renderTree();
  updateWatch();
}
