/**
 * User AI asset types.
 */

export type AssetKind = "image" | "video" | "audio" | "font" | "lottie";

export type UserAsset = {
  id: string;
  kind: AssetKind;
  url: string;
  objectKey?: string | null;
  mime?: string | null;
  width?: number | null;
  height?: number | null;
  source?: string | null;
  prompt?: string | null;
  meta?: Record<string, unknown> | null;
  /** Bodymovin JSON for lottie — list API inlines this; do not refetch .json url. */
  animationData?: Record<string, unknown> | null;
  createdAt?: number | null;
};
