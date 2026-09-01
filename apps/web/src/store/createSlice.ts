/**
 * Action creators + immer reducers for Zustand (`store/index.ts`).
 * Same call shape as the old RTK createSlice so editor/auth slices stay readable.
 */
import { produce } from 'immer';

export type AnyAction = { type: string; [extra: string]: unknown };

export type PayloadAction<P = void, T extends string = string> = {
  type: T;
  payload: P;
};

export type Dispatch<A extends AnyAction = AnyAction> = (action: A) => A;
a
type CaseReducer<S, A extends AnyAction = AnyAction> = (
  state: S,
  action: A
) => void | S;

type SliceCaseReducers<S> = Record<string, CaseReducer<S, any>>;

type ActionCreator<P> = {
  (payload: P): PayloadAction<P>;
  type: string;
};

type ActionCreatorsFromReducers<S, R extends SliceCaseReducers<S>> = {
  [K in keyof R]: R[K] extends (state: S, action: infer A) => unknown
    ? A extends { payload: infer P }
      ? ActionCreator<P>
      : ActionCreator<void>
    : ActionCreator<unknown>;
};

export function createSlice<
  S,
  R extends SliceCaseReducers<S>,
  Name extends string = string,
>(config: {
  name: Name;
  initialState: S | (() => S);
  reducers: R;
}): {
  name: Name;
  reducer: (state: S | undefined, action: AnyAction) => S;
  actions: ActionCreatorsFromReducers<S, R>;
  /** Raw case reducers — call from sibling reducers (same as RTK). */
  caseReducers: R;
} {
  const initialState =
    typeof config.initialState === 'function'
      ? (config.initialState as () => S)()
      : config.initialState;

  const actions = {} as ActionCreatorsFromReducers<S, R>;
  const handlers: Record<string, CaseReducer<S, any>> = {};

  for (const key of Object.keys(config.reducers) as Array<keyof R & string>) {
    const type = `${config.name}/${key}`;
    const reducer = config.reducers[key];
    handlers[type] = reducer;
    const creator = ((payload: unknown) => ({
      type,
      payload,
    })) as ActionCreator<unknown>;
    creator.type = type;
    (actions as Record<string, ActionCreator<unknown>>)[key] = creator;
  }

  function reducer(state: S | undefined, action: AnyAction): S {
    const current = state === undefined ? initialState : state;
    const handler = handlers[action.type];
    if (!handler) return current;
    return produce(current, (draft) => {
      handler(draft as S, action);
    });
  }

  return { name: config.name, reducer, actions, caseReducers: config.reducers };
}
