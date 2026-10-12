/**
 * hear2play — Shared Audio Context
 * Single AudioContext instance for the entire application
 */

export const audioContext = new (window.AudioContext || window.webkitAudioContext)();

// Resume context on user interaction (required by browser policy)
export function ensureAudioContextRunning() {
    if (audioContext.state === 'suspended') {
        return audioContext.resume();
    }
    return Promise.resolve();
}

// Master gain node for global volume control
export const masterGain = audioContext.createGain();
masterGain.connect(audioContext.destination);
masterGain.gain.value = 1.0;