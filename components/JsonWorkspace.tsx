'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { JsonTreeView } from '@/components/JsonTreeView';
import { JsTsTreeView } from '@/components/JsTsTreeView';
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
  WORKSPACE_STORAGE_KEY,
  type ClosedTabSnapshot,
  parseClosedHistory,
  parseWorkspace,
} from '@/lib/workspace-storage';
import type { Tab, TabLanguage } from '@/lib/workspace-types';

const WATCH_STORAGE_KEY = 'json-workspace-watch-v1';
const WATCH_VALUE_MAX = 4000;

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

export function JsonWorkspace() {
  const [tabs, setTabs] = useState<Tab[]>(() => [
    { id: 'tab-0', name: '', text: '{\n  \n}' },
  ]);
  const [activeId, setActiveId] = useState('tab-0');
  const [hydrated, setHydrated] = useState(false);
  const [closedHistory, setClosedHistory] = useState<ClosedTabSnapshot[]>([]);
  const [watchEntries, setWatchEntries] = useState<WatchEntry[]>([]);
  const [editView, setEditView] = useState<'text' | 'tree'>('text');
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareAId, setCompareAId] = useState('tab-0');
  const [compareBId, setCompareBId] = useState('tab-0');
  const [findQuery, setFindQuery] = useState('');
  const [findMatchIndex, setFindMatchIndex] = useState(-1);
  const [watchInput, setWatchInput] = useState('');
  const [busyAction, setBusyAction] = useState<'format' | 'minify' | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const nameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIdRef = useRef(activeId);

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

  useEffect(() => {
    setFindMatchIndex(findMatches.length ? 0 : -1);
  }, [findMatches]);

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

  const updateActiveText = useCallback(
    (text: string) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === activeId ? { ...t, text } : t))
      );
      scheduleTabNameRefresh();
    },
    [activeId, scheduleTabNameRefresh]
  );

  const onTextInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateActiveText(e.target.value);
  };

  const onTextKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab' || editView !== 'text') return;
    e.preventDefault();
    const ta = e.currentTarget;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const v = ta.value;
    const next = v.slice(0, start) + '\t' + v.slice(end);
    updateActiveText(next);
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + 1;
    });
  };

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
        alert(data.error ?? 'Cannot format.');
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
        alert(data.error ?? 'Cannot minify.');
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
    } finally {
      setBusyAction(null);
    }
  };

  const onCollapseAll = () => {
    treeRef.current?.querySelectorAll('details').forEach((d) => {
      (d as HTMLDetailsElement).open = false;
    });
  };

  const onExpandAll = () => {
    treeRef.current?.querySelectorAll('details').forEach((d) => {
      (d as HTMLDetailsElement).open = true;
    });
  };

  const addWatch = () => {
    const expr = watchInput.trim();
    if (!expr) return;
    setWatchEntries((w) => [...w, { id: uid(), expr }]);
    setWatchInput('');
  };

  const removeWatch = (id: string) => {
    setWatchEntries((w) => w.filter((x) => x.id !== id));
  };

  const findNext = (delta: number) => {
    if (findMatches.length === 0) return;
    setFindMatchIndex(
      (i) => (i + delta + findMatches.length) % findMatches.length
    );
  };

  useEffect(() => {
    if (findMatchIndex < 0 || findMatchIndex >= findMatches.length) return;
    const m = findMatches[findMatchIndex];
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(m.start, m.end);
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
      if (e.key === 'Escape' && compareOpen) setCompareOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [compareOpen]);

  const onCompare = () => {
    setCompareOpen(true);
  };

  const findStatus =
    findMatches.length === 0
      ? findQuery
        ? 'No matches'
        : ''
      : `${findMatchIndex + 1} / ${findMatches.length}`;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-head">
          <h1 className="sidebar-title">Workspace</h1>
        </div>

        <div className="watch-panel">
          <h2 className="watch-heading">Watch</h2>
          <p className="watch-hint">
            Paths from root, e.g. <code>user</code>, <code>items[0]</code>,{' '}
            <code>["key-name"]</code>
          </p>
          <div className="watch-add">
            <input
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
      </aside>

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
            <span className="toolbar-label">View</span>
            <label className="toggle">
              <input
                type="radio"
                name="edit-view"
                checked={editView === 'text'}
                onChange={() => setEditView('text')}
              />{' '}
              Text
            </label>
            <label className="toggle">
              <input
                type="radio"
                name="edit-view"
                checked={editView === 'tree'}
                onChange={() => setEditView('tree')}
              />{' '}
              Tree
            </label>
            <span
              className={`toolbar-sep tree-only${editView === 'tree' ? '' : ' hidden'}`}
              aria-hidden
            />
            <button
              type="button"
              className={`btn tree-only${editView === 'tree' ? '' : ' hidden'}`}
              onClick={onCollapseAll}
            >
              Collapse all
            </button>
            <button
              type="button"
              className={`btn tree-only${editView === 'tree' ? '' : ' hidden'}`}
              onClick={onExpandAll}
            >
              Expand all
            </button>
          </div>
          <div
            className={`toolbar-search${editView === 'tree' ? ' hidden' : ''}`}
            id="toolbar-search"
          >
            <label className="search-field">
              Find
              <input
                type="search"
                placeholder="Search in tab…"
                autoComplete="off"
                value={findQuery}
                onChange={(e) => setFindQuery(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn ghost"
              onClick={() => findNext(-1)}
            >
              Prev
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => findNext(1)}
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
          <div
            className={`editor-pane text-pane${editView === 'tree' ? ' hidden' : ''}`}
          >
            <textarea
              ref={textareaRef}
              className="json-textarea"
              spellCheck={false}
              placeholder={
                activeLang === 'json'
                  ? 'Paste JSON here. Tree, Watch, and Format need valid JSON.'
                  : activeLang === 'typescript'
                    ? 'Paste TypeScript here. Tree and Watch use the parsed AST (paths like program.body[0]).'
                    : 'Paste JavaScript here. Tree and Watch use the parsed AST (paths like program.body[0]).'
              }
              value={activeTab.text}
              onChange={onTextInput}
              onKeyDown={onTextKeyDown}
            />
          </div>
          <div
            className={`editor-pane tree-pane${editView === 'text' ? ' hidden' : ''}`}
            id="tree-pane"
          >
            <div ref={treeRef} id="json-tree-root">
              {activeLang === 'json' ? (
                <JsonTreeView text={activeTab.text} />
              ) : (
                <JsTsTreeView text={activeTab.text} lang={activeLang} />
              )}
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
