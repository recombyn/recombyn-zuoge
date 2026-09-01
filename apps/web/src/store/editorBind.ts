/**
 * Bind editor case mutators to Zustand `set` via immer produce.
 * Call `bindEditorStore` once from store/index.ts during create().
 */
import { produce } from 'immer';

export type EditorDraftFn = (fn: (draft: any) => void) => void;

let runEditor: EditorDraftFn = () => {
  throw new Error('Editor store not bound — import @/store before calling mutators');
};

export function bindEditorStore(run: EditorDraftFn) {
  runEditor = run;
}

/** Wrap a (state, action) case reducer as a direct Zustand mutator. */
export function bindEditorMutator<S, P = void>(
  reducer: (state: S, action: { payload: P }) => void
): P extends void ? () => void : (payload: P) => void {
  return ((payload?: P) => {
    runEditor((draft) => {
      reducer(draft, { payload: payload as P });
    });
  }) as P extends void ? () => void : (payload: P) => void;
}

/** Pure apply for unit tests (no Zustand). */
export function applyEditorReducer<S>(
  state: S,
  reducer: (state: S, action: { payload: unknown }) => void,
  payload?: unknown
): S {
  return produce(state, (draft) => {
    reducer(draft as S, { payload });
  });
}
