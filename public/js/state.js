/** @type {{ tabs: { id: string, name: string, text: string }[], activeId: string, tabNameRefreshTimer: ReturnType<typeof setTimeout> | null, findMatches: { start: number, end: number }[], findMatchIndex: number, watchEntries: { id: string, expr: string }[] }} */
export const appState = {
  tabs: [],
  activeId: '',
  tabNameRefreshTimer: null,
  findMatches: [],
  findMatchIndex: -1,
  watchEntries: [],
};
