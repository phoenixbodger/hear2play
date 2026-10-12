/**
 * hear2play — MIDI Handler
 * Web MIDI API integration for MIDI keyboard input
 */

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;

/**
 * MIDI Handler Class
 */
export class MidiHandler {
    constructor(options = {}) {
        this.onNoteOn = options.onNoteOn ?? (() => {});
        this.onNoteOff = options.onNoteOff ?? (() => {});
        this.onStateChange = options.onStateChange ?? (() => {});

        this.midiAccess = null;
        this.inputs = new Map();
        this.selectedInputId = null;
        this.enabled = false;
    }

    /**
     * Initialize MIDI access
     * @returns {Promise<boolean>} Success status
     */
    async init() {
        if (!navigator.requestMIDIAccess) {
            this.updateState('unsupported');
            return false;
        }

        try {
            this.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
            this.midiAccess.addEventListener('statechange', this.handleStateChange.bind(this));
            this.scanInputs();
            this.updateState('connected');
            this.enabled = true;
            return true;
        } catch (error) {
            console.error('MIDI access denied:', error);
            this.updateState('denied');
            return false;
        }
    }

    /**
     * Handle MIDI connection state changes
     */
    handleStateChange(event) {
        const port = event.port;
        console.log(`MIDI ${port.type} ${port.state}: ${port.name}`);
        this.scanInputs();
    }

    /**
     * Scan for available MIDI inputs
     */
    scanInputs() {
        if (!this.midiAccess) return;

        this.inputs.clear();
        let firstInputId = null;

        for (const input of this.midiAccess.inputs.values()) {
            this.inputs.set(input.id, input);
            if (!firstInputId) firstInputId = input.id;

            // Remove old listeners
            input.removeEventListener('midimessage', this.handleMidiMessage.bind(this));
            // Add new listener
            input.addEventListener('midimessage', this.handleMidiMessage.bind(this));
        }

        // Auto-select first input if none selected
        if (this.inputs.size > 0 && !this.selectedInputId) {
            this.selectInput(firstInputId);
        } else if (this.inputs.size === 0) {
            this.updateState('disconnected');
        }
    }

    /**
     * Select a specific MIDI input
     * @param {string} inputId - MIDI input ID
     */
    selectInput(inputId) {
        if (this.inputs.has(inputId)) {
            this.selectedInputId = inputId;
            this.updateState('connected');
        }
    }

    /**
     * Get list of available inputs
     * @returns {Array} Array of { id, name, manufacturer }
     */
    getInputs() {
        const inputs = [];
        for (const input of this.inputs.values()) {
            inputs.push({
                id: input.id,
                name: input.name,
                manufacturer: input.manufacturer,
                state: input.state
            });
        }
        return inputs;
    }

    /**
     * Handle incoming MIDI messages
     */
    handleMidiMessage(event) {
        if (!this.enabled) return;

        const [status, data1, data2] = event.data;
        const command = status & 0xF0;
        const channel = status & 0x0F;

        // Only handle channel 0 (or all channels)
        // Note On: 0x90, Note Off: 0x80
        // Some controllers send Note On with velocity 0 for Note Off
        if (command === NOTE_ON) {
            const note = data1;
            const velocity = data2;

            if (velocity > 0) {
                this.onNoteOn(note, velocity);
            } else {
                this.onNoteOff(note);
            }
        } else if (command === NOTE_OFF) {
            const note = data1;
            this.onNoteOff(note);
        }
    }

    /**
     * Update connection state
     */
    updateState(state) {
        this.onStateChange(state, this.getInputs());
    }

    /**
     * Enable/disable MIDI input
     */
    setEnabled(enabled) {
        this.enabled = enabled;
    }

    /**
     * Cleanup
     */
    destroy() {
        if (this.midiAccess) {
            this.midiAccess.removeEventListener('statechange', this.handleStateChange.bind(this));
            for (const input of this.inputs.values()) {
                input.removeEventListener('midimessage', this.handleMidiMessage.bind(this));
            }
        }
        this.inputs.clear();
        this.midiAccess = null;
    }
}