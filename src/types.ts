// Project model, as stored in each recording folder.

export type CursorEvent = {
  t: number; x: number; y: number; event: 'move' | 'down' | 'click' | 'up'; visible: boolean;
  cursorType?: string; button?: 'left' | 'right' | 'middle';
};

/** Zoom region in source time (ms). */
export type ZoomRegion = { id: string; name?: string; start: number; end: number; scale: number; focus: { x: number; y: number }; source?: 'auto' | 'manual' };

/** Blurred rectangle in source time; bounds are normalized to the full video frame. */
export type BlurRegion = { id: string; name?: string; start: number; end: number; bounds: { x: number; y: number; width: number; height: number }; strength?: number; transition?: number; transitionIn?: number; transitionOut?: number };

/** Drawn annotation in output space (points normalized to the composition), timeline ms. */
export type Annotation = {
  id: string; name?: string; startMs: number; endMs: number; points: Array<{ x: number; y: number }>;
  shape: 'freehand' | 'line' | 'arrow' | 'rectangle' | 'ellipse'; tool: 'pen' | 'highlighter';
  color: string; strokeWidth: number; opacity: number; animation: 'draw-on' | 'fade' | 'pop' | 'pulse' | 'none';
};

export type AnnotationSettings = {
  enabled: boolean; defaultColor: string; defaultStrokeWidth: number; defaultOpacity: number; defaultDurationMs: number;
  defaultTool: Annotation['tool']; defaultShape: Annotation['shape']; defaultAnimation: Annotation['animation'];
};

/** A kept piece of the source, placed on the output timeline. */
export type Clip = { id: string; sourceStart: number; sourceEnd: number; speed: number; timelineStart: number };

export type KeyEvent = {
  t: number; event: 'down' | 'up'; key: string; keyCode: number; isModifier: boolean;
  modifiers: { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean };
};

export type KeyboardSettings = {
  enabled: boolean; position: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
  fontSize: number; style: 'pill' | 'minimal' | 'keycap' | 'glass' | 'outline' | 'flat';
  backgroundColor: string; textColor: string; showModifierSymbols: boolean; holdAnimation: boolean; holdAnimationColor: string;
  displayDuration: number; opacity: number; groupingThreshold: number;
};

export type Metadata = {
  id: string; name: string; createdAt: string; duration: number; fps: number;
  resolution: { width: number; height: number }; captureArea?: { x: number; y: number; width: number; height: number };
  source?: string; sourceName?: string; hasSystemAudio?: boolean; hasMicAudio?: boolean; cursorEmbedded?: boolean; importedFrom?: string;
  hasCamera?: boolean; cameraOffset?: number;
};

export type BackgroundSettings = {
  type: 'wallpaper' | 'gradient' | 'solid' | 'image';
  wallpaper: string; gradient: string; color: string; imagePath: string | null;
  aspectRatio: 'original' | '16:9' | '9:16' | '1:1' | '4:3' | '21:9';
  fitMode: 'contain' | 'cover';
  padding: number; borderRadius: number; inset: number; backgroundBlur: number;
  shadow: boolean; shadowSettings: { blur: number; offsetX: number; offsetY: number; opacity: number };
};

export type CursorSettingsModel = {
  visible: boolean; cursorDesign: 'macos' | 'windows' | 'minimal' | 'crosshair' | 'lavender' | 'parched'; size: number; color: string; strokeColor: string;
  smooth: boolean; smoothingIntensity: number; hideWhenIdle: boolean; idleHideDelayMs: number;
  clickShrink: boolean; clickShrinkAmount: number; tiltOnMove: boolean; tiltAmount: number;
  highlightClicks: boolean; clickEffect: 'ring' | 'ripple' | 'glow' | 'burst' | 'bounce' | 'none'; clickEffectDuration: number; highlightColor: string;
  useDetectedCursorType: boolean; forcedCursorType: string;
};

export type ZoomSettings = {
  enabled: boolean; autoDetect: boolean; detectOnClicks: boolean; detectOnDeceleration: boolean;
  defaultScale: number; transitionDuration: number;
  followCursor: boolean; followCursorSafeZone: number; followCursorSmoothing: number; followCursorAlwaysTrack: boolean;
  motionBlur: boolean; motionBlurStrength: number; cursorMotionBlur: number;
};

export type AudioSettings = {
  systemVolume: number; micVolume: number;
  backgroundMusicEnabled: boolean; backgroundMusicPath: string | null; backgroundMusicName: string | null;
  backgroundMusicVolume: number; backgroundMusicDurationMs: number; backgroundMusicLoop: boolean;
  autoDuck: boolean; autoDuckAmount: number;
  speechCleanup: SpeechCleanup;
};

/** Speech cleanup: a processed copy of the voice track replaces it when present. */
export type SpeechCleanup = {
  normalizedVolume: boolean; backgroundNoiseRemoval: boolean; noiseEngine: 'local' | 'ai'; fillerWordsRemoved: boolean;
  voiceReplacement: { voiceId: string; voiceName: string } | null;
  micProcessedPath: string | null; processedTrack: 'mic' | 'audio' | null; micError: string | null; processedAt: number;
};

/** One spoken word (ms). Transcribed captions use source time, voiceover captions timeline time. */
export type CaptionWord = { text: string; startMs: number; endMs: number; confidence?: number; id?: string };
export type Caption = {
  id: string; text: string; startMs: number; endMs: number; words?: CaptionWord[];
  source?: 'transcription' | 'voiceover' | 'manual'; sourceId?: string;
};

/** Google Drive connection state. */
export type DriveStatus = { configured: boolean; connected: boolean; email: string | null };

/** App update state. `portable` builds can't self-update: they link to `releasesPage` instead. */
export type UpdateState = {
  status: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error';
  version: string | null; progress: number; error: string | null; current: string; portable: boolean; releasesPage: string;
};

/** Offline captions engine (whisper.cpp) install state. */
export type WhisperStatus = { installed: boolean; models: Array<{ id: string; label: string; installed: boolean }> };

/** Offline voiceover engine (Piper) install state. */
export type PiperStatus = { installed: boolean; voices: Array<{ id: string; name: string; installed: boolean }> };

/** Voiceover clip; times in timeline ms, trims within the generated audio. */
export type VoiceoverClip = {
  id: string; name?: string; script: string; audioPath: string; durationMs: number; startTimeMs: number;
  trimStartMs: number; trimEndMs: number; volume: number;
  provider: string; voiceId: string; voiceName: string; modelId: string; words?: CaptionWord[];
};

/** Camera keyframe (source ms); position 1–9 or a custom 0–1 point. */
export type CameraKeyframe = {
  id: string; time: number; position: number; customPosition?: { x: number; y: number }; shape?: CameraSettings['shape'];
  size: number; roundness: number; mirror: boolean; visible: boolean; opacity: number;
};

/** Recorder text-focus event (text-focus-events.json, source ms). */
export type TextFocusEvent = { t: number; type: 'focus' | 'blur'; bounds?: { x: number; y: number; width: number; height: number }; x: number; y: number; source?: string };
export type TextFocusRegion = { id: string; start: number; end: number; bounds: { x: number; y: number; width: number; height: number } };
export type TextFocusSettings = {
  enabled: boolean; mode: 'dim' | 'blur'; blurAmount: number; dimOpacity: number; dimColor: string; padding: number; borderRadius: number;
  transitionDuration: number; autoDetect: boolean;
};

/** 3D keyframe (source ms). */
export type ThreeDKeyframe = { id: string; name?: string; startTime: number; endTime: number; rotateX: number; rotateY: number; rotateZ: number; perspective: number; scale: number };
export type ThreeDSettings = {
  enabled: boolean; defaultRotateX: number; defaultRotateY: number; defaultRotateZ: number; defaultPerspective: number; defaultScale: number;
  reflection: boolean; reflectionOpacity: number; reflectionGap: number; transitionDuration: number;
};

export type CaptionSettings = {
  enabled: boolean; style: 'classic' | 'tiktok' | 'karaoke'; position: 'bottom' | 'top' | 'center';
  fontSize: number; fontFamily: string; fontWeight: 'normal' | 'bold' | 'black'; textTransform: 'none' | 'uppercase' | 'lowercase';
  letterSpacing: number; lineHeight: number; textColor: string; highlightColor: string;
  backgroundColor: string; backgroundOpacity: number; textShadow: boolean; textShadowColor: string; textShadowBlur: number;
  textStroke: boolean; strokeColor: string; strokeWidth: number; maxWordsPerLine: number; maxLines: number;
  wordSpacing: number; padding: number; marginBottom: number; animation: 'fade' | 'pop' | 'slide' | 'bounce' | 'none';
  animationDuration: number; highlightCurrentWord: boolean; wordBackground: boolean; wordBackgroundColor: string; wordBorderRadius: number;
};

export type ProjectSettings = {
  version: 1;
  backgroundSettings: BackgroundSettings;
  cursorSettings: CursorSettingsModel;
  zoomSettings: ZoomSettings;
  audioSettings: AudioSettings;
  keyboardSettings: KeyboardSettings;
  cropSettings: CropSettings;
  annotationSettings: AnnotationSettings;
  cameraSettings: CameraSettings;
  captionSettings: CaptionSettings;
  threeDSettings: ThreeDSettings;
  textFocusSettings: TextFocusSettings;
};

/** Webcam overlay. Position 1–9 is a 3×3 grid, reading order. */
export type CameraSettings = {
  visible: boolean; position: number; shape: 'circle' | 'rounded' | 'square' | 'landscape' | 'portrait'; size: number; roundness: number;
  mirror: boolean; shrinkOnZoom: boolean; zoomedSize: number; borderWidth: number; borderColor: string; shadow: boolean;
};

export type CropSettings = { enabled: boolean; region: { x: number; y: number; width: number; height: number } };

export type Project = {
  id: string;
  /** Per-track splits/removals for camera, system audio and microphone (source ms). */
  trackSegments: import('./trackSegments').TrackSegments;
  metadata: Metadata;
  cursorData: CursorEvent[];
  keyboardData: KeyEvent[];
  zooms: ZoomRegion[];
  clips: Clip[];
  blurRegions: BlurRegion[];
  annotations: Annotation[];
  captions: Caption[];
  voiceoverClips: VoiceoverClip[];
  threeDKeyframes: ThreeDKeyframe[];
  cameraKeyframes: CameraKeyframe[];
  textFocusEvents: TextFocusEvent[];
  textFocusRegions: TextFocusRegion[];
  settings: ProjectSettings;
  files: { screen: boolean; audio: boolean; mic: boolean; camera?: boolean };
};

export type ProjectSummary = Metadata & { hasThumbnail: boolean };

export type Microphone = { id: string; name: string; default: boolean };
export type DisplayDevice = { index: number; name: string; primary: boolean; bounds: Rect; scale: number; refresh_rate: number; thumbnail: string | null };
export type WindowDevice = { hwnd: number; title: string; process: string; bounds: Rect; thumbnail: string | null; icon: string | null };
export type Rect = { x: number; y: number; width: number; height: number };
export type CaptureSource =
  | { kind: 'display'; index: number }
  | { kind: 'window'; hwnd: number }
  | { kind: 'area'; display: number; rect: Rect };

export type SystemCursor = { url: string; hotspotX: number; hotspotY: number };

declare global {
  interface Window {
    dz: {
      window: { minimize(): Promise<void>; toggleMaximize(): Promise<void>; close(): Promise<void>; isMaximized(): Promise<boolean>; onMaximized(l: (v: boolean) => void): () => void };
      devices(): Promise<{ displays: DisplayDevice[]; windows: WindowDevice[]; microphones: Microphone[] }>;
      selectArea(displayIndex: number): Promise<{ display: number; rect: Rect } | null>;
      areaDone(rect: Rect | null): Promise<void>;
      recording: {
        start(options: { source: CaptureSource; sourceName: string; fps: number; systemAudio: boolean; microphone: boolean; keyboard: boolean; camera?: boolean; cameraDeviceId?: string; microphoneId?: string }): Promise<{ id: string; startedAt: number }>;
        stop(options?: { discard?: boolean }): Promise<{ id?: string; discarded?: boolean }>;
        status(): Promise<{ state: string; startedAt?: number }>;
        onState(l: (s: { state: string; startedAt?: number }) => void): () => void;
        onFinished(l: (s: { id: string; warnings: string[]; closed: string | null }) => void): () => void;
      };
      projects: {
        list(): Promise<ProjectSummary[]>;
        load(id: string): Promise<Omit<Project, 'settings'> & { settings: Partial<ProjectSettings> | null }>;
        save(project: Partial<Project> & { id: string }): Promise<boolean>;
        rename(id: string, name: string): Promise<void>;
        remove(id: string): Promise<boolean>;
        importFolder(): Promise<string[]>;
        saveCamera(id: string, bytes: Uint8Array, offset: number): Promise<boolean>;
        mediaUrl(id: string, file: string): string;
      };
      systemCursors(): Promise<Record<string, SystemCursor>>;
      ai: {
        status(): Promise<{ configured: boolean }>;
        setKey(key: string): Promise<{ configured: boolean }>;
        account(): Promise<{ configured: boolean; available?: boolean; tier?: string | null; status?: string | null; used?: number; limit?: number; resetsAt?: number | null }>;
        transcribe(id: string, options?: { language?: string; engine?: 'elevenlabs' | 'local'; model?: string }): Promise<{ language: string | null; text: string; words: CaptionWord[] }>;
        voices(): Promise<Array<{ id: string; name: string; category: string; description: string; previewUrl: string | null }>>;
        generateVoiceover(id: string, options: { script: string; voiceId: string; provider?: 'elevenlabs' | 'piper'; voiceName?: string; modelId?: string; startTimeMs: number; stability?: number; similarity?: number; style?: number; speed?: number }): Promise<VoiceoverClip>;
      };
      saveSrt(name: string, text: string): Promise<string | null>;
      openSubtitles(): Promise<string | null>;
      /** Audio peaks 0–255, 100 per second of source time. */
      audioPeaks(id: string, track?: 'mic' | 'audio'): Promise<Uint8Array | null>;
      diagnostics(): Promise<string | null>;
      appInfo(): Promise<{ version: string; electron: string }>;
      gdrive: {
        status(): Promise<DriveStatus>;
        connect(): Promise<DriveStatus>;
        disconnect(): Promise<DriveStatus>;
        upload(file: string): Promise<{ id: string; name: string; link: string }>;
        importClient(): Promise<DriveStatus | null>;
        onProgress(listener: (p: { file: string; progress: number }) => void): () => void;
      };
      openLink(url: string): Promise<void>;
      setTheme(preference: 'system' | 'dark' | 'light'): Promise<void>;
      updates: {
        state(): Promise<UpdateState>;
        check(): Promise<UpdateState>;
        install(): Promise<void>;
        onState(listener: (s: UpdateState) => void): () => void;
      };
      whisper: {
        status(): Promise<WhisperStatus>;
        install(model: string): Promise<WhisperStatus>;
        remove(model: string): Promise<WhisperStatus>;
        onProgress(listener: (p: { stage: string; progress: number }) => void): () => void;
        onTranscribeProgress(listener: (p: { id: string; progress: number }) => void): () => void;
      };
      piper: {
        status(): Promise<PiperStatus>;
        install(voice: string): Promise<PiperStatus>;
        onProgress(listener: (p: { stage: string; progress: number }) => void): () => void;
      };
      speech: {
        process(id: string, options: { normalize?: boolean; denoise?: 'off' | 'local' | 'ai'; fillers?: Array<{ start: number; end: number }>; voiceId?: string | null }): Promise<{ file: string; track: 'mic' | 'audio' }>;
        onProgress(listener: (p: { id: string; stage: string }) => void): () => void;
      };
      chooseMusic(id: string): Promise<{ name: string; file: string; durationMs: number } | null>;
      exporter: {
        choose(name: string, format: string): Promise<string | null>;
        begin(): Promise<string>;
        write(jobId: string, position: number, bytes: Uint8Array): Promise<void>;
        cancel(jobId: string): Promise<void>;
        finish(jobId: string, job: ExportJob): Promise<{ path: string; size: number }>;
        onProgress(l: (p: { jobId: string; progress: number }) => void): () => void;
      };
      reveal(file: string): Promise<void>;
    };
  }
}

/** Part of an edited audio track for the exporter (recording ms → output ms). */
export type TrackPiece = { sourceStart: number; sourceEnd: number; outputStart: number; speed: number };

export type ExportJob = {
  projectId: string; output: string; format: 'mp4' | 'webm' | 'gif';
  segments: Array<{ start: number; end: number; speed?: number }>; duration: number;
  systemVolume: number; micVolume: number; micFile?: string; systemFile?: string; gif?: { fps: number; width: number };
  /** Edited system audio / microphone tracks: recording ranges placed on the output (ms); null = unedited. */
  systemPieces?: TrackPiece[] | null; micPieces?: TrackPiece[] | null;
  voiceovers?: Array<{ file: string; startMs: number; trimStartMs: number; trimEndMs: number; volume: number }>;
  music?: { file: string; volume: number; loop: boolean; duck: { amount: number; intervals: Array<{ start: number; end: number }> } | null } | null;
};
