'use client';

import { createContext, useContext, useState } from 'react';

// ── Actions context — only set in log-stream context, not in watch panel ──────

type CdpActions = {
  onWatchObj?: (objectId: string, label: string) => void;
  onCopyObj?: (objectId: string) => void;
};
const CdpActionsCtx = createContext<CdpActions>({});

// ── CDP wire types ────────────────────────────────────────────────────────────

export type CdpObjPreview = {
  description?: string;
  overflow?: boolean;
  properties?: CdpPropPreview[];
};

export type CdpPropPreview = {
  name: string;
  type: string;
  subtype?: string;
  value?: string;
  valuePreview?: CdpObjPreview;
};

export type CdpArg = {
  type: string;
  subtype?: string;
  description?: string;
  value?: unknown;
  objectId?: string;
  preview?: CdpObjPreview;
};

// From Runtime.getProperties response
type CdpRemoteObject = {
  type: string;
  subtype?: string;
  description?: string;
  value?: unknown;
  objectId?: string;
  preview?: CdpObjPreview;
};

type CdpPropertyDescriptor = {
  name: string;
  enumerable?: boolean;
  value?: CdpRemoteObject;
};

// ── Primitives ────────────────────────────────────────────────────────────────

function CdpPrimitive({ type, subtype, value }: { type: string; subtype?: string; value?: string }) {
  if (subtype === 'null' || value === 'null') return <span className="cdp-null">null</span>;
  if (type === 'undefined') return <span className="cdp-undef">undefined</span>;
  if (type === 'number') return <span className="cdp-number">{value}</span>;
  if (type === 'boolean') return <span className="cdp-boolean">{value}</span>;
  if (type === 'string') return <span className="cdp-string">&quot;{value}&quot;</span>;
  return <span className="cdp-other">{value ?? type}</span>;
}

// ── Lazy object — fetches full props from /api/chrome-inspect on expand ───────

function CdpLazyObj({ objectId, label }: { objectId: string; label: string }) {
  const { onWatchObj, onCopyObj } = useContext(CdpActionsCtx);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [props, setProps] = useState<CdpPropertyDescriptor[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  const load = async () => {
    if (status !== 'idle') return;
    setStatus('loading');
    try {
      const res = await fetch('/api/chrome-inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectId }),
      });
      const data = (await res.json()) as { properties?: CdpPropertyDescriptor[]; error?: string };
      if (data.error) throw new Error(data.error);
      setProps((data.properties ?? []).filter((p) => p.enumerable !== false));
      setStatus('done');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Failed');
      setStatus('error');
    }
  };

  const hasActions = onWatchObj || onCopyObj;

  const handleLabelClick = (e: React.MouseEvent) => {
    if (!onWatchObj) return;
    e.stopPropagation(); // don't toggle <details>
    onWatchObj(objectId, label);
  };

  return (
    <details className="cdp-obj" onToggle={(e) => { if (e.currentTarget.open) void load(); }}>
      <summary className="cdp-obj-summary">
        <span
          className={`cdp-obj-label${hasActions ? ' cdp-obj-label-act' : ''}`}
          onClick={hasActions ? handleLabelClick : undefined}
          title={hasActions ? 'Click to inspect & copy' : undefined}
        >{label}</span>
        {hasActions && (
          <span className="cdp-obj-actions">
            {onWatchObj && (
              <button
                type="button"
                className="cdp-obj-act"
                title="Add all keys to watch panel"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onWatchObj(objectId, label); }}
              >
                + Watch
              </button>
            )}
            {onCopyObj && (
              <button
                type="button"
                className="cdp-obj-act"
                title="Copy as JSON"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCopyObj(objectId); }}
              >
                ⎘ Copy
              </button>
            )}
          </span>
        )}
      </summary>
      {status === 'loading' && <div className="cdp-lazy-status cdp-loading">Loading…</div>}
      {status === 'error' && <div className="cdp-lazy-status cdp-error-text">{errorMsg}</div>}
      {status === 'done' && (
        <div className="cdp-obj-body">
          {props.length === 0
            ? <span className="cdp-empty-obj">{label}</span>
            : props.map((prop, i) => (
                <div key={i} className="cdp-prop">
                  <span className="cdp-prop-key">{prop.name}:</span>
                  {' '}
                  {prop.value ? <CdpRemoteObjView obj={prop.value} /> : <span className="cdp-undef">undefined</span>}
                </div>
              ))}
        </div>
      )}
    </details>
  );
}

// ── Render a full RemoteObject (from getProperties) — recursive ───────────────

function CdpRemoteObjView({ obj }: { obj: CdpRemoteObject }) {
  if ((obj.type === 'object' || obj.type === 'function') && obj.objectId) {
    return <CdpLazyObj objectId={obj.objectId} label={obj.description ?? 'Object'} />;
  }
  if ((obj.type === 'object' || obj.type === 'function') && obj.preview) {
    return <CdpShallowObj preview={obj.preview} description={obj.description} />;
  }
  if (obj.type === 'object' || obj.type === 'function') {
    return <span className="cdp-desc">{obj.description ?? obj.type}</span>;
  }
  return (
    <CdpPrimitive
      type={obj.type}
      subtype={obj.subtype}
      value={obj.value !== undefined ? String(obj.value) : obj.description}
    />
  );
}

// ── Static shallow tree from CDP preview (no objectId available) ──────────────

function CdpShallowObj({ preview, description }: { preview: CdpObjPreview; description?: string }) {
  const label = preview.description ?? description ?? 'Object';
  const props = preview.properties ?? [];
  return (
    <details className="cdp-obj">
      <summary className="cdp-obj-summary">{label}{preview.overflow ? ' …' : ''}</summary>
      <div className="cdp-obj-body">
        {props.map((prop, i) => (
          <div key={i} className="cdp-prop">
            <span className="cdp-prop-key">{prop.name}:</span>
            {' '}
            {prop.valuePreview ? (
              <CdpShallowObj preview={prop.valuePreview} description={prop.value} />
            ) : (
              <CdpPrimitive type={prop.type} subtype={prop.subtype} value={prop.value} />
            )}
          </div>
        ))}
        {props.length === 0 && <span className="cdp-empty-obj">{label}</span>}
        {preview.overflow && <span className="cdp-overflow">… (preview truncated)</span>}
      </div>
    </details>
  );
}

// ── Public entry point ────────────────────────────────────────────────────────

export function CdpArgView({ arg, onWatchObj, onCopyObj }: {
  arg: CdpArg;
  onWatchObj?: (objectId: string, label: string) => void;
  onCopyObj?: (objectId: string) => void;
}) {
  const inner = (() => {
    // Object/function with objectId → lazy-load full properties on expand
    if ((arg.type === 'object' || arg.type === 'function') && arg.objectId) {
      return (
        <CdpLazyObj
          objectId={arg.objectId}
          label={arg.preview?.description ?? arg.description ?? 'Object'}
        />
      );
    }
    // Object with preview only (no objectId) → static shallow tree
    if ((arg.type === 'object' || arg.type === 'function') && arg.preview) {
      return <CdpShallowObj preview={arg.preview} description={arg.description} />;
    }
    if (arg.type === 'object' || arg.type === 'function') {
      return <span className="cdp-desc">{arg.description ?? arg.type}</span>;
    }
    return (
      <CdpPrimitive
        type={arg.type}
        subtype={arg.subtype}
        value={arg.value !== undefined ? String(arg.value) : arg.description}
      />
    );
  })();

  if (!onWatchObj && !onCopyObj) return inner;

  return (
    <CdpActionsCtx.Provider value={{ onWatchObj, onCopyObj }}>
      {inner}
    </CdpActionsCtx.Provider>
  );
}
