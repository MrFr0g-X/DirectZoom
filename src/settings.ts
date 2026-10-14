// Default project settings and
// normalisation of settings loaded from disk (older and imported settings.json files).
import type { Clip, CursorEvent, ProjectSettings, ZoomRegion, ZoomSettings } from './types';
import { generateZooms } from './zoom';

export const defaultSettings: ProjectSettings = {
  version: 1,
  backgroundSettings: {
    type: 'wallpaper', wallpaper: 'dusk', gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: '#1a1a2e', imagePath: null,
    aspectRatio: 'original', fitMode: 'contain', padding: 40, borderRadius: 12, inset: 0, backgroundBlur: 0,
    shadow: true, shadowSettings: { blur: 40, offsetX: 0, offsetY: 20, opacity: 0.3 },
  },
  cursorSettings: {
    visible: true, cursorDesign: 'macos', size: 98, color: '#ffffff', strokeColor: '#000000',
    smooth: true, smoothingIntensity: 50, hideWhenIdle: false, idleHideDelayMs: 1000,
    clickShrink: true, clickShrinkAmount: 0.8, tiltOnMove: true, tiltAmount: 15,
    highlightClicks: true, clickEffect: 'ring', clickEffectDuration: 300, highlightColor: 'rgba(99, 102, 241, 0.4)',
    useDetectedCursorType: true, forcedCursorType: 'default',
  },
  zoomSettings: {
    enabled: true, autoDetect: true, detectOnClicks: true, detectOnDeceleration: true, defaultScale: 1.5, transitionDuration: 600,
    followCursor: true, followCursorSafeZone: 0.7, followCursorSmoothing: 0.12, followCursorAlwaysTrack: false,
    // zoomSettings.motionBlur/motionBlurStrength; cursor blur from animationSettings.cursorBlur.
    motionBlur: false, motionBlurStrength: 0.5, cursorMotionBlur: 0,
  },
  audioSettings: {
    systemVolume: 1, micVolume: 0.8,
    backgroundMusicEnabled: false, backgroundMusicPath: null, backgroundMusicName: null, backgroundMusicVolume: 0.15, backgroundMusicDurationMs: 0,
    backgroundMusicLoop: true, autoDuck: true, autoDuckAmount: 0.3,
    speechCleanup: {
      normalizedVolume: false, backgroundNoiseRemoval: false, noiseEngine: 'local', fillerWordsRemoved: false, voiceReplacement: null,
      micProcessedPath: null, processedTrack: null, micError: null, processedAt: 0,
    },
  },
  keyboardSettings: {
    enabled: true, position: 'bottom-center', fontSize: 16, style: 'pill', backgroundColor: 'rgba(0, 0, 0, 0.8)', textColor: '#ffffff',
    showModifierSymbols: true, holdAnimation: true, holdAnimationColor: 'rgba(139, 92, 246, 0.5)', displayDuration: 500, opacity: 1, groupingThreshold: 150,
  },
  cropSettings: { enabled: false, region: { x: 0, y: 0, width: 1, height: 1 } },
  annotationSettings: {
    enabled: true, defaultColor: '#ffde59', defaultStrokeWidth: 8, defaultOpacity: 0.96, defaultDurationMs: 3000,
    defaultTool: 'pen', defaultShape: 'freehand', defaultAnimation: 'draw-on',
  },
  // Caption defaults.
  captionSettings: {
    enabled: false, style: 'classic', position: 'bottom', fontSize: 38, fontFamily: 'Inter', fontWeight: 'bold', textTransform: 'none',
    letterSpacing: 0, lineHeight: 1.2, textColor: '#ffffff', highlightColor: '#8bd8ff', backgroundColor: 'rgba(10, 12, 18, 0.54)', backgroundOpacity: 0.54,
    textShadow: true, textShadowColor: 'rgba(0, 0, 0, 0.78)', textShadowBlur: 7, textStroke: false, strokeColor: '#000000', strokeWidth: 2,
    maxWordsPerLine: 7, maxLines: 2, wordSpacing: 8, padding: 12, marginBottom: 72, animation: 'fade', animationDuration: 120,
    highlightCurrentWord: false, wordBackground: false, wordBackgroundColor: 'rgba(248, 211, 79, 0.18)', wordBorderRadius: 8,
  },
  // 3D defaults; presets set the keyframe pose.
  threeDSettings: {
    enabled: false, defaultRotateX: 0, defaultRotateY: 0, defaultRotateZ: 0, defaultPerspective: 1200, defaultScale: 1,
    reflection: false, reflectionOpacity: 0.3, reflectionGap: 8, transitionDuration: 800,
  },
  // Text-focus defaults.
  textFocusSettings: {
    enabled: false, mode: 'dim', blurAmount: 8, dimOpacity: 0.5, dimColor: 'rgba(0, 0, 0, 1)', padding: 8, borderRadius: 6,
    transitionDuration: 300, autoDetect: true,
  },
  cameraSettings: {
    visible: true, position: 9, shape: 'rounded', size: 220, roundness: 50, mirror: true, shrinkOnZoom: true, zoomedSize: 160,
    borderWidth: 3, borderColor: 'rgba(255, 255, 255, 0.2)', shadow: true,
  },
};

type Loose = Record<string, any>;
const pick = <T extends Loose>(defaults: T, value: Loose | undefined): T => {
  const out: Loose = { ...defaults };
  if (!value) return out as T;
  for (const key of Object.keys(defaults)) {
    if (value[key] === undefined || value[key] === null && defaults[key] !== null) continue;
    const d = defaults[key];
    out[key] = d && typeof d === 'object' && !Array.isArray(d) ? pick(d, value[key]) : value[key];
  }
  return out as T;
};

const designs = ['macos', 'windows', 'minimal', 'crosshair'];
export function normalizeSettings(raw: Loose | null | undefined): ProjectSettings {
  const settings = {
    version: 1 as const,
    backgroundSettings: pick(defaultSettings.backgroundSettings, raw?.backgroundSettings),
    cursorSettings: pick(defaultSettings.cursorSettings, raw?.cursorSettings),
    zoomSettings: pick(defaultSettings.zoomSettings, raw?.zoomSettings),
    audioSettings: pick(defaultSettings.audioSettings, raw?.audioSettings),
    keyboardSettings: pick(defaultSettings.keyboardSettings, raw?.keyboardSettings),
    cropSettings: pick(defaultSettings.cropSettings, raw?.cropSettings),
    annotationSettings: pick(defaultSettings.annotationSettings, raw?.annotationSettings),
    cameraSettings: pick(defaultSettings.cameraSettings, raw?.cameraSettings),
    captionSettings: pick(defaultSettings.captionSettings, raw?.captionSettings),
    threeDSettings: pick(defaultSettings.threeDSettings, raw?.threeDSettings),
    textFocusSettings: pick(defaultSettings.textFocusSettings, raw?.textFocusSettings),
  };
  // Unknown wallpaper names (e.g. from imported projects) fall back to the default wallpaper.
  if (settings.backgroundSettings.type === 'wallpaper' && raw?.backgroundSettings?.wallpaperPath) settings.backgroundSettings.wallpaper = defaultSettings.backgroundSettings.wallpaper;
  if ((raw?.backgroundSettings?.type as string) === 'animated') settings.backgroundSettings.type = 'wallpaper';
  if (!designs.includes(settings.cursorSettings.cursorDesign)) settings.cursorSettings.cursorDesign = 'macos';
  return settings;
}

/** Automatic zoom points for a recording. */
export function autoZooms(cursor: CursorEvent[], zoom: ZoomSettings, duration: number): ZoomRegion[] {
  if (!zoom.enabled || !zoom.autoDetect) return [];
  return generateZooms(cursor, {
    autoZoom: true, zoomOnClicks: zoom.detectOnClicks, zoomOnSlowdown: zoom.detectOnDeceleration,
    zoomScale: zoom.defaultScale, transitionMs: zoom.transitionDuration,
  }, duration);
}

export const defaultClips = (duration: number): Clip[] => [{ id: 'clip-0', sourceStart: 0, sourceEnd: duration, speed: 1, timelineStart: 0 }];
