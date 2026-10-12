/**
 * hear2play — Audio Player
 * File loading, playback, speed control, A-B looping, waveform visualization
 */

import { audioContext, ensureAudioContextRunning } from './audio-context.js';

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

        this.sourceNode = audioContext.createBufferSource();
        this.sourceNode.buffer = this.audioBuffer;
        this.sourceNode.playbackRate.value = this.playbackRate;
        this.sourceNode.connect(this.gainNode);

        this.sourceNode.onended = () => {
            if (!this.loopEnabled) {
                this.isPlaying = false;
                this.onEnded();
            }
        };

        const offset = this.pauseTime;
        this.startTime = audioContext.currentTime - offset;
        this.sourceNode.start(0, offset);
        this.isPlaying = true;
        this.startTimeUpdates();
    }

    /**
     * Pause audio
     */
    pause() {
        if (!this.isPlaying) return;

        this.stopSource();
        this.pauseTime = audioContext.currentTime - this.startTime;
        this.isPlaying = false;
        this.stopTimeUpdates();
    }

    /**
     * Stop audio and reset
     */
    stop() {
        this.stopSource();
        this.pauseTime = 0;
        this.currentTime = 0;
        this.isPlaying = false;
        this.stopTimeUpdates();
        this.onTimeUpdate(0, this.duration);
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

        this.currentTime = audioContext.currentTime - this.startTime;

        // Handle A-B looping
        if (this.loopEnabled && this.loopEnd !== null && this.currentTime >= this.loopEnd) {
            this.currentTime = this.loopStart;
            this.startTime = audioContext.currentTime - this.loopStart;
            this.sourceNode.stop();
            this.sourceNode.disconnect();

            this.sourceNode = audioContext.createBufferSource();
            this.sourceNode.buffer = this.audioBuffer;
            this.sourceNode.playbackRate.value = this.playbackRate;
            this.sourceNode.connect(this.gainNode);
            this.sourceNode.onended = () => {
                if (!this.loopEnabled) {
                    this.isPlaying = false;
                    this.onEnded();
                }
            };
            this.sourceNode.start(0, this.loopStart);
        }

        this.onTimeUpdate(this.currentTime, this.duration);
        this.drawWaveform();

        this.timeUpdateId = requestAnimationFrame(() => this.tick());
    }

    /**
     * Set playback rate (0.25 - 1.0)
     */
    setPlaybackRate(rate) {
        this.playbackRate = Math.max(0.25, Math.min(1.0, rate));
        if (this.sourceNode) {
            this.sourceNode.playbackRate.value = this.playbackRate;
        }
    }

    /**
     * Set volume (0 - 1)
     */
    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
        this.gainNode.gain.value = this.volume;
    }

    /**
     * Seek to time
     */
    seek(time) {
        const clampedTime = Math.max(0, Math.min(this.duration, time));
        const wasPlaying = this.isPlaying;

        if (wasPlaying) {
            this.stopSource();
            this.pauseTime = clampedTime;
            this.startTime = audioContext.currentTime - clampedTime;
            this.sourceNode = audioContext.createBufferSource();
            this.sourceNode.buffer = this.audioBuffer;
            this.sourceNode.playbackRate.value = this.playbackRate;
            this.sourceNode.connect(this.gainNode);
            this.sourceNode.onended = () => {
                if (!this.loopEnabled) {
                    this.isPlaying = false;
                    this.onEnded();
                }
            };
            this.sourceNode.start(0, clampedTime);
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
     * Cleanup
     */
    destroy() {
        this.stop();
        this.stopTimeUpdates();
    }
}