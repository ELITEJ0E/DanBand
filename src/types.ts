export type GestureType = 'fist' | 'open_palm' | 'pointing_index' | 'peace' | 'three_fingers' | 'four_fingers' | 'thumbs_up' | 'rock_on' | 'sideways' | 'none';

export interface GestureInfo {
  id: GestureType;
  name: string;
  description: string;
  emoji: string;
}

export const GESTURES: GestureInfo[] = [
  { id: 'open_palm', name: 'Open Palm (5)', description: '5 fingers extended', emoji: '🖐️' },
  { id: 'four_fingers', name: 'Four Fingers (4)', description: '4 fingers extended (no thumb)', emoji: '✋' },
  { id: 'three_fingers', name: 'Three Fingers (3)', description: 'Index, middle, ring extended', emoji: '🤟' },
  { id: 'peace', name: 'Peace Sign (2)', description: 'Index and middle fingers extended', emoji: '✌️' },
  { id: 'pointing_index', name: 'Pointing Index (1)', description: 'Only index finger extended', emoji: '☝️' },
  { id: 'fist', name: 'Fist (0)', description: 'All fingers folded', emoji: '✊' },
  { id: 'thumbs_up', name: 'Thumbs Up', description: 'Only thumb extended, pointing up', emoji: '👍' },
  { id: 'rock_on', name: 'Rock On', description: 'Index and pinky extended', emoji: '🤘' },
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
