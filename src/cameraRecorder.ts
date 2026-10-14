// Webcam recording alongside a screen recording. Lives in the main window's renderer: starts
// after the native capture has started and uploads camera.mp4 with its start offset when the
// recording stops.
let active: { recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; startedAt: number; id: string; offset: number } | null = null;

export async function listCameras() {
  try {
    // Labels are only available after a permission grant; request briefly if needed.
    let devices = await navigator.mediaDevices.enumerateDevices();
    if (devices.some(d => d.kind === 'videoinput' && !d.label)) {
      const probe = await navigator.mediaDevices.getUserMedia({ video: true });
      probe.getTracks().forEach(t => t.stop());
      devices = await navigator.mediaDevices.enumerateDevices();
    }
    return devices.filter(d => d.kind === 'videoinput').map(d => ({ id: d.deviceId, label: d.label || 'Camera' }));
  } catch {
    return [];
  }
}

export async function openCamera(deviceId: string) {
  return navigator.mediaDevices.getUserMedia({
    video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    audio: false,
  });
}

const mime = ['video/mp4;codecs=avc1.42E01F', 'video/mp4;codecs=avc1', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type));

/** Starts recording `stream` for project `id`; `recordingStartedAt` is the screen recording's start (Date.now()). */
export function startCamera(stream: MediaStream, id: string, recordingStartedAt: number) {
  if (!mime) throw new Error('This system cannot record the camera as MP4');
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  recorder.start(1000);
  const startedAt = Date.now();
  active = { recorder, stream, chunks, startedAt, id, offset: startedAt - recordingStartedAt };
}

/** Stops the camera (if recording) and stores camera.mp4 in the project. */
export async function stopCamera(discard = false) {
  const current = active;
  active = null;
  if (!current) return;
  await new Promise<void>(resolve => {
    current.recorder.onstop = () => resolve();
    if (current.recorder.state !== 'inactive') current.recorder.stop(); else resolve();
  });
  current.stream.getTracks().forEach(t => t.stop());
  if (discard) return;
  const blob = new Blob(current.chunks, { type: 'video/mp4' });
  await window.dz.projects.saveCamera(current.id, new Uint8Array(await blob.arrayBuffer()), current.offset);
}

export const cameraRecording = () => !!active;
