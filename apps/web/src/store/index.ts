/**
 * Redux store root.
 *
 * Layout (keep thin):
 * - `index.ts` — configureStore only
 * - `modules/` — Redux slices that are truly cross-tree shared state
 *
 * Do NOT put localStorage helpers, scene/SVG math, or pure formatters here.
 * Those live under `@/utils/*` or `@/components/*` (feature-colocated).
 *
 * Prefer component/local state unless many distant trees must share the same
 * live value (auth session, editor document/selection). Wallet lives in Query.
 */
import { configureStore } from '@reduxjs/toolkit';
import authReducer from './modules/auth';
import editorReducer from './modules/editor';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    editor: editorReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export default store;
