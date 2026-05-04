import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

export function cmSelectRange(view: EditorView, from: number, to: number) {
  view.dispatch({
    selection: EditorSelection.range(from, to),
    scrollIntoView: true,
  });
}

export function cmPlaceCursor(view: EditorView, pos: number) {
  view.dispatch({
    selection: EditorSelection.cursor(pos),
    scrollIntoView: true,
  });
}
