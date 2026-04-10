'use client';

import { parseJsonSafe } from '@/lib/json-utils';

function hasMeaningfulChildValue(v: unknown): boolean {
  if (v === undefined) return false;
  if (v === null) return true;
  if (typeof v !== 'object') return true;
  if (Array.isArray(v)) return v.length > 0;
  return Object.keys(v).length > 0;
}

export function PlainTreeView({ value }: { value: unknown }) {
  return (
    <div className="json-tree" tabIndex={0} aria-label="Collapsible tree">
      <JsonTreeValue value={value} />
    </div>
  );
}

function JsonTreeValue({ value }: { value: unknown }) {
  if (value !== null && typeof value === 'object') {
    if (Array.isArray(value)) {
      return (
        <details open>
          <summary
            className={`json-summary${hasMeaningfulChildValue(value) ? ' json-summary-has-value' : ''}`}
          >
            {`Array(${value.length})`}
          </summary>
          <div className="json-children">
            {value.map((item, i) => (
              <div key={i} className="json-array-item">
                <JsonTreeValue value={item} />
              </div>
            ))}
          </div>
        </details>
      );
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    return (
      <details open>
        <summary
          className={`json-summary${hasMeaningfulChildValue(value) ? ' json-summary-has-value' : ''}`}
        >
          {`{${keys.length} keys}`}
        </summary>
        <div className="json-children">
          {keys.map((k) => (
            <div key={k} className="json-key-line">
              <span
                className={`json-key${hasMeaningfulChildValue(obj[k]) ? ' json-key-has-value' : ''}`}
              >
                {`${k}: `}
              </span>
              <JsonTreeValue value={obj[k]} />
            </div>
          ))}
        </div>
      </details>
    );
  }
  return <span className="json-scalar">{JSON.stringify(value)}</span>;
}

export function JsonTreeView({ text }: { text: string }) {
  const p = parseJsonSafe(text);
  if (!p.ok) {
    return <div className="tree-error">Invalid JSON: {p.error}</div>;
  }
  return <PlainTreeView value={p.value} />;
}
