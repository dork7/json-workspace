import { appState } from './state.js';
import * as dom from './dom.js';

export function getActiveTab() {
  return appState.tabs.find((t) => t.id === appState.activeId) ?? null;
}

export function saveActiveFromDom() {
  const t = getActiveTab();
  if (t && dom.jsonTextarea) t.text = dom.jsonTextarea.value;
}
