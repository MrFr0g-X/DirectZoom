//! Exports the user's active Windows cursors as high-resolution PNGs with hotspots, so the
//! "Windows" cursor style renders exactly what the user sees on their own system.
use serde::Serialize;
use std::path::Path;
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::System::Registry::{HKEY_CURRENT_USER, RRF_RT_REG_EXPAND_SZ, RRF_RT_REG_SZ, RegGetValueW};
use windows::Win32::UI::WindowsAndMessaging::*;
use windows::core::PCWSTR;
use windows_capture::encoder::{ImageEncoder, ImageEncoderPixelFormat, ImageFormat};

#[derive(Serialize)]
pub struct CursorImage {
    pub name: &'static str,
    pub file: String,
    pub size: u32,
    pub hotspot_x: f64,
    pub hotspot_y: f64,
}

/// (CSS name, OEM cursor id, value name under HKCU\Control Panel\Cursors)
const CURSORS: [(&str, u32, &str); 13] = [
    ("default", 32512, "Arrow"), ("text", 32513, "IBeam"), ("wait", 32514, "Wait"), ("crosshair", 32515, "Crosshair"),
    ("nwse-resize", 32642, "SizeNWSE"), ("nesw-resize", 32643, "SizeNESW"), ("ew-resize", 32644, "SizeWE"), ("ns-resize", 32645, "SizeNS"),
    ("move", 32646, "SizeAll"), ("not-allowed", 32648, "No"), ("pointer", 32649, "Hand"), ("progress", 32650, "AppStarting"), ("help", 32651, "Help"),
];

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Cursor file of the active scheme, with %SystemRoot% expanded. None for built-in cursors.
fn scheme_file(value: &str) -> Option<String> {
    let mut buffer = [0u16; 520];
    let mut length = (buffer.len() * 2) as u32;
    let key = wide(r"Control Panel\Cursors");
    let name = wide(value);
    let status = unsafe {
        RegGetValueW(HKEY_CURRENT_USER, PCWSTR(key.as_ptr()), PCWSTR(name.as_ptr()), RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ,
            None, Some(buffer.as_mut_ptr() as _), Some(&mut length))
    };
    if status.is_err() { return None; }
    let text = String::from_utf16_lossy(&buffer[..(length as usize / 2).saturating_sub(1)]);
    let root = std::env::var("SystemRoot").unwrap_or_default();
    let expanded = text.replace("%SystemRoot%", &root).replace("%SYSTEMROOT%", &root);
    (!expanded.trim().is_empty()).then_some(expanded)
}

/// Loads a cursor at `size` from the scheme file, or the built-in cursor (shared handle).
unsafe fn load(id: u32, value: &str, size: u32) -> Option<(HCURSOR, bool)> {
    unsafe {
        if let Some(file) = scheme_file(value) {
            let path = wide(&file);
            if let Ok(handle) = LoadImageW(None, PCWSTR(path.as_ptr()), IMAGE_CURSOR, size as i32, size as i32, LR_LOADFROMFILE) {
                return Some((HCURSOR(handle.0), false));
            }
        }
        LoadImageW(None, PCWSTR(id as usize as *const u16), IMAGE_CURSOR, 0, 0, LR_SHARED | LR_DEFAULTSIZE)
            .ok()
            .map(|handle| (HCURSOR(handle.0), true))
    }
}

/// Draws the cursor scaled to `size` onto a solid background; BGRA rows, top-down.
unsafe fn draw(cursor: HCURSOR, size: u32, background: u8) -> Vec<u8> {
    unsafe {
        let screen = GetDC(None);
        let dc = CreateCompatibleDC(Some(screen));
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32, biWidth: size as i32, biHeight: -(size as i32),
                biPlanes: 1, biBitCount: 32, biCompression: BI_RGB.0, ..Default::default()
            },
            ..Default::default()
        };
        let mut bits = std::ptr::null_mut();
        let bitmap = CreateDIBSection(Some(dc), &info, DIB_RGB_COLORS, &mut bits, None, 0).unwrap();
        let old = SelectObject(dc, bitmap.into());
        let length = (size * size * 4) as usize;
        std::ptr::write_bytes(bits as *mut u8, background, length);
        let _ = DrawIconEx(dc, 0, 0, HICON(cursor.0), size as i32, size as i32, 0, None, DI_NORMAL);
        let _ = GdiFlush();
        let pixels = std::slice::from_raw_parts(bits as *const u8, length).to_vec();
        SelectObject(dc, old);
        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(dc);
        ReleaseDC(None::<HWND>, screen);
        pixels
    }
}

pub fn export(dir: &Path, size: u32) -> Result<Vec<CursorImage>, Box<dyn std::error::Error + Send + Sync>> {
    std::fs::create_dir_all(dir)?;
    let mut result = Vec::new();
    for (name, id, value) in CURSORS {
        unsafe {
            let Some((cursor, shared)) = load(id, value, size) else { continue };
            let mut icon = ICONINFO::default();
            if GetIconInfo(HICON(cursor.0), &mut icon).is_err() {
                if !shared { let _ = DestroyCursor(cursor); }
                continue;
            }
            // Natural width of the loaded image; the hotspot is in those pixels.
            let mut bitmap = BITMAP::default();
            let source = if icon.hbmColor.is_invalid() { icon.hbmMask } else { icon.hbmColor };
            GetObjectW(source.into(), std::mem::size_of::<BITMAP>() as i32, Some(&mut bitmap as *mut _ as _));
            let natural = bitmap.bmWidth.max(1) as f64;
            if !icon.hbmColor.is_invalid() { let _ = DeleteObject(icon.hbmColor.into()); }
            if !icon.hbmMask.is_invalid() { let _ = DeleteObject(icon.hbmMask.into()); }

            // Drawing on black and on white recovers exact alpha and colour.
            let black = draw(cursor, size, 0);
            let white = draw(cursor, size, 255);
            if !shared { let _ = DestroyCursor(cursor); }
            let mut bgra = vec![0u8; black.len()];
            for i in (0..black.len()).step_by(4) {
                let spread = ((white[i] as i32 - black[i] as i32) + (white[i + 1] as i32 - black[i + 1] as i32)
                    + (white[i + 2] as i32 - black[i + 2] as i32)) / 3;
                let alpha = (255 - spread).clamp(0, 255) as u8;
                if alpha > 0 {
                    for c in 0..3 { bgra[i + c] = ((black[i + c] as u32 * 255) / alpha as u32).min(255) as u8; }
                }
                bgra[i + 3] = alpha;
            }
            let png = ImageEncoder::new(ImageFormat::Png, ImageEncoderPixelFormat::Bgra8)?.encode(&bgra, size, size)?;
            let file = format!("{name}.png");
            std::fs::write(dir.join(&file), png)?;
            result.push(CursorImage { name, file, size, hotspot_x: icon.xHotspot as f64 / natural, hotspot_y: icon.yHotspot as f64 / natural });
        }
    }
    std::fs::write(dir.join("cursors.json"), serde_json::to_vec_pretty(&result)?)?;
    Ok(result)
}
