/**
 * App store — Zustand runtime (no react-redux Provider).
 * Slice logic uses local createSlice + immer (`store/createSlice.ts`); dispatch stays action-based.
 *
 * Write style:
 * - React subscriptions to editor fields go through `editorSelectors.ts` (no inline `s.editor…`).
 * - Playhead/playing: `animationTransport` + events — not whole-store fan-out.
 * - Scene DOM sync: `sceneEvents` / playhead/puppet apply events (mount-once listeners).
 */
import { create } from 'zustand';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import type { AnyAction } from '@/store/createSlice';
import authReducer from './modules/auth';
import editorReducer from './modules/editor';

const authInitial = authReducer(undefined, { type: '@@zustand/INIT' });
const editorInitial = editorReducer(undefined, { type: '@@zustand/INIT' });

export type RootState = {
  auth: ReturnType<typeof authReducer>;
  editor: ReturnType<typeof editorReducer>;
};

export type AppDispatch = (action: AnyAction) => AnyAction;

type AppStoreState = RootState & {
  dispatch: AppDispatch;
};

function reduceApp(state: RootState, action: AnyAction): RootState {
  const nextAuth = authReducer(state.auth, action);
  const nextEditor = editorReducer(state.editor, action);
  if (nextAuth === state.auth && nextEditor === state.editor) return state;
  return { auth: nextAuth, editor: nextEditor };
}

export const useAppStore = create<AppStoreState>((set, get) => ({
  auth: authInitial,
  editor: editorInitial,
  dispatch: (action: AnyAction) => {
    set((prev) => {
      const next = reduceApp(
        { auth: prev.auth, editor: prev.editor },
        action
      );
      if (next === prev || (next.auth === prev.auth && next.editor === prev.editor)) {
        return prev;
      }
      return { ...prev, auth: next.auth, editor: next.editor };
    });
    return action;
  },
}));

/** Vanilla store API (non-React). Same surface as former Redux `store`. */
export const store = {
  getState: (): RootState => {
    const s = useAppStore.getState();
    return { auth: s.auth, editor: s.editor };
  },
  dispatch: ((action: AnyAction) => useAppStore.getState().dispatch(action)) as AppDispatch,
  subscribe: (listener: () => void) => useAppStore.subscribe(() => listener()),
};

export default store;

export type { AnyAction, Dispatch, PayloadAction } from './createSlice';

/** Drop-in for `useDispatch` from react-redux. */
export function useDispatch(): AppDispatch {
  return useAppStore((s) => s.dispatch);
}

/** Drop-in for `useStore` from react-redux (getState/dispatch/subscribe). */
export function useStore() {
  return store;
}

/** Drop-in for `useSelector` from react-redux. */
export function useSelector<T>(
  selector: (state: RootState) => T,
  equalityFn?: (a: T, b: T) => boolean
): T {
  return useStoreWithEqualityFn(
    useAppStore,
    (s) => selector({ auth: s.auth, editor: s.editor }),
    equalityFn
  );
}
