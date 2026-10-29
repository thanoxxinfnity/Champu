---
name: yt-dlp-media
description: Get a video's details, subtitles, audio or a download with yt-dlp, no API key. Use to read what a YouTube (or other site) video says, search videos, pull captions to summarise, extract the audio of a clip you are allowed to keep, or list a playlist.
category: research
---
# yt-dlp: video info, captions, audio

yt-dlp (github.com/yt-dlp/yt-dlp, Unlicense) reads video sites without an API key.

1. Install or update: `pip install -U yt-dlp` (keep it fresh: sites change weekly). Audio work also needs `ffmpeg`.
2. **Details only**: `yt-dlp -J --no-playlist "<url>" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['title'], d['uploader'], d['duration'], d['view_count'])"`
3. **Search**: `yt-dlp "ytsearch5:your query" --flat-playlist -J` then print `title` and `url` of each entry.
4. **Captions (to summarise a video)**: `yt-dlp --skip-download --write-auto-subs --write-subs --sub-langs "en.*,hi" --convert-subs srt -o "%(id)s" "<url>"`, then strip timestamps: `sed -E '/^[0-9]+$/d;/-->/d;/^$/d' <id>.en.srt | awk '!seen[$0]++'`.
5. **Audio only**: `yt-dlp -x --audio-format mp3 -o "%(title)s.%(ext)s" "<url>"`. For speech to text pass the file to the whisper-cpp-transcribe skill.
6. **A playlist**: add `--playlist-end 10` unless the user asked for everything.

## Rules
- Download only what the user has the right to keep (their own videos, Creative Commons, public domain, or for personal viewing where the site allows it). Do not re-upload other people's work.
- No captions? Say so and offer the audio route instead of inventing a summary.
- Show the user the title, the length and your summary; do not paste the whole transcript.
