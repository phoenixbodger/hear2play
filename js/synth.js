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
        this.activeNotes = new Map(); // note -> { oscillator, gain, gainNode }
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
        const gainValue = Math.max(0.01, velocity / 127);

        // Create oscillator with multiple partials for richer tone
        const oscillator = audioContext.createOscillator();
        oscillator.type = 'triangle'; // Base waveform

        // Create gain node for envelope
        const gainNode = audioContext.createGain();
        gainNode.gain.value = 0;

        // Connect: oscillator -> gainNode -> masterGain
        oscillator.connect(gainNode);
        gainNode.connect(this.masterGain);

        // ADSR Envelope
        const now = audioContext.currentTime;
        const attack = 0.01;      // 10ms
        const decay = 0.1;        // 100ms
        const sustain = 0.3;      // 30% of peak
        const release = 0.3;      // 300ms
        const peakGain = gainValue * 0.4; // Scale down to avoid clipping

        // Attack
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(peakGain, now + attack);

        // Decay
        gainNode.gain.linearRampToValueAtTime(peakGain * sustain, now + attack + decay);

        // Store for note-off
        this.activeNotes.set(note, { oscillator, gainNode, release, peakGain, sustainLevel: peakGain * sustain });

        oscillator.start(now);
    }

    /**
     * Stop a note (trigger release)
     * @param {number} note - MIDI note number
     */
    stop(note) {
        const noteData = this.activeNotes.get(note);
        if (!noteData) return;

        const { oscillator, gainNode, release, sustainLevel } = noteData;
        const now = audioContext.currentTime;

        // Cancel any scheduled changes
        gainNode.gain.cancelScheduledValues(now);

        // Release from current level
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.linearRampToValueAtTime(0, now + release);

        // Stop oscillator after release
        oscillator.stop(now + release + 0.01);

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