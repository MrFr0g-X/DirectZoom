//! Display and window discovery in physical pixels (the process is per-monitor DPI aware).
use serde::Serialize;
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Dwm::{DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS, DwmGetWindowAttribute};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, HMONITOR, MONITORINFOEXW};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::WindowsAndMessaging::{GWL_EXSTYLE, GetWindowLongW, IsIconic, IsWindowVisible, WS_EX_TOOLWINDOW};
use windows_capture::monitor::Monitor;
use windows_capture::window::Window;

#[derive(Serialize, Clone, Copy, Debug)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl From<RECT> for Rect {
    fn from(r: RECT) -> Self {
        Self { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top }
    }
}

#[derive(Serialize)]
pub struct DisplayInfo {
    pub index: usize,
    pub name: String,
    pub primary: bool,
    pub bounds: Rect,
    pub scale: f64,
    pub refresh_rate: u32,
}

#[derive(Serialize)]
pub struct WindowInfo {
    pub hwnd: isize,
    pub title: String,
    pub process: String,
    pub bounds: Rect,
    pub minimized: bool,
}

pub fn monitor_rect(handle: HMONITOR) -> Option<(Rect, bool)> {
    let mut info = MONITORINFOEXW::default();
    info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
    unsafe { GetMonitorInfoW(handle, &mut info.monitorInfo).ok().ok()? };
    Some((info.monitorInfo.rcMonitor.into(), info.monitorInfo.dwFlags & 1 != 0))
}

/// Visible bounds of a window as composed by DWM; this is what Graphics Capture records.
pub fn window_rect(hwnd: HWND) -> Option<Rect> {
    let mut rect = RECT::default();
    unsafe {
        DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &mut rect as *mut _ as _, std::mem::size_of::<RECT>() as u32).ok()?;
    }
    Some(rect.into())
}

pub fn displays() -> Vec<DisplayInfo> {
    let mut result = Vec::new();
    for (position, monitor) in Monitor::enumerate().unwrap_or_default().into_iter().enumerate() {
        let handle = HMONITOR(monitor.as_raw_hmonitor());
        let Some((bounds, primary)) = monitor_rect(handle) else { continue };
        let (mut dpi_x, mut dpi_y) = (96u32, 96u32);
        unsafe { let _ = GetDpiForMonitor(handle, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y); }
        result.push(DisplayInfo {
            // One-based enumeration position, the value Monitor::from_index expects.
            index: position + 1,
            name: monitor.name().unwrap_or_default(),
            primary,
            bounds,
            scale: dpi_x as f64 / 96.0,
            refresh_rate: monitor.refresh_rate().unwrap_or(60),
        });
    }
    result
}

fn is_cloaked(hwnd: HWND) -> bool {
    let mut cloaked = 0u32;
    unsafe { DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut cloaked as *mut _ as _, 4).is_ok() && cloaked != 0 }
}

pub fn windows() -> Vec<WindowInfo> {
    let own_pid = std::process::id();
    let mut result = Vec::new();
    for window in Window::enumerate().unwrap_or_default() {
        let hwnd = HWND(window.as_raw_hwnd());
        if window.process_id().ok() == Some(own_pid) { continue; }
        let process = window.process_name().unwrap_or_default();
        // Apps with custom title bars (many Electron/Tauri apps) have empty titles;
        // keep them, labelled by process, but skip small untitled helper windows below.
        let raw_title = window.title().unwrap_or_default();
        let untitled = raw_title.trim().is_empty();
        let title = if untitled { process.trim_end_matches(".exe").to_string() } else { raw_title };
        let tool = unsafe { GetWindowLongW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW.0 != 0 };
        if tool || is_cloaked(hwnd) || !unsafe { IsWindowVisible(hwnd).as_bool() } { continue; }
        let Some(bounds) = window_rect(hwnd) else { continue };
        let minimized = unsafe { IsIconic(hwnd).as_bool() };
        let (min_w, min_h) = if untitled { (200, 150) } else { (40, 40) };
        if title.is_empty() || (!minimized && (bounds.width < min_w || bounds.height < min_h)) { continue; }
        result.push(WindowInfo { hwnd: hwnd.0 as isize, title, process, bounds, minimized });
    }
    result
}
