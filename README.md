<p align="center">
  <img src="build/icon.png" width="112" height="112" alt="DirectZoom">
</p>

<h1 align="center">DirectZoom</h1>

<p align="center">
  Screen recorder and editor for Windows. Record your screen, then turn it into a polished video<br>
  with zooms that follow your cursor, a smooth cursor, captions, voiceover and more.
</p>

<p align="center">
  <a href="https://github.com/MrFr0g-X/DirectZoom/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/MrFr0g-X/DirectZoom?style=flat-square&color=0a84ff&label=release"></a>
  <a href="https://github.com/MrFr0g-X/DirectZoom/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/MrFr0g-X/DirectZoom/total?style=flat-square&color=0a84ff"></a>
  <a href="https://github.com/MrFr0g-X/DirectZoom/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/MrFr0g-X/DirectZoom/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Windows 10 and 11" src="https://img.shields.io/badge/Windows-10%20%7C%2011-0a84ff?style=flat-square&logo=windows&logoColor=white">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-0a84ff?style=flat-square"></a>
</p>

<p align="center">
  <a href="https://github.com/MrFr0g-X/DirectZoom/releases/latest"><b>Download</b></a> ·
  <a href="https://hothifa.is-a.dev/DirectZoom/">Website</a> ·
  <a href="https://hothifa.is-a.dev/DirectZoom/privacy.html">Privacy</a>
</p>

<p align="center">
  <img src="media/demo.webp" width="880" alt="DirectZoom: a click is zoomed into automatically, with captions and a webcam bubble"><br>
  <sub><a href="media/demo.mp4">Watch in 1080p</a></sub>
</p>

DirectZoom records the cursor separately from the screen, so the cursor can be restyled, smoothed or hidden after recording, and zooms are generated from where you clicked. Record a display, a single window or an area; export to MP4, WebM or GIF.

## Download

From [Releases](https://github.com/MrFr0g-X/DirectZoom/releases/latest):

- **DirectZoom-Setup-x.y.z.exe** installs for your Windows user (no administrator rights needed) and updates itself.
- **DirectZoom-Portable-x.y.z.exe** runs without installing; it tells you when a new version is out.

Windows may show a SmartScreen notice for new, unsigned apps: choose **More info → Run anyway**.

## Features

**Recording**

- Display, window (only the window's own content, even when covered) or area capture with Windows Graphics Capture
- System audio and a chosen microphone (WASAPI), webcam (optional floating preview while recording) and keyboard shortcuts (only key combinations with Ctrl, Alt or Win are saved, never ordinary typing)
- Cursor position, clicks and keys are timed on the same clock as the video, so everything stays in sync
- DirectZoom's own windows never appear in the recording

**Editing**

- Automatic zooms from clicks and cursor movement, editable on the timeline; the camera can follow the cursor
- Cursor styles (macOS, Windows system cursors, minimal, crosshair and themed designs), smoothing, click effects, idle hiding
- Backgrounds (wallpapers, gradients, colours, images), padding, rounded corners, shadow, crop, aspect ratios
- Trimming, splitting and per-clip speed (0.25×–4×)
- Webcam bubble with keyframes, keyboard-shortcut overlay, blur regions, drawn annotations, text-field spotlight
- 3D tilt effect, motion blur, brand presets
- Undo and redo for every edit; projects are saved automatically

**Audio and captions**

- Captions with word timing in three styles, editable transcript, `.srt` / `.vtt` import and `.srt` export
- Voiceover from a script
- Background music with automatic ducking under speech
- Speech cleanup: level normalisation, noise removal, filler-word muting or cutting, voice replacement

Captions and voiceover can run on ElevenLabs (with your own API key) or fully offline with whisper.cpp and Piper, downloaded on first use.

**Export and sharing**

- MP4 (H.264 + AAC), WebM (VP9 + Opus) and GIF, rendered frame by frame at up to 4K / 60 fps
- Upload exports to Google Drive

## Requirements

- Windows 10 version 2004 or later (Windows 11 recommended), 64-bit
- To build: Node.js 24, Rust (stable, MSVC toolchain)

## Building from source

```powershell
npm install
npm run native              # builds the capture helper (native/dzcap)
npm run build               # type-checks and bundles the interface
npm run desktop             # runs the app
npm test                    # unit tests
npm run package             # release/: DirectZoom-Setup-<version>.exe, DirectZoom-Portable-<version>.exe, latest.yml
```

## Optional services

**ElevenLabs.** Online captions, voiceover, noise isolation and voice replacement use your ElevenLabs API key. Enter it under Settings on the home screen, which also shows your plan and remaining credits. The key is stored encrypted for your Windows account and is only sent to ElevenLabs. Errors such as running out of credits, a key without the right permissions or an unavailable voice are explained in plain language with a link to fix them.

**Google Drive.** Uploads need an OAuth client of type *Desktop app* from a Google Cloud project with the Google Drive API enabled. Either place the downloaded JSON at `build/google-client.json` before packaging (it is bundled into the build and ignored by git), or choose it in the app under Settings → Google Drive. DirectZoom requests the `drive.file` scope, so it can only see files it uploads. Exports go into a `DirectZoom` folder.

**Updates.** The installed version checks [GitHub Releases](https://github.com/MrFr0g-X/DirectZoom/releases) at startup and every few hours, downloads new versions in the background (verified with SHA-512) and installs them on restart. The portable version shows when a new release is available.

## Project layout

```
electron/          main process: windows, IPC, projects, export muxing, services
native/dzcap/      Rust capture helper (video, audio, cursor, keys, text focus)
src/               renderer: compositor, motion, captions, timeline and the interface (src/ui)
tests/             unit tests (node:test)
scripts/           build and packaging helpers
media/             README demo; media/demo/index.html is its source (npm run demo renders it)
docs/              website (GitHub Pages): home, privacy policy, terms
```

Recordings are stored in `%APPDATA%\directzoom\recordings`, one folder per project with the video, audio tracks and JSON files for cursor, keys, zooms, clips and settings.

## Privacy

Recordings, projects and settings stay on your computer. Data leaves it only when you use an online feature: audio sent to ElevenLabs for captions or speech processing, scripts sent for voiceover, files you choose to upload to Google Drive, and update checks against the source you configure. See the full [privacy policy](https://hothifa.is-a.dev/DirectZoom/privacy.html) and [terms of service](https://hothifa.is-a.dev/DirectZoom/terms.html).

The website lives in `docs/` and is published with GitHub Pages.

## Contact

Questions and bug reports: [h@hothifa.tech](mailto:h@hothifa.tech). Help → Save diagnostics creates a report file you can attach.

## License

[MIT](LICENSE). Bundled third-party components (Electron, FFmpeg, whisper.cpp, Piper and others) keep their own licenses.
