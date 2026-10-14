//! Pointer and keyboard tracking on the frame clock.
//!
//! Recorded cursor data: position polled at ~60 Hz with a `move`
//! written only when something changes, and `down` + `click` on press, `up` on release.
//! Button events come from a low-level hook so their timing is exact.
use crate::clock::now_100ns;
use crate::devices::{Rect, window_rect};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Input::KeyboardAndMouse::GetKeyNameTextW;
use windows::Win32::UI::WindowsAndMessaging::*;

#[derive(Clone, Copy)]
pub enum Target {
    /// Fixed rectangle in global physical pixels (display or area).
    Fixed(Rect),
    /// A window whose position is re-read on every poll.
    Window(HWND),
}
unsafe impl Send for Target {}

#[derive(Clone, Copy)]
struct Raw {
    t: i64,
    x: i32,
    y: i32,
    rect: Rect,
    kind: &'static str,
    button: Option<&'static str>,
    cursor: usize,
    showing: bool,
}

#[derive(Serialize)]
pub struct CursorEvent {
    #[serde(rename = "cursorType")]
    pub cursor_type: &'static str,
    pub event: &'static str,
    pub t: i64,
    pub visible: bool,
    pub x: f64,
    pub y: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub button: Option<&'static str>,
}

/// Key event as stored in keyboard.json.
#[derive(Serialize)]
pub struct KeyEvent {
    pub t: i64,
    pub event: &'static str,
    pub key: String,
    #[serde(rename = "keyCode")]
    pub key_code: u32,
    #[serde(rename = "isModifier")]
    pub is_modifier: bool,
    pub modifiers: Modifiers,
}

#[derive(Serialize, Clone, Copy, Default)]
pub struct Modifiers {
    pub alt: bool,
    pub ctrl: bool,
    pub meta: bool,
    pub shift: bool,
}

/// Readable key names; falls back to the keyboard layout's name.
fn key_name(vk: u32, scan: u32, extended: bool) -> String {
    match vk {
        0x10 | 0xA0 | 0xA1 => "Shift".into(),
        0x11 | 0xA2 | 0xA3 => "Ctrl".into(),
        0x12 | 0xA4 | 0xA5 => "Alt".into(),
        0x5B | 0x5C => "Win".into(),
        0x41..=0x5A | 0x30..=0x39 => char::from_u32(vk).map(String::from).unwrap_or_default(),
        0x60..=0x69 => format!("Num{}", vk - 0x60),
        0x70..=0x87 => format!("F{}", vk - 0x6F),
        0x0D => "Enter".into(), 0x1B => "Esc".into(), 0x20 => "Space".into(), 0x09 => "Tab".into(),
        0x08 => "Backspace".into(), 0x2E => "Delete".into(), 0x2D => "Insert".into(),
        0x24 => "Home".into(), 0x23 => "End".into(), 0x21 => "PageUp".into(), 0x22 => "PageDown".into(),
        0x25 => "←".into(), 0x26 => "↑".into(), 0x27 => "→".into(), 0x28 => "↓".into(),
        _ => {
            let mut name = [0u16; 64];
            let lparam = ((scan as i32) << 16) | if extended { 1 << 24 } else { 0 };
            let length = unsafe { GetKeyNameTextW(lparam, &mut name) };
            String::from_utf16_lossy(&name[..length.max(0) as usize])
        }
    }
}

struct RawKey {
    t: i64,
    down: bool,
    vk: u32,
    scan: u32,
    extended: bool,
}

static EVENTS: Mutex<Vec<Raw>> = Mutex::new(Vec::new());
static KEYS: Mutex<Vec<RawKey>> = Mutex::new(Vec::new());
static RECT: Mutex<Rect> = Mutex::new(Rect { x: 0, y: 0, width: 1, height: 1 });
static CURSOR: AtomicUsize = AtomicUsize::new(0);
static SHOWING: AtomicBool = AtomicBool::new(true);
static RECORD_KEYS: AtomicBool = AtomicBool::new(false);

/// CSS cursor names, index 0 is the fallback. Order matches `system_cursors`.
const CURSOR_NAMES: [&str; 14] = [
    "default", "text", "pointer", "wait", "progress", "crosshair", "ew-resize", "ns-resize",
    "nwse-resize", "nesw-resize", "move", "not-allowed", "help", "default",
];

fn system_cursors() -> Vec<isize> {
    let ids = [IDC_ARROW, IDC_IBEAM, IDC_HAND, IDC_WAIT, IDC_APPSTARTING, IDC_CROSS, IDC_SIZEWE, IDC_SIZENS, IDC_SIZENWSE, IDC_SIZENESW, IDC_SIZEALL, IDC_NO, IDC_HELP];
    ids.iter().map(|id| unsafe { LoadCursorW(None, *id).map(|c| c.0 as isize).unwrap_or(0) }).collect()
}

fn push(kind: &'static str, button: Option<&'static str>, point: POINT, t: i64) {
    let rect = *RECT.lock().unwrap();
    EVENTS.lock().unwrap().push(Raw {
        t, x: point.x, y: point.y, rect, kind, button,
        cursor: CURSOR.load(Ordering::Relaxed), showing: SHOWING.load(Ordering::Relaxed),
    });
}

unsafe extern "system" fn mouse_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let t = now_100ns();
        let info = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
        let (kind, button) = match wparam.0 as u32 {
            WM_LBUTTONDOWN => ("down", "left"),
            WM_RBUTTONDOWN => ("down", "right"),
            WM_MBUTTONDOWN => ("down", "middle"),
            WM_LBUTTONUP => ("up", "left"),
            WM_RBUTTONUP => ("up", "right"),
            WM_MBUTTONUP => ("up", "middle"),
            _ => ("", ""),
        };
        if !kind.is_empty() {
            push(kind, Some(button), info.pt, t);
            if kind == "down" {
                push("click", Some(button), info.pt, t);
                crate::focus::LAST_CLICK_X.store(info.pt.x as i64, Ordering::Relaxed);
                crate::focus::LAST_CLICK_Y.store(info.pt.y as i64, Ordering::Relaxed);
            }
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

unsafe extern "system" fn keyboard_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 && RECORD_KEYS.load(Ordering::Relaxed) {
        let info = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        let down = matches!(wparam.0 as u32, WM_KEYDOWN | WM_SYSKEYDOWN);
        KEYS.lock().unwrap().push(RawKey {
            t: now_100ns(), down, vk: info.vkCode, scan: info.scanCode, extended: info.flags.0 & LLKHF_EXTENDED.0 != 0,
        });
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

pub struct Tracker {
    stop: Arc<AtomicBool>,
    hook_thread: Arc<AtomicU32>,
    threads: Vec<JoinHandle<()>>,
}

impl Tracker {
    pub fn start(target: Target, keyboard: bool) -> Self {
        EVENTS.lock().unwrap().clear();
        KEYS.lock().unwrap().clear();
        RECORD_KEYS.store(keyboard, Ordering::Relaxed);
        if let Target::Fixed(rect) = target { *RECT.lock().unwrap() = rect; }
        if let Target::Window(hwnd) = target && let Some(rect) = window_rect(hwnd) { *RECT.lock().unwrap() = rect; }

        let stop = Arc::new(AtomicBool::new(false));
        let hook_thread = Arc::new(AtomicU32::new(0));
        let mut threads = Vec::new();

        let hook_id = hook_thread.clone();
        threads.push(std::thread::spawn(move || unsafe {
            hook_id.store(GetCurrentThreadId(), Ordering::SeqCst);
            let module = GetModuleHandleW(None).ok();
            let instance = module.map(|m| windows::Win32::Foundation::HINSTANCE(m.0));
            let mouse = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook), instance, 0).ok();
            let keys = if keyboard { SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook), instance, 0).ok() } else { None };
            let mut message = MSG::default();
            while GetMessageW(&mut message, None, 0, 0).as_bool() {}
            if let Some(hook) = mouse { let _ = UnhookWindowsHookEx(hook); }
            if let Some(hook) = keys { let _ = UnhookWindowsHookEx(hook); }
        }));

        let poll_stop = stop.clone();
        threads.push(std::thread::spawn(move || {
            let handles = system_cursors();
            let period = Duration::from_micros(16_667);
            let mut next = Instant::now();
            let mut last: Option<(i32, i32, usize, bool)> = None;
            while !poll_stop.load(Ordering::Relaxed) {
                if let Target::Window(hwnd) = target && let Some(rect) = window_rect(hwnd) { *RECT.lock().unwrap() = rect; }
                let mut info = CURSORINFO { cbSize: std::mem::size_of::<CURSORINFO>() as u32, ..Default::default() };
                if unsafe { GetCursorInfo(&mut info) }.is_ok() {
                    let t = now_100ns();
                    let showing = info.flags.0 & CURSOR_SHOWING.0 != 0;
                    let cursor = handles.iter().position(|h| *h == info.hCursor.0 as isize && *h != 0).unwrap_or(0);
                    CURSOR.store(cursor, Ordering::Relaxed);
                    SHOWING.store(showing, Ordering::Relaxed);
                    let state = (info.ptScreenPos.x, info.ptScreenPos.y, cursor, showing);
                    if last != Some(state) { push("move", None, info.ptScreenPos, t); last = Some(state); }
                }
                next += period;
                let now = Instant::now();
                if next > now { std::thread::sleep(next - now); } else { next = now; }
            }
        }));
        Self { stop, hook_thread, threads }
    }

    /// Stops tracking and converts events to milliseconds after `t0` (first frame),
    /// normalized to the capture rectangle at the time of each event.
    pub fn finish(self, t0: i64, base_width: u32, base_height: u32, fixed_size: bool) -> (Vec<CursorEvent>, Vec<KeyEvent>) {
        self.stop.store(true, Ordering::Relaxed);
        let id = self.hook_thread.load(Ordering::SeqCst);
        if id != 0 { unsafe { let _ = PostThreadMessageW(id, WM_QUIT, WPARAM(0), LPARAM(0)); } }
        for thread in self.threads { let _ = thread.join(); }

        let mut raw = std::mem::take(&mut *EVENTS.lock().unwrap());
        raw.sort_by_key(|event| event.t);
        // The pointer may not move during the recording: start with its position at t0,
        // taken from the last sample before the first frame.
        let initial = raw.iter().rev().find(|event| event.t < t0 && event.kind == "move").copied().map(|event| Raw { t: t0, ..event });
        let starts_with_move = raw.iter().find(|event| event.t >= t0).is_some_and(|event| event.kind == "move" && event.t - t0 < 10_000);
        let cursor = initial.filter(|_| !starts_with_move).into_iter().chain(raw.into_iter().filter(|event| event.t >= t0)).map(|event| {
            // Window captures keep the first frame size (later frames are padded or cropped
            // at the top-left), so normalize against that size, offset by the current position.
            let (width, height) = if fixed_size { (event.rect.width as f64, event.rect.height as f64) } else { (base_width as f64, base_height as f64) };
            let x = (event.x - event.rect.x) as f64 / width;
            let y = (event.y - event.rect.y) as f64 / height;
            let inside = (0.0..=1.0).contains(&x) && (0.0..=1.0).contains(&y);
            CursorEvent {
                cursor_type: CURSOR_NAMES[event.cursor], event: event.kind,
                t: (event.t - t0) / 10_000, visible: event.showing && inside,
                x, y, button: event.button,
            }
        }).collect();

        let mut modifiers = Modifiers::default();
        let mut held = std::collections::HashSet::new();
        let keys = std::mem::take(&mut *KEYS.lock().unwrap()).into_iter().filter_map(|key| {
            let is_modifier = matches!(key.vk, 0x10 | 0xA0 | 0xA1 | 0x11 | 0xA2 | 0xA3 | 0x12 | 0xA4 | 0xA5 | 0x5B | 0x5C);
            match key.vk {
                0x10 | 0xA0 | 0xA1 => modifiers.shift = key.down, 0x11 | 0xA2 | 0xA3 => modifiers.ctrl = key.down,
                0x12 | 0xA4 | 0xA5 => modifiers.alt = key.down, 0x5B | 0x5C => modifiers.meta = key.down, _ => {}
            }
            // Auto-repeat sends repeated downs; keep only the first.
            if key.down && !held.insert(key.vk) { return None; }
            if !key.down { held.remove(&key.vk); }
            if key.t < t0 { return None; }
            Some(KeyEvent {
                t: (key.t - t0) / 10_000, event: if key.down { "down" } else { "up" },
                key: key_name(key.vk, key.scan, key.extended), key_code: key.vk, is_modifier, modifiers,
            })
        }).collect();
        (cursor, keys)
    }
}
