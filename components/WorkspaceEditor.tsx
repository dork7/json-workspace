'use client';

import CodeMirror from '@uiw/react-codemirror';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useMemo } from 'react';
import { bookmarkAwareLineNumbers } from '@/lib/codemirror-bookmark-line-numbers';
import { watchPlusGutter } from '@/lib/codemirror-watch-gutter';
import type { TabLanguage } from '@/lib/workspace-types';

const watchfoxHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#c5a396' },
  { tag: tags.controlKeyword, color: '#c5a396' },
  { tag: tags.definitionKeyword, color: '#c5a396' },
  { tag: tags.moduleKeyword, color: '#c5a396' },
  { tag: tags.string, color: '#a7c4d4' },
  { tag: tags.regexp, color: '#a7c4d4' },
  { tag: tags.number, color: '#9fb8ce' },
  { tag: tags.bool, color: '#9fb8ce' },
  { tag: tags.null, color: '#9fb8ce' },
  { tag: tags.propertyName, color: '#9fb8ce' },
  { tag: tags.attributeName, color: '#9fb8ce' },
  { tag: tags.variableName, color: '#d4c49a' },
  { tag: tags.className, color: '#d4c49a' },
  { tag: tags.typeName, color: '#d4c49a' },
  { tag: tags.tagName, color: '#a4b89e' },
  { tag: tags.comment, color: '#918d86', fontStyle: 'italic' },
  { tag: tags.bracket, color: '#ddd9d2' },
  { tag: tags.brace, color: '#d4c49a' },
  { tag: tags.paren, color: '#ddd9d2' },
  { tag: tags.squareBracket, color: '#b8aac8' },
  { tag: tags.separator, color: '#918d86' },
  { tag: tags.operator, color: '#c5a396' },
  { tag: tags.meta, color: '#918d86' },
]);

const watchfoxTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--bg)',
    color: 'var(--text)',
    fontSize: '13px',
  },
  '&.cm-focused': {
    outline: '2px solid var(--accent)',
    outlineOffset: '2px',
  },
  '.cm-scroller': {
    fontFamily: 'var(--mono)',
    lineHeight: '1.55',
    overflow: 'auto',
  },
  '.cm-content': {
    caretColor: '#ffffff',
  },
  /** CodeMirror's `drawSelection` extension renders the caret as a 1.2px left border on `.cm-cursor`. */
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#ffffff',
  },
  '.cm-gutters': {
    backgroundColor: 'color-mix(in srgb, var(--surface) 85%, var(--bg))',
    color: 'var(--muted)',
    border: 'none',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 9%, transparent)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)',
    color: 'var(--text)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 0.35rem 0 0.65rem',
    minWidth: '2.25rem',
    cursor: 'pointer',
  },
  '.cm-lineNumbers .cm-gutterElement.cm-bookmarkedLineNumber': {
    color: 'var(--bookmark-line)',
    fontWeight: '600',
  },
  '.cm-activeLineGutter.cm-bookmarkedLineNumber': {
    color: 'var(--bookmark-line)',
    fontWeight: '600',
  },
  '.cm-foldGutter .cm-gutterElement': {
    padding: '0 0.15rem',
    cursor: 'pointer',
  },
  '.cm-watch-gutter .cm-gutterElement': {
    padding: '0 0.1rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '1.15rem',
  },
  '.cm-watch-plus': {
    border: 'none',
    background: 'transparent',
    color: 'var(--muted)',
    cursor: 'pointer',
    fontSize: '13px',
    lineHeight: '1',
    padding: '0',
    opacity: '0.55',
    fontWeight: '600',
  },
  '.cm-watch-plus:hover': {
    opacity: '1',
    color: 'var(--accent)',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'color-mix(in srgb, var(--surface) 80%, transparent)',
    border: '1px solid var(--border)',
    color: 'var(--muted)',
    borderRadius: '4px',
    padding: '0 0.25rem',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'rgba(218, 198, 155, 0.34)',
  },
  '&.cm-focused .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'rgba(218, 198, 155, 0.46)',
  },
});

export type WorkspaceEditorProps = {
  value: string;
  onChange: (value: string) => void;
  lang: TabLanguage;
  placeholder: string;
  editorViewRef: React.MutableRefObject<EditorView | null>;
  /** Line-start document positions with a bookmark */
  bookmarkAnchors: ReadonlySet<number>;
  /** Toggle bookmark on that document line (click line number or F9) */
  onBookmarkLineToggle: (docLineStart: number) => void;
  /** Add inferred watch path from this document line (+ gutter) */
  onWatchLineAdd: (docLineStart: number) => void;
};

export default function WorkspaceEditor({
  value,
  onChange,
  lang,
  placeholder,
  editorViewRef,
  bookmarkAnchors,
  onBookmarkLineToggle,
  onWatchLineAdd,
}: WorkspaceEditorProps) {
  useEffect(() => {
    return () => {
      editorViewRef.current = null;
    };
  }, [editorViewRef]);

  const extensions = useMemo(() => {
    const language =
      lang === 'json'
        ? json()
        : javascript({ typescript: lang === 'typescript' });

    /**
     * Replace CodeMirror's default word-selection on double-click with a
     * full-document select. CM detects multi-click via `mousedown` events
     * whose `.detail` is 2 (double) or 3 (triple) — we preempt the 2-click
     * case so word-selection never runs.
     */
    const selectAllOnDoubleClick = EditorView.domEventHandlers({
      mousedown(event, view) {
        if (event.detail !== 2 || event.button !== 0) return false;
        event.preventDefault();
        view.dispatch({
          selection: { anchor: 0, head: view.state.doc.length },
          scrollIntoView: false,
        });
        return true;
      },
    });

    return [
      watchfoxTheme,
      selectAllOnDoubleClick,
      drawSelection(),
      ...bookmarkAwareLineNumbers(value, bookmarkAnchors, onBookmarkLineToggle),
      watchPlusGutter(onWatchLineAdd),
      foldGutter({
        markerDOM(open) {
          const span = document.createElement('span');
          span.textContent = open ? '▼' : '▶';
          span.style.opacity = '0.85';
          span.style.fontSize = '10px';
          span.style.color = 'var(--muted)';
          return span;
        },
      }),
      language,
      indentUnit.of('\t'),
      indentOnInput(),
      bracketMatching(),
      syntaxHighlighting(watchfoxHighlight, { fallback: true }),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      history(),
      keymap.of([
        {
          key: 'F9',
          preventDefault: true,
          run(view) {
            const lineStart = view.state.doc.lineAt(
              view.state.selection.main.head
            ).from;
            onBookmarkLineToggle(lineStart);
            return true;
          },
        },
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
      ]),
      EditorView.lineWrapping,
    ];
  }, [lang, value, bookmarkAnchors, onBookmarkLineToggle, onWatchLineAdd]);

  return (
    <CodeMirror
      value={value}
      height="100%"
      theme="none"
      basicSetup={false}
      indentWithTab
      placeholder={placeholder}
      extensions={extensions}
      onChange={onChange}
      onCreateEditor={(view) => {
        editorViewRef.current = view;
      }}
    />
  );
}
