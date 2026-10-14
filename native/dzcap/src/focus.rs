//! Text-focus events (text-focus-events.json): while recording, UI Automation is
//! polled for the focused element. When an edit field gains focus a "focus" event is stored
//! with its bounds; when focus leaves it, a "blur" event. Fields that report no usable bounds
//! fall back to a box around the last click ("keyboard-fallback").
use crate::clock::now_100ns;
use crate::devices::{Rect, window_rect};
use crate::input::Target;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;
use windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize};
use windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation, IUIAutomationElement, UIA_ComboBoxControlTypeId, UIA_EditControlTypeId};

/// Last mouse-down position (screen px), updated by the mouse hook.
pub static LAST_CLICK_X: AtomicI64 = AtomicI64::new(i64::MIN);
pub static LAST_CLICK_Y: AtomicI64 = AtomicI64::new(i64::MIN);

#[derive(Clone, Copy)]
struct RawFocus { t: i64, focus: bool, bounds: Option<(i32, i32, i32, i32)>, click: Option<(i64, i64)>, rect: Rect }

#[derive(Serialize)]
pub struct Bounds { pub x: f64, pub y: f64, pub width: f64, pub height: f64 }

#[derive(Serialize)]
pub struct FocusEvent {
    pub t: i64,
    #[serde(rename = "type")]
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bounds: Option<Bounds>,
    pub x: f64,
    pub y: f64,
    pub source: &'static str,
}

pub struct FocusTracker {
    stop: Arc<AtomicBool>,
    events: Arc<Mutex<Vec<RawFocus>>>,
    thread: Option<JoinHandle<()>>,
}

fn editable(element: &IUIAutomationElement) -> bool {
    unsafe {
        let Ok(kind) = element.CurrentControlType() else { return false };
        if kind != UIA_EditControlTypeId && kind != UIA_ComboBoxControlTypeId { return false; }
        !element.CurrentIsPassword().map(|b| b.as_bool()).unwrap_or(false)
    }
}

impl FocusTracker {
    pub fn start(target: Target, fixed: Option<Rect>) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let events = Arc::new(Mutex::new(Vec::new()));
        let (thread_stop, thread_events) = (stop.clone(), events.clone());
        let thread = std::thread::spawn(move || unsafe {
            if CoInitializeEx(None, COINIT_MULTITHREADED).is_err() { return; }
            let automation: Option<IUIAutomation> = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok();
            if let Some(automation) = automation {
                let mut current: Option<IUIAutomationElement> = None;
                while !thread_stop.load(Ordering::Relaxed) {
                    let rect = match target {
                        Target::Window(hwnd) => window_rect(hwnd).or(fixed),
                        Target::Fixed(rect) => Some(rect),
                    };
                    if let Some(rect) = rect && let Ok(element) = automation.GetFocusedElement() {
                        let same = current.as_ref().is_some_and(|c| automation.CompareElements(c, &element).map(|b| b.as_bool()).unwrap_or(false));
                        if !same {
                            let t = now_100ns();
                            let click = Some((LAST_CLICK_X.load(Ordering::Relaxed), LAST_CLICK_Y.load(Ordering::Relaxed))).filter(|c| c.0 != i64::MIN);
                            let was_edit = current.as_ref().is_some_and(editable);
                            if editable(&element) {
                                let bounds = element.CurrentBoundingRectangle().ok().map(|r| (r.left, r.top, r.right - r.left, r.bottom - r.top));
                                thread_events.lock().unwrap().push(RawFocus { t, focus: true, bounds, click, rect });
                            } else if was_edit {
                                thread_events.lock().unwrap().push(RawFocus { t, focus: false, bounds: None, click, rect });
                            }
                            current = Some(element);
                        }
                    }
                    std::thread::sleep(Duration::from_millis(150));
                }
            }
            CoUninitialize();
        });
        Self { stop, events, thread: Some(thread) }
    }

    /// Stops polling; events in ms after `t0`, normalized to the capture rectangle.
    pub fn finish(mut self, t0: i64, width: u32, height: u32, fixed_size: bool) -> Vec<FocusEvent> {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() { let _ = thread.join(); }
        let raw = std::mem::take(&mut *self.events.lock().unwrap());
        let mut out = Vec::new();
        let mut last_centre = (0.5, 0.5);
        for event in raw {
            let (w, h) = if fixed_size { (event.rect.width as f64, event.rect.height as f64) } else { (width as f64, height as f64) };
            if w <= 0.0 || h <= 0.0 { continue; }
            let norm = |x: f64, y: f64| ((x - event.rect.x as f64) / w, (y - event.rect.y as f64) / h);
            let t = ((event.t - t0) / 10_000).max(0);
            if !event.focus {
                out.push(FocusEvent { t, kind: "blur", bounds: None, x: last_centre.0, y: last_centre.1, source: "uia" });
                continue;
            }
            // Use the field's own bounds when they are inside the capture and not the whole area.
            let own = event.bounds.and_then(|(x, y, bw, bh)| {
                if bw <= 0 || bh <= 0 { return None; }
                let (nx, ny) = norm(x as f64, y as f64);
                let (nw, nh) = (bw as f64 / w, bh as f64 / h);
                let inside = nx >= -0.01 && ny >= -0.01 && nx + nw <= 1.01 && ny + nh <= 1.01;
                (inside && nw < 0.9 && nh < 0.6).then(|| Bounds { x: nx.max(0.0), y: ny.max(0.0), width: nw.min(1.0), height: nh.min(1.0) })
            });
            let (bounds, source) = match own {
                Some(b) => (b, "uia"),
                None => {
                    let Some((cx, cy)) = event.click else { continue };
                    let (px, py) = norm(cx as f64, cy as f64);
                    if !(0.0..=1.0).contains(&px) || !(0.0..=1.0).contains(&py) { continue; }
                    // Fallback: 36% × 8% box centred on the click, clamped to the frame.
                    let (bw, bh) = (0.36, 0.08);
                    let x = (px - bw / 2.0).clamp(0.0, 1.0 - bw);
                    let y = (py - bh / 2.0).clamp(0.0, 1.0 - bh);
                    (Bounds { x, y, width: bw, height: bh }, "keyboard-fallback")
                }
            };
            last_centre = (bounds.x + bounds.width / 2.0, bounds.y + bounds.height / 2.0);
            out.push(FocusEvent { t, kind: "focus", x: last_centre.0, y: last_centre.1, bounds: Some(bounds), source });
        }
        out
    }
}
