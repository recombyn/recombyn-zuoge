/**
 * Bind auth case mutators to Zustand.
 */
import { produce } from 'immer';

type AuthDraftFn = (fn: (draft: any) => void) => void;

let runAuth: AuthDraftFn = () => {
  throw new Error('Auth store not bound — import @/store before calling mutators');
};

export function bindAuthStore(run: AuthDraftFn) {
  runAuth = run;
}

export function bindAuthMutator<S, P = void>(
  reducer: (state: S, action: { payload: P }) => void
): P extends void ? () => void : (payload: P) => void {
  return ((payload?: P) => {
    runAuth((draft) => {
      reducer(draft, { payload: payload as P });
    });
  }) as P extends void ? () => void : (payload: P) => void;
}

export function applyAuthReducer<S>(
  state: S,
  reducer: (state: S, action: { payload: unknown }) => void,
  payload?: unknown
): S {
  return produce(state, (draft) => {
    reducer(draft as S, { payload });
  });
}
