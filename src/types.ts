export type GestureType = 'fist' | 'open_palm' | 'pointing_index' | 'peace' | 'thumbs_up' | 'sideways' | 'none';

export interface GestureInfo {
  id: GestureType;
  name: string;
  description: string;
  emoji: string;
}

export const GESTURES: GestureInfo[] = [
  { id: 'open_palm', name: 'Open Palm', description: 'All fingers extended', emoji: '🖐️' },
  { id: 'fist', name: 'Fist', description: 'All fingers folded', emoji: '✊' },
  { id: 'pointing_index', name: 'Pointing Index', description: 'Only index finger extended', emoji: '☝️' },
  { id: 'peace', name: 'Peace Sign', description: 'Index and middle fingers extended', emoji: '✌️' },
  { id: 'thumbs_up', name: 'Thumbs Up', description: 'Only thumb extended, pointing up', emoji: '👍' },
  { id: 'sideways', name: 'Flat Hand Sideways', description: 'All fingers extended, hand horizontal', emoji: '🫱' },
];

export interface ChordMapping {
  gestureId: GestureType;
  chord: string; // e.g. "C", "Am", "G"
}

export interface Preset {
  id: string;
  name: string;
  mappings: ChordMapping[];
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'failed';

export interface ListenerConnection {
  id: string; // unique ID generated during pairing
  name: string; // display name entered by listener
  status: ConnectionStatus;
  peerConnection: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
  createdAt: number;
}

export interface ChordMessage {
  type: 'chord';
  value: string;
  ts: number;
}

export interface PingMessage {
  type: 'ping';
  ts: number;
}

export interface IdentifyMessage {
  type: 'identify';
  name: string;
}

export type WebRTCMessage = ChordMessage | PingMessage | IdentifyMessage;
