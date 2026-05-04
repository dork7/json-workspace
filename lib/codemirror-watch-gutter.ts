import { Prec, type Extension } from '@codemirror/state';
import { gutter, GutterMarker } from '@codemirror/view';

/** Per-line “+” control to push inferred path onto Watch */
export class WatchPlusMarker extends GutterMarker {
  eq(other: GutterMarker): boolean {
    return other instanceof WatchPlusMarker;
  }

  toDOM(): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cm-watch-plus';
    btn.textContent = '+';
    btn.setAttribute('aria-label', 'Add inferred path from this line to Watch');
    return btn;
  }
}

export function watchPlusGutter(
  onLine: (docLineStart: number) => void
): Extension {
  return Prec.high(
    gutter({
      class: 'cm-watch-gutter',
      renderEmptyElements: true,
      domEventHandlers: {
        mousedown(view, line, event) {
          const me = event as MouseEvent;
          if (me.button !== 0) return false;
          const docLine = view.state.doc.lineAt(line.from);
          onLine(docLine.from);
          queueMicrotask(() => view.focus());
          return true;
        },
      },
      lineMarker() {
        return new WatchPlusMarker();
      },
    })
  );
}
