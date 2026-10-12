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
        this.elements.btnExportSelection = document.getElementById('btn-export-selection');
        this.elements.btnStop = document.getElementById('btn-stop');
        this.elements.btnRestart = document.getElementById('btn-restart');
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
        // Instructions modal elements
        this.elements.btnInstructions = document.getElementById('btn-instructions');
        this.elements.instructionsModal = document.getElementById('instructions-modal');
        this.elements.modalClose = document.querySelector('.modal-close');
        this.elements.modalOverlay = document.querySelector('.modal-overlay');
        this.elements.modalTocLinks = document.querySelectorAll('.modal-toc a');
        this.elements.modalSections = document.querySelectorAll('.modal-section');
    }

    initInstructionsModal() {
        const modal = this.elements.instructionsModal;
        const openBtn = this.elements.btnInstructions;
        const closeBtn = this.elements.modalClose;
        const overlay = this.elements.modalOverlay;
        const tocLinks = this.elements.modalTocLinks;
        const sections = this.elements.modalSections;

        let lastFocusedElement = null;

        const openModal = () => {
            lastFocusedElement = document.activeElement;
            modal.showModal();
            closeBtn.focus();
            document.body.style.overflow = 'hidden';
            this.updateTocActive();
        };

        const closeModal = () => {
            modal.close();
            document.body.style.overflow = '';
            if (lastFocusedElement) {
                lastFocusedElement.focus();
            }
        };

        // Open modal
        openBtn.addEventListener('click', openModal);

        // Close modal via close button
        closeBtn.addEventListener('click', closeModal);

        // Close modal via overlay click
        overlay.addEventListener('click', closeModal);

        // Close modal via Escape key (native dialog handles this, but we ensure focus restoration)
        modal.addEventListener('close', () => {
            document.body.style.overflow = '';
            if (lastFocusedElement) {
                lastFocusedElement.focus();
            }
        });

        // Handle TOC link clicks - smooth scroll
        tocLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = link.getAttribute('href');
                const targetSection = document.querySelector(targetId);
                if (targetSection) {
                    targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    // Update active state immediately
                    this.updateTocActive(targetId);
                }
            });
        });

        // Scroll spy for TOC active state
        const observerOptions = {
            root: modal.querySelector('.modal-sections'),
            rootMargin: '-20% 0px -60% 0px',
            threshold: 0
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const id = '#' + entry.target.id;
                    this.updateTocActive(id);
                }
            });
        }, observerOptions);

        sections.forEach(section => observer.observe(section));

        // Also update on scroll (fallback)
        const sectionsContainer = modal.querySelector('.modal-sections');
        if (sectionsContainer) {
            sectionsContainer.addEventListener('scroll', () => this.updateTocActive());
        }
    }

    updateTocActive(currentId = null) {
        const tocLinks = this.elements.modalTocLinks;
        const sections = this.elements.modalSections;
        const sectionsContainer = this.elements.instructionsModal?.querySelector('.modal-sections');

        if (!sectionsContainer) return;

        // If we have a currentId from click, use it
        if (currentId) {
            tocLinks.forEach(link => {
                link.classList.toggle('active', link.getAttribute('href') === currentId);
            });
            return;
        }

        // Otherwise, detect from scroll position
        const containerTop = sectionsContainer.scrollTop;
        const containerHeight = sectionsContainer.clientHeight;

        let activeSection = null;
        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            const sectionHeight = section.offsetHeight;
            // Section is in the upper portion of the viewport
            if (sectionTop <= containerTop + containerHeight * 0.3 &&
                sectionTop + sectionHeight >= containerTop + containerHeight * 0.1) {
                activeSection = section;
            }
        });

        // If no section detected, use the first one that's past the top
        if (!activeSection) {
            sections.forEach(section => {
                if (section.offsetTop <= containerTop + 50 && !activeSection) {
                    activeSection = section;
                }
            });
        }

        const activeId = activeSection ? '#' + activeSection.id : null;
        tocLinks.forEach(link => {
            link.classList.toggle('active', link.getAttribute('href') === activeId);
        });
    }

    async init() {
        this.audioPlayer = new AudioPlayer({
            onTimeUpdate: (current, duration) => this.onTimeUpdate(current, duration),
            onEnded: () => this.onAudioEnded(),
            onLoaded: (duration) => this.onAudioLoaded(duration),
            onError: (error) => this.onAudioError(error),
            onLoopChange: (loopInfo) => this.onLoopChange(loopInfo)
        });
        this.audioPlayer.setWaveformCanvas(this.elements.waveformCanvas);

        // Setup waveform click/drag interaction
        this.setupWaveformInteraction();

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
        this.elements.btnExportSelection.addEventListener('click', () => this.exportSelection());
        this.elements.btnStop.addEventListener('click', () => this.audioPlayer.stop());
        this.elements.btnRestart.addEventListener('click', () => this.audioPlayer.seek(0));

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

        // Initialize instructions modal
        this.initInstructionsModal();

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

    setupWaveformInteraction() {
        const container = this.elements.waveformCanvas.parentElement;
        if (!container) return;

        let dragStartTime = null;
        let dragStartX = null;
        let isDragging = false;
        const DRAG_THRESHOLD = 5; // pixels

        const getClientX = (event) => {
            if (event.touches && event.touches.length > 0) {
                return event.touches[0].clientX;
            }
            return event.clientX;
        };

        const updatePreviewRegion = (startTime, endTime) => {
            const duration = this.audioPlayer.duration;
            if (duration <= 0) return;

            const minTime = Math.min(startTime, endTime);
            const maxTime = Math.max(startTime, endTime);

            const startPct = (minTime / duration) * 100;
            const endPct = (maxTime / duration) * 100;

            this.elements.loopRegion.style.left = startPct + '%';
            this.elements.loopRegion.style.width = (endPct - startPct) + '%';
            this.elements.loopRegion.hidden = false;
            this.elements.loopRegion.classList.add('preview');
        };

        const clearPreviewRegion = () => {
            this.elements.loopRegion.classList.remove('preview');
            // The onLoopChange callback will update the region to the committed state
        };

        const handlePointerDown = (event) => {
            // Only handle left mouse button or touch
            if (event.type === 'mousedown' && event.button !== 0) return;

            // Don't start drag if audio not loaded
            if (!this.audioPlayer.audioBuffer || this.audioPlayer.duration <= 0) return;

            event.preventDefault();

            const rect = this.elements.waveformCanvas.getBoundingClientRect();
            const clientX = getClientX(event);
            const canvasX = clientX - rect.left;
            const clickTime = this.audioPlayer.getTimeFromX(canvasX);

            // Shift+Click: extend selection from nearest edge
            if (event.shiftKey && this.audioPlayer.loopEnabled && this.audioPlayer.loopStart !== null && this.audioPlayer.loopEnd !== null) {
                const startDist = Math.abs(clickTime - this.audioPlayer.loopStart);
                const endDist = Math.abs(clickTime - this.audioPlayer.loopEnd);

                if (startDist < endDist) {
                    this.audioPlayer.loopStart = clickTime;
                } else {
                    this.audioPlayer.loopEnd = clickTime;
                }

                // Normalize so A < B
                if (this.audioPlayer.loopStart > this.audioPlayer.loopEnd) {
                    [this.audioPlayer.loopStart, this.audioPlayer.loopEnd] = [this.audioPlayer.loopEnd, this.audioPlayer.loopStart];
                }

                this.audioPlayer.updateLoopState();
                this.audioPlayer.notifyLoopChange();
                return;
            }

            dragStartTime = clickTime;
            dragStartX = clientX;
            isDragging = false;

            // Add move/up listeners on document for smooth dragging outside container
            document.addEventListener('mousemove', handlePointerMove);
            document.addEventListener('mouseup', handlePointerUp);
            document.addEventListener('touchmove', handlePointerMove, { passive: false });
            document.addEventListener('touchend', handlePointerUp);

            container.classList.add('dragging');
        };

        const handlePointerMove = (event) => {
            const clientX = getClientX(event);
            const deltaX = Math.abs(clientX - dragStartX);

            // Check if we've moved enough to consider it a drag
            if (!isDragging && deltaX >= DRAG_THRESHOLD) {
                isDragging = true;
            }

            if (isDragging) {
                event.preventDefault();
                const rect = this.elements.waveformCanvas.getBoundingClientRect();
                const canvasX = Math.max(0, Math.min(rect.width, clientX - rect.left));
                const currentTime = this.audioPlayer.getTimeFromX(canvasX);
                updatePreviewRegion(dragStartTime, currentTime);
            }
        };

        const handlePointerUp = (event) => {
            document.removeEventListener('mousemove', handlePointerMove);
            document.removeEventListener('mouseup', handlePointerUp);
            document.removeEventListener('touchmove', handlePointerMove);
            document.removeEventListener('touchend', handlePointerUp);

            container.classList.remove('dragging');

            if (isDragging) {
                // Finalize the selection
                const clientX = getClientX(event);
                const rect = this.elements.waveformCanvas.getBoundingClientRect();
                const canvasX = Math.max(0, Math.min(rect.width, clientX - rect.left));
                const endTime = this.audioPlayer.getTimeFromX(canvasX);

                const startTime = Math.min(dragStartTime, endTime);
                const endTimeFinal = Math.max(dragStartTime, endTime);

                // Only set loop if selection is meaningful (> 0.1s)
                if (endTimeFinal - startTime > 0.1) {
                    this.audioPlayer.loopStart = startTime;
                    this.audioPlayer.loopEnd = endTimeFinal;
                    this.audioPlayer.updateLoopState();
                    this.audioPlayer.notifyLoopChange();
                }

                clearPreviewRegion();
            } else {
                // Click - seek to position
                this.audioPlayer.seek(dragStartTime);
                clearPreviewRegion();
            }

            dragStartTime = null;
            dragStartX = null;
            isDragging = false;
        };

        // Mouse events
        container.addEventListener('mousedown', handlePointerDown);

        // Touch events
        container.addEventListener('touchstart', handlePointerDown, { passive: false });

        // Prevent context menu on long press (mobile)
        container.addEventListener('contextmenu', (e) => e.preventDefault());
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

    onLoopChange(loopInfo) {
        this.updateLoopRegion(loopInfo);
    }

    updateLoopRegion(loopInfo) {
        const { loopEnabled, loopStart, loopEnd, duration } = loopInfo;

        // Remove preview class when committing the loop region
        this.elements.loopRegion.classList.remove('preview');

        if (loopEnabled && loopStart !== null && loopEnd !== null && duration > 0) {
            const startPct = (loopStart / duration) * 100;
            const endPct = (loopEnd / duration) * 100;
            this.elements.loopRegion.style.left = startPct + '%';
            this.elements.loopRegion.style.width = (endPct - startPct) + '%';
            this.elements.loopRegion.hidden = false;
        } else {
            this.elements.loopRegion.hidden = true;
        }

        // Show/hide export button based on valid loop selection
        this.elements.btnExportSelection.hidden = !loopEnabled || !this.audioBuffer || 
                                               !(this.loopStart !== null && this.loopEnd !== null && 
                                                (this.loopEnd - this.loopStart) > 0.1);
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
        
        if (event.code === 'KeyS' && event.target === document.body) {
            event.preventDefault();
            this.audioPlayer.stop();
        }
        
        if (event.code === 'KeyR' && event.target === document.body) {
            event.preventDefault();
            this.audioPlayer.seek(0);
        }

        if (event.code === 'KeyL') {
            if (this.audioPlayer.loopEnabled) {
                this.audioPlayer.clearLoop();
            } else if (this.audioPlayer.loopStart !== null && this.audioPlayer.loopEnd !== null) {
                this.audioPlayer.updateLoopState();
            }
        }
    }

    /**
     * Export the selected loop region as a WAV file
     */
    async exportSelection() {
        const blob = await this.audioPlayer.exportSelection();
        
        if (!blob) {
            console.warn('No valid selection to export');
            return;
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        a.download = `hear2play-selection-${timestamp}.wav`;
        a.click();
        URL.revokeObjectURL(url);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.hear2play = new Hear2PlayApp();
});