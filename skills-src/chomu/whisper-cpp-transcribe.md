---
name: whisper-cpp-transcribe
description: Turn speech in an audio or video file into text on the terminal machine with whisper.cpp, offline, free, no API. Use to transcribe a recording, lecture, voice note, meeting or the audio of a downloaded video, with timestamps or as subtitles.
category: audio
---
# whisper.cpp: offline speech to text

whisper.cpp (github.com/ggml-org/whisper.cpp, MIT) runs OpenAI's Whisper models on the CPU; nothing leaves the machine.

1. Build once: `git clone --depth 1 https://github.com/ggml-org/whisper.cpp && cd whisper.cpp && cmake -B build && cmake --build build -j --config Release` (the binary is `build/bin/whisper-cli`).
2. A model: `sh ./models/download-ggml-model.sh base` (fast; use `small` for better Hindi/Hinglish, `medium` if there is time, add `.en` only for English audio).
3. Whisper wants 16 kHz mono WAV: `ffmpeg -i input.mp4 -ar 16000 -ac 1 -c:a pcm_s16le out.wav`.
4. Transcribe: `./build/bin/whisper-cli -m models/ggml-small.bin -f out.wav -l auto -otxt -osrt` (writes `out.wav.txt` and `.srt`; `-l hi` forces Hindi).
5. Long files: it is slower than real time on a weak CPU, so tell the user the estimate, run it in the background and report when done; for a quick look transcribe only the first 5 minutes with `--duration 300000`.
6. Show the first lines, the file paths, and a short summary. Mark words you are unsure of with [?] instead of guessing.

## Rules
- Only audio the user is allowed to transcribe. Do not publish a transcript of a private call without being asked.
- If the build fails (no cmake or compiler), say what is missing and offer `pip install faster-whisper` as the fallback.
