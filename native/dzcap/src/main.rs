//! dzcap: DirectZoom's native capture helper.
//!
//!   dzcap list                 → JSON displays and windows
//!   dzcap record '<json>'      → records until a "stop" line (or EOF) on stdin
//!
//! Output folder layout: screen.mp4, cursor.json, keyboard.json, metadata.json.
mod audio;
mod capture;
mod clock;
mod cursors;
mod devices;
mod focus;
mod input;
mod writer;

use capture::{Flags, Recorder, Shared};
use devices::Rect;
use input::{Target, Tracker};
use serde::Deserialize;
use serde_json::json;
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::time::Duration;
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Gdi::HMONITOR;
use windows::Win32::UI::HiDpi::{DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, SetProcessDpiAwarenessContext};
use windows_capture::capture::GraphicsCaptureApiHandler;
use windows_capture::monitor::Monitor;
use windows_capture::settings::*;
use windows_capture::window::Window;

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum Source {
    Display { index: usize },
    Window { hwnd: isize },
    Area { display: usize, rect: AreaRect },
}

#[derive(Deserialize, Clone, Copy)]
struct AreaRect { x: i32, y: i32, width: i32, height: i32 }

#[derive(Deserialize)]
struct RecordConfig {
    output_dir: PathBuf,
    source: Source,
    #[serde(default = "default_fps")]
    fps: u32,
    #[serde(default)]
    keyboard: bool,
    #[serde(default)]
    system_audio: bool,
    #[serde(default)]
    microphone: bool,
    /// Capture endpoint id from `dzcap list` (microphones); default device when absent.
    #[serde(default)]
    microphone_id: Option<String>,
}
fn default_fps() -> u32 { 60 }

fn emit(value: serde_json::Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{value}");
    let _ = out.flush();
}

fn main() {
    unsafe { let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2); }
    let args: Vec<String> = std::env::args().collect();
    let result = match args.get(1).map(String::as_str) {
        Some("list") => { emit(json!({ "displays": devices::displays(), "windows": devices::windows(), "microphones": audio::microphones() })); Ok(()) }
        Some("cursors") => {
            let dir = args.get(2).map(std::path::PathBuf::from).ok_or("missing output directory");
            let size = args.get(3).and_then(|v| v.parse().ok()).unwrap_or(128);
            dir.map_err(Into::into).and_then(|dir| cursors::export(&dir, size)).map(|list| emit(json!({ "event": "cursors", "cursors": list })))
        }
        Some("record") => args.get(2).ok_or_else(|| "missing config".into()).and_then(|raw| record(raw)),
        _ => Err("usage: dzcap list | dzcap record <json> | dzcap cursors <dir> [size]".into()),
    };
    if let Err(error) = result {
        emit(json!({ "event": "error", "message": error.to_string() }));
        std::process::exit(1);
    }
}

fn monitor_bounds(monitor: &Monitor) -> Result<Rect, Box<dyn std::error::Error + Send + Sync>> {
    devices::monitor_rect(HMONITOR(monitor.as_raw_hmonitor())).map(|(rect, _)| rect).ok_or_else(|| "monitor bounds unavailable".into())
}

fn record(raw: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let config: RecordConfig = serde_json::from_str(raw)?;
    std::fs::create_dir_all(&config.output_dir)?;
    let shared = Shared::new();
    // Audio starts first so packets cover the first video frame.
    let start_audio = |enabled: bool, kind, name: &str| -> Option<audio::AudioRecorder> {
        if !enabled { return None; }
        match audio::AudioRecorder::start(kind, if kind == audio::Kind::Microphone { config.microphone_id.clone() } else { None }, config.output_dir.join(name)) {
            Ok(recorder) => Some(recorder),
            Err(message) => { emit(json!({ "event": "warning", "message": format!("{name}: {message}") })); None }
        }
    };
    let system_audio = start_audio(config.system_audio, audio::Kind::System, "audio.wav");
    let microphone = start_audio(config.microphone, audio::Kind::Microphone, "mic.wav");
    let mut flags = Flags { output: config.output_dir.join("screen.mp4"), fps: config.fps.clamp(1, 120), crop: None, shared: shared.clone() };

    let (control, target, source_json, area) = match config.source {
        Source::Display { index } => {
            let monitor = Monitor::from_index(index)?;
            let bounds = monitor_bounds(&monitor)?;
            let control = Recorder::start_free_threaded(Settings::new(monitor, CursorCaptureSettings::WithoutCursor, DrawBorderSettings::WithoutBorder,
                SecondaryWindowSettings::Default, MinimumUpdateIntervalSettings::Custom(Duration::from_micros(1_000_000 / flags.fps as u64)),
                DirtyRegionSettings::Default, ColorFormat::Bgra8, flags.clone()))?;
            (control, Target::Fixed(bounds), "screen", bounds)
        }
        Source::Area { display, rect } => {
            let monitor = Monitor::from_index(display)?;
            let bounds = monitor_bounds(&monitor)?;
            let x0 = (rect.x - bounds.x).clamp(0, bounds.width) as u32;
            let y0 = (rect.y - bounds.y).clamp(0, bounds.height) as u32;
            let x1 = (rect.x + rect.width - bounds.x).clamp(0, bounds.width) as u32;
            let y1 = (rect.y + rect.height - bounds.y).clamp(0, bounds.height) as u32;
            if x1 <= x0 + 16 || y1 <= y0 + 16 { return Err("area is outside the selected display".into()); }
            flags.crop = Some((x0, y0, x1, y1));
            let area = Rect { x: bounds.x + x0 as i32, y: bounds.y + y0 as i32, width: ((x1 - x0) & !1) as i32, height: ((y1 - y0) & !1) as i32 };
            let control = Recorder::start_free_threaded(Settings::new(monitor, CursorCaptureSettings::WithoutCursor, DrawBorderSettings::WithoutBorder,
                SecondaryWindowSettings::Default, MinimumUpdateIntervalSettings::Custom(Duration::from_micros(1_000_000 / flags.fps as u64)),
                DirtyRegionSettings::Default, ColorFormat::Bgra8, flags.clone()))?;
            (control, Target::Fixed(area), "area", area)
        }
        Source::Window { hwnd } => {
            let handle = HWND(hwnd as *mut _);
            let window = Window::from_raw_hwnd(handle.0);
            if !window.is_valid() { return Err("window is no longer available".into()); }
            let bounds = devices::window_rect(handle).ok_or("window bounds unavailable")?;
            let control = Recorder::start_free_threaded(Settings::new(window, CursorCaptureSettings::WithoutCursor, DrawBorderSettings::WithoutBorder,
                SecondaryWindowSettings::Default, MinimumUpdateIntervalSettings::Custom(Duration::from_micros(1_000_000 / flags.fps as u64)),
                DirtyRegionSettings::Default, ColorFormat::Bgra8, flags.clone()))?;
            (control, Target::Window(handle), "window", bounds)
        }
    };
    let tracker = Tracker::start(target, config.keyboard);
    let focus_tracker = focus::FocusTracker::start(target, None);

    // Wait for the first frame so the caller's timeline starts with video.
    let wait_start = std::time::Instant::now();
    while shared.first_ts.load(Ordering::SeqCst) == i64::MIN {
        if wait_start.elapsed() > Duration::from_secs(5) { let _ = control.stop(); return Err("no frames received from capture source".into()); }
        std::thread::sleep(Duration::from_millis(5));
    }
    emit(json!({ "event": "started", "source": source_json, "bounds": area, "t0": shared.first_ts.load(Ordering::SeqCst) }));

    // Stop on a "stop" line, on stdin EOF (parent gone), or when the source closes.
    let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            match line.as_deref().map(str::trim) {
                Ok("stop") | Err(_) => break,
                _ => {}
            }
        }
        let _ = stop_tx.send(());
    });
    loop {
        match stop_rx.recv_timeout(Duration::from_millis(200)) {
            Ok(()) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if let Some(reason) = shared.error.lock().unwrap().clone() {
                    emit(json!({ "event": "source-closed", "message": reason }));
                    break;
                }
            }
        }
    }
    let stop_ts = capture::now();
    let recorder = control.callback();
    control.stop().map_err(|error| format!("{error:?}"))?;
    recorder.lock().finish(stop_ts)?;

    let t0 = shared.first_ts.load(Ordering::SeqCst);
    let has_system_audio = system_audio.is_some();
    let has_mic_audio = microphone.is_some();
    for (recorder, name) in [(system_audio, "audio.wav"), (microphone, "mic.wav")] {
        let Some(recorder) = recorder else { continue };
        match recorder.finish(t0, stop_ts) {
            Err(message) => emit(json!({ "event": "warning", "message": format!("{name}: {message}") })),
            // System audio is often silent; a microphone that delivers only zeros is usually muted.
            Ok(true) if name == "mic.wav" => emit(json!({ "event": "warning", "message": "The microphone recorded only silence. Check that it is not muted (many USB microphones have a mute button) and that DirectZoom may use it in Windows privacy settings." })),
            Ok(_) => {}
        }
    }
    let (width, height) = shared.size.lock().unwrap().unwrap_or((0, 0));
    let (cursor, keys) = tracker.finish(t0, width, height, !matches!(target, Target::Window(_)));
    let focus_events = focus_tracker.finish(t0, width, height, !matches!(target, Target::Window(_)));
    std::fs::write(config.output_dir.join("text-focus-events.json"), serde_json::to_vec_pretty(&focus_events)?)?;
    let duration = (stop_ts - t0) as f64 / 10_000.0;
    std::fs::write(config.output_dir.join("cursor.json"), serde_json::to_vec(&cursor)?)?;
    std::fs::write(config.output_dir.join("keyboard.json"), serde_json::to_vec(&keys)?)?;
    let metadata = json!({
        "captureArea": { "x": area.x, "y": area.y, "width": width, "height": height },
        "duration": duration, "fps": flags.fps as f64, "hasKeyboardData": !keys.is_empty(),
        "hasSystemAudio": has_system_audio, "hasMicAudio": has_mic_audio, "hasCamera": false,
        "resolution": { "width": width, "height": height }, "source": source_json,
        "frames": shared.frames.load(Ordering::Relaxed),
    });
    let frame_ms: Vec<f64> = shared.frame_times.lock().unwrap().iter().map(|t| (t - t0) as f64 / 10_000.0).collect();
    std::fs::write(config.output_dir.join("frames.json"), serde_json::to_vec(&frame_ms)?)?;
    std::fs::write(config.output_dir.join("metadata.json"), serde_json::to_vec_pretty(&metadata)?)?;
    emit(json!({ "event": "finished", "duration": duration, "width": width, "height": height,
        "frames": shared.frames.load(Ordering::Relaxed), "cursorEvents": cursor.len(), "closed": shared.error.lock().unwrap().clone() }));
    Ok(())
}
