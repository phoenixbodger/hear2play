/**
 * hear2play — Transcription Log
 * Real-time note logging with chord grouping
 */

import { noteToName } from './synth.js';

/**
 * Transcription Log Class
 */
export class TranscriptionLog {
    constructor(container, options = {}) {
        this.container = container;
        this.maxEntries = options.maxEntries ?? 200;
        this.chordWindow = options.chordWindow ?? 50; // ms to group as chord
        this.entries = [];
        this.pendingChord = [];
        this.chordTimeout = null;
        this.lastNoteTime = 0;

        this.logList = container.querySelector('#transcription-log');
        if (!this.logList) {
            this.logList = document.createElement('ul');
            this.logList.id = 'transcription-log';
            this.logList.className = 'transcription-log';
            this.logList.setAttribute('aria-live', 'polite');
            this.logList.setAttribute('aria-label', 'Notes played');
            container.appendChild(this.logList);
        }

        this.renderEmpty();
    }

    /**
     * Add a note to the log
     * @param {number} note - MIDI note number
     * @param {string} source - 'midi' | 'audio' | 'click'
     * @param {number} velocity - 0-127 (optional)
     */
    addNote(note, source, velocity = 100) {
        const now = Date.now();
        const timeSinceLast = now - this.lastNoteTime;

        // Clear any pending chord timeout
        if (this.chordTimeout) {
            clearTimeout(this.chordTimeout);
            this.chordTimeout = null;
        }

        // If notes are close together, group as chord
        if (timeSinceLast <= this.chordWindow && this.pendingChord.length > 0) {
            this.pendingChord.push({ note, source, velocity, timestamp: now });
        } else {
            // Flush previous pending chord
            if (this.pendingChord.length > 0) {
                this.flushChord();
            }
            // Start new chord group
            this.pendingChord = [{ note, source, velocity, timestamp: now }];
        }

        this.lastNoteTime = now;

        // Set timeout to flush chord
        this.chordTimeout = setTimeout(() => this.flushChord(), this.chordWindow + 10);
    }

    /**
     * Flush pending chord to log
     */
    flushChord() {
        if (this.pendingChord.length === 0) return;

        const chordNotes = [...this.pendingChord];
        this.pendingChord = [];
        this.chordTimeout = null;

        // Sort by pitch (low to high)
        chordNotes.sort((a, b) => a.note - b.note);

        const entry = {
            notes: chordNotes,
            timestamp: chordNotes[0].timestamp,
            isChord: chordNotes.length > 1
        };

        this.entries.unshift(entry);
        if (this.entries.length > this.maxEntries) {
            this.entries.pop();
        }

        this.render();
    }

    /**
     * Render the log
     */
    render() {
        if (this.entries.length === 0) {
            this.renderEmpty();
            return;
        }

        this.logList.innerHTML = '';

        for (const entry of this.entries) {
            const li = document.createElement('li');
            li.className = `log-entry${entry.isChord ? ' log-entry-chord' : ''}`;

            const timeStr = this.formatTime(entry.timestamp);
            const notesHtml = entry.notes.map(n => {
                const noteName = noteToName(n.note);
                const isSharp = noteName.includes('#');
                return `<span class="log-note${isSharp ? ' log-note-sharp' : ''}">${noteName}</span>`;
            }).join('');

            const sources = [...new Set(entry.notes.map(n => n.source))];
            const sourceStr = sources.join(',');

            li.innerHTML = `
                <span class="log-time">${timeStr}</span>
                <div class="log-notes">${notesHtml}</div>
                <span class="log-source">${sourceStr}</span>
            `;

            this.logList.appendChild(li);
        }
    }

    /**
     * Render empty state
     */
    renderEmpty() {
        this.logList.innerHTML = '<li class="log-empty">Play notes to see transcription...</li>';
    }

    /**
     * Format timestamp as MM:SS.mmm
     */
    formatTime(timestamp) {
        const date = new Date(timestamp);
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        const ms = String(date.getMilliseconds()).padStart(3, '0');
        return `${minutes}:${seconds}.${ms}`;
    }

    /**
     * Clear all entries
     */
    clear() {
        this.entries = [];
        this.pendingChord = [];
        if (this.chordTimeout) {
            clearTimeout(this.chordTimeout);
            this.chordTimeout = null;
        }
        this.renderEmpty();
    }

    /**
     * Export log as JSON
     * @returns {string} JSON string
     */
    exportJSON() {
        return JSON.stringify(this.entries.map(e => ({
            timestamp: e.timestamp,
            time: this.formatTime(e.timestamp),
            notes: e.notes.map(n => ({
                note: n.note,
                name: noteToName(n.note),
                source: n.source,
                velocity: n.velocity
            })),
            isChord: e.isChord
        })), null, 2);
    }

    /**
     * Download export as file
     */
    downloadExport() {
        const json = this.exportJSON();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `hear2play-transcription-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }
}