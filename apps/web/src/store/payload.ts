/**
 * PayloadAction type retained for typed mutator signatures (no action bus).
 */
export type PayloadAction<P = void, T extends string = string> = {
  type?: T;
  payload: P;
};
