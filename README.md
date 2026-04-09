# speed_tracker_video
Tracks speed of an object from a video.

## MOV support

- `.mov` kan direct werken als je browser de gebruikte codec ondersteunt.
- Als dat niet zo is, probeert de app automatisch `.mov` naar `.mp4` te converteren in de browser via `ffmpeg.wasm`.
- De eerste keer dat deze fallback gebruikt wordt, downloadt de browser ffmpeg-core (ongeveer 31MB).
- Hiervoor is een internetverbinding nodig tijdens de eerste conversie.

Als automatische conversie niet lukt, converteer lokaal en upload daarna de `.mp4`:

```bash
ffmpeg -i input.mov -c:v libx264 -pix_fmt yuv420p -c:a aac output.mp4
```
