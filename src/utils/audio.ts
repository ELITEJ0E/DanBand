// Reusable, clean Web Audio API synthesizer for playing band chords.

const CHORD_FREQS: Record<string, number[]> = {
  'C': [261.63, 329.63, 392.00],       // C4, E4, G4
  'Am': [220.00, 261.63, 329.63],      // A3, C4, E4
  'G': [196.00, 246.94, 293.66],       // G3, B3, D4
  'F': [174.61, 220.00, 261.63],       // F3, A3, C4
  'D': [293.66, 369.99, 440.00],       // D4, F#4, A4
  'E': [164.81, 207.65, 246.94],       // E3, G#3, B3
  'A': [220.00, 277.18, 329.63],       // A3, C#4, E4
  'F#m': [185.00, 220.00, 277.18],     // F#3, A3, C#4
  'Bm': [246.94, 293.66, 369.99],      // B3, D4, F#4
  'C#m': [277.18, 329.63, 415.30],     // C#4, E4, G#4
  'Cmaj7': [261.63, 329.63, 392.00, 493.88], // C4, E4, G4, B4
  'Am7': [220.00, 261.63, 329.63, 392.00],   // A3, C4, E4, G4
  'G7': [196.00, 246.94, 293.66, 349.23],    // G3, B3, D4, F4
  'Fmaj7': [174.61, 220.00, 261.63, 329.63], // F3, A3, C4, E4
  'Dm7': [293.66, 349.23, 440.00, 523.25],   // D4, F4, A4, C5
  'Em7': [164.81, 196.00, 246.94, 293.66],   // E3, G3, B3, D4
};

let audioCtx: AudioContext | null = null;
let activeNodes: { oscillators: OscillatorNode[]; gainNode: GainNode }[] = [];

export function playChordSound(chordName: string) {
  // Clean up chord name (remove whitespace or special character indicators if any)
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
      } catch (e) {
        // Safe catch
      }
    });
    activeNodes = [];

    const oscillators: OscillatorNode[] = [];

    // Master volume node for the current chord
    const chordGainNode = audioCtx.createGain();
    chordGainNode.gain.setValueAtTime(0, now);
    // Smooth fade-in to sound pleasant and organic
    chordGainNode.gain.linearRampToValueAtTime(0.12, now + 0.04);
    // Nice natural acoustic-like decay
    chordGainNode.gain.exponentialRampToValueAtTime(0.03, now + 1.2);

    chordGainNode.connect(audioCtx.destination);

    freqs.forEach((freq) => {
      const osc = audioCtx!.createOscillator();
      const nodeGain = audioCtx!.createGain();
      
      // Triangle wave has a warm, flute-like vintage electric keyboard sound
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      
      // Subtle micro-detuning (chorus effect) for a richer spatial acoustic feel
      osc.detune.setValueAtTime((Math.random() - 0.5) * 8, now);

      osc.connect(nodeGain);
      nodeGain.connect(chordGainNode);
      osc.start(now);
      oscillators.push(osc);
    });

    activeNodes.push({ oscillators, gainNode: chordGainNode });

    // Schedule final complete fade-out after 1.8 seconds
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
