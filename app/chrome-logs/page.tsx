'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CdpArgView, type CdpArg } from '@/components/CdpArgView';

// ── Types ─────────────────────────────────────────────────────────────────────

type LogLevel = 'log' | 'warn' | 'error' | 'info' | 'debug' | 'verbose' | 'unknown';
type LogEntry = { id: number; level: LogLevel; args: CdpArg[]; text?: string; timestamp: number };
type WatchItem = { id: string; expr: string };
type WatchResult = { ok: true; arg: CdpArg } | { ok: false; error: string };
type KeyEntry = { name: string; type: string };

const WATCHES_KEY = 'watchfox-chrome-watches';
function loadWatches(): WatchItem[] {
  try { return JSON.parse(localStorage.getItem(WATCHES_KEY) ?? '[]') as WatchItem[]; }
  catch { return []; }
}

// Build a safe JS property access expression (bracket notation for non-identifier keys)
function propExpr(base: string, key: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)
    ? `${base}.${key}`
    : `${base}[${JSON.stringify(key)}]`;
}

async function inspectKeys(objectId: string): Promise<KeyEntry[]> {
  const res = await fetch('/api/chrome-inspect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objectId }),
  });
  const data = (await res.json()) as {
    properties?: { name: string; enumerable?: boolean; value?: { type?: string } }[];
    error?: string;
  };
  if (data.error) throw new Error(data.error);
  return (data.properties ?? [])
    .filter((p) => p.enumerable !== false)
    .map((p) => ({ name: p.name, type: p.value?.type ?? 'unknown' }));
}

// ── WatchKeyPicker ────────────────────────────────────────────────────────────

function WatchKeyPicker({ objectId, baseExpr, onAddOne, onAddAll }: {
  objectId: string;
  baseExpr: string;
  onAddOne: (expr: string) => void;
  onAddAll: (exprs: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [keys, setKeys] = useState<KeyEntry[]>([]);

  const load = async () => {
    if (status === 'loading') return;
    if (status === 'done') { setOpen((v) => !v); return; }
    setStatus('loading');
    setOpen(true);
    try {
      setKeys(await inspectKeys(objectId));
      setStatus('done');
    } catch {
      setStatus('error');
    }
  };

  return (
    <div className="wkp">
      <div className="wkp-toolbar">
        <button type="button" className="wkp-toggle" onClick={() => void load()}>
          {status === 'loading' ? 'Loading…' : open ? '▲ keys' : '▼ keys'}
        </button>
        {status === 'done' && keys.length > 0 && (
          <button
            type="button"
            className="wkp-add-all"
            onClick={() => onAddAll(keys.map((k) => propExpr(baseExpr, k.name)))}
          >
            + Add all to watch
          </button>
        )}
      </div>
      {open && status === 'done' && (
        <div className="wkp-keys">
          {keys.length === 0
            ? <span className="muted" style={{ fontSize: 11 }}>No enumerable keys</span>
            : keys.map((k) => (
                <button
                  key={k.name}
                  type="button"
                  className={`wkp-chip wkp-chip-${k.type}`}
                  title={`Set input to ${propExpr(baseExpr, k.name)}`}
                  onClick={() => onAddOne(propExpr(baseExpr, k.name))}
                >
                  {k.name}
                </button>
              ))}
        </div>
      )}
      {open && status === 'error' && (
        <span className="clp-watch-error" style={{ fontSize: 11 }}>Failed to load keys</span>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ChromeLogsPage() {
  // ── log state ────────────────────────────────────────────────────────────────
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('');
  const esRef = useRef<EventSource | null>(null);
  const logIdRef = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  // ── watch state ──────────────────────────────────────────────────────────────
  const [watches, setWatches] = useState<WatchItem[]>([]);
  const [watchResults, setWatchResults] = useState<Record<string, WatchResult>>({});
  const [watchInput, setWatchInput] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const watchesRef = useRef<WatchItem[]>([]);
  watchesRef.current = watches;
  const watchResultsRef = useRef<Record<string, WatchResult>>({});
  watchResultsRef.current = watchResults;

  // ── selected object (from log stream) ────────────────────────────────────────
  const [selectedObj, setSelectedObj] = useState<{ varName: string; label: string } | null>(null);
  const [selectedProps, setSelectedProps] = useState<{ name: string; value?: CdpArg }[]>([]);
  const selectedObjRef = useRef<{ varName: string; label: string } | null>(null);
  selectedObjRef.current = selectedObj;

  // ── key suggestion cache: expr → child exprs ─────────────────────────────────
  // Keyed by expression string so it survives objectId changes across polls
  const keysCacheRef = useRef<Map<string, string[]>>(new Map());
  const fetchedRef = useRef<Set<string>>(new Set());

  // ── autocomplete state ────────────────────────────────────────────────────────
  const [acItems, setAcItems] = useState<string[]>([]);
  const [acHighlight, setAcHighlight] = useState(-1);
  const [inputFocused, setInputFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const acDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setWatches(loadWatches()); }, []);
  useEffect(() => { localStorage.setItem(WATCHES_KEY, JSON.stringify(watches)); }, [watches]);

  // ── SSE ───────────────────────────────────────────────────────────────────────
  const connect = () => {
    if (esRef.current) return;
    setStatus('Connecting…');
    const es = new EventSource('/api/chrome-logs');
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string) as {
          type: string; method?: string;
          params?: { type?: string; args?: CdpArg[]; entry?: { level?: string; text?: string } };
          message?: string; title?: string;
        };
        if (msg.type === 'connected') { setConnected(true); setStatus(msg.title ?? 'Connected'); return; }
        if (msg.type === 'disconnected') { setConnected(false); setStatus('Disconnected'); es.close(); esRef.current = null; return; }
        if (msg.type === 'error') {
          setConnected(false); setStatus(msg.message ?? 'Error'); es.close(); esRef.current = null;
          setLogs((p) => [...p, { id: ++logIdRef.current, level: 'error', args: [], text: msg.message ?? 'Error', timestamp: Date.now() }]);
          return;
        }
        let level: LogLevel = 'log', args: CdpArg[] = [], text: string | undefined;
        if (msg.method === 'Runtime.consoleAPICalled') {
          level = (msg.params?.type as LogLevel) ?? 'log';
          args = msg.params?.args ?? [];
        } else if (msg.method === 'Log.entryAdded') {
          const entry = msg.params?.entry ?? {};
          level = (entry.level as LogLevel) ?? 'log';
          text = entry.text ?? '';
        } else return;
        setLogs((prev) => {
          const next = [...prev, { id: ++logIdRef.current, level, args, text, timestamp: Date.now() }];
          return next.length > 2000 ? next.slice(-2000) : next;
        });
      } catch { /* malformed */ }
    };

    es.onerror = () => {
      setConnected(false);
      setStatus('Connection failed — is Chrome running with --remote-debugging-port=9222?');
      es.close(); esRef.current = null;
    };
  };

  const disconnect = () => { esRef.current?.close(); esRef.current = null; setConnected(false); setStatus(''); };

  useEffect(() => {
    connect();
    return () => { esRef.current?.close(); esRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── watch polling ─────────────────────────────────────────────────────────────
  const evalWatch = useCallback(async (item: WatchItem): Promise<[string, WatchResult]> => {
    try {
      const res = await fetch('/api/chrome-evaluate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expression: item.expr }),
      });
      const data = (await res.json()) as { result?: CdpArg; error?: string };
      if (data.error) return [item.id, { ok: false, error: data.error }];
      return [item.id, { ok: true, arg: data.result! }];
    } catch { return [item.id, { ok: false, error: 'Network error' }]; }
  }, []);

  useEffect(() => {
    if (!connected || watches.length === 0) return;
    const poll = async () => {
      const results = await Promise.all(watchesRef.current.map(evalWatch));
      setWatchResults(Object.fromEntries(results));
    };
    void poll();
    const t = setInterval(() => void poll(), 1000);
    return () => clearInterval(t);
  }, [connected, watches, evalWatch]);

  useEffect(() => {
    const ids = new Set(watches.map((w) => w.id));
    setWatchResults((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) if (!ids.has(k)) delete next[k];
      return next;
    });
  }, [watches]);

  // ── auto-fetch keys for object watches → build suggestion list ────────────────
  useEffect(() => {
    if (!connected) return;
    const toFetch = watches.filter((w) => {
      const res = watchResults[w.id];
      return (
        res?.ok &&
        (res.arg.type === 'object' || res.arg.type === 'function') &&
        res.arg.objectId &&
        !fetchedRef.current.has(w.expr)
      );
    });
    if (toFetch.length === 0) return;

    void (async () => {
      for (const w of toFetch) {
        const res = watchResults[w.id];
        if (!res?.ok || !res.arg.objectId) continue;
        fetchedRef.current.add(w.expr);
        try {
          const keys = await inspectKeys(res.arg.objectId);
          keysCacheRef.current.set(w.expr, keys.map((k) => propExpr(w.expr, k.name)));
        } catch { /* ignore */ }
      }
    })();
  }, [watchResults, connected, watches]);

  // ── watch CRUD ────────────────────────────────────────────────────────────────
  const addWatch = useCallback((expr: string) => {
    const e = expr.trim();
    if (!e) return;
    setWatches((prev) => prev.some((w) => w.expr === e) ? prev : [...prev, { id: crypto.randomUUID(), expr: e }]);
  }, []);

  const addWatches = useCallback((exprs: string[]) => {
    setWatches((prev) => {
      const existing = new Set(prev.map((w) => w.expr));
      const newItems = exprs.filter((e) => !existing.has(e)).map((expr) => ({ id: crypto.randomUUID(), expr }));
      return newItems.length ? [...prev, ...newItems] : prev;
    });
  }, []);

  const removeWatch = (id: string) => {
    const w = watches.find((x) => x.id === id);
    if (w) { keysCacheRef.current.delete(w.expr); fetchedRef.current.delete(w.expr); }
    setWatches((prev) => prev.filter((x) => x.id !== id));
  };

  const submitInput = () => {
    const e = watchInput.trim();
    if (!e) return;
    addWatch(e);
    setWatchInput('');
    setAcItems([]);
  };

  // ── select object from log stream → pin, retarget watches, show in panel ─────
  const handleWatchObj = useCallback(async (objectId: string, label: string) => {
    try {
      const res = await fetch('/api/chrome-watch-obj', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectId }),
      });
      const data = (await res.json()) as {
        varName?: string;
        keys?: { name: string; type: string }[];
        error?: string;
      };
      if (data.error || !data.varName) return;
      const { varName, keys = [] } = data;

      // Retarget any existing watches that used the previous selected object's varName
      const prevVar = selectedObjRef.current?.varName;
      if (prevVar && prevVar !== varName) {
        setWatches((prev) => prev.map((w) => {
          if (w.expr === prevVar) return { ...w, expr: varName };
          if (w.expr.startsWith(prevVar + '.') || w.expr.startsWith(prevVar + '[')) {
            return { ...w, expr: varName + w.expr.slice(prevVar.length) };
          }
          return w;
        }));
        // Migrate key cache to new varName
        const cached = keysCacheRef.current.get(prevVar);
        if (cached) {
          keysCacheRef.current.set(varName, cached.map((e) => varName + e.slice(prevVar.length)));
          keysCacheRef.current.delete(prevVar);
        }
        fetchedRef.current.delete(prevVar);
      }

      // Cache keys for autocomplete
      const childExprs = keys.map((k) => propExpr(varName, k.name));
      keysCacheRef.current.set(varName, childExprs);
      fetchedRef.current.add(varName);

      setSelectedObj({ varName, label });
    } catch { /* ignore */ }
  }, [setWatches]);

  // ── copy object from log stream ───────────────────────────────────────────────
  const handleCopyObj = useCallback(async (objectId: string) => {
    try {
      const res = await fetch('/api/chrome-obj-json', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectId }),
      });
      const data = (await res.json()) as { json?: string; error?: string };
      if (data.json != null) await navigator.clipboard.writeText(data.json);
    } catch { /* ignore */ }
  }, []);

  // ── poll selected object properties ──────────────────────────────────────────
  useEffect(() => {
    if (!connected || !selectedObj) { setSelectedProps([]); return; }
    const poll = async () => {
      const obj = selectedObjRef.current;
      if (!obj) return;
      try {
        const evalRes = await fetch('/api/chrome-evaluate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expression: obj.varName }),
        });
        const evalData = (await evalRes.json()) as { result?: CdpArg };
        const objectId = evalData.result?.objectId;
        if (!objectId) return;

        const inspectRes = await fetch('/api/chrome-inspect', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ objectId }),
        });
        const inspectData = (await inspectRes.json()) as {
          properties?: { name: string; enumerable?: boolean; value?: CdpArg }[];
        };
        setSelectedProps(
          (inspectData.properties ?? [])
            .filter((p) => p.enumerable !== false)
            .map((p) => ({ name: p.name, value: p.value as CdpArg | undefined }))
        );
      } catch { /* ignore */ }
    };
    void poll();
    const t = setInterval(() => void poll(), 1000);
    return () => clearInterval(t);
  }, [connected, selectedObj]);


  // ── copy watch value ──────────────────────────────────────────────────────────
  const copyWatch = async (w: WatchItem) => {
    try {
      const res = await fetch('/api/chrome-evaluate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expression: `JSON.stringify(${w.expr}, null, 2)` }),
      });
      const data = (await res.json()) as { result?: CdpArg; error?: string };
      const text = data.result?.value != null ? String(data.result.value) : (data.error ?? '');
      await navigator.clipboard.writeText(text);
      setCopiedId(w.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch { /* ignore */ }
  };

  // ── flat suggestion list from cache ──────────────────────────────────────────
  const getAllSuggestions = useCallback((): string[] => {
    const topLevel = watchesRef.current.map((w) => w.expr);
    const children = Array.from(keysCacheRef.current.values()).flat();
    const watchedSet = new Set(topLevel);
    return Array.from(new Set([...topLevel, ...children.filter((e) => !watchedSet.has(e))]));
  }, []);

  // ── autocomplete ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (acDebounceRef.current) clearTimeout(acDebounceRef.current);

    if (!inputFocused) { setAcItems([]); return; }

    const input = watchInput.trim();

    // Empty input or just typing: show/filter from the pre-fetched cache instantly
    const all = getAllSuggestions();
    if (!input) {
      setAcItems(all.slice(0, 30));
      return;
    }
    const lower = input.toLowerCase();
    const cached = all.filter((e) => e.toLowerCase().includes(lower) && e !== input);
    setAcItems(cached.slice(0, 30));

    if (!connected) return;

    // Debounced CDP call for parent paths not yet cached (deeper drilling)
    const lastDot = input.lastIndexOf('.');
    if (lastDot === -1) return;
    const parent = input.slice(0, lastDot);
    const partial = input.slice(lastDot + 1).toLowerCase();
    if (keysCacheRef.current.has(parent)) return;

    acDebounceRef.current = setTimeout(async () => {
      let objectId: string | undefined;
      const pw = watchesRef.current.find((w) => w.expr === parent);
      if (pw) {
        const r = watchResultsRef.current[pw.id];
        if (r?.ok && r.arg.objectId) objectId = r.arg.objectId;
      }
      if (!objectId) {
        try {
          const r = await fetch('/api/chrome-evaluate', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expression: parent }),
          });
          const d = (await r.json()) as { result?: CdpArg };
          objectId = d.result?.objectId;
        } catch { return; }
      }
      if (!objectId) return;
      try {
        const keys = await inspectKeys(objectId);
        const childExprs = keys.map((k) => propExpr(parent, k.name));
        keysCacheRef.current.set(parent, childExprs);
        const filtered = childExprs.filter((e) => {
          const key = e.slice(parent.length + 1).toLowerCase();
          return key.includes(partial) && e !== input;
        });
        setAcItems(filtered.slice(0, 30));
      } catch { /* ignore */ }
    }, 300);

    return () => { if (acDebounceRef.current) clearTimeout(acDebounceRef.current); };
  }, [watchInput, inputFocused, connected, getAllSuggestions]);

  const pickAc = (expr: string) => {
    setWatchInput(expr);
    setAcItems([]);
    setAcHighlight(-1);
    inputRef.current?.focus();
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!acItems.length) { if (e.key === 'Enter') submitInput(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setAcHighlight((h) => Math.min(h + 1, acItems.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAcHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (acHighlight >= 0) pickAc(acItems[acHighlight]);
      else submitInput();
    }
    else if (e.key === 'Escape') { setAcItems([]); setAcHighlight(-1); }
  };

  // ── log scroll ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !atBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [logs]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  const fmt = (ts: number) =>
    new Date(ts).toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // ── render ────────────────────────────────────────────────────────────────────
  return (
    <div className="clp">
      <header className="clp-head">
        <Link href="/" className="btn ghost clp-back">← Workspace</Link>
        <div className="clp-title-group">
          <h1 className="clp-title">Chrome Logs</h1>
          {connected && <span className="clp-dot" title="Connected" />}
          {status && <span className="clp-status muted">{status}</span>}
        </div>
        <div className="clp-actions">
          {connected
            ? <button type="button" className="btn ghost" onClick={disconnect}>Disconnect</button>
            : <button type="button" className="btn primary" onClick={connect}>Connect</button>}
          <button type="button" className="btn ghost" onClick={() => setLogs([])} disabled={logs.length === 0}>Clear</button>
        </div>
      </header>

      <div className="clp-main">
        {/* ── Log stream ── */}
        <div className="clp-body" ref={bodyRef} onScroll={onScroll}>
          {logs.length === 0 ? (
            <p className="clp-empty muted">
              {connected ? 'Listening for console output…' : 'Click Connect to start capturing Chrome logs.'}
            </p>
          ) : logs.map((entry) => (
            <div key={entry.id} className={`clp-entry clp-entry-${entry.level}`}>
              <span className="clp-ts">{fmt(entry.timestamp)}</span>
              <span className="clp-level">{entry.level}</span>
              <div className="clp-content">
                {entry.text !== undefined
                  ? entry.text
                  : entry.args.map((arg, i) => (
                      <div key={i} className="cdp-arg">
                        <CdpArgView arg={arg} onWatchObj={handleWatchObj} onCopyObj={handleCopyObj} />
                      </div>
                    ))}
              </div>
            </div>
          ))}
        </div>

        {/* ── Watch sidebar ── */}
        <aside className="clp-watch">
          <div className="clp-watch-head">
            <span className="clp-watch-title">Watch</span>
            <div className="clp-watch-head-actions">
              {watches.length > 0 && (
                <button
                  type="button"
                  className="clp-watch-clear"
                  onClick={() => {
                    keysCacheRef.current.clear();
                    fetchedRef.current.clear();
                    setWatches([]);
                  }}
                >
                  Clear all
                </button>
              )}
            </div>
          </div>

          {/* Selected object inspector */}
          {selectedObj && (
            <div className="clp-sel">
              <div className="clp-sel-head">
                <span className="clp-sel-label" title={selectedObj.varName}>{selectedObj.label}</span>
                <button
                  type="button"
                  className="clp-watch-remove"
                  aria-label="Close"
                  onClick={() => { setSelectedObj(null); setSelectedProps([]); }}
                >×</button>
              </div>
              <div className="clp-sel-body">
                {selectedProps.length === 0 ? (
                  <span className="muted" style={{ fontSize: 11 }}>Loading…</span>
                ) : (() => {
                  const watchedExprs = new Set(watches.map((w) => w.expr));
                  const visible = selectedProps.filter(
                    (p) => !watchedExprs.has(propExpr(selectedObj.varName, p.name))
                  );
                  const hiddenCount = selectedProps.length - visible.length;
                  return (
                    <>
                      {visible.length === 0 && hiddenCount > 0 && (
                        <span className="muted" style={{ fontSize: 11 }}>
                          All {hiddenCount} keys already in watch list
                        </span>
                      )}
                      {visible.map((p, i) => (
                        <div key={i} className="clp-sel-prop">
                          <span className="clp-sel-key">{p.name}:</span>
                          {p.value
                            ? <CdpArgView arg={p.value} />
                            : <span className="cdp-undef">undefined</span>}
                        </div>
                      ))}
                      {hiddenCount > 0 && visible.length > 0 && (
                        <div className="clp-sel-hidden">
                          {hiddenCount} key{hiddenCount > 1 ? 's' : ''} already watched
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Input + autocomplete dropdown */}
          <div className="clp-watch-input-wrap">
            <form
              className="clp-watch-add"
              onSubmit={(e) => { e.preventDefault(); if (acHighlight < 0) submitInput(); }}
            >
              <input
                ref={inputRef}
                className="clp-watch-input"
                type="text"
                placeholder="Expression or pick from list…"
                value={watchInput}
                onChange={(e) => { setWatchInput(e.target.value); setAcHighlight(-1); }}
                onKeyDown={onInputKeyDown}
                onFocus={() => setInputFocused(true)}
                onBlur={() => {
                  setTimeout(() => { setInputFocused(false); setAcItems([]); setAcHighlight(-1); }, 150);
                }}
                spellCheck={false}
                autoComplete="off"
              />
              <button type="submit" className="btn primary" disabled={!watchInput.trim()}>+</button>
            </form>

            {acItems.length > 0 && (
              <ul className="clp-ac">
                {acItems.map((item, i) => (
                  <li key={item}>
                    <button
                      type="button"
                      className={`clp-ac-item${i === acHighlight ? ' clp-ac-item-active' : ''}`}
                      onMouseDown={() => pickAc(item)}
                    >
                      {item}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Watch list */}
          <div className="clp-watch-list">
            {watches.length === 0 ? (
              <p className="clp-watch-empty muted">No watches yet.</p>
            ) : watches.map((w) => {
              const res = watchResults[w.id];
              const isObj = res?.ok && (res.arg.type === 'object' || res.arg.type === 'function') && res.arg.objectId;
              return (
                <div key={w.id} className="clp-watch-item">
                  <div className="clp-watch-item-head">
                    <span className="clp-watch-expr">{w.expr}</span>
                    <div className="clp-watch-item-actions">
                      <button
                        type="button"
                        className="clp-watch-action"
                        title="Copy value"
                        onClick={() => void copyWatch(w)}
                      >
                        {copiedId === w.id ? '✓' : '⎘'}
                      </button>
                      <button type="button" className="clp-watch-remove" aria-label="Remove" onClick={() => removeWatch(w.id)}>×</button>
                    </div>
                  </div>
                  <div className="clp-watch-value">
                    {!res ? (
                      <span className="muted">{connected ? 'Evaluating…' : 'Not connected'}</span>
                    ) : res.ok ? (
                      <>
                        <CdpArgView arg={res.arg} />
                        {isObj && (
                          <WatchKeyPicker
                            objectId={res.arg.objectId!}
                            baseExpr={w.expr}
                            onAddOne={(expr) => { addWatch(expr); setWatchInput(expr); }}
                            onAddAll={(exprs) => addWatches(exprs)}
                          />
                        )}
                      </>
                    ) : (
                      <span className="clp-watch-error">{res.error}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}
