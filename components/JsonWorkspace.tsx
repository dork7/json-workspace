'use client';

import dynamic from 'next/dynamic';
import { foldAll, unfoldAll } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import {
  lineSnippet,
  lineStartOffset,
  offsetToLineNumber,
} from '@/lib/editor-lines';
import { cmPlaceCursor, cmSelectRange } from '@/lib/codemirror-nav';
import { collectJsonPaths, getPathValue } from '@/lib/json-path';
import {
  displayTextForCompare,
  uid,
} from '@/lib/json-utils';
import { deriveTabLabel } from '@/lib/tab-names';
import { getTabLang } from '@/lib/tab-lang';
import { getWatchRoot } from '@/lib/watch-root';
import {
  CLOSED_TABS_STORAGE_KEY,
  FOCUSED_WATCHES_STORAGE_KEY,
  FOCUSED_WATCH_HEIGHTS_STORAGE_KEY,
  MAX_CLOSED_HISTORY,
  SIDEBAR_WIDTH_STORAGE_KEY,
  WORKSPACE_STORAGE_KEY,
  WATCH_STORAGE_KEY,
  migrateWorkspaceStorageKeys,
  parseFocusedWatchHeights,
  type ClosedTabSnapshot,
  parseClosedHistory,
  parseWorkspace,
} from '@/lib/workspace-storage';
import {
  extractWatchExprFromLine,
  sliceDocLineAt,
} from '@/lib/watch-extract-from-editor';
import type { Tab, TabLanguage } from '@/lib/workspace-types';
import { toast } from 'sonner';
import { JsonTreeView } from '@/components/JsonTreeView';

const WorkspaceEditor = dynamic(
  () => import('@/components/WorkspaceEditor'),
  { ssr: false }
);

const WATCH_VALUE_MAX = 4000;

/** Custom MIME used when dragging a Watch list item onto the editor pane. */
const WATCH_DRAG_MIME = 'application/x-watchfox-watch-id';

function dragHasWatchPayload(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  /** `types` is an array-like in modern browsers; cast for safe `includes` calls. */
  const list: readonly string[] = Array.from(dt.types ?? []);
  return list.includes(WATCH_DRAG_MIME);
}

type WatchEntry = { id: string; expr: string };

function formatWatchDisplay(v: unknown): string {
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

/** Full pretty-printed serialization of a watch value, no truncation — used for copy-to-clipboard. */
function serializeWatchValue(v: unknown): string {
  if (v === undefined) return '(undefined)';
  try {
    if (typeof v === 'function') return '[Function]';
    return v !== null && typeof v === 'object'
      ? JSON.stringify(v, null, 2)
      : JSON.stringify(v);
  } catch {
    return String(v);
  }
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.clipboard?.writeText === 'function'
    ) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /** Fall through to legacy fallback below. */
  }
  /** Legacy fallback for non-secure contexts where the async clipboard API is unavailable. */
  try {
    if (typeof document === 'undefined') return false;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

type DiffLine = {
  lineNo: number;
  text: string;
  /** True when this line differs from its counterpart on the other side. */
  differs: boolean;
  /** True when this side has no content for this row (the other side is longer). */
  empty: boolean;
};

function computeDiffLines(
  aText: string,
  bText: string
): { left: DiffLine[]; right: DiffLine[]; differCount: number } {
  const al = aText.split('\n');
  const bl = bText.split('\n');
  const n = Math.max(al.length, bl.length);
  const left: DiffLine[] = [];
  const right: DiffLine[] = [];
  let differCount = 0;
  for (let i = 0; i < n; i++) {
    const la = al[i];
    const lb = bl[i];
    const differs = la !== lb;
    if (differs) differCount++;
    left.push({
      lineNo: i + 1,
      text: la ?? '',
      differs,
      empty: la === undefined,
    });
    right.push({
      lineNo: i + 1,
      text: lb ?? '',
      differs,
      empty: lb === undefined,
    });
  }
  return { left, right, differCount };
}

const SIDEBAR_WIDTH_DEFAULT = 280;
const SIDEBAR_MIN = 200;
const SIDEBAR_MIN_MAIN = 320;
const SIDEBAR_CAP = 720;

function clampSidebarWidth(px: number, viewportW: number): number {
  const maxAllowed = Math.min(SIDEBAR_CAP, viewportW - SIDEBAR_MIN_MAIN);
  const lo = Math.min(SIDEBAR_MIN, maxAllowed);
  const hi = Math.max(lo, maxAllowed);
  return Math.min(Math.max(Math.round(px), lo), hi);
}

/** Default and bounds for a single focused watch card's height (px). */
const FOCUS_CARD_HEIGHT_DEFAULT = 240;
const FOCUS_CARD_HEIGHT_MIN = 120;
const FOCUS_CARD_HEIGHT_MAX = 900;

function clampFocusCardHeight(px: number): number {
  return Math.min(
    Math.max(Math.round(px), FOCUS_CARD_HEIGHT_MIN),
    FOCUS_CARD_HEIGHT_MAX
  );
}

export function JsonWorkspace() {
  const [tabs, setTabs] = useState<Tab[]>(() => [
    { id: 'tab-0', name: '', text: '{\n  \n}' },
  ]);
  const [activeId, setActiveId] = useState('tab-0');
  const [hydrated, setHydrated] = useState(false);
  const [closedHistory, setClosedHistory] = useState<ClosedTabSnapshot[]>([]);
  const [watchEntries, setWatchEntries] = useState<WatchEntry[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareAId, setCompareAId] = useState('tab-0');
  const [compareBId, setCompareBId] = useState('tab-0');
  const [findQuery, setFindQuery] = useState('');
  const [findMatchIndex, setFindMatchIndex] = useState(-1);
  const [watchInput, setWatchInput] = useState('');
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionHighlight, setSuggestionHighlight] = useState(-1);
  const [busyAction, setBusyAction] = useState<'format' | 'minify' | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_WIDTH_DEFAULT);
  const [focusedWatchIds, setFocusedWatchIds] = useState<string[]>([]);
  const [focusedWatchHeights, setFocusedWatchHeights] = useState<
    Record<string, number>
  >({});
  const [editorDragOver, setEditorDragOver] = useState(false);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const editorViewRef = useRef<EditorView | null>(null);
  const watchInputRef = useRef<HTMLInputElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const findNextButtonRef = useRef<HTMLButtonElement>(null);
  const findPrevButtonRef = useRef<HTMLButtonElement>(null);
  /** After toolbar find navigation, stay in toolbar instead of focusing the editor */
  const findToolbarFocusTargetRef = useRef<'next' | 'prev' | 'find' | null>(
    null
  );
  const nameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIdRef = useRef(activeId);
  const sidebarWidthRef = useRef(sidebarWidth);
  const focusedWatchHeightsRef = useRef(focusedWatchHeights);
  /** Counts dragenter/dragleave so we don't flicker when the cursor crosses nested editor children. */
  const editorDragDepthRef = useRef(0);

  sidebarWidthRef.current = sidebarWidth;
  focusedWatchHeightsRef.current = focusedWatchHeights;

  activeIdRef.current = activeId;

  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const activeLang = useMemo(
    () => getTabLang(activeTab),
    [activeTab.text, activeTab.lang, activeTab.langAuto]
  );

  const watchRoot = useMemo(
    () => getWatchRoot(activeTab.text, activeLang),
    [activeTab.text, activeLang]
  );

  const pathSuggestions = useMemo(() => {
    if (!watchRoot.ok) return [] as string[];
    const out: string[] = [];
    collectJsonPaths(watchRoot.value, '', out);
    /** Hide noisy root branches we never want to suggest. Matches `actions`/`dictionary`/`definitions` and any nested path under them (e.g. `dictionary.foo`, `actions[0]`, `definitions.bar`). */
    const HIDDEN_ROOTS = /^(?:actions|dictionary|definitions)(?:$|[.[])/;
    return [...new Set(out)]
      .filter((p) => !HIDDEN_ROOTS.test(p))
      .sort((a, b) => a.localeCompare(b));
  }, [watchRoot]);

  const filteredSuggestions = useMemo(() => {
    const q = watchInput.trim().toLowerCase();
    const list = q
      ? pathSuggestions.filter((p) => p.toLowerCase().includes(q))
      : pathSuggestions;
    return list.slice(0, 50);
  }, [pathSuggestions, watchInput]);

  const focusedWatchSet = useMemo(
    () => new Set(focusedWatchIds),
    [focusedWatchIds]
  );

  /** Pinned watch entries in the order they were pinned, filtered to existing ones. */
  const focusedWatchEntries = useMemo(() => {
    if (focusedWatchIds.length === 0) return [] as WatchEntry[];
    const byId = new Map(watchEntries.map((w) => [w.id, w]));
    const out: WatchEntry[] = [];
    for (const id of focusedWatchIds) {
      const w = byId.get(id);
      if (w) out.push(w);
    }
    return out;
  }, [focusedWatchIds, watchEntries]);

  const findMatches = useMemo(() => {
    if (!findQuery) return [] as { start: number; end: number }[];
    const text = activeTab.text;
    const matches: { start: number; end: number }[] = [];
    let i = 0;
    while (true) {
      const idx = text.indexOf(findQuery, i);
      if (idx === -1) break;
      matches.push({ start: idx, end: idx + findQuery.length });
      i = idx + 1;
    }
    return matches;
  }, [findQuery, activeTab.text]);

  const activeBookmarksSanitized = useMemo(() => {
    const text = activeTab.text;
    const raw = activeTab.bookmarks ?? [];
    return raw
      .filter((b) => b.anchor >= 0 && b.anchor <= text.length)
      .slice()
      .sort((a, b) => a.anchor - b.anchor);
  }, [activeTab.bookmarks, activeTab.text]);

  const bookmarkAnchorsSet = useMemo(() => {
    const text = activeTab.text;
    const s = new Set<number>();
    for (const b of activeTab.bookmarks ?? []) {
      if (typeof b.anchor !== 'number') continue;
      if (b.anchor < 0 || b.anchor > text.length) continue;
      s.add(lineStartOffset(text, b.anchor));
    }
    return s;
  }, [activeTab.bookmarks, activeTab.text]);

  /** Reset navigation when query or buffer changes — editor selection moves only after Enter / Prev / Next. */
  useEffect(() => {
    setFindMatchIndex(-1);
  }, [findQuery, activeTab.text]);

  useEffect(() => {
    migrateWorkspaceStorageKeys();
  }, []);

  /** Keep the highlighted suggestion in range as the filtered list shrinks. */
  useEffect(() => {
    setSuggestionHighlight((i) =>
      i >= filteredSuggestions.length ? filteredSuggestions.length - 1 : i
    );
  }, [filteredSuggestions]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(WATCH_STORAGE_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw) as unknown;
      if (!Array.isArray(arr)) return;
      const next = arr
        .filter((x): x is { expr?: string } => x && typeof (x as { expr?: string }).expr === 'string')
        .map((x) => ({
          id: typeof (x as { id?: string }).id === 'string' ? (x as { id: string }).id : uid(),
          expr: String((x as { expr: string }).expr).trim(),
        }))
        .filter((x) => x.expr);
      setWatchEntries(next);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        WATCH_STORAGE_KEY,
        JSON.stringify(watchEntries.map((w) => ({ id: w.id, expr: w.expr })))
      );
    } catch {
      /* ignore */
    }
  }, [watchEntries]);

  useEffect(() => {
    try {
      const w = parseWorkspace(
        typeof window !== 'undefined'
          ? localStorage.getItem(WORKSPACE_STORAGE_KEY)
          : null
      );
      if (w) {
        const tabsFixed = w.tabs.map((t) => {
          if (t.nameLocked) return t;
          const n = deriveTabLabel(t.text, getTabLang(t));
          if (n !== null && t.name !== n) return { ...t, name: n };
          return t;
        });
        setTabs(tabsFixed);
        setActiveId(w.activeId);
      }
      setClosedHistory(
        parseClosedHistory(
          typeof window !== 'undefined'
            ? localStorage.getItem(CLOSED_TABS_STORAGE_KEY)
            : null
        )
      );
    } catch {
      /* ignore */
    }
    try {
      const sw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
      if (sw !== null) {
        const n = Number.parseInt(sw, 10);
        if (Number.isFinite(n)) {
          setSidebarWidth(clampSidebarWidth(n, window.innerWidth));
        }
      }
    } catch {
      /* ignore */
    }
    try {
      const raw = localStorage.getItem(FOCUSED_WATCHES_STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as unknown;
        if (Array.isArray(arr)) {
          const ids = arr.filter((x): x is string => typeof x === 'string');
          if (ids.length) setFocusedWatchIds(ids);
        }
      }
    } catch {
      /* ignore */
    }
    try {
      const raw = localStorage.getItem(FOCUSED_WATCH_HEIGHTS_STORAGE_KEY);
      const map = parseFocusedWatchHeights(raw);
      const cleaned: Record<string, number> = {};
      for (const [id, h] of Object.entries(map)) {
        cleaned[id] = clampFocusCardHeight(h);
      }
      setFocusedWatchHeights(cleaned);
    } catch {
      /* ignore */
    }
    queueMicrotask(() => setHydrated(true));
  }, []);

  const scheduleTabNameRefresh = useCallback(() => {
    if (nameTimerRef.current) clearTimeout(nameTimerRef.current);
    nameTimerRef.current = setTimeout(() => {
      nameTimerRef.current = null;
      const id = activeIdRef.current;
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        if (idx === -1) return prev;
        const tab = prev[idx];
        if (tab.nameLocked) return prev;
        const name = deriveTabLabel(tab.text, getTabLang(tab));
        if (name === null || tab.name === name) return prev;
        const next = [...prev];
        next[idx] = { ...tab, name };
        return next;
      });
    }, 350);
  }, []);

  useEffect(() => {
    return () => {
      if (nameTimerRef.current) clearTimeout(nameTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (tabs.length === 0) return;
    setCompareAId((a) => (tabs.some((t) => t.id === a) ? a : tabs[0].id));
    setCompareBId((b) =>
      tabs.some((t) => t.id === b) ? b : (tabs[1] ?? tabs[0]).id
    );
  }, [tabs]);

  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          WORKSPACE_STORAGE_KEY,
          JSON.stringify({ tabs, activeId })
        );
      } catch {
        /* ignore */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [tabs, activeId, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          CLOSED_TABS_STORAGE_KEY,
          JSON.stringify(closedHistory)
        );
      } catch {
        /* ignore */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [closedHistory, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          SIDEBAR_WIDTH_STORAGE_KEY,
          String(sidebarWidth)
        );
      } catch {
        /* ignore */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [sidebarWidth, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(
        FOCUSED_WATCHES_STORAGE_KEY,
        JSON.stringify(focusedWatchIds)
      );
    } catch {
      /* ignore */
    }
  }, [focusedWatchIds, hydrated]);

  /** Drop pinned IDs that no longer reference an existing watch entry. */
  useEffect(() => {
    setFocusedWatchIds((prev) => {
      const valid = new Set(watchEntries.map((w) => w.id));
      const next = prev.filter((id) => valid.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [watchEntries]);

  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          FOCUSED_WATCH_HEIGHTS_STORAGE_KEY,
          JSON.stringify(focusedWatchHeights)
        );
      } catch {
        /* ignore */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [focusedWatchHeights, hydrated]);

  /** Forget custom heights for cards that are no longer pinned. */
  useEffect(() => {
    setFocusedWatchHeights((prev) => {
      const keep = new Set(focusedWatchIds);
      const keys = Object.keys(prev);
      if (keys.every((k) => keep.has(k))) return prev;
      const next: Record<string, number> = {};
      for (const k of keys) if (keep.has(k)) next[k] = prev[k];
      return next;
    });
  }, [focusedWatchIds]);

  useEffect(() => {
    const onResize = () => {
      setSidebarWidth((w) => clampSidebarWidth(w, window.innerWidth));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const updateActiveText = useCallback(
    (text: string) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === activeId ? { ...t, text } : t))
      );
      scheduleTabNameRefresh();
    },
    [activeId, scheduleTabNameRefresh]
  );

  const onTextInput = (value: string) => {
    updateActiveText(value);
  };

  const toggleBookmarkAtLine = useCallback(
    (docLineStart: number) => {
      const text = activeTab.text;
      const lineStart = lineStartOffset(
        text,
        Math.min(Math.max(0, docLineStart), text.length)
      );
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== activeId) return t;
          const list = [...(t.bookmarks ?? [])].filter(
            (b) => b.anchor >= 0 && b.anchor <= text.length
          );
          const idx = list.findIndex(
            (b) =>
              lineStartOffset(text, Math.min(b.anchor, text.length)) ===
              lineStart
          );
          if (idx >= 0) {
            list.splice(idx, 1);
            return {
              ...t,
              ...(list.length ? { bookmarks: list } : { bookmarks: undefined }),
            };
          }
          list.push({ id: uid(), anchor: lineStart });
          list.sort((a, b) => a.anchor - b.anchor);
          return { ...t, bookmarks: list };
        })
      );
    },
    [activeId, activeTab.text]
  );

  const toggleBookmarkAtCursor = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) return;
    const text = activeTab.text;
    const pos = view.state.selection.main.head;
    toggleBookmarkAtLine(lineStartOffset(text, pos));
  }, [activeTab.text, toggleBookmarkAtLine]);

  const removeBookmark = useCallback(
    (bookmarkId: string) => {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== activeId) return t;
          const list = (t.bookmarks ?? []).filter((b) => b.id !== bookmarkId);
          return {
            ...t,
            ...(list.length ? { bookmarks: list } : { bookmarks: undefined }),
          };
        })
      );
    },
    [activeId]
  );

  const clearAllBookmarks = useCallback(() => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeId ? { ...t, bookmarks: undefined } : t
      )
    );
  }, [activeId]);

  const goToBookmark = useCallback(
    (anchor: number) => {
      const view = editorViewRef.current;
      if (!view) return;
      const text = activeTab.text;
      const a = Math.min(Math.max(0, anchor), text.length);
      cmPlaceCursor(view, a);
      view.focus();
    },
    [activeTab.text]
  );

  const selectTab = (id: string) => {
    setActiveId(id);
    setFindQuery('');
  };

  const closeTab = (id: string) => {
    if (tabs.length <= 1) return;
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const closing = tabs[idx];
    setClosedHistory((prev) => {
      const snap: ClosedTabSnapshot = {
        id: uid(),
        name: closing.name,
        text: closing.text,
        closedAt: Date.now(),
        ...(closing.langAuto === false
          ? { langAuto: false as const, lang: closing.lang ?? 'json' }
          : { langAuto: true as const }),
        ...(closing.nameLocked ? { nameLocked: true as const } : {}),
      };
      return [snap, ...prev].slice(0, MAX_CLOSED_HISTORY);
    });
    const next = tabs.filter((t) => t.id !== id);
    setTabs(next);
    if (activeId === id) {
      const ni = Math.max(0, idx - 1);
      setActiveId(next[ni].id);
    }
  };

  const restoreClosed = (snap: ClosedTabSnapshot) => {
    const newId = uid();
    const manual =
      snap.langAuto === false ||
      (snap.langAuto === undefined && snap.lang !== undefined);
    setTabs((prev) => [
      ...prev,
      {
        id: newId,
        name: snap.name,
        text: snap.text,
        ...(manual
          ? { langAuto: false, lang: snap.lang ?? 'json' }
          : { langAuto: true }),
        ...(snap.nameLocked ? { nameLocked: true } : {}),
      },
    ]);
    setActiveId(newId);
    setClosedHistory((prev) => prev.filter((x) => x.id !== snap.id));
    setFindQuery('');
  };

  const dismissClosed = (snap: ClosedTabSnapshot) => {
    setClosedHistory((prev) => prev.filter((x) => x.id !== snap.id));
  };

  const newTab = () => {
    const id = uid();
    setTabs((prev) => [...prev, { id, name: '', text: '{\n  \n}' }]);
    setActiveId(id);
    setFindQuery('');
  };

  const startRenameTab = useCallback(
    (id: string) => {
      const tab = tabs.find((t) => t.id === id);
      if (!tab) return;
      setRenamingTabId(id);
      setRenameDraft(tab.name);
    },
    [tabs]
  );

  const cancelRenameTab = useCallback(() => {
    setRenamingTabId(null);
    setRenameDraft('');
  }, []);

  /** Live-edit the active tab's name from the editor toolbar input. */
  const setActiveTabName = useCallback((name: string) => {
    const id = activeIdRef.current;
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, name, nameLocked: true } : t))
    );
  }, []);

  /** On blur/Enter, an empty name reverts to the auto-derived label. */
  const commitActiveTabName = useCallback(() => {
    const id = activeIdRef.current;
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        if (t.name.trim() !== '') return t;
        const auto = deriveTabLabel(t.text, getTabLang(t)) ?? '';
        const { nameLocked: _nameLocked, ...rest } = t;
        return { ...rest, name: auto };
      })
    );
  }, []);

  const commitRenameTab = useCallback(() => {
    const id = renamingTabId;
    if (!id) return;
    const draft = renameDraft.trim();
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        if (draft === '') {
          /** Empty draft resets to auto-derived. Re-run derivation immediately. */
          const auto = deriveTabLabel(t.text, getTabLang(t)) ?? '';
          if (!t.nameLocked && t.name === auto) return t;
          /** Strip `nameLocked` so future edits resume content-driven naming. */
          const { nameLocked: _nameLocked, ...rest } = t;
          return { ...rest, name: auto };
        }
        if (t.nameLocked && t.name === draft) return t;
        return { ...t, name: draft, nameLocked: true };
      })
    );
    setRenamingTabId(null);
    setRenameDraft('');
  }, [renamingTabId, renameDraft]);

  const setLanguageSelect = (value: string) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeId) return t;
        if (value === 'auto') return { ...t, langAuto: true };
        return { ...t, langAuto: false, lang: value as TabLanguage };
      })
    );
    scheduleTabNameRefresh();
  };

  const onFormat = async () => {
    const id = activeId;
    const lang = getTabLang(activeTab);
    const text = activeTab.text;
    setBusyAction('format');
    try {
      const res = await fetch('/api/format', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        text?: string;
        error?: string;
      };
      if (!data.ok || typeof data.text !== 'string') {
        toast.error(data.error ?? 'Cannot format.');
        return;
      }
      const out = data.text;
      const name = deriveTabLabel(out, lang);
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t;
          if (t.nameLocked || name === null) return { ...t, text: out };
          return { ...t, text: out, name };
        })
      );
    } catch {
      toast.error('Format request failed. Check your connection and try again.');
    } finally {
      setBusyAction(null);
    }
  };

  const onMinify = async () => {
    const id = activeId;
    const lang = getTabLang(activeTab);
    const text = activeTab.text;
    setBusyAction('minify');
    try {
      const res = await fetch('/api/minify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        text?: string;
        error?: string;
      };
      if (!data.ok || typeof data.text !== 'string') {
        toast.error(data.error ?? 'Cannot minify.');
        return;
      }
      const out = data.text;
      const name = deriveTabLabel(out, lang);
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t;
          if (t.nameLocked || name === null) return { ...t, text: out };
          return { ...t, text: out, name };
        })
      );
    } catch {
      toast.error('Minify request failed. Check your connection and try again.');
    } finally {
      setBusyAction(null);
    }
  };

  const onCollapseAll = useCallback(() => {
    const view = editorViewRef.current;
    if (view) foldAll(view);
  }, []);

  const onExpandAll = useCallback(() => {
    const view = editorViewRef.current;
    if (view) unfoldAll(view);
  }, []);

  /**
   * Double-click anywhere inside a focused-watch card's value pane (but not
   * on its interactive controls — toggles, key buttons, the Copy/Close
   * buttons) selects every visible character in that pane. Mirrors the
   * editor's double-click-selects-all behaviour without the brief
   * word-selection flash.
   */
  const onFocusCardMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.detail !== 2 || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, textarea, select')) return;
    e.preventDefault();
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(e.currentTarget);
    sel.removeAllRanges();
    sel.addRange(range);
  };

  const onCopyAll = async () => {
    const text = activeTab.text;
    if (text === '') {
      toast.info('Nothing to copy — this tab is empty.');
      return;
    }
    const ok = await copyTextToClipboard(text);
    if (ok) {
      toast.success('Copied tab contents to clipboard.');
    } else {
      toast.error('Could not copy. Check your browser clipboard permissions.');
    }
  };

  const onCopyFocusedWatch = async (expr: string) => {
    const { value, err, display } = evaluateWatch(expr);
    const text = err ? display : serializeWatchValue(value);
    const ok = await copyTextToClipboard(text);
    if (ok) {
      toast.success(err ? 'Copied error message.' : `Copied value of ${expr}.`);
    } else {
      toast.error('Could not copy. Check your browser clipboard permissions.');
    }
  };

  const addWatchExpr = useCallback((rawExpr: string) => {
    const expr = rawExpr.trim();
    if (!expr) return;
    setWatchEntries((w) => {
      if (w.some((x) => x.expr === expr)) return w;
      return [...w, { id: uid(), expr }];
    });
    setWatchInput('');
    setSuggestionsOpen(false);
    setSuggestionHighlight(-1);
  }, []);

  const addWatch = () => addWatchExpr(watchInput);

  const addWatchFromDocLineStart = useCallback(
    (docLineStart: number) => {
      const text = activeTab.text;
      const lineText = sliceDocLineAt(text, docLineStart);
      const col = lineText.search(/\S/u);
      const expr = extractWatchExprFromLine(
        lineText,
        activeLang,
        col >= 0 ? col : 0
      );
      if (!expr) {
        toast.error(
          'Could not infer a watch path from this line. Try a line with a JSON key, const/function/class name, or identifier.'
        );
        return;
      }
      let added = false;
      flushSync(() => {
        setWatchEntries((w) => {
          if (w.some((x) => x.expr === expr)) return w;
          added = true;
          return [...w, { id: uid(), expr }];
        });
      });
      if (!added) {
        toast.error(`Watch already lists "${expr}".`);
        return;
      }
      setWatchInput('');
      queueMicrotask(() => editorViewRef.current?.focus());
    },
    [activeLang, activeTab.text]
  );

  const removeWatch = (id: string) => {
    setWatchEntries((w) => w.filter((x) => x.id !== id));
  };

  const clearAllWatches = useCallback(() => {
    setWatchEntries([]);
  }, []);

  const focusWatchById = useCallback((id: string) => {
    setFocusedWatchIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const unfocusWatch = useCallback((id: string) => {
    setFocusedWatchIds((prev) => prev.filter((x) => x !== id));
  }, []);

  const clearAllFocusedWatches = useCallback(() => {
    setFocusedWatchIds([]);
  }, []);

  const onWatchItemDragStart = useCallback(
    (e: React.DragEvent<HTMLLIElement>, id: string) => {
      /**
       * Only attach the custom MIME — no `text/plain`. CodeMirror is a drop
       * target inside `.editor-section`, and a `text/plain` payload would be
       * pasted into the document if our capture-phase intercept ever missed.
       */
      e.dataTransfer.setData(WATCH_DRAG_MIME, id);
      e.dataTransfer.effectAllowed = 'copy';
    },
    []
  );

  /**
   * Drag/drop handlers run in **capture** phase so CodeMirror's own drop
   * listener (registered on inner DOM nodes) never sees a Watch drag.
   * We call `stopPropagation` (and `stopImmediatePropagation` on the native
   * event) so the event terminates at `.editor-section`.
   */
  const onEditorDragEnterCapture = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      if (!dragHasWatchPayload(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      editorDragDepthRef.current += 1;
      if (editorDragDepthRef.current === 1) setEditorDragOver(true);
    },
    []
  );

  const onEditorDragOverCapture = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      if (!dragHasWatchPayload(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      e.dataTransfer.dropEffect = 'copy';
    },
    []
  );

  const onEditorDragLeaveCapture = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      if (!dragHasWatchPayload(e.dataTransfer)) return;
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      editorDragDepthRef.current = Math.max(
        0,
        editorDragDepthRef.current - 1
      );
      if (editorDragDepthRef.current === 0) setEditorDragOver(false);
    },
    []
  );

  const onEditorDropCapture = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      if (!dragHasWatchPayload(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      const id = e.dataTransfer.getData(WATCH_DRAG_MIME);
      editorDragDepthRef.current = 0;
      setEditorDragOver(false);
      if (id) focusWatchById(id);
    },
    [focusWatchById]
  );

  const onFocusCardResizerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, id: string) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const pointerId = e.pointerId;
      const startY = e.clientY;
      const startH =
        focusedWatchHeightsRef.current[id] ?? FOCUS_CARD_HEIGHT_DEFAULT;

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const next = clampFocusCardHeight(startH + (ev.clientY - startY));
        setFocusedWatchHeights((prev) =>
          prev[id] === next ? prev : { ...prev, [id]: next }
        );
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        document.body.classList.remove('is-resizing-focus-card');
      };

      document.body.classList.add('is-resizing-focus-card');
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    []
  );

  const onFocusCardResizerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, id: string) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 16 : -16;
      setFocusedWatchHeights((prev) => {
        const cur = prev[id] ?? FOCUS_CARD_HEIGHT_DEFAULT;
        const next = clampFocusCardHeight(cur + delta);
        return prev[id] === next ? prev : { ...prev, [id]: next };
      });
    },
    []
  );

  const onSidebarResizerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const pointerId = e.pointerId;
      const startX = e.clientX;
      const startW = sidebarWidthRef.current;

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        setSidebarWidth(
          clampSidebarWidth(startW + ev.clientX - startX, window.innerWidth)
        );
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        document.body.classList.remove('is-resizing-sidebar');
      };

      document.body.classList.add('is-resizing-sidebar');
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    []
  );

  const onSidebarResizerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const vw = window.innerWidth;
      const delta = e.key === 'ArrowRight' ? 12 : -12;
      setSidebarWidth((w) => clampSidebarWidth(w + delta, vw));
    },
    []
  );

  const findNext = (delta: number) => {
    const n = findMatches.length;
    if (n === 0) return;
    setFindMatchIndex((i) => {
      if (delta > 0) {
        if (i < 0) return 0;
        return (i + 1) % n;
      }
      if (i < 0) return n - 1;
      return (i - 1 + n) % n;
    });
  };

  useEffect(() => {
    if (findMatchIndex < 0 || findMatchIndex >= findMatches.length) return;
    const m = findMatches[findMatchIndex];
    const view = editorViewRef.current;
    if (!view) return;
    cmSelectRange(view, m.start, m.end);
    const focusTarget = findToolbarFocusTargetRef.current;
    if (focusTarget) {
      findToolbarFocusTargetRef.current = null;
      view.scrollDOM.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      queueMicrotask(() => {
        if (focusTarget === 'next') findNextButtonRef.current?.focus();
        else if (focusTarget === 'prev') findPrevButtonRef.current?.focus();
        else findInputRef.current?.focus();
      });
      return;
    }
    view.focus();
  }, [findMatchIndex, findMatches]);

  const compareDiff = useMemo(() => {
    const ta = tabs.find((t) => t.id === compareAId);
    const tb = tabs.find((t) => t.id === compareBId);
    if (!ta || !tb) {
      return {
        left: [] as DiffLine[],
        right: [] as DiffLine[],
        differCount: 0,
      };
    }
    return computeDiffLines(
      displayTextForCompare(ta.text, getTabLang(ta)),
      displayTextForCompare(tb.text, getTabLang(tb))
    );
  }, [tabs, compareAId, compareBId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && compareOpen) {
        setCompareOpen(false);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        if (compareOpen) setCompareOpen(false);
        queueMicrotask(() => {
          findInputRef.current?.focus();
          findInputRef.current?.select();
        });
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.altKey &&
        e.key.toLowerCase() === 'b'
      ) {
        if (compareOpen) return;
        const view = editorViewRef.current;
        if (!view?.hasFocus) return;
        e.preventDefault();
        toggleBookmarkAtCursor();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [compareOpen, toggleBookmarkAtCursor]);

  const onCompare = () => {
    setCompareOpen(true);
  };

  const findStatus =
    findMatches.length === 0
      ? findQuery
        ? 'No matches'
        : ''
      : findMatchIndex < 0
        ? `${findMatches.length} match${findMatches.length === 1 ? '' : 'es'} · Enter`
        : `${findMatchIndex + 1} / ${findMatches.length}`;

  const evaluateWatch = (
    expr: string
  ): { display: string; err: boolean; value: unknown } => {
    if (!watchRoot.ok) {
      return {
        err: true,
        display:
          activeLang === 'json'
            ? `Invalid JSON: ${watchRoot.error}`
            : `Parse error: ${watchRoot.error}`,
        value: undefined,
      };
    }
    const res = getPathValue(watchRoot.value, expr);
    if (!res.ok) {
      return {
        err: true,
        display: res.error ?? 'Path error',
        value: undefined,
      };
    }
    return {
      err: false,
      display: formatWatchDisplay(res.value),
      value: res.value,
    };
  };

  const watchPanel = (
    <div className="watch-panel">
      <div className="watch-panel-head">
        <h2 className="watch-heading">Watch</h2>
        <div className="watch-panel-head-actions">
          <button
            type="button"
            className="btn ghost watch-clear-all"
            disabled={watchEntries.length === 0}
            title="Remove all watch expressions"
            onClick={clearAllWatches}
          >
            Clear all
          </button>
        </div>
      </div>
      <p className="watch-hint">
        Paths from root, e.g. <code>user</code>, <code>items[0]</code>,{' '}
        <code>["key-name"]</code>. Choosing a suggestion adds it to the list.
      </p>
      <div className="watch-add-wrap">
        <div className="watch-add">
          <input
            ref={watchInputRef}
            type="text"
            className="watch-input"
            placeholder="path…"
            autoComplete="off"
            spellCheck={false}
            value={watchInput}
            role="combobox"
            aria-expanded={
              suggestionsOpen && filteredSuggestions.length > 0
            }
            aria-controls="watch-suggestions-list"
            aria-autocomplete="list"
            aria-activedescendant={
              suggestionHighlight >= 0 &&
              filteredSuggestions[suggestionHighlight]
                ? `watch-suggestion-${suggestionHighlight}`
                : undefined
            }
            onFocus={() => setSuggestionsOpen(true)}
            onChange={(e) => {
              setWatchInput(e.target.value);
              setSuggestionsOpen(true);
              setSuggestionHighlight(-1);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (
                  suggestionsOpen &&
                  suggestionHighlight >= 0 &&
                  filteredSuggestions[suggestionHighlight]
                ) {
                  addWatchExpr(filteredSuggestions[suggestionHighlight]);
                } else {
                  addWatch();
                }
              } else if (e.key === 'ArrowDown') {
                if (filteredSuggestions.length === 0) return;
                e.preventDefault();
                setSuggestionsOpen(true);
                setSuggestionHighlight((i) =>
                  Math.min(filteredSuggestions.length - 1, i + 1)
                );
              } else if (e.key === 'ArrowUp') {
                if (filteredSuggestions.length === 0) return;
                e.preventDefault();
                setSuggestionsOpen(true);
                setSuggestionHighlight((i) =>
                  Math.max(0, (i < 0 ? filteredSuggestions.length : i) - 1)
                );
              } else if (e.key === 'Escape') {
                if (suggestionsOpen) {
                  e.preventDefault();
                  setSuggestionsOpen(false);
                }
              }
            }}
            onBlur={() => {
              /** Defer so a click on a suggestion (mousedown → blur → click) registers. */
              window.setTimeout(() => setSuggestionsOpen(false), 120);
            }}
          />
          <button type="button" className="btn" onClick={addWatch}>
            Add
          </button>
        </div>
        {suggestionsOpen && filteredSuggestions.length > 0 ? (
          <ul
            id="watch-suggestions-list"
            className="watch-suggestions"
            role="listbox"
            aria-label="Path suggestions"
          >
            {filteredSuggestions.map((s, i) => (
              <li
                key={s}
                id={`watch-suggestion-${i}`}
                role="option"
                aria-selected={i === suggestionHighlight}
                className={`watch-suggestion${
                  i === suggestionHighlight ? ' is-active' : ''
                }`}
                /** mousedown fires before the input blurs; preventDefault keeps focus. */
                onMouseDown={(e) => {
                  e.preventDefault();
                  addWatchExpr(s);
                }}
                onMouseEnter={() => setSuggestionHighlight(i)}
              >
                {s}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <ul className="watch-list">
        {watchEntries.map((w) => {
          const { display, err } = evaluateWatch(w.expr);
          const focused = focusedWatchSet.has(w.id);
          return (
            <li
              key={w.id}
              className={`watch-item${focused ? ' is-pinned' : ''}`}
              draggable
              onDragStart={(e) => onWatchItemDragStart(e, w.id)}
              title="Drag onto the editor to pin this watch alongside"
            >
              <div className="watch-expr">
                <code>{w.expr}</code>
                <div className="watch-item-actions">
                  {focused ? (
                    <span
                      className="watch-pinned-mark"
                      aria-label="Pinned alongside editor"
                      title="Pinned alongside editor"
                    >
                      ●
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="watch-remove"
                    aria-label="Remove watch"
                    onClick={() => removeWatch(w.id)}
                  >
                    ×
                  </button>
                </div>
              </div>
              <pre className={`watch-value${err ? ' watch-err' : ''}`}>{display}</pre>
            </li>
          );
        })}
      </ul>
    </div>
  );

  const focusedWatchPanel =
    focusedWatchEntries.length === 0 ? null : (
      <div className="editor-focus-stack" aria-label="Focused watches">
        <div className="editor-focus-stack-head">
          <h2 className="editor-focus-stack-heading">Focused</h2>
          <button
            type="button"
            className="btn ghost editor-focus-stack-clear"
            title="Close all focused watches"
            onClick={clearAllFocusedWatches}
          >
            Close all
          </button>
        </div>
        {focusedWatchEntries.map((w) => {
          const { display, err, value } = evaluateWatch(w.expr);
          const height =
            focusedWatchHeights[w.id] ?? FOCUS_CARD_HEIGHT_DEFAULT;
          return (
            <article
              key={w.id}
              className="editor-focus-card"
              /**
               * `flex-basis` is the preferred height. Cards have `flex-grow: 1`
               * (in CSS) so they expand to fill the remaining dock height —
               * a single pinned watch covers the full available area; multiple
               * cards share the space proportionally based on their bases.
               */
              style={{ flexBasis: `${height}px` }}
            >
              <header className="editor-focus-card-head">
                <code className="editor-focus-card-expr" title={w.expr}>
                  {w.expr}
                </code>
                <div className="editor-focus-card-actions">
                  <button
                    type="button"
                    className="editor-focus-card-copy"
                    aria-label={`Copy value of ${w.expr}`}
                    title="Copy value to clipboard"
                    onClick={() => void onCopyFocusedWatch(w.expr)}
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    className="editor-focus-card-close"
                    aria-label={`Close focused view for ${w.expr}`}
                    title="Close focused view"
                    onClick={() => unfocusWatch(w.id)}
                  >
                    ×
                  </button>
                </div>
              </header>
              <div
                className={`editor-focus-card-value${err ? ' watch-err' : ''}`}
                onMouseDown={onFocusCardMouseDown}
              >
                {err ? (
                  <pre className="editor-focus-card-error">{display}</pre>
                ) : (
                  <JsonTreeView value={value} highlight={findQuery} />
                )}
              </div>
              <div
                className="editor-focus-card-resizer"
                role="separator"
                aria-orientation="horizontal"
                aria-label={`Resize focused view for ${w.expr}`}
                tabIndex={0}
                aria-valuemin={FOCUS_CARD_HEIGHT_MIN}
                aria-valuemax={FOCUS_CARD_HEIGHT_MAX}
                aria-valuenow={Math.round(height)}
                title="Drag to resize · ↑/↓ to nudge"
                onPointerDown={(e) =>
                  onFocusCardResizerPointerDown(e, w.id)
                }
                onKeyDown={(e) => onFocusCardResizerKeyDown(e, w.id)}
              >
                <span className="editor-focus-card-resizer-grip" aria-hidden />
              </div>
            </article>
          );
        })}
      </div>
    );

  return (
    <div
      className="app"
      style={
        { '--app-sidebar-width': `${sidebarWidth}px` } as React.CSSProperties
      }
    >
      <aside className="sidebar">
        <div className="sidebar-head">
          <h1 className="sidebar-title">Watchfox</h1>
        </div>

        {watchPanel}

        <div className="sidebar-new-tab">
          <button type="button" className="btn primary" onClick={newTab}>
            + New tab
          </button>
        </div>

        <ul className="tab-list" role="tablist" aria-label="Open tabs">
          {tabs.map((tab) => {
            const isRenaming = renamingTabId === tab.id;
            return (
              <li
                key={tab.id}
                className={`tab-item${tab.id === activeId ? ' active' : ''}${
                  isRenaming ? ' is-renaming' : ''
                }`}
                role="tab"
                aria-selected={tab.id === activeId ? 'true' : 'false'}
              >
                {isRenaming ? (
                  <input
                    autoFocus
                    type="text"
                    className="tab-rename-input"
                    value={renameDraft}
                    placeholder="Tab name (empty resets to auto)"
                    aria-label={`Rename tab ${tab.name || tab.id}`}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitRenameTab();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelRenameTab();
                      }
                    }}
                    onBlur={commitRenameTab}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                ) : (
                  <button
                    type="button"
                    className="tab-btn"
                    onClick={() => selectTab(tab.id)}
                    onDoubleClick={() => startRenameTab(tab.id)}
                    title={`${tab.name || tab.id} — double-click to rename`}
                  >
                    {tab.name || '…'}
                  </button>
                )}
                <button
                  type="button"
                  className="tab-close"
                  aria-label="Close tab"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>

        <div className="compare-panel">
          <h2 className="compare-heading">Compare two tabs</h2>
          <label className="field">
            Tab A
            <select
              value={compareAId}
              onChange={(e) => setCompareAId(e.target.value)}
            >
              {tabs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name || t.id}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Tab B
            <select
              value={compareBId}
              onChange={(e) => setCompareBId(e.target.value)}
            >
              {tabs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name || t.id}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn" onClick={onCompare}>
            Show diff side by side
          </button>
        </div>

        <details className="history-panel" open={false}>
          <summary className="history-summary">History</summary>
          <div className="history-panel-body">
            <p className="history-hint muted">
              Recently closed tabs are saved here and in your browser. Restore
              to open them again.
            </p>
            {closedHistory.length === 0 ? (
              <p className="history-empty muted">No closed tabs yet.</p>
            ) : (
              <ul className="history-list">
                {closedHistory.map((snap) => (
                  <li key={snap.id} className="history-item">
                    <div className="history-item-main">
                      <span className="history-item-title">
                        {snap.name || 'Untitled'}
                      </span>
                      <span className="history-item-time muted">
                        {new Date(snap.closedAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="history-item-actions">
                      <button
                        type="button"
                        className="btn primary"
                        onClick={() => restoreClosed(snap)}
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        aria-label="Remove from history"
                        onClick={() => dismissClosed(snap)}
                      >
                        Dismiss
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>

      </aside>

      <div
        className="sidebar-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        tabIndex={0}
        aria-valuemin={SIDEBAR_MIN}
        aria-valuemax={SIDEBAR_CAP}
        aria-valuenow={Math.round(sidebarWidth)}
        onPointerDown={onSidebarResizerPointerDown}
        onKeyDown={onSidebarResizerKeyDown}
      >
        <span className="sidebar-resizer-grip" aria-hidden />
      </div>

      <div className="main">
        <header
          className={`toolbar${compareOpen ? ' hidden' : ''}`}
          id="main-toolbar"
        >
          <div className="toolbar-actions">
            <label className="toolbar-lang-field">
              <span className="toolbar-label">Language</span>
              <select
                className="toolbar-lang-select"
                value={
                  activeTab.langAuto !== false ? 'auto' : (activeTab.lang ?? 'json')
                }
                onChange={(e) => setLanguageSelect(e.target.value)}
                aria-label="Document language"
                title={
                  activeTab.langAuto !== false
                    ? `Auto-detected: ${activeLang}`
                    : 'Fixed language (auto-detect off)'
                }
              >
                <option value="auto">Auto (detect)</option>
                <option value="json">JSON</option>
                <option value="javascript">JavaScript</option>
                <option value="typescript">TypeScript</option>
              </select>
              {activeTab.langAuto !== false ? (
                <span className="toolbar-lang-detected muted" aria-live="polite">
                  → {activeLang}
                </span>
              ) : null}
            </label>
            <span className="toolbar-sep" aria-hidden />
            <button
              type="button"
              className="btn primary"
              onClick={() => void onFormat()}
              disabled={busyAction !== null}
            >
              {busyAction === 'format' ? 'Format…' : 'Format'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void onMinify()}
              disabled={busyAction !== null}
            >
              {busyAction === 'minify' ? 'Minify…' : 'Minify'}
            </button>
            <span className="toolbar-sep" aria-hidden />
            <button type="button" className="btn" onClick={onCollapseAll}>
              Collapse all
            </button>
            <button type="button" className="btn" onClick={onExpandAll}>
              Expand all
            </button>
            <span className="toolbar-sep" aria-hidden />
            <button
              type="button"
              className="btn"
              onClick={() => void onCopyAll()}
              title="Copy the full contents of this tab to the clipboard"
            >
              Copy all
            </button>
          </div>
          <div className="toolbar-search" id="toolbar-search">
            <label className="search-field">
              Find
              <input
                ref={findInputRef}
                type="search"
                placeholder="Search in tab…"
                title="⌘F / Ctrl+F — Enter next · Shift+Enter prev · focus stays in Find"
                autoComplete="off"
                spellCheck={false}
                value={findQuery}
                onChange={(e) => setFindQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    findToolbarFocusTargetRef.current = 'find';
                    findNext(e.shiftKey ? -1 : 1);
                  }
                }}
              />
            </label>
            <button
              ref={findPrevButtonRef}
              type="button"
              className="btn ghost"
              onClick={() => {
                findToolbarFocusTargetRef.current = 'prev';
                findNext(-1);
              }}
            >
              Prev
            </button>
            <button
              ref={findNextButtonRef}
              type="button"
              className="btn ghost"
              onClick={() => {
                findToolbarFocusTargetRef.current = 'next';
                findNext(1);
              }}
            >
              Next
            </button>
            <span className="muted">{findStatus}</span>
          </div>
        </header>

        <div
          className={`editor-filename-bar${compareOpen ? ' hidden' : ''}`}
        >
          <input
            type="text"
            className="editor-filename-input"
            value={activeTab.name}
            placeholder="Untitled"
            spellCheck={false}
            autoComplete="off"
            aria-label="Tab name"
            title="Edit the tab name. Clear it to restore the auto-derived label."
            onChange={(e) => setActiveTabName(e.target.value)}
            onBlur={commitActiveTabName}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
          />
          {activeTab.nameLocked ? (
            <button
              type="button"
              className="btn ghost editor-filename-reset"
              onClick={() => {
                setActiveTabName('');
                /** Synchronously revert to the auto-derived name so the input updates immediately. */
                queueMicrotask(commitActiveTabName);
              }}
              title="Reset to auto-derived name"
              aria-label="Reset tab name to auto-derived"
            >
              Auto
            </button>
          ) : (
            <span
              className="editor-filename-auto-hint muted"
              title="This name is auto-derived from the content"
              aria-hidden
            >
              auto
            </span>
          )}
        </div>

        <div
          className={`editor-row${
            focusedWatchEntries.length > 0 && !compareOpen
              ? ' has-watch-dock'
              : ''
          }${compareOpen ? ' hidden' : ''}`}
        >
        <section
          className={`editor-section${editorDragOver ? ' is-drop-target' : ''}`}
          aria-label="Editor"
          onDragEnterCapture={onEditorDragEnterCapture}
          onDragOverCapture={onEditorDragOverCapture}
          onDragLeaveCapture={onEditorDragLeaveCapture}
          onDropCapture={onEditorDropCapture}
        >
          {editorDragOver ? (
            <div className="editor-drop-overlay" aria-hidden>
              <div className="editor-drop-overlay-card">
                Drop to pin watch alongside the editor
              </div>
            </div>
          ) : null}
          <div className="editor-pane">
            <div className="editor-code-root">
              {activeBookmarksSanitized.length > 0 ? (
                <div
                  className="editor-bookmarks-strip"
                  aria-label="Bookmarks"
                >
                  <div className="editor-bookmarks-strip-header">
                    <span className="editor-bookmarks-strip-label">
                      Bookmarks
                    </span>
                    <button
                      type="button"
                      className="btn ghost editor-bookmarks-clear-all"
                      title="Remove all bookmarks in this tab"
                      onClick={() => clearAllBookmarks()}
                    >
                      Clear all
                    </button>
                  </div>
                  {activeBookmarksSanitized.map((b) => {
                    const anchor = Math.min(b.anchor, activeTab.text.length);
                    const line = offsetToLineNumber(activeTab.text, anchor);
                    const snippet = lineSnippet(activeTab.text, anchor, 48);
                    return (
                      <div key={b.id} className="editor-bookmark-pill">
                        <button
                          type="button"
                          className="editor-bookmark-pill-main"
                          onClick={() => goToBookmark(b.anchor)}
                        >
                          <span className="editor-bookmark-pill-line">
                            L{line}
                          </span>
                          <span className="editor-bookmark-pill-snippet">
                            {snippet}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="editor-bookmark-pill-remove"
                          aria-label={`Remove bookmark on line ${line}`}
                          onClick={() => removeBookmark(b.id)}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              <div className="editor-code-frame editor-code-frame-cm">
                <div className="editor-cm-mount">
                  <WorkspaceEditor
                    value={activeTab.text}
                    onChange={onTextInput}
                    lang={activeLang}
                    placeholder={
                      activeLang === 'json'
                        ? 'Paste JSON here. Watch and Format need valid JSON.'
                        : activeLang === 'typescript'
                          ? 'Paste TypeScript here. Watch uses the parsed AST (paths like program.body[0]).'
                          : 'Paste JavaScript here. Watch uses the parsed AST (paths like program.body[0]).'
                    }
                    editorViewRef={editorViewRef}
                    bookmarkAnchors={bookmarkAnchorsSet}
                    onBookmarkLineToggle={toggleBookmarkAtLine}
                    onWatchLineAdd={addWatchFromDocLineStart}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

          {focusedWatchEntries.length > 0 && !compareOpen ? (
            <aside
              className="editor-watch-dock"
              aria-label="Focused watches alongside editor"
            >
              {focusedWatchPanel}
            </aside>
          ) : null}
        </div>

        <section
          className={`compare-section${compareOpen ? '' : ' hidden'}`}
          aria-label="Compare view"
        >
          <div className="compare-toolbar">
            <button
              type="button"
              className="btn primary"
              onClick={() => setCompareOpen(false)}
            >
              Back to editor
            </button>
            <span className="compare-hint muted">
              {compareDiff.differCount === 0
                ? 'Tabs match line-for-line.'
                : `${compareDiff.differCount} differing line${
                    compareDiff.differCount === 1 ? '' : 's'
                  } highlighted (paired by line number).`}
            </span>
          </div>
          <div className="compare-split">
            <div className="compare-side">
              <h3 className="compare-side-title">
                {tabs.find((t) => t.id === compareAId)?.name ?? 'A'}
              </h3>
              <div className="compare-lines">
                {compareDiff.left.map((line) => (
                  <div
                    key={line.lineNo}
                    className={`diff-line ${
                      line.differs ? 'diff-left' : 'diff-same'
                    }${line.empty ? ' diff-blank' : ''}`}
                  >
                    <span className="diff-lineno" aria-hidden>
                      {line.lineNo}
                    </span>
                    <span className="diff-text">{line.text}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="compare-side">
              <h3 className="compare-side-title">
                {tabs.find((t) => t.id === compareBId)?.name ?? 'B'}
              </h3>
              <div className="compare-lines">
                {compareDiff.right.map((line) => (
                  <div
                    key={line.lineNo}
                    className={`diff-line ${
                      line.differs ? 'diff-right' : 'diff-same'
                    }${line.empty ? ' diff-blank' : ''}`}
                  >
                    <span className="diff-lineno" aria-hidden>
                      {line.lineNo}
                    </span>
                    <span className="diff-text">{line.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
