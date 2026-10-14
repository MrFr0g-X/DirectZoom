import { useEffect, useState } from 'react';
import { Library } from './ui/Library';
import { Editor } from './ui/Editor';
import { RecordingBar } from './ui/RecordingBar';
import { AreaSelect } from './ui/AreaSelect';
import { CameraPreview } from './ui/CameraPreview';
import { GlobalDialogs } from './ui/GlobalDialogs';
import { startCamera, stopCamera } from './cameraRecorder';

// Test hook: lets automated checks drive the camera path with a synthetic stream.
(window as any).__directzoomCamera = { startCamera, stopCamera };

const readRoute = () => window.location.hash.replace(/^#/, '') || '/library';

export function navigate(route: string) {
  window.location.hash = route;
}

export function App() {
  const [route, setRoute] = useState(readRoute);
  // The main window owns the webcam recorder: stop and save it when capture stops.
  useEffect(() => window.dz.recording.onState(state => { if (state.state === 'saving') stopCamera(); }), []);
  useEffect(() => {
    const onChange = () => setRoute(readRoute());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  if (route.startsWith('/recording-bar')) return <RecordingBar />;
  if (route.startsWith('/area')) return <AreaSelect />;
  if (route.startsWith('/camera-preview')) return <CameraPreview />;
  const editor = /^\/editor\/([\w.-]+)/.exec(route);
  return (
    <>
      {editor ? <Editor key={editor[1]} projectId={editor[1]} /> : <Library />}
      <GlobalDialogs />
    </>
  );
}
