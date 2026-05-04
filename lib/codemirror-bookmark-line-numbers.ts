import { RangeSetBuilder, Text, type Extension, type RangeSet } from '@codemirror/state';
import {
  GutterMarker,
  gutterLineClass,
  lineNumbers,
} from '@codemirror/view';

/** Marks line-number gutter cells for bookmarked document lines (CSS via `elementClass` only). */
class BookmarkedLineNumberMarker extends GutterMarker {
  eq(other: GutterMarker): boolean {
    return other instanceof BookmarkedLineNumberMarker;
  }
  readonly elementClass = 'cm-bookmarkedLineNumber';
}

const bookmarkedLineMarker = new BookmarkedLineNumberMarker();

function buildBookmarkLineRangeSet(
  docText: string,
  anchors: ReadonlySet<number>
): RangeSet<GutterMarker> {
  const doc = Text.of(docText.split(/\n/u));
  const builder = new RangeSetBuilder<GutterMarker>();
  const seenLineFrom = new Set<number>();
  for (const raw of anchors) {
    const pos = Math.min(Math.max(0, raw), doc.length);
    let line;
    try {
      line = doc.lineAt(pos);
    } catch {
      continue;
    }
    if (seenLineFrom.has(line.from)) continue;
    seenLineFrom.add(line.from);
    builder.add(line.from, line.to, bookmarkedLineMarker);
  }
  return builder.finish();
}

/** Line-number gutter: bookmarked rows get `cm-bookmarkedLineNumber`; click toggles bookmark. */
export function bookmarkAwareLineNumbers(
  docText: string,
  anchors: ReadonlySet<number>,
  toggleLine: (docLineStart: number) => void
): Extension[] {
  return [
    gutterLineClass.of(buildBookmarkLineRangeSet(docText, anchors)),
    lineNumbers({
      domEventHandlers: {
        mousedown(view, line, event) {
          const me = event as MouseEvent;
          if (me.button !== 0) return false;
          const docLine = view.state.doc.lineAt(line.from);
          toggleLine(docLine.from);
          queueMicrotask(() => view.focus());
          return true;
        },
      },
    }),
  ];
}
