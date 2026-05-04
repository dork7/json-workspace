/** Number of lines in editor buffer (textarea semantics; trailing newline still counts its line). */
export function lineCount(text: string): number {
  if (text === '') return 1;
  let n = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n++;
  }
  return n;
}

/** 1-based line number for cursor offset `offset` (clamped). */
export function offsetToLineNumber(text: string, offset: number): number {
  const o = Math.min(Math.max(0, offset), text.length);
  let line = 1;
  for (let i = 0; i < o; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

/** Start offset (UTF-16) of the line containing `offset`. */
export function lineStartOffset(text: string, offset: number): number {
  const o = Math.min(Math.max(0, offset), text.length);
  const nl = text.lastIndexOf('\n', o - 1);
  return nl === -1 ? 0 : nl + 1;
}

/** Start offset for 1-based line index `line1`. */
export function lineNumberToStartOffset(text: string, line1: number): number {
  if (line1 <= 1) return 0;
  let line = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      if (line === line1) return i + 1;
    }
  }
  return text.length;
}

export function lineSnippet(text: string, anchor: number, maxLen: number): string {
  const start = Math.min(Math.max(0, anchor), text.length);
  const nl = text.indexOf('\n', start);
  const end = nl === -1 ? text.length : nl;
  let s = text.slice(start, end).trim();
  if (s.length > maxLen) s = `${s.slice(0, Math.max(0, maxLen - 1))}…`;
  return s || '(empty line)';
}
