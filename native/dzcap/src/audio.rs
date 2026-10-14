//! WASAPI capture of system audio (loopback) or a microphone (the default one unless chosen).
//!
//! Packets carry a QPC timestamp, the same clock as video frames. Loopback delivers no
//! packets while nothing plays, so audio is placed on the timeline by timestamp and gaps
//! become silence; appending packets would make the file shorter than the video.
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;
use windows::Win32::Media::Audio::*;
use windows::Win32::Media::KernelStreaming::{KSDATAFORMAT_SUBTYPE_PCM, WAVE_FORMAT_EXTENSIBLE};
use windows::Win32::Media::Multimedia::KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;
use windows::Win32::System::Com::{CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree, STGM_READ};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;

#[derive(Clone, Copy, PartialEq)]
pub enum Kind { System, Microphone }

struct Packet { qpc: i64, frames: u32, data: Option<Vec<u8>> }

struct Format { rate: u32, channels: u16, float: bool, bits: u16 }

pub struct AudioRecorder {
    stop: Arc<AtomicBool>,
    thread: JoinHandle<Result<(Format, Vec<Packet>), String>>,
    path: PathBuf,
}

const WAVE_FORMAT_IEEE_FLOAT_TAG: u16 = 3;

#[derive(serde::Serialize)]
pub struct Microphone { pub id: String, pub name: String, pub default: bool }

unsafe fn device_id(device: &IMMDevice) -> Option<String> {
    let raw = unsafe { device.GetId() }.ok()?;
    let id = unsafe { raw.to_string() }.ok();
    unsafe { CoTaskMemFree(Some(raw.0 as _)) };
    id
}

/// Active capture endpoints with their friendly names.
pub fn microphones() -> Vec<Microphone> {
    let list = || -> windows::core::Result<Vec<Microphone>> { unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let default = enumerator.GetDefaultAudioEndpoint(eCapture, eConsole).ok().and_then(|d| device_id(&d));
        let collection = enumerator.EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE)?;
        let mut out = Vec::new();
        for i in 0..collection.GetCount()? {
            let device = collection.Item(i)?;
            let Some(id) = device_id(&device) else { continue };
            let name = device.OpenPropertyStore(STGM_READ).ok()
                .and_then(|store| store.GetValue(&PKEY_Device_FriendlyName).ok())
                .and_then(|value| PropVariantToStringAlloc(&value).ok())
                .and_then(|text| { let s = text.to_string().ok(); CoTaskMemFree(Some(text.0 as _)); s })
                .unwrap_or_else(|| "Microphone".into());
            out.push(Microphone { default: default.as_deref() == Some(id.as_str()), id, name });
        }
        Ok(out)
    }};
    list().unwrap_or_default()
}

impl AudioRecorder {
    /// `device`: a capture endpoint id for the microphone (the default one when absent or gone).
    pub fn start(kind: Kind, device: Option<String>, path: PathBuf) -> Result<Self, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();
        let thread = std::thread::spawn(move || -> Result<(Format, Vec<Packet>), String> {
            let setup = || -> windows::core::Result<(IAudioClient, IAudioCaptureClient, Format)> { unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
                let chosen = match (&device, kind) {
                    (Some(id), Kind::Microphone) => enumerator.GetDevice(&windows::core::HSTRING::from(id.as_str())).ok(),
                    _ => None,
                };
                let device = match chosen {
                    Some(device) => device,
                    None => enumerator.GetDefaultAudioEndpoint(if kind == Kind::System { eRender } else { eCapture }, eConsole)?,
                };
                let client: IAudioClient = device.Activate(CLSCTX_ALL, None)?;
                let mix = client.GetMixFormat()?;
                let wave = *mix;
                let float = if wave.wFormatTag == WAVE_FORMAT_EXTENSIBLE as u16 {
                    let extensible = *(mix as *const WAVEFORMATEXTENSIBLE);
                    let sub = extensible.SubFormat;
                    sub == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT && sub != KSDATAFORMAT_SUBTYPE_PCM
                } else { wave.wFormatTag == WAVE_FORMAT_IEEE_FLOAT_TAG };
                let flags = if kind == Kind::System { AUDCLNT_STREAMFLAGS_LOOPBACK } else { 0 };
                client.Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 2_000_000, 0, mix, None)?;
                CoTaskMemFree(Some(mix as _));
                let capture: IAudioCaptureClient = client.GetService()?;
                client.Start()?;
                Ok((client, capture, Format { rate: wave.nSamplesPerSec, channels: wave.nChannels, float, bits: wave.wBitsPerSample }))
            }};
            let (client, capture, format) = match setup() {
                Ok(value) => { let _ = ready_tx.send(Ok(())); value }
                Err(error) => { let _ = ready_tx.send(Err(error.to_string())); return Err(error.to_string()); }
            };
            let block = format.channels as usize * format.bits as usize / 8;
            let mut packets = Vec::new();
            while !flag.load(Ordering::Relaxed) {
                std::thread::sleep(std::time::Duration::from_millis(10));
                unsafe {
                    while capture.GetNextPacketSize().unwrap_or(0) > 0 {
                        let (mut data, mut frames, mut flags, mut qpc) = (std::ptr::null_mut(), 0u32, 0u32, 0u64);
                        if capture.GetBuffer(&mut data, &mut frames, &mut flags, None, Some(&mut qpc)).is_err() { break; }
                        let silent = flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0;
                        let bytes = (!silent && !data.is_null()).then(|| std::slice::from_raw_parts(data, frames as usize * block).to_vec());
                        packets.push(Packet { qpc: qpc as i64, frames, data: bytes });
                        let _ = capture.ReleaseBuffer(frames);
                    }
                }
            }
            unsafe { let _ = client.Stop(); }
            Ok((format, packets))
        });
        ready_rx.recv().map_err(|e| e.to_string())??;
        Ok(Self { stop, thread, path })
    }

    /// Writes a 16-bit stereo WAV covering exactly [t0, end] (100 ns QPC times).
    /// Writes the WAV; returns true when every sample was zero (e.g. a muted microphone).
    pub fn finish(self, t0: i64, end: i64) -> Result<bool, String> {
        self.stop.store(true, Ordering::Relaxed);
        let (format, packets) = self.thread.join().map_err(|_| "audio thread panicked")??;
        let rate = format.rate as i64;
        let total = ((end - t0).max(0) as i128 * rate as i128 / 10_000_000) as usize;
        let mut out = vec![0i16; total * 2];
        let channels = format.channels as usize;
        let sample = |data: &[u8], frame: usize, channel: usize| -> i16 {
            let channel = channel.min(channels - 1);
            if format.float {
                let o = (frame * channels + channel) * 4;
                let v = f32::from_le_bytes([data[o], data[o + 1], data[o + 2], data[o + 3]]);
                (v.clamp(-1.0, 1.0) * 32767.0) as i16
            } else if format.bits == 16 {
                let o = (frame * channels + channel) * 2;
                i16::from_le_bytes([data[o], data[o + 1]])
            } else {
                let o = (frame * channels + channel) * (format.bits as usize / 8) + (format.bits as usize / 8 - 2);
                i16::from_le_bytes([data[o], data[o + 1]])
            }
        };
        let snap = rate / 50; // packets within 20 ms of the cursor continue seamlessly
        let mut cursor: i64 = 0;
        for packet in &packets {
            let mut position = ((packet.qpc - t0) as i128 * rate as i128 / 10_000_000) as i64;
            if (position - cursor).abs() <= snap { position = cursor; }
            for frame in 0..packet.frames as i64 {
                let index = position + frame;
                if index < 0 || index as usize >= total { continue; }
                if let Some(data) = &packet.data {
                    out[index as usize * 2] = sample(data, frame as usize, 0);
                    out[index as usize * 2 + 1] = sample(data, frame as usize, 1);
                }
            }
            cursor = position + packet.frames as i64;
        }
        write_wav(&self.path, format.rate, &out).map_err(|e| e.to_string())?;
        Ok(out.iter().all(|s| *s == 0))
    }
}

fn write_wav(path: &PathBuf, rate: u32, samples: &[i16]) -> std::io::Result<()> {
    let data_len = (samples.len() * 2) as u32;
    let mut bytes = Vec::with_capacity(44 + data_len as usize);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes()); // PCM
    bytes.extend_from_slice(&2u16.to_le_bytes()); // stereo
    bytes.extend_from_slice(&rate.to_le_bytes());
    bytes.extend_from_slice(&(rate * 4).to_le_bytes());
    bytes.extend_from_slice(&4u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples { bytes.extend_from_slice(&sample.to_le_bytes()); }
    std::fs::write(path, bytes)
}
