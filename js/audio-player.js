/**
 * hear2play — Audio Player
 * File loading, playback, speed control, A-B looping, waveform visualization
 */

import { audioContext, ensureAudioContextRunning } from './audio-context.js';
import { timeStretch } from './wsola.js';

/**
 * Audio Player Class
 */
export class AudioPlayer {
    constructor(options = {}) {
        this.onTimeUpdate = options.onTimeUpdate ?? (() => {});
        this.onEnded = options.onEnded ?? (() => {});
        this.onLoaded = options.onLoaded ?? (() => {});
        this.onError = options.onError ?? (() => {});
        this.onLoopChange = options.onLoopChange ?? (() => {});

        this.audioBuffer = null;
        this.sourceNode = null;
        this.gainNode = audioContext.createGain();
        this.gainNode.connect(audioContext.destination);

        this.playbackRate = 1.0;
        this.volume = 1.0;
        this.isPlaying = false;
        this.currentTime = 0;
        this.duration = 0;

        // Time-stretched buffer cache (for pitch-preserving speed control)
        this.timeStretchedBuffer = null;
        this.stretchRatio = 1.0; // 1.0 = normal, 2.0 = half speed, etc.
        this.isStretching = false;
        this.stretchBufferCache = new Map(); // stretchRatio -> AudioBuffer

        // A-B Loop
        this.loopStart = null;
        this.loopEnd = null;
        this.loopEnabled = false;

        // Waveform
        this.waveformCanvas = null;
        this.waveformData = null;

        // Animation frame for time updates
        this.timeUpdateId = null;
        this.startTime = 0;
        this.pauseTime = 0;
    }

    /**
     * Load audio file
     * @param {File} file - Audio file
     * @returns {Promise<boolean>} Success status
     */
    async loadFile(file) {
        try {
            await ensureAudioContextRunning();

            const arrayBuffer = await file.arrayBuffer();
            this.audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            this.duration = this.audioBuffer.duration;
            this.currentTime = 0;
            this.pauseTime = 0;
            // Clear time-stretched cache when new file loads
            this.timeStretchedBuffer = null;
            this.stretchRatio = 1.0;
            this.stretchBufferCache.clear();
            this.generateWaveform();

            this.onLoaded(this.duration);
            return true;
        } catch (error) {
            console.error('Failed to load audio:', error);
            this.onError(error);
            return false;
        }
    }

    /**
     * Generate waveform data for visualization
     */
    generateWaveform() {
        if (!this.audioBuffer) return;

        const channelData = this.audioBuffer.getChannelData(0);
        const samples = channelData.length;
        const blockSize = Math.ceil(samples / 2000);
        const filteredData = [];

        for (let i = 0; i < samples; i += blockSize) {
            let max = 0;
            for (let j = 0; j < blockSize && i + j < samples; j++) {
                max = Math.max(max, Math.abs(channelData[i + j]));
            }
            filteredData.push(max);
        }

        this.waveformData = filteredData;
        this.drawWaveform();
    }

    /**
     * Draw waveform on canvas
     */
    drawWaveform() {
        if (!this.waveformCanvas || !this.waveformData) return;

        const ctx = this.waveformCanvas.getContext('2d');
        const width = this.waveformCanvas.width;
        const height = this.waveformCanvas.height;
        const centerY = height / 2;

        ctx.clearRect(0, 0, width, height);

        // Draw waveform
        ctx.strokeStyle = 'rgba(78, 205, 196, 0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();

        const step = width / this.waveformData.length;
        for (let i = 0; i < this.waveformData.length; i++) {
            const x = i * step;
            const amplitude = this.waveformData[i] * centerY * 0.9;
            ctx.moveTo(x, centerY - amplitude);
            ctx.lineTo(x, centerY + amplitude);
        }
        ctx.stroke();

        // Draw loop region if set
        if (this.loopEnabled && this.loopStart !== null && this.loopEnd !== null) {
            const startX = (this.loopStart / this.duration) * width;
            const endX = (this.loopEnd / this.duration) * width;
            ctx.fillStyle = 'rgba(78, 205, 196, 0.15)';
            ctx.fillRect(startX, 0, endX - startX, height);
            ctx.strokeStyle = '#4ecdc4';
            ctx.strokeRect(startX, 0, endX - startX, height);
        }

        // Draw playhead
        const playheadX = (this.currentTime / this.duration) * width;
        ctx.strokeStyle = '#4ecdc4';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(playheadX, 0);
        ctx.lineTo(playheadX, height);
        ctx.stroke();
    }

    /**
     * Convert canvas X coordinate to time (seconds)
     * @param {number} x - X coordinate relative to canvas left edge
     * @returns {number} Time in seconds
     */
    getTimeFromX(x) {
        if (!this.waveformCanvas || this.duration <= 0) return 0;
        const width = this.waveformCanvas.width;
        const clampedX = Math.max(0, Math.min(width, x));
        return (clampedX / width) * this.duration;
    }

    /**
     * Convert time (seconds) to canvas X coordinate
     * @param {number} time - Time in seconds
     * @returns {number} X coordinate relative to canvas left edge
     */
    getXFromTime(time) {
        if (!this.waveformCanvas || this.duration <= 0) return 0;
        const width = this.waveformCanvas.width;
        const clampedTime = Math.max(0, Math.min(this.duration, time));
        return (clampedTime / this.duration) * width;
    }

    /**
     * Set waveform canvas element
     */
    setWaveformCanvas(canvas) {
        this.waveformCanvas = canvas;
        this.drawWaveform();
    }

    /**
     * Play audio
     */
    async play() {
        if (!this.audioBuffer) return;
        await ensureAudioContextRunning();

        if (this.isPlaying) return;

        this.stopSource();

        // Use time-stretched buffer if available (for pitch-preserving speed)
        // Otherwise fall back to original buffer with playbackRate
        const bufferToUse = this.timeStretchedBuffer || this.audioBuffer;
        const useNativeRate = !this.timeStretchedBuffer;

        this.sourceNode = audioContext.createBufferSource();
        this.sourceNode.buffer = bufferToUse;
        // Use native playbackRate only if we don't have a stretched buffer
        // (WSOLA stretched audio plays at 1.0 rate)
        this.sourceNode.playbackRate.value = useNativeRate ? this.playbackRate : 1.0;
        this.sourceNode.connect(this.gainNode);

        this.sourceNode.onended = () => {
            if (!this.loopEnabled) {
                this.isPlaying = false;
                this.onEnded();
            }
        };

        // Convert pauseTime (original time) to buffer time (stretched time if needed)
        const offset = useNativeRate ? this.pauseTime : this.pauseTime * this.stretchRatio;
        // startTime = wall-clock time playback begins; content offset is pauseTime
        this.startTime = audioContext.currentTime;
        this.sourceNode.start(0, offset);
        this.isPlaying = true;
        this.startTimeUpdates();
    }

    /**
     * Pause audio
     */
    pause() {
        if (!this.isPlaying) return;

        // Content advances by playbackRate per wall-clock second in both modes
        this.pauseTime = this.pauseTime + (audioContext.currentTime - this.startTime) * this.playbackRate;

        this.stopSource();
        this.isPlaying = false;
        this.stopTimeUpdates();
    }

    /**
     * Stop audio and reset.
     * Resets the play cursor to the loop start (Point A) if a loop selection
     * is active, otherwise resets to the very beginning (0).
     */
    stop() {
        this.stopSource();
        const resetTime = (this.loopStart !== null) ? this.loopStart : 0;
        this.pauseTime = resetTime;
        this.currentTime = resetTime;
        this.isPlaying = false;
        this.stopTimeUpdates();
        this.onTimeUpdate(resetTime, this.duration);
        this.drawWaveform();
    }

    /**
     * Stop and cleanup source node
     */
    stopSource() {
        if (this.sourceNode) {
            try {
                this.sourceNode.onended = null;
                this.sourceNode.stop();
                this.sourceNode.disconnect();
            } catch (e) {
                // Ignore errors
            }
            this.sourceNode = null;
        }
    }

    /**
     * Serialize stretch operations so only one runs at a time.
     */
    queueStretch(task) {
        const next = this._stretchChain ? this._stretchChain.then(task) : task();
        this._stretchChain = next.catch(() => {});
        return next;
    }

    /**
     * Set playback rate with pitch preservation using WSOLA time-stretching
     * @param {number} rate - Playback rate (0.25 - 1.0 for slowdown, >1.0 for speedup)
     * @returns {Promise<void>} Resolves when stretching is complete
     */
    async setPlaybackRate(rate) {
        if (!this.audioBuffer) return;
        return this.queueStretch(() => this._doSetPlaybackRate(rate));
    }

    /**
     * Apply the requested playback rate (serialized via queueStretch).
     */
    async _doSetPlaybackRate(rate) {
        // Clamp rate to valid range
        const clampedRate = Math.max(0.25, Math.min(4.0, rate));

        // If rate hasn't changed significantly, do nothing
        if (Math.abs(clampedRate - this.playbackRate) < 0.001) {
            return;
        }

        // Capture current playing state BEFORE changing anything (pause needs
        // the OLD playbackRate to compute the correct content position)
        const wasPlaying = this.isPlaying;
        const currentPlaybackTime = this.currentTime;

        if (wasPlaying) {
            this.pause();
        }

        // Stretch ratio is inverse of playback rate
        // rate 0.5 = half speed = stretch ratio 2.0
        // rate 2.0 = double speed = stretch ratio 0.5
        this.playbackRate = clampedRate;
        const newStretchRatio = 1.0 / clampedRate;

        // If stretch ratio hasn't changed significantly, do nothing (but keep
        // the new rate so playback continues at it)
        this.stretchRatio = newStretchRatio;

        // Check cache first
        let stretchedBuffer = this.stretchBufferCache.get(this.stretchRatio);

        if (!stretchedBuffer) {
            // Show stretching indicator
            this.isStretching = true;
            this.onStretchingStart?.();

            try {
                // Stretch the original audio buffer
                stretchedBuffer = await timeStretch(this.audioBuffer, this.stretchRatio);
                // Cache for future use
                this.stretchBufferCache.set(this.stretchRatio, stretchedBuffer);
            } catch (error) {
                console.error('WSOLA time-stretch failed:', error);
                // Fallback to original buffer
                stretchedBuffer = null;
            } finally {
                this.isStretching = false;
                this.onStretchingEnd?.();
            }
        }
        
        this.timeStretchedBuffer = stretchedBuffer;
        
        if (wasPlaying) {
            // Resume from current position (adjusted for new stretch ratio)
            this.pauseTime = currentPlaybackTime;
            await this.play();
        }
    }

    /**
     * Clear time-stretching and reset playback to normal speed (1.0x).
     * Only called when no time-stretched buffer is in use.
     * @returns {Promise<void>}
     */
    async clearPlaybackRate() {
        if (!this.audioBuffer) return;
        
        const wasAtNormal = Math.abs(this.stretchRatio - 1.0) < 0.001;
        if (wasAtNormal && !this.timeStretchedBuffer) {
            return; // already normal
        }
        
        const wasPlaying = this.isPlaying;
        const currentPlaybackTime = this.currentTime;
        
        if (wasPlaying) {
            this.pause();
        }
        
        this.stretchRatio = 1.0;
        this.playbackRate = 1.0;
        this.timeStretchedBuffer = null;
        
        if (wasPlaying) {
            this.pauseTime = currentPlaybackTime;
            await this.play();
        }
    }

    /**
     * Callbacks for stretching progress (optional, for UI)
     */
    onStretchingStart() {}
    onStretchingEnd() {}

    /**
     * Start time update loop
     */
    startTimeUpdates() {
        this.stopTimeUpdates();
        this.tick();
    }

    /**
     * Stop time update loop
     */
    stopTimeUpdates() {
        if (this.timeUpdateId) {
            cancelAnimationFrame(this.timeUpdateId);
            this.timeUpdateId = null;
        }
    }

    /**
     * Time update tick
     */
    tick() {
        if (!this.isPlaying) return;

        // Content advances by playbackRate per wall-clock second in both modes.
        // This keeps the playhead on the original waveform regardless of mode.
        this.currentTime = this.pauseTime + (audioContext.currentTime - this.startTime) * this.playbackRate;

        // Handle A-B looping
        if (this.loopEnabled && this.loopEnd !== null && this.currentTime >= this.loopEnd) {
            this.currentTime = this.loopStart;
            this.pauseTime = this.loopStart;
            this.startTime = audioContext.currentTime;
            // Convert loopStart to buffer time for the new source
            const loopStartBufferTime = this.timeStretchedBuffer ? this.loopStart * this.stretchRatio : this.loopStart;
            this.sourceNode.stop();
            this.sourceNode.disconnect();

            // Use time-stretched buffer if available
            const bufferToUse = this.timeStretchedBuffer || this.audioBuffer;
            const useNativeRate = !this.timeStretchedBuffer;

            this.sourceNode = audioContext.createBufferSource();
            this.sourceNode.buffer = bufferToUse;
            this.sourceNode.playbackRate.value = useNativeRate ? this.playbackRate : 1.0;
            this.sourceNode.connect(this.gainNode);
            this.sourceNode.onended = () => {
                if (!this.loopEnabled) {
                    this.isPlaying = false;
                    this.onEnded();
                }
            };
            this.sourceNode.start(0, loopStartBufferTime);
        }

        this.onTimeUpdate(this.currentTime, this.duration);
        this.drawWaveform();

        this.timeUpdateId = requestAnimationFrame(() => this.tick());
    }

    /**
     * Set volume (0 - 1)
     */
    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
        this.gainNode.gain.value = this.volume;
    }

    /**
     * Seek to time (in original timeline)
     */
    seek(time) {
        const clampedTime = Math.max(0, Math.min(this.duration, time));
        const wasPlaying = this.isPlaying;

        // Convert to buffer time (stretched time if using stretched buffer)
        const bufferTime = this.timeStretchedBuffer ? clampedTime * this.stretchRatio : clampedTime;
        const bufferToUse = this.timeStretchedBuffer || this.audioBuffer;
        const useNativeRate = !this.timeStretchedBuffer;

        if (wasPlaying) {
            this.stopSource();
            this.pauseTime = clampedTime;
            this.startTime = audioContext.currentTime;
            this.sourceNode = audioContext.createBufferSource();
            this.sourceNode.buffer = bufferToUse;
            this.sourceNode.playbackRate.value = useNativeRate ? this.playbackRate : 1.0;
            this.sourceNode.connect(this.gainNode);
            this.sourceNode.onended = () => {
                if (!this.loopEnabled) {
                    this.isPlaying = false;
                    this.onEnded();
                }
            };
            this.sourceNode.start(0, bufferTime);
        } else {
            this.pauseTime = clampedTime;
            this.currentTime = clampedTime;
            this.onTimeUpdate(this.currentTime, this.duration);
            this.drawWaveform();
        }
    }

    /**
     * Set loop start (A)
     */
    setLoopStart() {
        this.loopStart = this.currentTime;
        this.updateLoopState();
        this.notifyLoopChange();
    }

    /**
     * Set loop end (B)
     */
    setLoopEnd() {
        this.loopEnd = this.currentTime;
        this.updateLoopState();
        this.notifyLoopChange();
    }

    /**
     * Clear loop
     */
    clearLoop() {
        this.loopStart = null;
        this.loopEnd = null;
        this.loopEnabled = false;
        this.drawWaveform();
        this.notifyLoopChange();
    }

    /**
     * Update loop enabled state
     */
    updateLoopState() {
        if (this.loopStart !== null && this.loopEnd !== null) {
            if (this.loopStart > this.loopEnd) {
                [this.loopStart, this.loopEnd] = [this.loopEnd, this.loopStart];
            }
            if (this.loopEnd - this.loopStart > 0.1) {
                this.loopEnabled = true;
            }
        }
        this.drawWaveform();
    }

    /**
     * Notify loop change to UI
     */
    notifyLoopChange() {
        this.onLoopChange({
            loopEnabled: this.loopEnabled,
            loopStart: this.loopStart,
            loopEnd: this.loopEnd,
            duration: this.duration
        });
    }

    /**
     * Get current state
     */
    getState() {
        return {
            isPlaying: this.isPlaying,
            currentTime: this.currentTime,
            duration: this.duration,
            playbackRate: this.playbackRate,
            volume: this.volume,
            loopEnabled: this.loopEnabled,
            loopStart: this.loopStart,
            loopEnd: this.loopEnd
        };
    }

    /**
     * Check if a valid loop selection exists
     */
    hasValidSelection() {
        return this.loopEnabled &&
               this.loopStart !== null &&
               this.loopEnd !== null &&
               (this.loopEnd - this.loopStart) > 0.1;
    }

    /**
     * Export the selected loop region as a WAV file
     * @returns {Promise<Blob|null>} WAV blob or null if no valid selection
     */
    async exportSelection() {
        if (!this.hasValidSelection() || !this.audioBuffer) {
            return null;
        }

        try {
            const duration = this.loopEnd - this.loopStart;
            const sampleRate = this.audioBuffer.sampleRate;
            const outputLength = Math.ceil(duration * sampleRate);

            // Use OfflineAudioContext to render the selection
            const offlineContext = new OfflineAudioContext(
                this.audioBuffer.numberOfChannels,
                outputLength,
                sampleRate
            );

            // Create buffer source for the selection
            const source = offlineContext.createBufferSource();
            source.buffer = this.audioBuffer;
            source.connect(offlineContext.destination);

            // Start at loopStart, play for duration
            source.start(0, this.loopStart, duration);

            // Start rendering
            const renderedBuffer = await offlineContext.startRendering();

            // Encode to WAV
            const wavBlob = this.encodeWAV(renderedBuffer);

            return wavBlob;
        } catch (error) {
            console.error('Failed to export selection:', error);
            return null;
        }
    }

    /**
     * Encode AudioBuffer to WAV format
     * @param {AudioBuffer} audioBuffer - The audio buffer to encode
     * @returns {Blob} WAV blob
     */
    encodeWAV(audioBuffer) {
        const numChannels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const numSamples = audioBuffer.length; // samples per channel
        const sampleSize = 16; // 16-bit samples
        const bytesPerSample = sampleSize / 8; // 2 bytes

        const byteLength = numSamples * numChannels * bytesPerSample;
        const buffer = new ArrayBuffer(44 + byteLength);
        const view = new DataView(buffer);

        // WAV file header
        this.writeWAVHeader(view, byteLength, numChannels, sampleRate, sampleSize);

        const channelData = [];
        for (let i = 0; i < numChannels; i++) {
            channelData.push(audioBuffer.getChannelData(i));
        }

        // Interleave channels
        let offset = 44;
        for (let i = 0; i < numSamples; i++) {
            for (let channel = 0; channel < numChannels; channel++) {
                const sample = Math.max(-1, Math.min(1, channelData[channel][i]));
                view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
                offset += bytesPerSample;
            }
        }

        return new Blob([view], { type: 'audio/wav' });
    }

    /**
     * Write WAV header bytes
     * @param {DataView} view - DataView to write to
     * @param {number} byteLength - Length of audio data in bytes
     * @param {number} numChannels - Number of channels
     * @param {number} sampleRate - Sample rate
     * @param {number} sampleSize - Bits per sample
     */
    writeWAVHeader(view, byteLength, numChannels, sampleRate, sampleSize) {
        // RIFF identifier
        this.writeASCII(view, 0, 'RIFF');
        // File length minus first 8 bytes
        view.setUint32(4, 36 + byteLength, true);
        // RIFF type
        this.writeASCII(view, 8, 'WAVE');
        // Format chunk identifier
        this.writeASCII(view, 12, 'fmt ');
        // Format chunk length
        view.setUint32(16, 16, true);
        // Sample format (raw PCM)
        view.setUint16(20, 1, true);
        // Channel count
        view.setUint16(22, numChannels, true);
        // Sample rate
        view.setUint32(24, sampleRate, true);
        // Byte rate (sample rate * block align)
        view.setUint32(28, sampleRate * numChannels * sampleSize / 8, true);
        // Block align (channel count * sample size)
        view.setUint16(32, numChannels * sampleSize / 8, true);
        // Bits per sample
        view.setUint16(34, sampleSize, true);
        // Data chunk identifier
        this.writeASCII(view, 36, 'data');
        // Data chunk length
        view.setUint32(40, byteLength, true);
    }

    /**
     * Helper to write ASCII string to DataView
     * @param {DataView} view - DataView to write to
     * @param {number} offset - Offset in bytes
     * @param {string} str - String to write
     */
    writeASCII(view, offset, str) {
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    }

    /**
     * Cleanup
     */
    destroy() {
        this.stop();
        this.stopTimeUpdates();
    }
}