// Reusable, clean Web Audio API synthesizer for playing band chords.

const CHORD_FREQS: Record<string, number[]> = {
  'C': [261.63, 329.63, 392.00],       // C4, E4, G4
  'Am': [220.00, 261.63, 329.63],      // A3, C4, E4
  'G': [196.00, 246.94, 293.66],       // G3, B3, D4
  'F': [174.61, 220.00, 261.63],       // F3, A3, C4
  'D': [293.66, 369.99, 440.00],       // D4, F#4, A4
  'E': [164.81, 207.65, 246.94],       // E3, G#3, B3
  'A': [220.00, 277.18, 329.63],       // A3, C#4, E4
  'Dm': [293.66, 349.23, 440.00],      // D4, F4, A4
  'Em': [164.81, 196.00, 246.94],      // E3, G3, B3
  'F#m': [185.00, 220.00, 277.18],     // F#3, A3, C#4
  'Bm': [246.94, 293.66, 369.99],      // B3, D4, F#4
  'C#m': [277.18, 329.63, 415.30],     // C#4, E4, G#4
  'Cmaj7': [261.63, 329.63, 392.00, 493.88], // C4, E4, G4, B4
  'Am7': [220.00, 261.63, 329.63, 392.00],   // A3, C4, E4, G4
  'G7': [196.00, 246.94, 293.66, 349.23],    // G3, B3, D4, F4
  'Fmaj7': [174.61, 220.00, 261.63, 329.63], // F3, A3, C4, E4
  'Dm7': [293.66, 349.23, 440.00, 523.25],   // D4, F4, A4, C5
  'Em7': [164.81, 196.00, 246.94, 293.66],   // E3, G3, B3, D4
  'D7': [293.66, 369.99, 440.00, 587.33],    // D4, F#4, A4, C5
  'E7': [164.81, 207.65, 246.94, 329.63],    // E3, G#3, B3, D4
  'A7': [220.00, 277.18, 329.63, 392.00],    // A3, C#4, E4, G4
};

// Chromatic scale for note transposition
export const CHROMATIC_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// MIDI bases for roots
const KEY_ROOTS: Record<string, number> = {
  'C': 60, 'C#': 61, 'D': 62, 'D#': 63, 'E': 52, 'F': 53, 'F#': 54, 'G': 55, 'G#': 56, 'A': 57, 'A#': 58, 'B': 59
};

const MAJOR_SCALE_OFFSETS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE_OFFSETS = [0, 2, 3, 5, 7, 8, 10];

const DIATONIC_CHORDS_C_MAJOR = [
  { rootOffset: 0, base: "C", suffix: "", sevSuffix: "maj7" },
  { rootOffset: 2, base: "D", suffix: "m", sevSuffix: "m7" },
  { rootOffset: 4, base: "E", suffix: "m", sevSuffix: "m7" },
  { rootOffset: 5, base: "F", suffix: "", sevSuffix: "maj7" },
  { rootOffset: 7, base: "G", suffix: "", sevSuffix: "7" },
  { rootOffset: 9, base: "A", suffix: "m", sevSuffix: "m7" },
  { rootOffset: 11, base: "B", suffix: "dim", sevSuffix: "m7b5" }
];

const DIATONIC_CHORDS_C_MINOR = [
  { rootOffset: 0, base: "C", suffix: "m", sevSuffix: "m7" },
  { rootOffset: 2, base: "D", suffix: "dim", sevSuffix: "m7b5" },
  { rootOffset: 3, base: "Eb", suffix: "", sevSuffix: "maj7" },
  { rootOffset: 5, base: "F", suffix: "m", sevSuffix: "m7" },
  { rootOffset: 7, base: "G", suffix: "m", sevSuffix: "m7" },
  { rootOffset: 8, base: "Ab", suffix: "", sevSuffix: "maj7" },
  { rootOffset: 10, base: "Bb", suffix: "", sevSuffix: "7" }
];

let audioCtx: AudioContext | null = null;
let activeNodes: { oscillators: OscillatorNode[]; gainNode: GainNode; filterNode?: BiquadFilterNode }[] = [];

/**
 * Translates left hand parameters (Key, Major/Minor mode, scale degree 1-7)
 * and right hand 7th chord configuration into a standard chord name.
 */
export function getDiatonicChordName(
  keyName: string,
  mode: 'major' | 'minor',
  degreeNum: number, // 1 to 7
  seventhType: 'none' | 'maj7' | 'dom7'
): string {
  if (degreeNum < 1 || degreeNum > 7) return '—';
  const degreeIdx = degreeNum - 1;
  const list = mode === 'major' ? DIATONIC_CHORDS_C_MAJOR : DIATONIC_CHORDS_C_MINOR;
  const spec = list[degreeIdx];

  const keyIndex = CHROMATIC_NOTES.indexOf(keyName);
  const baseIndex = CHROMATIC_NOTES.indexOf("C");
  const transposedIndex = (keyIndex - baseIndex + spec.rootOffset + 12) % 12;
  const rootNote = CHROMATIC_NOTES[transposedIndex];

  if (seventhType === 'none') {
    return rootNote + spec.suffix;
  } else {
    // If major/minor 7th or dominant 7th is requested
    return rootNote + spec.sevSuffix;
  }
}

/**
 * Converts a MIDI note value to frequency (Hz)
 */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Standard chord sound player from hardcoded frequencies
 */
export function playChordSound(chordName: string) {
  // Clean up chord name
  const cleanName = chordName.trim();
  const freqs = CHORD_FREQS[cleanName];
  if (!freqs) return;

  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const now = audioCtx.currentTime;

    // Smoothly stop any currently playing chord to avoid abrupt clipping/popping
    activeNodes.forEach(({ oscillators, gainNode }) => {
      try {
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        setTimeout(() => {
          oscillators.forEach(osc => {
            try { osc.stop(); } catch (e) {}
          });
        }, 160);
      } catch (e) {}
    });
    activeNodes = [];

    const oscillators: OscillatorNode[] = [];

    // Master volume node for the current chord
    const chordGainNode = audioCtx.createGain();
    chordGainNode.gain.setValueAtTime(0, now);
    chordGainNode.gain.linearRampToValueAtTime(0.12, now + 0.04);
    chordGainNode.gain.exponentialRampToValueAtTime(0.03, now + 1.2);

    chordGainNode.connect(audioCtx.destination);

    freqs.forEach((freq) => {
      const osc = audioCtx!.createOscillator();
      const nodeGain = audioCtx!.createGain();
      
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      osc.detune.setValueAtTime((Math.random() - 0.5) * 8, now);

      osc.connect(nodeGain);
      nodeGain.connect(chordGainNode);
      osc.start(now);
      oscillators.push(osc);
    });

    activeNodes.push({ oscillators, gainNode: chordGainNode });

    const endOffset = 1.8;
    const fadeOutTime = now + endOffset;
    chordGainNode.gain.setValueAtTime(0.03, fadeOutTime - 0.3);
    chordGainNode.gain.exponentialRampToValueAtTime(0.001, fadeOutTime);
    
    setTimeout(() => {
      oscillators.forEach(osc => {
        try { osc.stop(); } catch (e) {}
      });
    }, (endOffset + 0.1) * 1000);

  } catch (error) {
    console.error('Failed to play chord sound:', error);
  }
}

/**
 * Advanced real-time parameterized synthesizer that models physical hand control
 */
export function playDynamicSynthChord(
  keyName: string,
  mode: 'major' | 'minor',
  degreeNum: number,
  options: {
    inversion: number;     // 0: Root position, 1: 1st Inversion
    seventhType: 'none' | 'maj7' | 'dom7';
    octaveOffset: number;  // -1 (standard/low) or 0 (high)
    filterCutoff: number;  // Lowpass frequency
    volume: number;        // Dynamic amplitude
  }
) {
  if (degreeNum < 1 || degreeNum > 7) return;
  const degreeIdx = degreeNum - 1;

  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const now = audioCtx.currentTime;

    // Fade out previous active nodes smoothly
    activeNodes.forEach(({ oscillators, gainNode }) => {
      try {
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        setTimeout(() => {
          oscillators.forEach(osc => {
            try { osc.stop(); } catch (e) {}
          });
        }, 130);
      } catch (e) {}
    });
    activeNodes = [];

    // Base MIDI pitch for Key Root
    const baseMidi = KEY_ROOTS[keyName] || 60;
    const scaleOffsets = mode === 'major' ? MAJOR_SCALE_OFFSETS : MINOR_SCALE_OFFSETS;

    // Helper to calculate scale degree pitches
    const getScaleOffset = (k: number) => {
      const octave = Math.floor(k / 7);
      const idx = k % 7;
      return scaleOffsets[idx] + octave * 12;
    };

    // Calculate chord intervals
    const rootInterval = getScaleOffset(degreeIdx);
    const thirdInterval = getScaleOffset(degreeIdx + 2);
    const fifthInterval = getScaleOffset(degreeIdx + 4);
    
    // Core triad midi values
    let chordMidi = [
      baseMidi + rootInterval,
      baseMidi + thirdInterval,
      baseMidi + fifthInterval
    ];

    // Optional 7th degree note
    if (options.seventhType !== 'none') {
      const seventhInterval = getScaleOffset(degreeIdx + 6);
      chordMidi.push(baseMidi + seventhInterval);
    }

    // Apply octave shift
    // Default octave is lower, thumb in shifts up +12
    const baseOctaveShift = options.octaveOffset === 0 ? 0 : -12;
    chordMidi = chordMidi.map(pitch => pitch + baseOctaveShift);

    // Apply inversion if selected
    if (options.inversion === 1 && chordMidi.length >= 3) {
      // 1st Inversion: transpose the lowest note (index 0) up one octave (+12 semitones)
      const rootNote = chordMidi[0] + 12;
      chordMidi = [...chordMidi.slice(1), rootNote];
    }

    // Convert MIDI pitch to frequencies
    const frequencies = chordMidi.map(pitch => midiToFreq(pitch));

    // Create custom nodes
    const oscillators: OscillatorNode[] = [];
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(options.filterCutoff, now);
    filter.Q.setValueAtTime(1.5, now); // resonance boost for synthesizer character

    const masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(0, now);
    // Snappy fade in
    masterGain.gain.linearRampToValueAtTime(options.volume, now + 0.05);
    // Slow pleasing decay
    masterGain.gain.exponentialRampToValueAtTime(options.volume * 0.4, now + 1.2);

    // Connect node graph
    filter.connect(masterGain);
    masterGain.connect(audioCtx.destination);

    frequencies.forEach((freq, idx) => {
      const osc = audioCtx!.createOscillator();
      const nodeGain = audioCtx!.createGain();

      // Mix Sawtooth and Square for a warm rich cinematic synth pad!
      osc.type = idx % 2 === 0 ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      
      // Fine detuning for lush chorus effect
      osc.detune.setValueAtTime((Math.random() - 0.5) * 15, now);

      // Low bass volume helper to keep it clean
      const oscVolume = osc.type === 'sawtooth' ? 0.07 : 0.12;
      nodeGain.gain.setValueAtTime(oscVolume, now);

      osc.connect(nodeGain);
      nodeGain.connect(filter);
      osc.start(now);
      oscillators.push(osc);
    });

    activeNodes.push({ oscillators, gainNode: masterGain, filterNode: filter });

    // Schedule final complete fade-out after 2 seconds
    const endOffset = 2.0;
    const fadeOutTime = now + endOffset;
    masterGain.gain.setValueAtTime(options.volume * 0.4, fadeOutTime - 0.3);
    masterGain.gain.exponentialRampToValueAtTime(0.001, fadeOutTime);
    
    setTimeout(() => {
      oscillators.forEach(osc => {
        try { osc.stop(); } catch (e) {}
      });
    }, (endOffset + 0.1) * 1000);

  } catch (error) {
    console.error('Failed to play dynamic synth chord:', error);
  }
}

