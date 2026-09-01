/**
 * Typed mutator argument shape (no action bus — Zustand writes).
 */
export type PayloadAction<P = void, T extends string = string> = {
  type?: T;
  payload: P;
};
