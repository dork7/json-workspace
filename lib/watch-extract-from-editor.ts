import type { EditorView } from '@codemirror/view';
import type { TabLanguage } from '@/lib/workspace-types';

const MAX_LEN = 512;

/** Quote JSON path segment when it isn’t a simple identifier */
export function jsonKeyToWatchSegment(key: string): string {
  const t = key.trim();
  if (!t) return t;
  if (/^[a-zA-Z_$][\w$]*$/.test(t)) return t;
  const escaped = t.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `["${escaped}"]`;
}

function sanitizeWatchExpr(s: string): string | null {
  const t = s.trim();
  if (!t || t.length > MAX_LEN) return null;
  return t;
}

/** Line text for a document line starting at `docLineStart`. */
export function sliceDocLineAt(text: string, docLineStart: number): string {
  const start = Math.min(Math.max(0, docLineStart), text.length);
  const nl = text.indexOf('\n', start);
  const end = nl === -1 ? text.length : nl;
  return text.slice(start, end);
}

/**
 * Infer watch path from one line — JSON key, declaration, or identifier at `cursorCol`.
 */
export function extractWatchExprFromLine(
  lineText: string,
  lang: TabLanguage,
  cursorCol: number
): string | null {
  const trimmed = lineText.trim();
  if (!trimmed) return null;

  const col = Math.min(Math.max(0, cursorCol), lineText.length);

  if (lang === 'json') {
    const dq = trimmed.match(/^"([^"]+)"\s*:/);
    if (dq) return sanitizeWatchExpr(jsonKeyToWatchSegment(dq[1]));

    const bk = trimmed.match(/^\[\s*"([^"]+)"\s*\]\s*:/);
    if (bk) return sanitizeWatchExpr(jsonKeyToWatchSegment(bk[1]));
  }

  if (lang === 'javascript' || lang === 'typescript') {
    const decl = trimmed.match(
      /^(?:export\s+)?(?:declare\s+)?(?:async\s+)?(?:function\s*\*?\s*|class\s+|(?:const|let|var)\s+)([$_a-zA-Z][$\w]*)/
    );
    if (decl) return sanitizeWatchExpr(decl[1]);

    const intf = trimmed.match(
      /^export\s+(?:default\s+)?interface\s+([$_a-zA-Z][$\w]*)/
    );
    if (intf && lang === 'typescript') return sanitizeWatchExpr(intf[1]);

    const tp = trimmed.match(/^export\s+type\s+([$_a-zA-Z][$\w]*)/);
    if (tp && lang === 'typescript') return sanitizeWatchExpr(tp[1]);
  }

  let lo = col;
  let hi = col;
  while (lo > 0 && /[\w$]/.test(lineText.charAt(lo - 1))) lo--;
  while (hi < lineText.length && /[\w$]/.test(lineText.charAt(hi))) hi++;
  const word = lineText.slice(lo, hi);
  if (word && /^[$_a-zA-Z]/.test(word)) return sanitizeWatchExpr(word);

  return null;
}

/**
 * Prefer non-empty selection; otherwise infer from the cursor line.
 */
export function extractWatchExprFromEditor(
  view: EditorView,
  lang: TabLanguage
): string | null {
  const state = view.state;
  const sel = state.selection.main;
  const doc = state.doc;

  if (sel.from !== sel.to) {
    let selText = doc.sliceString(sel.from, sel.to).trim();
    if (selText.includes('\n')) {
      selText = selText.split(/\r?\n/u)[0].trim();
    }
    const single = sanitizeWatchExpr(selText);
    if (single) return single;
  }

  const head = sel.head;
  const line = doc.lineAt(head);
  const col = Math.min(Math.max(0, head - line.from), line.text.length);
  return extractWatchExprFromLine(line.text, lang, col);
}
