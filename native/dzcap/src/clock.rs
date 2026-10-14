//! One clock for frames and input. Windows Graphics Capture stamps frames with
//! `SystemRelativeTime`, a QueryPerformanceCounter value in 100 ns units, so input
//! events are stamped with the same counter and converted the same way.
use std::sync::OnceLock;
use windows::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};

fn frequency() -> i64 {
    static FREQUENCY: OnceLock<i64> = OnceLock::new();
    *FREQUENCY.get_or_init(|| {
        let mut value = 0i64;
        unsafe { QueryPerformanceFrequency(&mut value).expect("QueryPerformanceFrequency") };
        value
    })
}

/// Current time in the frame timestamp domain (100 ns ticks).
pub fn now_100ns() -> i64 {
    let mut counter = 0i64;
    unsafe { QueryPerformanceCounter(&mut counter).expect("QueryPerformanceCounter") };
    let frequency = frequency() as i128;
    ((counter as i128) * 10_000_000 / frequency) as i64
}
