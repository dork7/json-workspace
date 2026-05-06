'use client';

import { useState, type ReactNode } from 'react';

type JsonTreeViewProps = {
  value: unknown;
  /**
   * Optional substring to highlight inside primitives, keys, and summary text.
   * Matching follows the toolbar Find — case-sensitive substring match.
   */
  highlight?: string;
};

/**
 * Indented, syntax-coloured JSON tree with collapsible objects and arrays.
 * Used by the focused-watch cards alongside the editor.
 */
export function JsonTreeView({ value, highlight }: JsonTreeViewProps) {
  const query = (highlight ?? '').length > 0 ? (highlight as string) : '';
  return (
    <div className="json-tree" role="tree">
      <ValueLine
        label={null}
        value={value}
        depth={0}
        isLast
        highlight={query}
      />
    </div>
  );
}

/** Levels at which collapsibles start expanded; deeper nodes start collapsed. */
const INITIAL_OPEN_DEPTH = 2;
/** Hard cap on direct children rendered per object/array to keep huge payloads usable. */
const MAX_CHILDREN_PER_NODE = 1000;
/** Pixel indent applied per nesting level. */
const INDENT_PX = 14;

type ValueLineProps = {
  /** Pre-formatted key text (e.g. `"foo"` or `0`). `null` means render as a top-level value with no prefix. */
  label: string | null;
  value: unknown;
  depth: number;
  /** Whether this is the last child in its parent — controls trailing comma. */
  isLast: boolean;
  /** Active find query (empty string means no highlight). */
  highlight: string;
};

function ValueLine(props: ValueLineProps) {
  const { value } = props;
  if (Array.isArray(value)) {
    return <CollapsibleNode {...props} kind="array" />;
  }
  if (value !== null && typeof value === 'object') {
    return <CollapsibleNode {...props} kind="object" />;
  }
  return <PrimitiveLine {...props} />;
}

function PrimitiveLine({
  label,
  value,
  depth,
  isLast,
  highlight,
}: ValueLineProps) {
  return (
    <div
      className="json-line"
      style={{ paddingLeft: depth * INDENT_PX }}
      role="treeitem"
    >
      <span className="json-toggle-spacer" aria-hidden />
      {label !== null ? (
        <>
          <span className="json-key">
            {highlightText(label, highlight)}
          </span>
          <span className="json-punc">: </span>
        </>
      ) : null}
      {renderPrimitive(value, highlight)}
      {!isLast ? <span className="json-punc">,</span> : null}
    </div>
  );
}

type CollapsibleNodeProps = ValueLineProps & { kind: 'array' | 'object' };

function CollapsibleNode({
  kind,
  label,
  value,
  depth,
  isLast,
  highlight,
}: CollapsibleNodeProps) {
  /**
   * Arrays always start expanded — their items don't carry index labels
   * so users want to see them inline. Objects honour the depth limit so
   * deeply nested keys collapse to a summary on first render.
   */
  const [open, setOpen] = useState(
    kind === 'array' ? true : depth < INITIAL_OPEN_DEPTH
  );
  const opener = kind === 'array' ? '[' : '{';
  const closer = kind === 'array' ? ']' : '}';

  const entries: Array<[string, unknown]> = (() => {
    if (kind === 'array') {
      const arr = value as unknown[];
      return arr.map((v, i) => [String(i), v]);
    }
    return Object.entries(value as Record<string, unknown>);
  })();

  const length = entries.length;
  const summaryNoun =
    kind === 'array'
      ? length === 1
        ? 'item'
        : 'items'
      : length === 1
        ? 'key'
        : 'keys';
  const visible = entries.slice(0, MAX_CHILDREN_PER_NODE);
  const overflow = length - visible.length;
  const indentStyle = { paddingLeft: depth * INDENT_PX };

  const onToggle = () => setOpen((o) => !o);

  return (
    <div role="treeitem" aria-expanded={open}>
      <div className="json-line" style={indentStyle}>
        {length === 0 ? (
          <span className="json-toggle-spacer" aria-hidden />
        ) : (
          <button
            type="button"
            className="json-toggle"
            aria-label={open ? 'Collapse' : 'Expand'}
            aria-expanded={open}
            onClick={onToggle}
          >
            {open ? '▾' : '▸'}
          </button>
        )}

        {label !== null ? (
          <>
            <button
              type="button"
              className="json-key json-key-button"
              onClick={onToggle}
              title={open ? 'Collapse' : 'Expand'}
            >
              {highlightText(label, highlight)}
            </button>
            <span className="json-punc">: </span>
          </>
        ) : null}

        {length === 0 ? (
          <>
            <span className="json-punc">
              {opener}
              {closer}
            </span>
            {!isLast ? <span className="json-punc">,</span> : null}
          </>
        ) : open ? (
          <span className="json-punc">{opener}</span>
        ) : (
          <>
            <span className="json-punc">{opener}</span>
            <span className="json-summary">
              {' '}
              {length} {summaryNoun}{' '}
            </span>
            <span className="json-punc">{closer}</span>
            {!isLast ? <span className="json-punc">,</span> : null}
          </>
        )}
      </div>

      {open && length > 0 ? (
        <>
          {visible.map(([k, v], i) => {
            /**
             * Array items don't display their numeric index — the visual
             * order already conveys position. Object entries keep their
             * JSON-stringified key.
             */
            const childLabel = kind === 'array' ? null : JSON.stringify(k);
            const childIsLast = overflow === 0 && i === visible.length - 1;
            return (
              <ValueLine
                key={k}
                label={childLabel}
                value={v}
                depth={depth + 1}
                isLast={childIsLast}
                highlight={highlight}
              />
            );
          })}
          {overflow > 0 ? (
            <div
              className="json-line json-truncated-line"
              style={{ paddingLeft: (depth + 1) * INDENT_PX }}
            >
              <span className="json-toggle-spacer" aria-hidden />
              <span className="json-truncated">
                … {overflow} more {kind === 'array' ? 'items' : 'keys'} hidden
              </span>
            </div>
          ) : null}

          <div className="json-line" style={indentStyle}>
            <span className="json-toggle-spacer" aria-hidden />
            <span className="json-punc">{closer}</span>
            {!isLast ? <span className="json-punc">,</span> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function renderPrimitive(v: unknown, highlight: string): ReactNode {
  if (v === null) {
    return <span className="json-null">{highlightText('null', highlight)}</span>;
  }
  if (v === undefined) {
    return (
      <span className="json-undefined">
        {highlightText('undefined', highlight)}
      </span>
    );
  }
  switch (typeof v) {
    case 'string':
      return (
        <span className="json-string">
          {highlightText(`"${escapeString(v)}"`, highlight)}
        </span>
      );
    case 'number':
      return (
        <span className="json-number">
          {highlightText(numberLiteral(v), highlight)}
        </span>
      );
    case 'boolean':
      return (
        <span className="json-boolean">
          {highlightText(String(v), highlight)}
        </span>
      );
    case 'bigint':
      return (
        <span className="json-number">
          {highlightText(`${String(v)}n`, highlight)}
        </span>
      );
    case 'function':
      return (
        <span className="json-function">
          {highlightText('[Function]', highlight)}
        </span>
      );
    case 'symbol':
      return (
        <span className="json-symbol">
          {highlightText(String(v), highlight)}
        </span>
      );
    default:
      return <span>{highlightText(String(v), highlight)}</span>;
  }
}

/**
 * Wrap each occurrence of `query` (case-sensitive, like the editor's Find)
 * in a `<mark className="json-match">`. Returns the raw text when there is
 * no query or no match so we don't allocate arrays needlessly.
 */
function highlightText(text: string, query: string): ReactNode {
  if (!query) return text;
  if (!text.includes(query)) return text;
  const parts: ReactNode[] = [];
  let cursor = 0;
  let idx = text.indexOf(query, cursor);
  let key = 0;
  while (idx !== -1) {
    if (idx > cursor) parts.push(text.slice(cursor, idx));
    parts.push(
      <mark key={`m${key++}`} className="json-match">
        {text.slice(idx, idx + query.length)}
      </mark>
    );
    cursor = idx + query.length;
    idx = text.indexOf(query, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function escapeString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function numberLiteral(n: number): string {
  if (Number.isNaN(n)) return 'NaN';
  if (n === Infinity) return 'Infinity';
  if (n === -Infinity) return '-Infinity';
  return String(n);
}
