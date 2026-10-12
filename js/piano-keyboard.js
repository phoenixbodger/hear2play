/**
 * hear2play - Visual Piano Keyboard
 * Interactive on-screen keyboard (C4-B5, 24 keys)
 */

import { noteToName, isBlackKey } from './synth.js';

/**
 * Piano Keyboard Class
 */
export class PianoKeyboard {
    constructor(container, options = {}) {
        this.container = container;
        this.lowestNote = options.lowestNote ?? 60; // C4
        this.highestNote = options.highestNote ?? 83; // B5
        this.onNoteClick = options.onNoteClick ?? (() => {});
        this.whiteKeyWidth = 42;
        this.blackKeyWidth = 26;

        this.keys = new Map(); // note -> { white: element, black: element }
        this.render();
    }

    /**
     * Render the keyboard
     */
    render() {
        this.container.innerHTML = '';
        this.container.className = 'piano-keyboard';
        this.keys.clear();

        // First pass: create white keys
        const whiteNotes = [];
        for (let note = this.lowestNote; note <= this.highestNote; note++) {
            if (!isBlackKey(note)) {
                whiteNotes.push(note);
            }
        }

        whiteNotes.forEach((note, index) => {
            const key = this.createWhiteKey(note, index);
            this.container.appendChild(key);
            this.keys.set(note, { white: key, black: null });
        });

        // Second pass: create black keys
        for (let note = this.lowestNote; note <= this.highestNote; note++) {
            if (isBlackKey(note)) {
                const key = this.createBlackKey(note);
                this.container.appendChild(key);
                const existing = this.keys.get(note);
                if (existing) {
                    existing.black = key;
                } else {
                    this.keys.set(note, { white: null, black: key });
                }
            }
        }
    }

    /**
     * Create a white key element
     */
    createWhiteKey(note, index) {
        const key = document.createElement('button');
        key.className = 'piano-key-white';
        key.dataset.note = note;
        key.style.left = index * this.whiteKeyWidth + 'px';
        key.setAttribute('aria-label', noteToName(note));
        key.setAttribute('role', 'button');
        key.tabIndex = 0;

        const label = document.createElement('span');
        label.className = 'note-label';
        label.textContent = noteToName(note);
        key.appendChild(label);

        // Mouse events
        key.addEventListener('mousedown', (e) => this.handleKeyDown(note, e));
        key.addEventListener('mouseup', () => this.handleKeyUp(note));
        key.addEventListener('mouseleave', () => this.handleKeyUp(note));
        key.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.handleKeyDown(note, e);
        }, { passive: false });
        key.addEventListener('touchend', () => this.handleKeyUp(note));

        // Keyboard events
        key.addEventListener('keydown', (e) => {
            if (e.code === 'Space' || e.code === 'Enter') {
                e.preventDefault();
                this.handleKeyDown(note, e);
            }
        });
        key.addEventListener('keyup', (e) => {
            if (e.code === 'Space' || e.code === 'Enter') {
                e.preventDefault();
                this.handleKeyUp(note);
            }
        });

        return key;
    }

    /**
     * Create a black key element
     */
    createBlackKey(note) {
        // Count white keys from lowestNote up to (but not including) this black key.
        // The black key sits on the boundary AFTER its left white neighbor.
        // If there are `whiteCount` white keys before it, the last one has index `whiteCount - 1`,
        // and the boundary after it is at `whiteCount * whiteKeyWidth`.
        let whiteCount = 0;
        for (let n = this.lowestNote; n < note; n++) {
            if (!isBlackKey(n)) whiteCount++;
        }
        // Boundary after the last white key before this black key:
        const left = whiteCount * this.whiteKeyWidth - this.blackKeyWidth / 2;

        const key = document.createElement('button');
        key.className = 'piano-key-black';
        key.dataset.note = note;
        key.style.left = left + 'px';
        key.setAttribute('aria-label', noteToName(note));
        key.setAttribute('role', 'button');
        key.tabIndex = 0;

        const label = document.createElement('span');
        label.className = 'note-label';
        label.textContent = noteToName(note);
        key.appendChild(label);

        key.addEventListener('mousedown', (e) => this.handleKeyDown(note, e));
        key.addEventListener('mouseup', () => this.handleKeyUp(note));
        key.addEventListener('mouseleave', () => this.handleKeyUp(note));
        key.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.handleKeyDown(note, e);
        }, { passive: false });
        key.addEventListener('touchend', () => this.handleKeyUp(note));

        key.addEventListener('keydown', (e) => {
            if (e.code === 'Space' || e.code === 'Enter') {
                e.preventDefault();
                this.handleKeyDown(note, e);
            }
        });
        key.addEventListener('keyup', (e) => {
            if (e.code === 'Space' || e.code === 'Enter') {
                e.preventDefault();
                this.handleKeyUp(note);
            }
        });

        return key;
    }

    /**
     * Handle key press (mouse/touch/keyboard)
     */
    handleKeyDown(note, event) {
        event?.preventDefault();
        this.setKeyActive(note, true);
        this.onNoteClick(note, true, event);
    }

    /**
     * Handle key release
     */
    handleKeyUp(note) {
        this.setKeyActive(note, false);
        this.onNoteClick(note, false);
    }

    /**
     * Set visual active state
     */
    setKeyActive(note, active) {
        const keyPair = this.keys.get(note);
        if (!keyPair) return;

        if (keyPair.white) {
            keyPair.white.classList.toggle('active', active);
        }
        if (keyPair.black) {
            keyPair.black.classList.toggle('active', active);
        }
    }

    /**
     * Highlight key from external input (MIDI/audio)
     */
    highlightNote(note, active) {
        this.setKeyActive(note, active);
    }

    /**
     * Get key element for a note
     */
    getKeyElement(note) {
        return this.keys.get(note);
    }
}