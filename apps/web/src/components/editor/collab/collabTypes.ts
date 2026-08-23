export type CollabRole = 'edit' | 'view';

export type CollabStatus = 'idle' | 'connecting' | 'synced' | 'error';

export type CollabPeerCamera = {
  x: number;
  y: number;
  zoom: number;
};

export type CollabPeer = {
  clientId: number;
  userId: string;
  name: string;
  color: string;
  selectedNodeIds: string[];
  /** Artboard / frame selection (data-frame-id). */
  selectedFrameIds: string[];
  cursor: { x: number; y: number } | null;
  /** Remote viewport for peer follow. */
  camera: CollabPeerCamera | null;
};

export type CollabRoomToken = {
  token: string;
  roomId: string;
  wsUrl: string;
  role: CollabRole;
  expiresAt: number;
};
