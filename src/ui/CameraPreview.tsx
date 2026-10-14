import { useEffect, useRef, useState } from 'react';

/** Floating webcam bubble shown while recording; drag it anywhere. Not part of the capture. */
export function CameraPreview() {
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    document.body.style.background = 'transparent';
    const device = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('device') || undefined;
    let stream: MediaStream | null = null;
    navigator.mediaDevices.getUserMedia({ video: { deviceId: device ? { exact: device } : undefined, width: { ideal: 640 }, height: { ideal: 640 } }, audio: false })
      .then(s => { stream = s; if (video.current) video.current.srcObject = s; })
      .catch(() => setFailed(true));
    return () => stream?.getTracks().forEach(t => t.stop());
  }, []);
  return (
    <div className="camera-preview">
      {failed ? <div className="camera-preview-error">Camera unavailable</div> : <video ref={video} autoPlay muted playsInline />}
    </div>
  );
}
