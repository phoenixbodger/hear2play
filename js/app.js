/**
 * hear2play — Main Application
 * Coordinates all modules: audio player, piano keyboard, MIDI, audio input, transcription log
 */

import { AudioPlayer } from './audio-player.js';
import { PianoKeyboard } from './piano-keyboard.js';
import { TranscriptionLog } from './transcription-log.js';
import { MidiHandler } from './midi-handler.js';
import { AudioInput } from './audio-input.js';
import { pianoSynth } from './synth.js';
import { ensureAudioContextRunning } from './audio-context.js';

/**
 * Main App Class
 */
class Hear2PlayApp {
    constructor() {
        this.elements = {};
        this.cacheElements();

        this.audioPlayer = null;
        this.pianoKeyboard = null;
        this.transcriptionLog = null;
        this.midiHandler = null;
        this.audioInput = null;

        this.inputMode = 'midi';
        this.activeNotes = new Set();

        this.init();
    }

    cacheElements() {
        this.elements.audioFile = document.getElementById('audio-file');
        this.elements.fileName = document.getElementById('file-name');
        this.elements.waveformCanvas = document.getElementById('waveform-canvas');
        this.elements.playhead = document.getElementById('playhead');
        this.elements.loopRegion = document.getElementById('loop-region');
        this.elements.btnPlay = document.getElementById('btn-play');
        this.elements.btnPause = document.getElementById('btn-pause');
        this.elements.btnRewind = document.getElementById('btn-rewind');
        this.elements.btnForward = document.getElementById('btn-forward');
        this.elements.btnLoopA = document.getElementById('btn-loop-a');
        this.elements.btnLoopB = document.getElementById('btn-loop-b');
        this.elements.btnLoopClear = document.getElementById('btn-loop-clear');
        this.elements.currentTime = document.getElementById('current-time');
        this.elements.duration = document.getElementById('duration');
        this.elements.speedSlider = document.getElementById('speed-slider');
        this.elements.speedValue = document.getElementById('speed-value');
        this.elements.volumeSlider = document.getElementById('volume-slider');
        this.elements.volumeValue = document.getElementById('volume-value');
        this.elements.pianoContainer = document.getElementById('piano-keyboard');
        this.elements.micToggle = document.getElementById('mic-toggle');
        this.elements.midiStatus = document.getElementById('midi-status');
        this.elements.logContainer = document.querySelector('.log-panel .panel-content');
        this.elements.btnClearLog = document.getElementById('btn-clear-log');
        this.elements.btnExportLog = document.getElementById('btn-export-log');
    }

    async init() {
        this.audioPlayer = new AudioPlayer({
            onTimeUpdate: (current, duration) => this.onTimeUpdate(current, duration),
            onEnded: () => this.onAudioEnded(),
            onLoaded: (duration) => this.onAudioLoaded(duration),
            onError: (error) => this.onAudioError(error)
        });
        this.audioPlayer.setWaveformCanvas(this.elements.waveformCanvas);

        this.pianoKeyboard = new PianoKeyboard(this.elements.pianoContainer, {
            onNoteClick: (note, isDown, event) => this.onPianoNote(note, isDown, event)
        });

        this.transcriptionLog = new TranscriptionLog(this.elements.logContainer);

        this.midiHandler = new MidiHandler({
            onNoteOn: (note, velocity) => this.onMidiNoteOn(note, velocity),
            onNoteOff: (note) => this.onMidiNoteOff(note),
            onStateChange: (state, inputs) => this.onMidiStateChange(state, inputs)
        });
        await this.midiHandler.init();

        this.audioInput = new AudioInput({
            onNoteOn: (note, velocity) => this.onAudioNoteOn(note, velocity),
            onNoteOff: (note) => this.onAudioNoteOff(note),
            onError: (error) => this.onAudioInputError(error)
        });

        this.setupEventListeners();

        window.addEventListener('resize', () => this.resizeWaveformCanvas());
        this.resizeWaveformCanvas();

        document.body.addEventListener('click', () => ensureAudioContextRunning(), { once: true });
        document.body.addEventListener('keydown', () => ensureAudioContextRunning(), { once: true });
    }

    setupEventListeners() {
        this.elements.audioFile.addEventListener('change', (e) => this.onFileSelected(e));

        this.elements.btnPlay.addEventListener('click', () => this.audioPlayer.play());
        this.elements.btnPause.addEventListener('click', () => this.audioPlayer.pause());
        this.elements.btnRewind.addEventListener('click', () => this.audioPlayer.seek(Math.max(0, this.audioPlayer.currentTime - 5)));
        this.elements.btnForward.addEventListener('click', () => this.audioPlayer.seek(Math.min(this.audioPlayer.duration, this.audioPlayer.currentTime + 5)));
        this.elements.btnLoopA.addEventListener('click', () => this.audioPlayer.setLoopStart());
        this.elements.btnLoopB.addEventListener('click', () => this.audioPlayer.setLoopEnd());
        this.elements.btnLoopClear.addEventListener('click', () => this.audioPlayer.clearLoop());

        this.elements.speedSlider.addEventListener('input', (e) => {
            const rate = parseFloat(e.target.value);
            this.audioPlayer.setPlaybackRate(rate);
            this.elements.speedValue.textContent = rate.toFixed(2) + 'x';
        });

        this.elements.volumeSlider.addEventListener('input', (e) => {
            const volume = parseFloat(e.target.value);
            this.audioPlayer.setVolume(volume);
            pianoSynth.setVolume(volume);
            this.elements.volumeValue.textContent = Math.round(volume * 100) + '%';
        });

        this.elements.micToggle.addEventListener('change', (e) => this.toggleInputMode(e.target.checked));

        this.elements.btnClearLog.addEventListener('click', () => this.transcriptionLog.clear());
        this.elements.btnExportLog.addEventListener('click', () => this.transcriptionLog.downloadExport());

        document.addEventListener('keydown', (e) => this.onKeyDown(e));
    }

    resizeWaveformCanvas() {
        const container = this.elements.waveformCanvas.parentElement;
        if (container) {
            const rect = container.getBoundingClientRect();
            this.elements.waveformCanvas.width = rect.width;
            this.elements.waveformCanvas.height = rect.height;
            this.audioPlayer.drawWaveform();
        }
    }

    formatTime(seconds) {
        if (!isFinite(seconds) || seconds < 0) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return mins + ':' + secs.toString().padStart(2, '0');
    }

    onFileSelected(event) {
        const file = event.target.files[0];
        if (!file) return;
        this.elements.fileName.textContent = file.name;
        this.audioPlayer.loadFile(file);
    }

    onAudioLoaded(duration) {
        this.elements.duration.textContent = this.formatTime(duration);
        this.elements.currentTime.textContent = '0:00';
        this.elements.btnPlay.hidden = false;
        this.elements.btnPause.hidden = true;
    }

    onAudioError(error) {
        this.elements.fileName.textContent = 'Error loading file';
        console.error('Audio load error:', error);
    }

    onTimeUpdate(current, duration) {
        this.elements.currentTime.textContent = this.formatTime(current);
        this.elements.duration.textContent = this.formatTime(duration);

        if (duration > 0) {
            const progress = (current / duration) * 100;
            this.elements.playhead.style.left = progress + '%';
        }

        if (this.audioPlayer.loopEnabled && this.audioPlayer.loopStart !== null && this.audioPlayer.loopEnd !== null) {
            const startPct = (this.audioPlayer.loopStart / duration) * 100;
            const endPct = (this.audioPlayer.loopEnd / duration) * 100;
            this.elements.loopRegion.style.left = startPct + '%';
            this.elements.loopRegion.style.width = (endPct - startPct) + '%';
            this.elements.loopRegion.hidden = false;
        } else {
            this.elements.loopRegion.hidden = true;
        }
    }

    onAudioEnded() {
        this.elements.btnPlay.hidden = false;
        this.elements.btnPause.hidden = true;
    }

    onPianoNote(note, isDown, event) {
        if (isDown) {
            pianoSynth.play(note);
            this.activeNotes.add(note);
            this.pianoKeyboard.highlightNote(note, true);
            this.transcriptionLog.addNote(note, 'click');
        } else {
            pianoSynth.stop(note);
            this.activeNotes.delete(note);
            this.pianoKeyboard.highlightNote(note, false);
        }
    }

    onMidiNoteOn(note, velocity) {
        if (this.inputMode !== 'midi') return;
        pianoSynth.play(note, velocity);
        this.activeNotes.add(note);
        this.pianoKeyboard.highlightNote(note, true);
        this.transcriptionLog.addNote(note, 'midi', velocity);
    }

    onMidiNoteOff(note) {
        if (this.inputMode !== 'midi') return;
        pianoSynth.stop(note);
        this.activeNotes.delete(note);
        this.pianoKeyboard.highlightNote(note, false);
    }

    onMidiStateChange(state, inputs) {
        const statusEl = this.elements.midiStatus;
        const text = statusEl.querySelector('.status-text');
        statusEl.dataset.status = state;

        switch (state) {
            case 'connected':
                text.textContent = 'MIDI: ' + inputs.length + ' device' + (inputs.length !== 1 ? 's' : '') + ' connected';
                break;
            case 'disconnected':
                text.textContent = 'MIDI: Disconnected';
                break;
            case 'denied':
                text.textContent = 'MIDI: Access denied';
                break;
            case 'unsupported':
                text.textContent = 'MIDI: Not supported';
                break;
            default:
                text.textContent = 'MIDI: ' + state;
        }
    }

    async onAudioNoteOn(note, velocity) {
        if (this.inputMode !== 'audio') return;
        pianoSynth.play(note, velocity);
        this.activeNotes.add(note);
        this.pianoKeyboard.highlightNote(note, true);
        this.transcriptionLog.addNote(note, 'audio', velocity);
    }

    onAudioNoteOff(note) {
        if (this.inputMode !== 'audio') return;
        pianoSynth.stop(note);
        this.activeNotes.delete(note);
        this.pianoKeyboard.highlightNote(note, false);
    }

    onAudioInputError(error) {
        console.error('Audio input error:', error);
        this.elements.micToggle.checked = false;
        this.toggleInputMode(false);
    }

    async toggleInputMode(useAudio) {
        this.inputMode = useAudio ? 'audio' : 'midi';

        if (useAudio) {
            this.midiHandler.setEnabled(false);
            const success = await this.audioInput.start();
            if (!success) {
                this.elements.micToggle.checked = false;
                this.inputMode = 'midi';
                this.midiHandler.setEnabled(true);
            }
        } else {
            this.audioInput.stop();
            this.midiHandler.setEnabled(true);
        }
    }

    onKeyDown(event) {
        if (event.code === 'Space' && event.target === document.body) {
            event.preventDefault();
            if (this.audioPlayer.isPlaying) {
                this.audioPlayer.pause();
            } else {
                this.audioPlayer.play();
            }
        }

        if (event.code === 'ArrowLeft') {
            this.audioPlayer.seek(Math.max(0, this.audioPlayer.currentTime - 1));
        }
        if (event.code === 'ArrowRight') {
            this.audioPlayer.seek(Math.min(this.audioPlayer.duration, this.audioPlayer.currentTime + 1));
        }

        if (event.code === 'KeyL') {
            if (this.audioPlayer.loopEnabled) {
                this.audioPlayer.clearLoop();
            } else if (this.audioPlayer.loopStart !== null && this.audioPlayer.loopEnd !== null) {
                this.audioPlayer.updateLoopState();
            }
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.hear2play = new Hear2PlayApp();
});