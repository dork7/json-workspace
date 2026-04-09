'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { JsonTreeView } from '@/components/JsonTreeView';
import { collectJsonPaths, getPathValue } from '@/lib/json-path';
import {
  displayTextForCompare,
  formatJsonString,
  minifyJsonString,
  parseJsonSafe,
  uid,
} from '@/lib/json-utils';
import { deriveTabName } from '@/lib/tab-names';

const WATCH_STORAGE_KEY = 'json-workspace-watch-v1';
const WATCH_VALUE_MAX = 4000;

type Tab = { id: string; name: string; text: string };
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
  const [watchEntries, setWatchEntries] = useState<WatchEntry[]>([]);
  const [editView, setEditView] = useState<'text' | 'tree'>('text');
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareAId, setCompareAId] = useState('tab-0');
  const [compareBId, setCompareBId] = useState('tab-0');
  const [findQuery, setFindQuery] = useState('');
  const [findMatchIndex, setFindMatchIndex] = useState(-1);
  const [watchInput, setWatchInput] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const nameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIdRef = useRef(activeId);

  activeIdRef.current = activeId;

  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0];

  const parsedActive = useMemo(() => parseJsonSafe(activeTab.text), [activeTab.text]);

  const pathSuggestions = useMemo(() => {
    if (!parsedActive.ok) return [] as string[];
    const out: string[] = [];
    collectJsonPaths(parsedActive.value, '', out);
    return [...new Set(out)].sort((a, b) => a.localeCompare(b));
  }, [parsedActive]);

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
    setTabs((prev) =>
      prev.map((t) => {
        const name = deriveTabName(t.text);
        if (name === null || t.name === name) return t;
        return { ...t, name };
      })
    );
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
        const name = deriveTabName(tab.text);
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
    const next = tabs.filter((t) => t.id !== id);
    setTabs(next);
    if (activeId === id) {
      const ni = Math.max(0, idx - 1);
      setActiveId(next[ni].id);
    }
  };

  const newTab = () => {
    const id = uid();
    setTabs((prev) => [...prev, { id, name: '', text: '{\n  \n}' }]);
    setActiveId(id);
    setFindQuery('');
  };

  const onFormat = () => {
    const out = formatJsonString(activeTab.text);
    if (out === null) {
      alert('Invalid JSON — cannot format.');
      return;
    }
    const name = deriveTabName(out);
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeId) return t;
        return name !== null ? { ...t, text: out, name } : { ...t, text: out };
      })
    );
  };

  const onMinify = () => {
    const out = minifyJsonString(activeTab.text);
    if (out === null) {
      alert('Invalid JSON — cannot minify.');
      return;
    }
    const name = deriveTabName(out);
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeId) return t;
        return name !== null ? { ...t, text: out, name } : { ...t, text: out };
      })
    );
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
      displayTextForCompare(ta.text),
      displayTextForCompare(tb.text)
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
          <h1 className="sidebar-title">JSON</h1>
          <button type="button" className="btn primary" onClick={newTab}>
            + New tab
          </button>
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
              if (!parsedActive.ok) {
                err = true;
                display =
                  'error' in parsedActive && parsedActive.error
                    ? `Invalid JSON: ${parsedActive.error}`
                    : 'Invalid JSON';
              } else {
                const res = getPathValue(parsedActive.value, w.expr);
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

        <ul className="tab-list" role="tablist" aria-label="Open JSON tabs">
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
      </aside>

      <div className="main">
        <header
          className={`toolbar${compareOpen ? ' hidden' : ''}`}
          id="main-toolbar"
        >
          <div className="toolbar-actions">
            <button type="button" className="btn primary" onClick={onFormat}>
              Format
            </button>
            <button type="button" className="btn" onClick={onMinify}>
              Minify
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
          aria-label="JSON editor"
        >
          <div
            className={`editor-pane text-pane${editView === 'tree' ? ' hidden' : ''}`}
          >
            <textarea
              ref={textareaRef}
              className="json-textarea"
              spellCheck={false}
              placeholder="Paste JSON here. Switch to Tree for a collapsible view. Tabs on the left switch documents."
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
              <JsonTreeView text={activeTab.text} />
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
