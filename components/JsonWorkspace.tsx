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
  MAX_CLOSED_HISTORY,
  SIDEBAR_WIDTH_STORAGE_KEY,
  WORKSPACE_STORAGE_KEY,
  WATCH_STORAGE_KEY,
  migrateWorkspaceStorageKeys,
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

const WorkspaceEditor = dynamic(
  () => import('@/components/WorkspaceEditor'),
  { ssr: false }
);

const WATCH_VALUE_MAX = 4000;

type WatchEntry = { id: string; expr: string };

type GitPullResult = {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
  code?: number | null;
};

declare global {
  interface Window {
    electron?: {
      platform: string;
      gitUpdateCapable?: () => Promise<{
        capable: boolean;
        repoRoot?: string;
      }>;
      pullFromGithubMaster?: () => Promise<GitPullResult>;
      relaunchApp?: () => Promise<void>;
    };
  }
}

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

function computeDiffLines(aText: string, bText: string): { left: string[]; right: string[] } {
  const al = aText.split('\n');
  const bl = bText.split('\n');
  const n = Math.max(al.length, bl.length);
  const left: string[] = [];
  const right: string[] = [];
  for (let i = 0; i < n; i++) {
    const la = al[i];
    const lb = bl[i];
    if (la === lb) continue;
    const lineNo = `L${i + 1}`;
    left.push(`${lineNo}\t${la ?? ''}`);
    right.push(`${lineNo}\t${lb ?? ''}`);
  }
  if (left.length === 0) {
    left.push('No differing lines.');
    right.push('No differing lines.');
  }
  return { left, right };
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
  const [busyAction, setBusyAction] = useState<'format' | 'minify' | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_WIDTH_DEFAULT);
  const [electronGitCapable, setElectronGitCapable] = useState<boolean | null>(
    null
  );
  const [gitPullBusy, setGitPullBusy] = useState(false);

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

  sidebarWidthRef.current = sidebarWidth;

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
    return [...new Set(out)].sort((a, b) => a.localeCompare(b));
  }, [watchRoot]);

  const pathSuggestionsSet = useMemo(
    () => new Set(pathSuggestions),
    [pathSuggestions]
  );

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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const api =
        typeof window !== 'undefined' ? window.electron : undefined;
      if (!api?.gitUpdateCapable) {
        if (!cancelled) setElectronGitCapable(false);
        return;
      }
      try {
        const r = await api.gitUpdateCapable();
        if (!cancelled) setElectronGitCapable(Boolean(r?.capable));
      } catch {
        if (!cancelled) setElectronGitCapable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = watchInputRef.current;
    if (!el) return;
    /** Native `change` fires when a datalist option is chosen (React `onChange` maps to `input`, so it misses this). */
    const onSuggestionCommitted = () => {
      const expr = el.value.trim();
      if (!expr || !pathSuggestionsSet.has(expr)) return;
      setWatchEntries((w) => {
        if (w.some((x) => x.expr === expr)) return w;
        return [...w, { id: uid(), expr }];
      });
      setWatchInput('');
    };
    el.addEventListener('change', onSuggestionCommitted);
    return () => el.removeEventListener('change', onSuggestionCommitted);
  }, [pathSuggestionsSet]);

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
          return name !== null ? { ...t, text: out, name } : { ...t, text: out };
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
          return name !== null ? { ...t, text: out, name } : { ...t, text: out };
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

  const addWatch = () => {
    const expr = watchInput.trim();
    if (!expr) return;
    setWatchEntries((w) => {
      if (w.some((x) => x.expr === expr)) return w;
      return [...w, { id: uid(), expr }];
    });
    setWatchInput('');
  };

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
    if (!ta || !tb) return { left: [] as string[], right: [] as string[] };
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

  const pullUpdatesFromGithub = useCallback(async () => {
    const pull = window.electron?.pullFromGithubMaster;
    if (!pull) return;
    setGitPullBusy(true);
    try {
      const res = await pull();
      if (res.ok) {
        const detail = [res.stdout, res.stderr]
          .filter(Boolean)
          .join('\n')
          .trim();
        toast.success('Updated from GitHub', {
          description:
            detail.slice(0, 380) ||
            'Latest changes pulled. Restart the app to load new code.',
          duration: 12_000,
          action: window.electron?.relaunchApp
            ? {
                label: 'Restart app',
                onClick: () => {
                  void window.electron?.relaunchApp?.();
                },
              }
            : undefined,
        });
      } else {
        toast.error(res.error ?? 'Git pull failed', {
          description: [res.stderr, res.stdout]
            .filter(Boolean)
            .join('\n')
            .slice(0, 480),
        });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setGitPullBusy(false);
    }
  }, []);

  const findStatus =
    findMatches.length === 0
      ? findQuery
        ? 'No matches'
        : ''
      : findMatchIndex < 0
        ? `${findMatches.length} match${findMatches.length === 1 ? '' : 'es'} · Enter`
        : `${findMatchIndex + 1} / ${findMatches.length}`;

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

        <div className="watch-panel">
          <div className="watch-panel-head">
            <h2 className="watch-heading">Watch</h2>
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
          <p className="watch-hint">
            Paths from root, e.g. <code>user</code>, <code>items[0]</code>,{' '}
            <code>["key-name"]</code>. Choosing a suggestion adds it to the list.
          </p>
          <div className="watch-add">
            <input
              ref={watchInputRef}
              type="text"
              className="watch-input"
              list="watch-datalist"
              placeholder="path…"
              autoComplete="off"
              spellCheck={false}
              value={watchInput}
              onChange={(e) => setWatchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addWatch();
                }
              }}
            />
            <datalist id="watch-datalist">
              {pathSuggestions.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <button type="button" className="btn" onClick={addWatch}>
              Add
            </button>
          </div>
          <ul className="watch-list">
            {watchEntries.map((w) => {
              let display = '';
              let err = false;
              if (!watchRoot.ok) {
                err = true;
                display =
                  activeLang === 'json'
                    ? `Invalid JSON: ${watchRoot.error}`
                    : `Parse error: ${watchRoot.error}`;
              } else {
                const res = getPathValue(watchRoot.value, w.expr);
                if (!res.ok) {
                  err = true;
                  display = res.error ?? 'Path error';
                } else {
                  display = formatWatchDisplay(res.value);
                }
              }
              return (
                <li key={w.id} className="watch-item">
                  <div className="watch-expr">
                    <code>{w.expr}</code>
                    <button
                      type="button"
                      className="watch-remove"
                      aria-label="Remove watch"
                      onClick={() => removeWatch(w.id)}
                    >
                      ×
                    </button>
                  </div>
                  <pre className={`watch-value${err ? ' watch-err' : ''}`}>{display}</pre>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="sidebar-new-tab">
          <button type="button" className="btn primary" onClick={newTab}>
            + New tab
          </button>
        </div>

        <ul className="tab-list" role="tablist" aria-label="Open tabs">
          {tabs.map((tab) => (
            <li
              key={tab.id}
              className={`tab-item${tab.id === activeId ? ' active' : ''}`}
              role="tab"
              aria-selected={tab.id === activeId ? 'true' : 'false'}
            >
              <button
                type="button"
                className="tab-btn"
                onClick={() => selectTab(tab.id)}
              >
                {tab.name || '…'}
              </button>
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
          ))}
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

        {electronGitCapable === true ? (
          <div className="electron-git-update">
            <button
              type="button"
              className="btn primary electron-git-update-btn"
              disabled={gitPullBusy}
              title="git pull origin master (or main). Requires git installed and this folder to be a clone with remotes configured."
              onClick={() => void pullUpdatesFromGithub()}
            >
              {gitPullBusy ? 'Updating…' : 'Update from GitHub'}
            </button>
            <p className="electron-git-update-hint muted">
              Pulls <code>origin/master</code>, or <code>main</code> if master is
              missing.
            </p>
          </div>
        ) : null}
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

        <section
          className={`editor-section${compareOpen ? ' hidden' : ''}`}
          aria-label="Editor"
        >
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
              Only differing lines are shown (paired by line number).
            </span>
          </div>
          <div className="compare-split">
            <div className="compare-side">
              <h3 className="compare-side-title">
                {tabs.find((t) => t.id === compareAId)?.name ?? 'A'}
              </h3>
              <div className="compare-lines">
                {compareDiff.left.map((line, i) => (
                  <div
                    key={i}
                    className={`diff-line diff-left${
                      line === 'No differing lines.' ? ' diff-empty' : ''
                    }`}
                  >
                    {line}
                  </div>
                ))}
              </div>
            </div>
            <div className="compare-side">
              <h3 className="compare-side-title">
                {tabs.find((t) => t.id === compareBId)?.name ?? 'B'}
              </h3>
              <div className="compare-lines">
                {compareDiff.right.map((line, i) => (
                  <div
                    key={i}
                    className={`diff-line diff-right${
                      line === 'No differing lines.' ? ' diff-empty' : ''
                    }`}
                  >
                    {line}
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
