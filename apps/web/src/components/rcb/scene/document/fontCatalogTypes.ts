/** Shared font catalog types (FontFamily / FontChild). */

export type FontFaceFormat = 'woff2' | 'woff' | 'truetype' | 'opentype';

export type FontChild = {
  family: string;
  displayName: string;
  /** Optional file URL — registered as its own @font-face family when set. */
  url?: string;
  format?: FontFaceFormat;
  /** CSS fontWeight when several children share one family name. */
  weight?: number;
};

export type FontFamilyNode = {
  family: string;
  displayName: string;
  url?: string;
  format?: FontFaceFormat;
  children: FontChild[];
  /** True when the current user uploaded this family. */
  isMine?: boolean;
  ownerUserId?: string | null;
};

export type FontWeightOption = {
  value: string;
  label: string;
  weight?: number;
};
