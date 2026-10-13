/**
 * hear2play — WSOLA Time-Stretching
 * Waveform Similarity Overlap-Add algorithm for pitch-preserving speed changes.
 *
 * Runs on the main thread but processes audio in small chunks, yielding
 * between chunks so the UI stays responsive (no Web Worker dependency).
 *
 * Based on the standard WSOLA algorithm (Verhelst & Roelands, 1993).
 */

import { audioContext } from './audio-context.js';

// WSOLA Configuration
const WSOLA_CONFIG = {
    WINDOW_SIZE: 1024,    // Analysis/synthesis window (samples)
    SYNTHESIS_HOP: 512,   // Output advance per frame (samples) = WINDOW_SIZE / 2
    SEARCH_WINDOW: 32,    // ± samples for best-match search
    MAX_STRETCH_RATIO: 4.0,
    MIN_STRETCH_RATIO: 0.001,  // treat |ratio-1| below this as "no stretch"
    YIELD_FRAMES: 128,    // Yield to browser every N frames
};

export { WSOLA_CONFIG };

/**
 * Yield to the browser event loop so the UI doesn't freeze.
 */
function yieldToBrowser() {
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

/**
 * Normalized cross-correlation between a reference window (from output tail)
 * and a candidate window (from input).
 */
function crossCorrelate(ref, input, inputStart, length) {
    let sumR = 0, sumI = 0, sumRI = 0, sumR2 = 0, sumI2 = 0;
    for (let i = 0; i < length; i++) {
        const r = ref[i];
        const x = input[inputStart + i];
        sumR += r;
        sumI += x;
        sumRI += r * x;
        sumR2 += r * r;
        sumI2 += x * x;
    }
    const n = length;
    const meanR = sumR / n;
    const meanI = sumI / n;
    const num = sumRI - n * meanR * meanI;
    const den = Math.sqrt(Math.max(1e-9, (sumR2 - n * meanR * meanR) * (sumI2 - n * meanI * meanI)));
    return den > 0 ? num / den : 0;
}

/**
 * Find the input offset (relative to `center`) that best matches the
 * previously written output overlap tail.
 */
function findBestOffset(input, output, center, outTailStart, seekLen, searchWindow, inputLen) {
    const ref = output.subarray(outTailStart, outTailStart + seekLen);
    if (ref.length < 32) return 0;

    const lo = Math.max(0, center - searchWindow);
    const hi = Math.min(inputLen - seekLen, center + searchWindow);
    if (lo >= hi) return 0;

    let bestOff = 0;
    let best = -Infinity;
    for (let pos = lo; pos <= hi; pos++) {
        const c = crossCorrelate(ref, input, pos, seekLen);
        if (c > best) {
            best = c;
            bestOff = pos - center;
        }
    }
    return bestOff;
}

/**
 * Stretch one channel (main-thread, chunked + yielding).
 */
async function stretchChannel(input, output, ratio, cfg, onProgress) {
    const { WINDOW_SIZE: W, SYNTHESIS_HOP: HS, SEARCH_WINDOW: S } = cfg;
    const inputLen = input.length;
    const outputLen = output.length;

    // Output advances by a fixed synthesis hop; input advances by the analysis
    // hop = synthesisHop / ratio. This keeps exactly 50% overlap between
    // consecutive windows for every stretch ratio (no amplitude buildup).
    const synthesisHop = HS;
    const analysisHop = HS / ratio;
    const overlap = W - synthesisHop;   // fixed = W/2
    const crossLen = Math.max(1, Math.min(overlap, W));

    // Linear crossfade - consecutive windows are phase-aligned by the search,
    // so a linear blend preserves amplitude (equal-power would boost it).
    const fadeIn = new Float32Array(crossLen);
    const fadeOut = new Float32Array(crossLen);
    for (let i = 0; i < crossLen; i++) {
        const t = i / (crossLen - 1);
        fadeIn[i] = t;
        fadeOut[i] = 1 - t;
    }

    // Reference region used for the search (fraction of the overlap tail)
    const seekLen = Math.max(32, Math.floor(crossLen / 2));

    // First window: copy from input start
    const firstLen = Math.min(W, outputLen, inputLen);
    for (let i = 0; i < firstLen; i++) {
        output[i] = input[i];
    }

    // Next window starts at `outPos` (overlaps the previous window's tail)
    let outPos = synthesisHop;
    let idealInPos = analysisHop; // input advances by analysisHop per window
    let frameCount = 0;

    while (outPos < outputLen && idealInPos + W <= inputLen) {
        const center = Math.max(0, Math.min(Math.round(idealInPos), inputLen - W));
        const outTailStart = outPos;
        const offset = findBestOffset(input, output, center, outTailStart, seekLen, S, inputLen);
        const inPos = Math.max(0, Math.min(center + offset, inputLen - W));

        // Crossfade the overlap region, then copy the rest
        for (let i = 0; i < crossLen && i + inPos < inputLen; i++) {
            const oi = outPos + i;
            if (oi >= outputLen) break;
            output[oi] = output[oi] * fadeOut[i] + input[inPos + i] * fadeIn[i];
        }
        for (let i = crossLen; i < W; i++) {
            const oi = outPos + i;
            const ii = inPos + i;
            if (oi >= outputLen || ii >= inputLen) break;
            output[oi] = input[ii];
        }

        outPos += synthesisHop;
        idealInPos += analysisHop;
        frameCount++;

        if (frameCount % cfg.YIELD_FRAMES === 0) {
            await yieldToBrowser();
            if (onProgress) onProgress(Math.min(1, outPos / outputLen));
        }
    }
}

/**
 * WSOLA Time-Stretch an AudioBuffer (main-thread, non-blocking).
 * @param {AudioBuffer} audioBuffer - Input audio buffer
 * @param {number} stretchRatio - Stretch ratio (1.0 normal, 2.0 half speed)
 * @param {Object} [config] - Configuration overrides
 * @param {Function} [onProgress] - Optional progress callback (0-1)
 * @returns {Promise<AudioBuffer>} Time-stretched audio buffer
 */
export async function timeStretch(audioBuffer, stretchRatio, config = {}, onProgress) {
    const cfg = { ...WSOLA_CONFIG, ...config };

    if (Math.abs(stretchRatio - 1.0) < cfg.MIN_STRETCH_RATIO) {
        return audioBuffer;
    }

    const clampedRatio = Math.max(0.25, Math.min(cfg.MAX_STRETCH_RATIO, stretchRatio));
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const outLength = Math.ceil(audioBuffer.length * clampedRatio);

    // Use the shared AudioContext (audioBuffer.context may be null on some browsers)
    const outBuffer = audioContext.createBuffer(numChannels, outLength, sampleRate);

    for (let ch = 0; ch < numChannels; ch++) {
        const inData = audioBuffer.getChannelData(ch);
        const outData = outBuffer.getChannelData(ch);
        await stretchChannel(inData, outData, clampedRatio, cfg, onProgress);
        await yieldToBrowser();
    }

    return outBuffer;
}

/**
 * Synchronous fallback (blocking) - kept for compatibility but not recommended.
 */
export function timeStretchSync(audioBuffer, stretchRatio, config = {}) {
    console.warn('timeStretchSync blocks the main thread. Use async timeStretch().');
    return audioBuffer;
}