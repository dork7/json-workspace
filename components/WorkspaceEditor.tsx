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
  { tag: tags.keyword, color: '#ff7b72' },
  { tag: tags.controlKeyword, color: '#ff7b72' },
  { tag: tags.definitionKeyword, color: '#ff7b72' },
  { tag: tags.moduleKeyword, color: '#ff7b72' },
  { tag: tags.string, color: '#a5d6ff' },
  { tag: tags.regexp, color: '#a5d6ff' },
  { tag: tags.number, color: '#79c0ff' },
  { tag: tags.bool, color: '#79c0ff' },
  { tag: tags.null, color: '#79c0ff' },
  { tag: tags.propertyName, color: '#79c0ff' },
  { tag: tags.attributeName, color: '#79c0ff' },
  { tag: tags.variableName, color: '#ffa657' },
  { tag: tags.className, color: '#ffa657' },
  { tag: tags.typeName, color: '#ffa657' },
  { tag: tags.tagName, color: '#7ee787' },
  { tag: tags.comment, color: '#8b949e', fontStyle: 'italic' },
  { tag: tags.bracket, color: '#e6edf3' },
  { tag: tags.brace, color: '#ffa657' },
  { tag: tags.paren, color: '#e6edf3' },
  { tag: tags.squareBracket, color: '#d2a8ff' },
  { tag: tags.separator, color: '#8b949e' },
  { tag: tags.operator, color: '#ff7b72' },
  { tag: tags.meta, color: '#8b949e' },
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
    caretColor: 'var(--accent)',
  },
  '.cm-gutters': {
    backgroundColor: 'color-mix(in srgb, var(--surface) 85%, var(--bg))',
    color: 'var(--muted)',
    border: 'none',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(88, 166, 255, 0.06)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgba(88, 166, 255, 0.08)',
    color: 'var(--text)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 0.35rem 0 0.65rem',
    minWidth: '2.25rem',
    cursor: 'pointer',
  },
  '.cm-lineNumbers .cm-gutterElement.cm-bookmarkedLineNumber': {
    color: '#f85149',
    fontWeight: '600',
  },
  '.cm-activeLineGutter.cm-bookmarkedLineNumber': {
    color: '#f85149',
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
    backgroundColor: 'rgba(253, 224, 71, 0.38)',
  },
  '&.cm-focused .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'rgba(253, 224, 71, 0.52)',
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

    return [
      watchfoxTheme,
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
