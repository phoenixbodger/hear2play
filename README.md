# hear2play

A web application for pianists to train their ear by transcribing songs. Built with HTML, CSS, and modern JavaScript (ES Modules) using Web Audio API, Web MIDI API, and MediaDevices API.

## Features

### 🎵 Audio Player
- Load local MP3/WAV audio files
- Variable playback speed (0.25x to 1.0x) without pitch change
- A-B looping for repeating sections
- Waveform visualization with playhead and loop region
- Keyboard shortcuts: Space (play/pause), Arrow keys (seek), L (toggle loop)

### 🎹 Dual-Input Note Detection
- **MIDI Input**: Web MIDI API integration for connected MIDI keyboards (Note On/Off events)
- **Microphone Input**: Pitch detection via autocorrelation on audio input (fallback when no MIDI)
- Toggle between MIDI and microphone input modes

### 🎹 Visual Piano Keyboard
- Interactive on-screen piano (C4 to B5, 24 keys / 2 octaves)
- Click/touch to play notes with synthesized piano tones
- Keys light up when notes received via MIDI, microphone, or click
- Note labels on each key
- Full keyboard accessibility (Tab, Space, Enter)

### 📝 Transcription Log
- Real-time logging of played notes
- Automatic chord grouping (notes within 50ms)
- Timestamped entries with source (MIDI/Audio/Click)
- Export as JSON

## Project Structure

```
hear2play/
├── index.html          # Main HTML entry point
├── css/
│   └── styles.css      # Complete styling (dark/light theme, responsive)
├── js/
│   ├── app.js              # Main application coordinator
│   ├── audio-context.js    # Shared AudioContext
│   ├── audio-player.js     # Audio playback, speed, looping, waveform
│   ├── audio-input.js      # Microphone pitch detection (autocorrelation)
│   ├── midi-handler.js     # Web MIDI API integration
│   ├── piano-keyboard.js   # Visual keyboard (C4-B5)
│   ├── synth.js            # Web Audio piano synthesizer
│   └── transcription-log.js # Note logging with chord grouping
└── README.md           # This file
```

## Requirements

- **Modern browser** with ES Modules support (Chrome, Firefox, Edge, Safari)
- **Secure context** (HTTPS or `localhost`) for Web MIDI and Microphone APIs
- **Local server** required (file:// protocol won't work for MIDI/microphone)

## Quick Start

1. Serve the project (required for MIDI/microphone):
   ```bash
   npx serve
   # or
   python -m http.server 8000
   # or use VS Code Live Server
   ```

2. Open `http://localhost:3000` (or your server URL)

3. **Load an audio file** using the folder button in the Audio Player panel

4. **Connect a MIDI keyboard** (auto-detected) or enable **Microphone Input** toggle

5. **Play along** - notes appear on the keyboard and in the transcription log

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play/Pause |
| `←` / `→` | Seek -1s / +1s |
| `L` | Toggle A-B loop |
| `Tab` | Navigate piano keys |
| `Space` / `Enter` | Play focused piano key |

## Technical Details

### Audio Player
- Uses `AudioBufferSourceNode` with `playbackRate` for pitch-preserving speed control
- A-B looping via seamless buffer source restart
- Waveform rendered to canvas from decoded audio buffer

### Pitch Detection (Microphone)
- Autocorrelation on time-domain data from `AnalyserNode`
- Configurable frequency range (65Hz - 1000Hz, C2-C6)
- Confidence threshold and temporal smoothing for stability
- Silence detection for Note Off

### Synthesizer
- Triangle wave oscillator with ADSR envelope
- Attack: 10ms, Decay: 100ms, Sustain: 30%, Release: 300ms
- Polyphonic (one oscillator+gain per active note)
- Master volume control

### MIDI Handling
- `navigator.requestMIDIAccess()` with state change monitoring
- Handles Note On (velocity > 0) and Note Off (velocity = 0 or status 0x80)
- Auto-selects first available input

## Browser Support

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| Web Audio API | ✅ | ✅ | ✅ | ✅ |
| Web MIDI API | ✅ | ❌* | ❌* | ✅ |
| MediaDevices API | ✅ | ✅ | ✅ | ✅ |
| ES Modules | ✅ | ✅ | ✅ | ✅ |

*Web MIDI requires enabling flag or Chrome/Edge

## Development

No build step required - pure ES Modules. Edit files directly and refresh.

### Adding Features
- Extend keyboard range: Modify `lowestNote`/`highestNote` in `PianoKeyboard` constructor
- Adjust pitch detection: Modify `minFrequency`/`maxFrequency` in `AudioInput`
- Change synth timbre: Modify oscillator types in `synth.js`

## License

MIT