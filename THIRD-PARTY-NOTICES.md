# Third-party notices

DirectZoom is released under the MIT License (see LICENSE). It includes or downloads the
following components, which remain under their own licenses.

## Included with DirectZoom

| Component | License | Source |
|---|---|---|
| Electron (includes Chromium and Node.js) | MIT; Chromium components under their own licenses, listed in `LICENSES.chromium.html` next to `DirectZoom.exe` | https://github.com/electron/electron |
| FFmpeg 6.1.1 (`ffmpeg.exe`, essentials build by gyan.dev, via ffmpeg-static) | GPL v3; full text in `resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe.LICENSE` | Source code: https://github.com/FFmpeg/FFmpeg/commit/e38092ef93 · Build: https://www.gyan.dev/ffmpeg/builds/ |
| electron-updater | MIT | https://github.com/electron-userland/electron-builder |
| React, React DOM | MIT | https://github.com/facebook/react |
| Lucide icons | ISC | https://github.com/lucide-icons/lucide |
| mp4box.js | BSD-3-Clause | https://github.com/gpac/mp4box.js |
| mp4-muxer | MIT | https://github.com/Vanilagy/mp4-muxer |
| Outfit, JetBrains Mono fonts (via Fontsource) | SIL Open Font License 1.1 | https://fontsource.org |

FFmpeg runs as a separate program (`ffmpeg.exe`); DirectZoom does not link to it.

## Downloaded on request

These are downloaded from their official releases only when you turn on the matching feature,
and are verified against pinned SHA-256 checksums.

| Component | License | Source |
|---|---|---|
| whisper.cpp 1.9.2 and Whisper models (offline captions) | MIT | https://github.com/ggml-org/whisper.cpp |
| Piper 2023.11.14-2 (offline voiceover) | MIT | https://github.com/rhasspy/piper |
| Piper voices (Lessac, Ryan, Alan) | See each voice's model card | https://huggingface.co/rhasspy/piper-voices |
