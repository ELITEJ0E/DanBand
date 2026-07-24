import { ChordMapping, Preset } from '../types';

export const DEFAULT_MAPPINGS: ChordMapping[] = [
  { gestureId: 'open_palm', chord: 'C' },
  { gestureId: 'fist', chord: 'Am' },
  { gestureId: 'pointing_index', chord: 'G' },
  { gestureId: 'peace', chord: 'F' },
  { gestureId: 'thumbs_up', chord: 'D' },
  { gestureId: 'sideways', chord: 'E' },
];

export const DEFAULT_PRESETS: Preset[] = [
  {
    id: 'standard',
    name: 'Standard Set (C, Am, G, F, D, E)',
    mappings: DEFAULT_MAPPINGS,
  },
  {
    id: 'blues',
    name: 'Blues Set (A, D, E, F#m, Bm, C#m)',
    mappings: [
      { gestureId: 'open_palm', chord: 'A' },
      { gestureId: 'fist', chord: 'F#m' },
      { gestureId: 'pointing_index', chord: 'D' },
      { gestureId: 'peace', chord: 'Bm' },
      { gestureId: 'thumbs_up', chord: 'E' },
      { gestureId: 'sideways', chord: 'C#m' },
    ],
  },
  {
    id: 'jazz',
    name: 'Jazz Set (Cmaj7, Dm7, G7, Em7, Am7, Fmaj7)',
    mappings: [
      { gestureId: 'open_palm', chord: 'Cmaj7' },
      { gestureId: 'fist', chord: 'Am7' },
      { gestureId: 'pointing_index', chord: 'G7' },
      { gestureId: 'peace', chord: 'Fmaj7' },
      { gestureId: 'thumbs_up', chord: 'Dm7' },
      { gestureId: 'sideways', chord: 'Em7' },
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
