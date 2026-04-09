import type { Tab } from '@/lib/workspace-types';

/** Tabs + active tab — survives refresh */
export const WORKSPACE_STORAGE_KEY = 'json-workspace-workspace-v1';
export const CLOSED_TABS_STORAGE_KEY = 'json-workspace-closed-tabs-v1';

export const MAX_CLOSED_HISTORY = 40;

export type ClosedTabSnapshot = {
  id: string;
  name: string;
  text: string;
  closedAt: number;
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
      parsed.push({
        id,
        text,
        name: typeof name === 'string' ? name : '',
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
      out.push({
        id: typeof sid === 'string' ? sid : `legacy-${closedAt}-${out.length}`,
        text,
        closedAt,
        name: typeof name === 'string' ? name : '',
      });
    }
    return out.slice(0, MAX_CLOSED_HISTORY);
  } catch {
    return [];
  }
}
