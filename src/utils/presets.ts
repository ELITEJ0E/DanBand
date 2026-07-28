import { ChordMapping, Preset } from '../types';

export const DEFAULT_MAPPINGS: ChordMapping[] = [
  { gestureId: 'open_palm', chord: 'C' },
  { gestureId: 'four_fingers', chord: 'F' },
  { gestureId: 'three_fingers', chord: 'G' },
  { gestureId: 'peace', chord: 'Am' },
  { gestureId: 'pointing_index', chord: 'Dm' },
  { gestureId: 'fist', chord: 'Em' },
  { gestureId: 'thumbs_up', chord: 'D' },
  { gestureId: 'rock_on', chord: 'E' },
  { gestureId: 'sideways', chord: 'A' },
];

export const DEFAULT_PRESETS: Preset[] = [
  {
    id: 'standard',
    name: 'Standard Set (C, F, G, Am, Dm, Em, D, E, A)',
    mappings: DEFAULT_MAPPINGS,
  },
  {
    id: 'blues',
    name: 'Blues Set (A, D, E, F#m, Bm, C#m, G, C, F)',
    mappings: [
      { gestureId: 'open_palm', chord: 'A' },
      { gestureId: 'four_fingers', chord: 'D' },
      { gestureId: 'three_fingers', chord: 'E' },
      { gestureId: 'peace', chord: 'F#m' },
      { gestureId: 'pointing_index', chord: 'Bm' },
      { gestureId: 'fist', chord: 'C#m' },
      { gestureId: 'thumbs_up', chord: 'G' },
      { gestureId: 'rock_on', chord: 'C' },
      { gestureId: 'sideways', chord: 'F' },
    ],
  },
  {
    id: 'jazz',
    name: 'Jazz Set (Cmaj7, Dm7, G7, Em7, Am7, Fmaj7, D7, E7, A7)',
    mappings: [
      { gestureId: 'open_palm', chord: 'Cmaj7' },
      { gestureId: 'four_fingers', chord: 'Dm7' },
      { gestureId: 'three_fingers', chord: 'G7' },
      { gestureId: 'peace', chord: 'Em7' },
      { gestureId: 'pointing_index', chord: 'Am7' },
      { gestureId: 'fist', chord: 'Fmaj7' },
      { gestureId: 'thumbs_up', chord: 'D7' },
      { gestureId: 'rock_on', chord: 'E7' },
      { gestureId: 'sideways', chord: 'A7' },
    ],
  },
];

const PRESETS_KEY = 'banddan_presets';
const ACTIVE_PRESET_ID_KEY = 'banddan_active_preset_id';

export function loadPresets(): Preset[] {
  try {
    const data = localStorage.getItem(PRESETS_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load presets:', error);
  }
  return DEFAULT_PRESETS;
}

export function savePresets(presets: Preset[]): void {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  } catch (error) {
    console.error('Failed to save presets:', error);
  }
}

export function loadActivePresetId(): string {
  return localStorage.getItem(ACTIVE_PRESET_ID_KEY) || 'standard';
}

export function saveActivePresetId(id: string): void {
  localStorage.setItem(ACTIVE_PRESET_ID_KEY, id);
}
