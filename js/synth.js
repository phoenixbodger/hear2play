/**
 * hear2play — Piano Synthesizer
 * Web Audio API based polyphonic piano synth with ADSR envelope
 */

import { audioContext, masterGain, ensureAudioContextRunning } from './audio-context.js';

/**
 * MIDI note number to frequency
 * @param {number} note - MIDI note number (60 = C4)
 * @returns {number} Frequency in Hz
 */
export function noteToFrequency(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
}

/**
 * Note name from MIDI number
 * @param {number} note - MIDI note number
 * @returns {string} Note name (e.g., "C4", "C#4")
 */
export function noteToName(note) {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(note / 12) - 1;
    return names[note % 12] + octave;
}

/**
 * Check if note is a black key
 * @param {number} note - MIDI note number
 * @returns {boolean}
 */
export function isBlackKey(note) {
    const pitchClass = note % 12;
    return [1, 3, 6, 8, 10].includes(pitchClass); // C#, D#, F#, G#, A#
}

/**
 * Piano Synthesizer Class
 */
export class PianoSynth {
    constructor() {
        this.activeNotes = new Map(); // note -> { oscillators[], gains[], release }
        this.masterGain = masterGain;
    }

    /**
     * Play a note
     * @param {number} note - MIDI note number
     * @param {number} velocity - 0-127 (default 100)
     */
    play(note, velocity = 100) {
        ensureAudioContextRunning();

        // Stop existing note if playing
        this.stop(note);

        const freq = noteToFrequency(note);
        const now = audioContext.currentTime;
        const gainValue = Math.max(0.01, velocity / 127);

        // Piano-like harmonic partials: the fundamental is strongest and upper
        // harmonics are progressively weaker (a rough 1/n falloff). Together
        // they build a richer timbre than a single bare oscillator.
        const harmonics = [1.0, 0.55, 0.33, 0.2, 0.13, 0.09];
        // Scale so the summed partials stay comfortably below clipping.
        const peakBase = gainValue * 0.32;

        const oscillators = [];
        const gains = [];

        harmonics.forEach((amp, i) => {
            // One oscillator per harmonic, tuned to freq * (i + 1)
            const osc = audioContext.createOscillator();
            osc.type = 'triangle';
            // Apply the note's exact frequency so each key has the right pitch
            // (an unset oscillator defaults to 440 Hz and every note sounds alike).
            osc.frequency.value = freq * (i + 1);

            // Individual gain node so each partial decays at its own rate
            const gain = audioContext.createGain();
            gain.gain.value = 0;

            osc.connect(gain);
            gain.connect(this.masterGain);

            // Percussive hammer-like attack, then a natural exponential decay.
            // Higher harmonics decay faster, mimicking real piano strings.
            const peak = peakBase * amp;
            const decayTime = 1.7 / (i + 1); // fundamental ~1.7s, partials faster

            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(peak, now + 0.003);           // fast attack
            gain.gain.exponentialRampToValueAtTime(0.0001, now + decayTime); // natural tail

            osc.start(now);
            oscillators.push(osc);
            gains.push(gain);
        });

        // Track the note so it can be released early on key-up
        const data = { oscillators, gains, release: 0.25 };
        this.activeNotes.set(note, data);

        // Clean up oscillators after the natural decay reaches silence —
        // unless the note was already released earlier via stop().
        setTimeout(() => {
            if (this.activeNotes.get(note) === data) {
                this.stop(note);
            }
        }, 1900);
    }

    /**
     * Stop a note (trigger release)
     * @param {number} note - MIDI note number
     */
    stop(note) {
        const data = this.activeNotes.get(note);
        if (!data) return;

        const { oscillators, gains, release } = data;
        const now = audioContext.currentTime;

        // Ramp every partial down and stop its oscillator for a smooth release
        oscillators.forEach((osc, i) => {
            const gain = gains[i];
            gain.gain.cancelScheduledValues(now);
            gain.gain.setValueAtTime(gain.gain.value, now);
            gain.gain.linearRampToValueAtTime(0, now + release);
            osc.stop(now + release + 0.02);
        });

        this.activeNotes.delete(note);
    }

    /**
     * Stop all notes
     */
    stopAll() {
        for (const note of this.activeNotes.keys()) {
            this.stop(note);
        }
    }

    /**
     * Set master volume
     * @param {number} volume - 0-1
     */
    setVolume(volume) {
        this.masterGain.gain.value = Math.max(0, Math.min(1, volume));
    }
}

// Singleton instance
export const pianoSynth = new PianoSynth();