//! H.264 MP4 writer on Media Foundation's SinkWriter.
//!
//! Every frame is written with its capture timestamp and a duration that lasts until the
//! next captured frame, so the file reproduces exactly what was on screen and when.
//! (The windows-capture encoder retimes frames through MediaTranscoder; measured offsets
//! reached hundreds of milliseconds, which broke cursor alignment.)
use std::path::Path;
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx};
use windows::core::{HSTRING, Result};

pub struct Mp4Writer {
    writer: IMFSinkWriter,
    stream: u32,
    width: u32,
    height: u32,
    /// Frame held back until the next one arrives, so its duration is known.
    pending: Option<(Vec<u8>, i64)>,
}

// The SinkWriter is created in the multithreaded apartment and used by one thread at a time.
unsafe impl Send for Mp4Writer {}

fn pack(a: u32, b: u32) -> u64 { ((a as u64) << 32) | b as u64 }

impl Mp4Writer {
    pub fn new(path: &Path, width: u32, height: u32, fps: u32, bitrate: u32) -> Result<Self> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            MFStartup(MF_VERSION, MFSTARTUP_FULL)?;

            let mut attributes = None;
            MFCreateAttributes(&mut attributes, 2)?;
            let attributes = attributes.unwrap();
            attributes.SetUINT32(&MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, 1)?;
            attributes.SetUINT32(&MF_SINK_WRITER_DISABLE_THROTTLING, 1)?;
            let writer = MFCreateSinkWriterFromURL(&HSTRING::from(path.as_os_str()), None, &attributes)?;

            let output = MFCreateMediaType()?;
            output.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
            output.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264)?;
            output.SetUINT32(&MF_MT_AVG_BITRATE, bitrate)?;
            output.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
            output.SetUINT32(&MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_High.0 as u32)?;
            output.SetUINT64(&MF_MT_FRAME_SIZE, pack(width, height))?;
            output.SetUINT64(&MF_MT_FRAME_RATE, pack(fps, 1))?;
            output.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pack(1, 1))?;
            let stream = writer.AddStream(&output)?;

            let input = MFCreateMediaType()?;
            input.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
            input.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_RGB32)?;
            input.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
            input.SetUINT64(&MF_MT_FRAME_SIZE, pack(width, height))?;
            input.SetUINT64(&MF_MT_FRAME_RATE, pack(fps, 1))?;
            input.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pack(1, 1))?;
            // Positive stride: rows are top-down, as Graphics Capture delivers them.
            input.SetUINT32(&MF_MT_DEFAULT_STRIDE, width * 4)?;
            writer.SetInputMediaType(stream, &input, None)?;
            writer.BeginWriting()?;
            Ok(Self { writer, stream, width, height, pending: None })
        }
    }

    pub fn size(&self) -> (u32, u32) { (self.width, self.height) }

    /// Queues a top-down BGRA frame of exactly `size()` captured at `time` (100 ns, relative).
    pub fn push(&mut self, bgra: Vec<u8>, time: i64) -> Result<()> {
        match self.pending.take() {
            // Frames less than 1 ms apart: the newer one replaces the held frame.
            Some((_, previous_time)) if time - previous_time < 10_000 => self.pending = Some((bgra, previous_time)),
            Some((previous, previous_time)) => {
                self.write(&previous, previous_time, time - previous_time)?;
                self.pending = Some((bgra, time));
            }
            None => self.pending = Some((bgra, time)),
        }
        Ok(())
    }

    /// Writes the held frame so that it lasts until `end`, then finalizes the file.
    pub fn finish(mut self, end: i64) -> Result<()> {
        if let Some((frame, time)) = self.pending.take() {
            self.write(&frame, time, (end - time).max(10_000))?;
        }
        unsafe { self.writer.Finalize()?; }
        Ok(())
    }

    fn write(&self, bgra: &[u8], time: i64, duration: i64) -> Result<()> {
        unsafe {
            let buffer = MFCreateMemoryBuffer(bgra.len() as u32)?;
            let mut data = std::ptr::null_mut();
            buffer.Lock(&mut data, None, None)?;
            std::ptr::copy_nonoverlapping(bgra.as_ptr(), data, bgra.len());
            buffer.Unlock()?;
            buffer.SetCurrentLength(bgra.len() as u32)?;
            let sample = MFCreateSample()?;
            sample.AddBuffer(&buffer)?;
            sample.SetSampleTime(time)?;
            sample.SetSampleDuration(duration)?;
            self.writer.WriteSample(self.stream, &sample)
        }
    }
}
