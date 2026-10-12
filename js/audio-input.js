/**
 * hear2play - Audio Input / Pitch Detection
 * Microphone pitch detection using autocorrelation
 */

import { audioContext, ensureAudioContextRunning } from './audio-context.js';

/**
 * Audio Input Class for pitch detection
 */
export class AudioInput {
    constructor(options = {}) {
        this.onNoteOn = options.onNoteOn ?? (() => {});
        this.onNoteOff = options.onNoteOff ?? (() => {});
        this.onError = options.onError ?? (() => {});

        this.stream = null;
        this.analyser = null;
        this.dataArray = null;
        this.running = false;
        this.animationId = null;

        // Pitch detection parameters
        this.sampleRate = 44100;
        this.bufferSize = 2048;
        this.minFrequency = 65;   // C2
        this.maxFrequency = 1000; // C6
        this.confidenceThreshold = 0.6;

        // Smoothing / debouncing
        this.lastDetectedNote = null;
        this.noteStableCount = 0;
        this.minStableFrames = 2;

        // Note off detection
        this.silenceThreshold = 0.01;
        this.silenceFrames = 0;
        this.minSilenceFrames = 5;
    }

    /**
     * Start microphone input and pitch detection
     * @returns {Promise<boolean>} Success status
     */
    async start() {
        try {
            await ensureAudioContextRunning();

            this.stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });

            // Create audio graph: stream -> analyser -> destination (muted)
            const source = audioContext.createMediaStreamSource(this.stream);
            this.analyser = audioContext.createAnalyser();
            this.analyser.fftSize = this.bufferSize;
            this.analyser.smoothingTimeConstant = 0.3;

            // Connect but don't output to speakers (avoid feedback)
            source.connect(this.analyser);
            // analyser.connect(audioContext.destination); // Don't connect to output

            this.dataArray = new Float32Array(this.analyser.frequencyBinCount);
            this.running = true;

            this.detectPitch();
            return true;
        } catch (error) {
            console.error('Microphone access denied:', error);
            this.onError(error);
            return false;
        }
    }

    /**
     * Stop microphone input
     */
    stop() {
        this.running = false;

        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }

        this.analyser = null;
        this.dataArray = null;
        this.resetDetection();
    }

    /**
     * Reset detection state
     */
    resetDetection() {
        this.lastDetectedNote = null;
        this.noteStableCount = 0;
        this.silenceFrames = 0;
    }

    /**
     * Main pitch detection loop
     */
    detectPitch() {
        if (!this.running || !this.analyser || !this.dataArray) return;

        this.animationId = requestAnimationFrame(() => this.detectPitch());

        this.analyser.getFloatTimeDomainData(this.dataArray);

        // Check for silence first
        const rms = this.calculateRMS(this.dataArray);
        if (rms < this.silenceThreshold) {
            this.silenceFrames++;
            if (this.silenceFrames >= this.minSilenceFrames && this.lastDetectedNote !== null) {
                this.triggerNoteOff(this.lastDetectedNote);
                this.lastDetectedNote = null;
            }
            return;
        }

        this.silenceFrames = 0;

        // Autocorrelation pitch detection
        const frequency = this.autocorrelation(this.dataArray);
        if (!frequency) return;

        // Convert frequency to MIDI note
        const note = this.frequencyToNote(frequency);
        if (note === null) return;

        // Stabilize detection
        if (note === this.lastDetectedNote) {
            this.noteStableCount++;
        } else {
            this.noteStableCount = 0;
            this.lastDetectedNote = note;
        }

        // Trigger note on after stable frames
        if (this.noteStableCount === this.minStableFrames) {
            this.triggerNoteOn(note);
        }
    }

    /**
     * Calculate RMS amplitude
     */
    calculateRMS(buffer) {
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
            sum += buffer[i] * buffer[i];
        }
        return Math.sqrt(sum / buffer.length);
    }

    /**
     * Autocorrelation pitch detection
     * @param {Float32Array} buffer - Time domain data
     * @returns {number|null} Fundamental frequency in Hz
     */
    autocorrelation(buffer) {
        const len = buffer.length;
        let bestOffset = -1;
        let bestCorrelation = 0;

        // Search range based on min/max frequency
        const minOffset = Math.floor(this.sampleRate / this.maxFrequency);
        const maxOffset = Math.min(Math.floor(this.sampleRate / this.minFrequency), len / 2);

        for (let offset = minOffset; offset <= maxOffset; offset++) {
            let correlation = 0;
            for (let i = 0; i < len - offset; i++) {
                correlation += buffer[i] * buffer[i + offset];
            }
            correlation /= (len - offset);

            if (correlation > bestCorrelation) {
                bestCorrelation = correlation;
                bestOffset = offset;
            }
        }

        if (bestCorrelation < this.confidenceThreshold || bestOffset === -1) {
            return null;
        }

        // Parabolic interpolation for better accuracy
        let freq = this.sampleRate / bestOffset;

        // Refine with parabolic interpolation
        if (bestOffset > 0 && bestOffset < len - 1) {
            const x1 = this.sampleRate / (bestOffset - 1);
            const x2 = this.sampleRate / bestOffset;
            const x3 = this.sampleRate / (bestOffset + 1);

            // Simple interpolation
            if (x1 > x2 && x3 > x2) {
                freq = x2 - (x3 - x1) / 8;
            }
        }

        return freq;
    }

    /**
     * Convert frequency to MIDI note number
     * @param {number} frequency - Frequency in Hz
     * @returns {number|null} MIDI note number (21-108) or null
     */
    frequencyToNote(frequency) {
        if (frequency < this.minFrequency || frequency > this.maxFrequency) {
            return null;
        }

        // MIDI note = 69 + 12 * log2(freq / 440)
        const note = Math.round(69 + 12 * Math.log2(frequency / 440));
        return Math.max(21, Math.min(108, note));
    }

    /**
     * Trigger note on callback
     */
    triggerNoteOn(note) {
        this.onNoteOn(note, 100); // velocity 100 for audio input
    }

    /**
     * Trigger note off callback
     */
    triggerNoteOff(note) {
        this.onNoteOff(note);
    }

    /**
     * Check if running
     */
    isRunning() {
        return this.running;
    }
}