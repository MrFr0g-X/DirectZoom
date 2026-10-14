//! Windows Graphics Capture with the pointer excluded, written by `Mp4Writer`.
use crate::clock::now_100ns;
use crate::writer::Mp4Writer;
use std::path::PathBuf;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use windows_capture::capture::{Context, GraphicsCaptureApiHandler};
use windows_capture::frame::Frame;
use windows_capture::graphics_capture_api::InternalCaptureControl;

pub struct Shared {
    pub first_ts: AtomicI64,
    pub last_ts: AtomicI64,
    pub frames: AtomicU64,
    pub size: Mutex<Option<(u32, u32)>>,
    pub error: Mutex<Option<String>>,
    /// Raw capture timestamps (100 ns), kept for diagnostics.
    pub frame_times: Mutex<Vec<i64>>,
}

impl Shared {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            first_ts: AtomicI64::new(i64::MIN), last_ts: AtomicI64::new(i64::MIN), frames: AtomicU64::new(0),
            size: Mutex::new(None), error: Mutex::new(None), frame_times: Mutex::new(Vec::new()),
        })
    }
}

#[derive(Clone)]
pub struct Flags {
    pub output: PathBuf,
    pub fps: u32,
    /// Frame-relative crop (x0, y0, x1, y1) for area recordings.
    pub crop: Option<(u32, u32, u32, u32)>,
    pub shared: Arc<Shared>,
}

pub struct Recorder {
    flags: Flags,
    writer: Option<Mp4Writer>,
    scratch: Vec<u8>,
}

type BoxError = Box<dyn std::error::Error + Send + Sync>;

impl GraphicsCaptureApiHandler for Recorder {
    type Flags = Flags;
    type Error = BoxError;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        Ok(Self { flags: ctx.flags, writer: None, scratch: Vec::new() })
    }

    fn on_frame_arrived(&mut self, frame: &mut Frame, _control: InternalCaptureControl) -> Result<(), Self::Error> {
        let timestamp = frame.timestamp()?.Duration;
        let (frame_w, frame_h) = (frame.width(), frame.height());
        let (x0, y0, x1, y1) = self.flags.crop.unwrap_or((0, 0, frame_w, frame_h));
        if self.writer.is_none() {
            // H.264 needs even dimensions.
            let width = (x1 - x0) & !1;
            let height = (y1 - y0) & !1;
            let bitrate = ((width as u64 * height as u64 * self.flags.fps as u64) as f64 * 0.15) as u32;
            self.writer = Some(Mp4Writer::new(&self.flags.output, width, height, self.flags.fps, bitrate.max(2_000_000))?);
            *self.flags.shared.size.lock().unwrap() = Some((width, height));
            self.flags.shared.first_ts.store(timestamp, Ordering::SeqCst);
        }
        let first = self.flags.shared.first_ts.load(Ordering::SeqCst);
        let writer = self.writer.as_mut().unwrap();
        let (width, height) = writer.size();

        // Window captures can change size; keep the first size, anchored top-left.
        let copy_w = width.min(x1.min(frame_w).saturating_sub(x0));
        let copy_h = height.min(y1.min(frame_h).saturating_sub(y0));
        if copy_w == 0 || copy_h == 0 { return Ok(()); }
        let buffer = frame.buffer_crop(x0, y0, x0 + copy_w, y0 + copy_h)?;
        let rows = buffer.as_nopadding_buffer(&mut self.scratch);
        let mut image = vec![0u8; (width * height * 4) as usize];
        let (src_stride, dst_stride) = (copy_w as usize * 4, width as usize * 4);
        for row in 0..copy_h as usize {
            image[row * dst_stride..row * dst_stride + src_stride].copy_from_slice(&rows[row * src_stride..row * src_stride + src_stride]);
        }
        writer.push(image, timestamp - first)?;

        self.flags.shared.last_ts.store(timestamp, Ordering::SeqCst);
        self.flags.shared.frames.fetch_add(1, Ordering::Relaxed);
        self.flags.shared.frame_times.lock().unwrap().push(timestamp);
        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        *self.flags.shared.error.lock().unwrap() = Some("capture source closed".into());
        Ok(())
    }
}

impl Recorder {
    /// Finalizes the MP4 so the last frame lasts until `stop_ts`. Call after capture stopped.
    pub fn finish(&mut self, stop_ts: i64) -> Result<(), BoxError> {
        let first = self.flags.shared.first_ts.load(Ordering::SeqCst);
        if let Some(writer) = self.writer.take() { writer.finish(stop_ts - first)?; }
        Ok(())
    }
}

pub fn now() -> i64 { now_100ns() }
