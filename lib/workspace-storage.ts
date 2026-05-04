import type { EditorBookmark, Tab, TabLanguage } from '@/lib/workspace-types';

/** Tabs + active tab — survives refresh */
export const WORKSPACE_STORAGE_KEY = 'watchfox-workspace-v1';
export const CLOSED_TABS_STORAGE_KEY = 'watchfox-closed-tabs-v1';
/** Watch expressions panel */
export const WATCH_STORAGE_KEY = 'watchfox-watch-v1';
/** Sidebar width in px (desktop layout only) */
export const SIDEBAR_WIDTH_STORAGE_KEY = 'watchfox-sidebar-width-v1';

const LEGACY_KEYS = {
  workspace: 'json-workspace-workspace-v1',
  closedTabs: 'json-workspace-closed-tabs-v1',
  watch: 'json-workspace-watch-v1',
} as const;

function migrateStoragePair(nextKey: string, legacyKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (localStorage.getItem(nextKey) !== null) return;
    const legacy = localStorage.getItem(legacyKey);
    if (legacy === null) return;
    localStorage.setItem(nextKey, legacy);
    localStorage.removeItem(legacyKey);
  } catch {
    /* ignore */
  }
}

/** Copy data from legacy keys once so upgrades keep tabs, watch list, and history. */
export function migrateWorkspaceStorageKeys(): void {
  migrateStoragePair(WORKSPACE_STORAGE_KEY, LEGACY_KEYS.workspace);
  migrateStoragePair(CLOSED_TABS_STORAGE_KEY, LEGACY_KEYS.closedTabs);
  migrateStoragePair(WATCH_STORAGE_KEY, LEGACY_KEYS.watch);
}

export const MAX_CLOSED_HISTORY = 40;

export type ClosedTabSnapshot = {
  id: string;
  name: string;
  text: string;
  closedAt: number;
  lang?: TabLanguage;
  langAuto?: boolean;
};

export type PersistedWorkspace = {
  tabs: Tab[];
  activeId: string;
};

export function parseWorkspace(raw: string | null): PersistedWorkspace | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== 'object') return null;
    const tabs = (data as { tabs?: unknown }).tabs;
    const activeId = (data as { activeId?: unknown }).activeId;
    if (!Array.isArray(tabs) || typeof activeId !== 'string') return null;
    const parsed: Tab[] = [];
    for (const t of tabs) {
      if (!t || typeof t !== 'object') continue;
      const id = (t as { id?: unknown }).id;
      const text = (t as { text?: unknown }).text;
      if (typeof id !== 'string' || typeof text !== 'string') continue;
      const name = (t as { name?: unknown }).name;
      const langRaw = (t as { lang?: unknown }).lang;
      const lang: TabLanguage | undefined =
        langRaw === 'json' || langRaw === 'javascript' || langRaw === 'typescript'
          ? langRaw
          : undefined;
      const langAutoRaw = (t as { langAuto?: unknown }).langAuto;
      const langAuto: boolean | undefined =
        typeof langAutoRaw === 'boolean'
          ? langAutoRaw
          : lang !== undefined
            ? false
            : undefined;
      const bookmarksRaw = (t as { bookmarks?: unknown }).bookmarks;
      let bookmarks: EditorBookmark[] | undefined;
      if (Array.isArray(bookmarksRaw)) {
        const bm: EditorBookmark[] = [];
        for (const b of bookmarksRaw) {
          if (!b || typeof b !== 'object') continue;
          const bid = (b as { id?: unknown }).id;
          const anch = (b as { anchor?: unknown }).anchor;
          if (typeof bid !== 'string' || typeof anch !== 'number') continue;
          bm.push({ id: bid, anchor: anch });
        }
        if (bm.length > 0) bookmarks = bm;
      }
      parsed.push({
        id,
        text,
        name: typeof name === 'string' ? name : '',
        ...(lang ? { lang } : {}),
        ...(langAuto !== undefined ? { langAuto } : {}),
        ...(bookmarks ? { bookmarks } : {}),
      });
    }
    if (parsed.length === 0) return null;
    const aid = parsed.some((x) => x.id === activeId) ? activeId : parsed[0].id;
    return { tabs: parsed, activeId: aid };
  } catch {
    return null;
  }
}

export function parseClosedHistory(raw: string | null): ClosedTabSnapshot[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    const out: ClosedTabSnapshot[] = [];
    for (const item of data) {
      if (!item || typeof item !== 'object') continue;
      const text = (item as { text?: unknown }).text;
      const closedAt = (item as { closedAt?: unknown }).closedAt;
      if (typeof text !== 'string' || typeof closedAt !== 'number') continue;
      const name = (item as { name?: unknown }).name;
      const sid = (item as { id?: unknown }).id;
      const langRaw = (item as { lang?: unknown }).lang;
      const lang: TabLanguage | undefined =
        langRaw === 'json' || langRaw === 'javascript' || langRaw === 'typescript'
          ? langRaw
          : undefined;
      const langAutoRaw = (item as { langAuto?: unknown }).langAuto;
      const langAuto =
        typeof langAutoRaw === 'boolean' ? langAutoRaw : undefined;
      out.push({
        id: typeof sid === 'string' ? sid : `legacy-${closedAt}-${out.length}`,
        text,
        closedAt,
        name: typeof name === 'string' ? name : '',
        ...(lang ? { lang } : {}),
        ...(langAuto !== undefined ? { langAuto } : {}),
      });
    }
    return out.slice(0, MAX_CLOSED_HISTORY);
  } catch {
    return [];
  }
}
