// Frame compositor shared by preview and export. Layers, back to front:
// layout (contain/cover with padding), a zoom transform that keeps the focus point fixed,
// rounded/shadowed screen, cursor and click effects inside the screen.
import { cameraAt, type CameraState } from './camera';
import { cursorFrame, interpolate, prepareCursor, type CursorSettings } from './cursor-motion';
import { cursorArt, designTypes, type CursorArt, type CursorDesign } from './cursors';
import { loadBackgroundImage, renderBackground } from './backgrounds';
import { mapCursor, mapRanges, mapZooms, sourceToTimeline, timelineToSource } from './timeline';
import { trackOn, type TrackSegments } from './trackSegments';
import { drawKeyboard, shortcutsFromKeys, type Shortcut } from './keyboard';
import { drawAnnotations } from './annotations';
import { drawCaptions, mapCaptions } from './captions';
import { isNeutral, projectPoint, QuadRenderer, threeDAt } from './threeD';
import { drawTextFocus, focusAt } from './textFocus';
import { cameraPoseAt } from './cameraKeyframes';
import { motionBlurAmount, transitions, type Transition } from './motionBlur';
import type { Annotation, CameraKeyframe, Caption, TextFocusRegion, ThreeDKeyframe, BlurRegion, Clip, CursorEvent, KeyEvent, ProjectSettings, ZoomRegion } from './types';

const presets: Record<string, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 }, '21:9': { width: 2560, height: 1080 }, '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 }, '4:3': { width: 1440, height: 1080 },
};
const even = (v: number) => Math.floor(v / 2) * 2;

/** Composition size for an aspect ratio. */
export function designSize(sourceWidth: number, sourceHeight: number, aspect: string) {
  return aspect === 'original' || !presets[aspect] ? { width: even(sourceWidth), height: even(sourceHeight) } : presets[aspect];
}

export type Layout = {
  contentWidth: number; contentHeight: number; mediaWidth: number; mediaHeight: number;
  mediaOffsetX: number; mediaOffsetY: number; mediaScale: number; coverZoom: number;
};

export function layout(sourceWidth: number, sourceHeight: number, padding: number, target: { width: number; height: number }, fitMode: 'contain' | 'cover'): Layout {
  const availW = Math.max(2, target.width - 2 * padding), availH = Math.max(2, target.height - 2 * padding);
  const contain = Math.min(availW / sourceWidth, availH / sourceHeight);
  const cover = Math.max(availW / sourceWidth, availH / sourceHeight);
  const mediaScale = fitMode === 'cover' ? cover : contain;
  const contentScale = fitMode === 'cover' ? 1 : contain;
  const contentWidth = even(fitMode === 'cover' ? availW : sourceWidth * contentScale);
  const contentHeight = even(fitMode === 'cover' ? availH : sourceHeight * contentScale);
  const mediaWidth = even(sourceWidth * mediaScale), mediaHeight = even(sourceHeight * mediaScale);
  return {
    contentWidth, contentHeight, mediaWidth, mediaHeight,
    mediaOffsetX: (contentWidth - mediaWidth) / 2, mediaOffsetY: (contentHeight - mediaHeight) / 2,
    mediaScale, coverZoom: contain > 0 ? mediaScale / contain : 1,
  };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** Cover mode pans the media toward the zoom focus. */
function panForZoom(base: Layout, camera: CameraState | null): Layout {
  if (!camera) return base;
  const progress = clamp01(camera.progress ?? 0);
  const offset = (content: number, media: number, focus: number) => {
    if (media <= content) return (content - media) / 2;
    const anchor = 0.5 + (clamp01(focus) - 0.5) * progress;
    return Math.max(content - media, Math.min(0, content / 2 - anchor * media));
  };
  return { ...base, mediaOffsetX: offset(base.contentWidth, base.mediaWidth, camera.focusX), mediaOffsetY: offset(base.contentHeight, base.mediaHeight, camera.focusY) };
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
}

// Seeded particles for the burst effect, stable per click.
function particles(seed: number) {
  let s = Math.floor(seed * 1000) % 2147483647 || 1;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: 8 }, (_, i) => ({ angle: (i / 8) * Math.PI * 2 + rand() * 0.3, speed: 0.8 + rand() * 0.4, size: 0.5 + rand() * 0.5 }));
}

function drawClickEffect(ctx: CanvasRenderingContext2D, effect: string, since: number, duration: number, color: string, size: number, seed: number, deviceScale: number) {
  if (effect === 'none' || since > duration || since < 0) return;
  const p = Math.min(since / duration, 1);
  ctx.save();
  if (effect === 'ring') {
    const opacity = interpolate(p, [0, 0.5, 1], [0.6, 0.3, 0], { right: 'clamp' });
    const scale = interpolate(p, [0, 1], [1, 2.5], { right: 'clamp' });
    if (opacity > 0) { ctx.globalAlpha = opacity; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, 0, size * scale, 0, Math.PI * 2); ctx.fill(); }
  } else if (effect === 'ripple') {
    [0, 0.15, 0.3].forEach((delay, i) => {
      const local = Math.max(0, since - delay * duration);
      const q = Math.min(local / (duration * 0.7), 1);
      const opacity = interpolate(q, [0, 0.3, 1], [0.5, 0.3, 0], { right: 'clamp' });
      const scale = interpolate(q, [0, 1], [0.5, 2 + i * 0.5], { right: 'clamp' });
      if (opacity <= 0) return;
      ctx.globalAlpha = opacity; ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, size * scale, 0, Math.PI * 2); ctx.stroke();
    });
  } else if (effect === 'glow') {
    const g = p < 0.3 ? interpolate(p, [0, 0.3], [0, 1]) : interpolate(p, [0.3, 1], [1, 0]);
    const opacity = g * 0.7;
    if (opacity > 0) {
      const diameter = size * 3 * (1 + g * 0.5);
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, diameter / 2);
      gradient.addColorStop(0, color);
      gradient.addColorStop(0.7, 'rgba(0,0,0,0)');
      ctx.globalAlpha = opacity;
      ctx.filter = `blur(${size * (1 + g) * deviceScale}px)`;
      ctx.fillStyle = gradient;
      ctx.beginPath(); ctx.arc(0, 0, diameter / 2, 0, Math.PI * 2); ctx.fill();
    }
  } else if (effect === 'burst') {
    const opacity = interpolate(p, [0, 0.7, 1], [1, 0.5, 0], { right: 'clamp' });
    if (opacity > 0) for (const particle of particles(seed)) {
      const distance = size * 3 * p * particle.speed;
      const dot = size * 0.3 * particle.size * (1 - p * 0.5);
      ctx.globalAlpha = opacity * particle.size; ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(Math.cos(particle.angle) * distance, Math.sin(particle.angle) * distance, dot / 2, 0, Math.PI * 2); ctx.fill();
    }
  } else if (effect === 'bounce') {
    const opacity = p < 0.3 ? interpolate(p, [0, 0.15, 0.3], [0, 0.4, 0]) : 0;
    const scale = interpolate(p, [0, 0.3], [0.8, 1.5], { right: 'clamp' });
    if (opacity > 0) { ctx.globalAlpha = opacity; ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, size * 0.75 * scale, 0, Math.PI * 2); ctx.stroke(); }
  }
  ctx.restore();
}

export type SceneInput = {
  sourceWidth: number; sourceHeight: number; fps: number;
  cursor: CursorEvent[]; zooms: ZoomRegion[]; clips: Clip[]; settings: ProjectSettings;
  cursorEmbedded?: boolean;
  keyboard?: KeyEvent[];
  blurRegions?: BlurRegion[];
  annotations?: Annotation[];
  /** Captions in source time (transcribed) or timeline time (voiceover). */
  captions?: Caption[];
  threeDKeyframes?: ThreeDKeyframe[];
  textFocusRegions?: TextFocusRegion[];
  cameraKeyframes?: CameraKeyframe[];
  /** Per-track splits/removals; a removed camera piece hides the bubble there. */
  trackSegments?: TrackSegments;
};

/** Holds per-project derived data and assets; draw() is synchronous. */
export class Compositor {
  private input: SceneInput | null = null;
  private mappedCursor: CursorEvent[] = [];
  private mappedZooms: ZoomRegion[] = [];
  private prepared: ReturnType<typeof prepareCursor> | null = null;
  private cursorSettings: CursorSettings | null = null;
  private arts = new Map<string, CursorArt>();
  private background: { key: string; canvas: HTMLCanvasElement } | null = null;
  private backgroundImage: HTMLImageElement | null = null;
  private shortcuts: Shortcut[] = [];
  private blurs: BlurRegion[] = [];
  private blurWindows: Transition[] = [];
  private captions: Caption[] = [];
  private threeD: ThreeDKeyframe[] = [];
  private focusRegions: TextFocusRegion[] = [];
  private cameraKeys: CameraKeyframe[] = [];
  private visibleCursor: CursorEvent[] = [];

  /** Recompute derived data; returns a promise that resolves once assets are ready. */
  async update(input: SceneInput) {
    const previous = this.input;
    this.input = input;
    if (!previous || previous.cursor !== input.cursor || previous.clips !== input.clips || previous.zooms !== input.zooms) {
      this.mappedCursor = mapCursor(input.cursor, input.clips);
      this.mappedZooms = mapZooms(input.zooms, input.clips);
      this.visibleCursor = this.mappedCursor.filter(e => e.visible !== false);
    }
    if (!previous || previous.captions !== input.captions || previous.clips !== input.clips) this.captions = mapCaptions(input.captions ?? [], input.clips);
    if (!previous || previous.threeDKeyframes !== input.threeDKeyframes || previous.clips !== input.clips) {
      this.threeD = mapRanges((input.threeDKeyframes ?? []).map(k => ({ ...k, start: k.startTime, end: k.endTime })), input.clips)
        .map(k => ({ ...k, startTime: k.start, endTime: k.end }));
    }
    if (!previous || previous.textFocusRegions !== input.textFocusRegions || previous.clips !== input.clips) this.focusRegions = mapRanges(input.textFocusRegions ?? [], input.clips);
    if (!previous || previous.cameraKeyframes !== input.cameraKeyframes || previous.clips !== input.clips) {
      this.cameraKeys = (input.cameraKeyframes ?? []).flatMap(k => { const time = sourceToTimeline(k.time, input.clips); return time === null ? [] : [{ ...k, time }]; });
    }
    this.blurWindows = transitions(this.mappedZooms, input.settings.zoomSettings.transitionDuration);
    if (!previous || previous.blurRegions !== input.blurRegions || previous.clips !== input.clips) this.blurs = mapRanges(input.blurRegions ?? [], input.clips);
    const k = input.settings.keyboardSettings;
    if (!previous || previous.keyboard !== input.keyboard || previous.clips !== input.clips
      || previous.settings.keyboardSettings.groupingThreshold !== k.groupingThreshold || previous.settings.keyboardSettings.showModifierSymbols !== k.showModifierSymbols) {
      const keys = (input.keyboard ?? []).flatMap(e => { const t = sourceToTimeline(e.t, input.clips); return t === null ? [] : [{ ...e, t }]; });
      this.shortcuts = shortcutsFromKeys(keys, k.groupingThreshold, k.showModifierSymbols);
    }
    const c = input.settings.cursorSettings;
    this.cursorSettings = {
      visible: c.visible && !input.cursorEmbedded, design: c.cursorDesign, size: c.size, color: c.color, strokeColor: c.strokeColor,
      smooth: c.smooth, smoothingIntensity: c.smoothingIntensity, hideWhenIdle: c.hideWhenIdle, idleHideDelayMs: c.idleHideDelayMs,
      clickShrink: c.clickShrink, clickShrinkAmount: c.clickShrinkAmount, tiltOnMove: c.tiltOnMove, tiltAmount: c.tiltAmount,
      highlightClicks: c.highlightClicks, clickEffect: c.clickEffect, clickEffectDuration: c.clickEffectDuration, highlightColor: c.highlightColor,
      useDetectedCursorType: c.useDetectedCursorType, forcedCursorType: c.forcedCursorType,
    };
    if (!previous || previous.cursor !== input.cursor || previous.clips !== input.clips
      || previous.settings.cursorSettings.smooth !== c.smooth || previous.settings.cursorSettings.smoothingIntensity !== c.smoothingIntensity) {
      this.prepared = prepareCursor(this.mappedCursor, this.cursorSettings);
    }
    const b = input.settings.backgroundSettings;
    this.backgroundImage = b.type === 'image' && b.imagePath ? await loadBackgroundImage(b.imagePath) : null;
    const design = c.cursorDesign as CursorDesign;
    await Promise.all(designTypes[design].map(async type => {
      const art = await cursorArt(design, type, c.color, c.strokeColor);
      if (art) this.arts.set(`${design}|${type}|${c.color}|${c.strokeColor}`, art);
    }));
  }

  /** Crop region (normalized), full frame when cropping is off. */
  crop() {
    const c = this.input!.settings.cropSettings;
    const r = c?.enabled ? c.region : null;
    return r && r.width > 0.01 && r.height > 0.01 ? r : { x: 0, y: 0, width: 1, height: 1 };
  }

  /** Visible source size after cropping. */
  private croppedSize() {
    const input = this.input!, r = this.crop();
    return { width: input.sourceWidth * r.width, height: input.sourceHeight * r.height };
  }

  /** Output size for the current aspect ratio before export scaling. */
  design() {
    const size = this.croppedSize();
    return designSize(size.width, size.height, this.input!.settings.backgroundSettings.aspectRatio);
  }

  camera(time: number, frame: number): CameraState | null {
    const input = this.input!;
    const z = input.settings.zoomSettings;
    if (!z.enabled) return null;
    // Follow-cursor stays inside the cropped area.
    const r = this.crop();
    const D = this.design(), size = this.croppedSize();
    const L = layout(size.width, size.height, input.settings.backgroundSettings.padding, D, input.settings.backgroundSettings.fitMode);
    const bounds = {
      minX: r.x, maxX: r.x + r.width, minY: r.y, maxY: r.y + r.height,
      visX: Math.max(0.0001, Math.min(1, r.width * Math.min(1, L.contentWidth / L.mediaWidth))),
      visY: Math.max(0.0001, Math.min(1, r.height * Math.min(1, L.contentHeight / L.mediaHeight))),
    };
    return cameraAt(this.mappedZooms, {
      enabled: true, transitionDuration: z.transitionDuration, followCursor: z.followCursor,
      followCursorSafeZone: z.followCursorSafeZone, followCursorSmoothing: z.followCursorSmoothing, followCursorAlwaysTrack: z.followCursorAlwaysTrack,
    }, this.mappedCursor, time, input.fps, frame, bounds);
  }

  private backgroundFor(width: number, height: number) {
    const b = this.input!.settings.backgroundSettings;
    const key = JSON.stringify([b.type, b.wallpaper, b.gradient, b.color, b.imagePath, b.backgroundBlur, Math.round(width), Math.round(height)]);
    if (this.background?.key !== key) this.background = { key, canvas: renderBackground(b, width, height, this.backgroundImage) };
    return this.background.canvas;
  }

  /** Layout, camera and zoom transform for a moment, shared by draw() and toMedia(). */
  private geometry(time: number, frame: number) {
    const input = this.input!;
    const b = input.settings.backgroundSettings;
    const D = this.design();
    const r = this.crop();
    const size = this.croppedSize();
    const camera = this.camera(time, frame);
    const base = layout(size.width, size.height, b.padding, D, b.fitMode);
    // Cover mode pans by the focus within the crop region.
    const local = camera ? { ...camera, focusX: (camera.focusX - r.x) / r.width, focusY: (camera.focusY - r.y) / r.height } : null;
    const L = b.fitMode === 'cover' ? panForZoom(base, local) : base;
    const offX = (D.width - L.contentWidth) / 2, offY = (D.height - L.contentHeight) / 2;
    const s = camera?.scale ?? 1;
    const fx = clamp01((offX + L.mediaOffsetX + clamp01(local?.focusX ?? 0.5) * L.mediaWidth) / D.width);
    const fy = clamp01((offY + L.mediaOffsetY + clamp01(local?.focusY ?? 0.5) * L.mediaHeight) / D.height);
    const tx = (0.5 - fx) * D.width * (s - 1), ty = (0.5 - fy) * D.height * (s - 1);
    return { D, r, L, offX, offY, s, tx, ty, cx: D.width / 2, cy: D.height / 2 };
  }

  /**
   * Draws one frame. `time` is timeline ms, `frame` the timeline frame index used by the
   * camera springs, `video` the source frame for that time.
   */
  draw(ctx: CanvasRenderingContext2D, outWidth: number, outHeight: number, video: CanvasImageSource | null, time: number, frame: number, camera: CanvasImageSource | null = null) {
    const input = this.input;
    if (!input) return;
    const settings = input.settings;
    const b = settings.backgroundSettings;
    const { D, r, L, offX, offY, s, tx, ty, cx, cy } = this.geometry(time, frame);
    const k = outWidth / D.width;
    const device = k * s; // composition px → device px for shadows/filters

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, outWidth, outHeight);
    ctx.setTransform(k * s, 0, 0, k * s, k * (cx * (1 - s) + tx), k * (cy * (1 - s) + ty));
    ctx.imageSmoothingQuality = 'high';

    // Background with overscan so it still covers the frame while zoomed.
    const blurPad = b.backgroundBlur > 0 ? Math.ceil(0.8 * b.backgroundBlur) : 0;
    const overscan = Math.max(blurPad, s > 1 ? Math.ceil((Math.max(D.width, D.height) * (s - 1)) / (2 * s)) : 0);
    const bg = this.backgroundFor(D.width, D.height);
    const bgScale = Math.max((D.width + 2 * overscan) / D.width, (D.height + 2 * overscan) / D.height);
    const bw = D.width * bgScale, bh = D.height * bgScale;
    ctx.drawImage(bg, cx - bw / 2, cy - bh / 2, bw, bh);

    const x = offX, y = offY, w = L.contentWidth, h = L.contentHeight;
    const frameArgs = { x, y, w, h, L, r, video, time };
    const three = threeDAt(this.threeD, time, settings.threeDSettings);
    if (isNeutral(three)) {
      this.drawFrame(ctx, frameArgs, device, true);
    } else {
      // 3D: render the frame (with its shadow) to a texture, then project it in perspective.
      const pad = b.inset + (b.shadow ? b.shadowSettings.blur * 1.5 + Math.max(Math.abs(b.shadowSettings.offsetX), Math.abs(b.shadowSettings.offsetY)) : 0) + 2;
      const affine = (px: number, py: number) => ({ x: k * s * px + k * (cx * (1 - s) + tx), y: k * s * py + k * (cy * (1 - s) + ty) });
      const centre = { x: x + w / 2, y: y + h / 2 }, origin = { x: D.width / 2, y: D.height / 2 };
      const quad = (rw: number, rh: number, extra?: (u: number, v: number) => [number, number]) =>
        ([[-rw / 2, -rh / 2, 0, 0], [rw / 2, -rh / 2, 1, 0], [rw / 2, rh / 2, 1, 1], [-rw / 2, rh / 2, 0, 1]] as const).map(([u, v, tu, tv]) => {
          const p = projectPoint(three!, u, v, centre, origin, extra);
          const d = affine(p.x, p.y);
          return { x: d.x, y: d.y, w: p.w, u: tu, v: tv };
        });
      const ts = Math.min(device * Math.max(1, three!.scale), 4096 / (w + 2 * pad), 4096 / (h + 2 * pad));
      const tex = this.texture(0, Math.ceil((w + 2 * pad) * ts), Math.ceil((h + 2 * pad) * ts));
      const tctx = tex.getContext('2d')!;
      tctx.setTransform(1, 0, 0, 1, 0, 0);
      tctx.clearRect(0, 0, tex.width, tex.height);
      tctx.setTransform(ts, 0, 0, ts, (pad - x) * ts, (pad - y) * ts);
      tctx.imageSmoothingQuality = 'high';
      this.drawFrame(tctx, frameArgs, ts, true);
      const gl = (this.quads ??= new QuadRenderer());
      gl.begin(outWidth, outHeight);
      const t3 = settings.threeDSettings;
      if (t3.reflection) {
        // Mirrored copy below the frame (translateY(h + gap) scaleY(-1)), faded out
        // with distance from the frame.
        const rtex = this.texture(1, Math.ceil(w * ts), Math.ceil(h * ts));
        const rctx = rtex.getContext('2d')!;
        rctx.setTransform(1, 0, 0, 1, 0, 0);
        rctx.clearRect(0, 0, rtex.width, rtex.height);
        rctx.setTransform(ts, 0, 0, ts, -x * ts, -y * ts);
        this.drawFrame(rctx, frameArgs, ts, false);
        rctx.setTransform(1, 0, 0, 1, 0, 0);
        const fade = rctx.createLinearGradient(0, rtex.height, 0, 0);
        fade.addColorStop(0, 'rgba(0, 0, 0, 1)');
        fade.addColorStop(0.7, 'rgba(0, 0, 0, 0)');
        rctx.globalCompositeOperation = 'destination-in';
        rctx.fillStyle = fade;
        rctx.fillRect(0, 0, rtex.width, rtex.height);
        rctx.globalCompositeOperation = 'source-over';
        gl.draw(rtex, quad(w, h, (u, v) => [u, -v + h + t3.reflectionGap]), t3.reflectionOpacity);
      }
      gl.draw(tex, quad(w + 2 * pad, h + 2 * pad));
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(gl.canvas, 0, 0);
      ctx.restore();
    }
    // Camera, keyboard and annotations sit in output space, above the zoomed frame.
    ctx.setTransform(k, 0, 0, k, 0, 0);
    if (camera && settings.cameraSettings.visible && trackOn(input.trackSegments?.camera, timelineToSource(time, input.clips))) this.drawCamera(ctx, camera, settings.cameraSettings, s, D.width, D.height, k, time);
    drawKeyboard(ctx, this.shortcuts, settings.keyboardSettings, time, D.width, D.height);
    if (settings.annotationSettings.enabled && input.annotations?.length) drawAnnotations(ctx, input.annotations, time, D.width, D.height);
    drawCaptions(ctx, this.captions, settings.captionSettings, time, D.width, D.height);
    ctx.restore();
  }

  /** Reusable offscreen canvases for the 3D textures. */
  private textures: HTMLCanvasElement[] = [];
  private quads: QuadRenderer | null = null;
  private texture(slot: number, width: number, height: number) {
    const c = (this.textures[slot] ??= document.createElement('canvas'));
    if (c.width !== width || c.height !== height) { c.width = Math.max(1, width); c.height = Math.max(1, height); }
    return c;
  }

  /**
   * The recording frame: inset ring and shadow (`decorated`), then the rounded, clipped media
   * with motion blur, cursor and blur regions. Coordinates are composition px; `device` is the
   * composition → bitmap scale of `ctx` (for shadows and filters).
   */
  private drawFrame(ctx: CanvasRenderingContext2D, f: { x: number; y: number; w: number; h: number; L: Layout; r: { x: number; y: number; width: number; height: number }; video: CanvasImageSource | null; time: number }, device: number, decorated: boolean) {
    const input = this.input!;
    const settings = input.settings;
    const b = settings.backgroundSettings;
    const { x, y, w, h, L, r, video, time } = f;
    if (decorated && b.inset > 0) {
      roundedRect(ctx, x - b.inset, y - b.inset, w + 2 * b.inset, h + 2 * b.inset, b.borderRadius + Math.round(0.3 * b.inset));
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'; ctx.stroke();
    }
    if (decorated && b.shadow) {
      ctx.save();
      ctx.shadowColor = `rgba(0, 0, 0, ${b.shadowSettings.opacity})`;
      ctx.shadowBlur = b.shadowSettings.blur * device;
      ctx.shadowOffsetX = b.shadowSettings.offsetX * device;
      ctx.shadowOffsetY = b.shadowSettings.offsetY * device;
      roundedRect(ctx, x, y, w, h, b.borderRadius);
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    roundedRect(ctx, x, y, w, h, b.borderRadius);
    ctx.clip();
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y, w, h);
    const mx = x + L.mediaOffsetX, my = y + L.mediaOffsetY;
    const z = settings.zoomSettings;
    const blur = z.motionBlur || z.cursorMotionBlur > 0
      ? motionBlurAmount({ zoomBlur: z.motionBlur, zoomBlurStrength: z.motionBlurStrength, cursorBlur: z.cursorMotionBlur > 0, cursorBlurStrength: z.cursorMotionBlur, globalStrength: 0.5 },
        this.blurWindows, z.transitionDuration, this.visibleCursor, time)
      : 0;
    // CSS blur inside the zoomed layer scales with it; canvas filters work in bitmap pixels.
    if (blur >= 0.1) ctx.filter = `blur(${(blur * device).toFixed(2)}px)`;
    if (video) ctx.drawImage(video, r.x * input.sourceWidth, r.y * input.sourceHeight, r.width * input.sourceWidth, r.height * input.sourceHeight, mx, my, L.mediaWidth, L.mediaHeight);
    this.drawCursor(ctx, time, mx, my, L, r, device);
    ctx.filter = 'none';
    this.drawBlurs(ctx, time, mx, my, L, r);
    const focus = focusAt(this.focusRegions, settings.textFocusSettings, time, input.fps);
    if (focus) {
      // Focus bounds are relative to the whole source; place the uncropped source rectangle.
      const full = { x: mx - (r.x / r.width) * L.mediaWidth, y: my - (r.y / r.height) * L.mediaHeight, width: L.mediaWidth / r.width, height: L.mediaHeight / r.height };
      drawTextFocus(ctx, focus, settings.textFocusSettings, full, { width: input.sourceWidth, height: input.sourceHeight }, device,
        video ? () => ctx.drawImage(video, full.x, full.y, full.width, full.height) : null);
    }
    ctx.restore();
  }

  /** Maps a point on the output canvas back to normalized source coordinates (for picking a focus). */
  toMedia(px: number, py: number, outWidth: number, time: number, frame: number) {
    if (!this.input) return null;
    const { D, r, L, offX, offY, s, tx, ty, cx, cy } = this.geometry(time, frame);
    const k = outWidth / D.width;
    const sx = (px / k - cx - tx) / s + cx, sy = (py / k - cy - ty) / s + cy;
    const u = clamp01((sx - offX - L.mediaOffsetX) / L.mediaWidth), v = clamp01((sy - offY - L.mediaOffsetY) / L.mediaHeight);
    return { x: r.x + u * r.width, y: r.y + v * r.height };
  }

  /** Webcam bubble. */
  private drawCamera(ctx: CanvasRenderingContext2D, source: CanvasImageSource, cam: ProjectSettings['cameraSettings'], zoom: number, width: number, height: number, k: number, time: number) {
    const pose = cameraPoseAt(this.cameraKeys, cam, time, this.input!.fps);
    if (!pose.visible || pose.opacity <= 0) return;
    const dims = (size: number) => pose.shape === 'landscape' ? { w: size, h: Math.round((9 * size) / 16) } : pose.shape === 'portrait' ? { w: Math.round((4 * size) / 5), h: size } : { w: size, h: size };
    const shrink = cam.shrinkOnZoom && zoom > 1 ? Math.min(1, (zoom - 1) / 0.6) : 0;
    const base = dims(Math.max(1, pose.size)), now = dims(Math.max(1, pose.size + (cam.zoomedSize - pose.size) * shrink));
    // The bubble sits flush with the frame edges: left = x · (W − w).
    const left = pose.x * (width - base.w) + (base.w - now.w) / 2;
    const top = pose.y * (height - base.h) + (base.h - now.h) / 2;
    // CSS border-radius percentages are relative to each side (elliptical corners).
    const pct = pose.shape === 'circle' ? 0.5 : pose.shape === 'square' ? 0 : Math.min(50, pose.roundness) / 100;
    const radius = { x: now.w * pct, y: now.h * pct };
    const sw = (source as HTMLVideoElement).videoWidth || (source as VideoFrame).displayWidth || now.w;
    const sh = (source as HTMLVideoElement).videoHeight || (source as VideoFrame).displayHeight || now.h;
    // object-fit: cover
    const scale = Math.max(now.w / sw, now.h / sh);
    const cw = now.w / scale, ch = now.h / scale;
    ctx.save();
    ctx.globalAlpha *= pose.opacity;
    if (cam.shadow) {
      for (const [blur, y, opacity] of [[32, 8, 0.4], [8, 2, 0.3]]) {
        ctx.save();
        ctx.shadowColor = `rgba(0, 0, 0, ${opacity})`; ctx.shadowBlur = blur * k; ctx.shadowOffsetY = y * k;
        (ctx.beginPath(), ctx.roundRect(left, top, now.w, now.h, [radius])); ctx.fillStyle = '#000'; ctx.fill();
        ctx.restore();
      }
    }
    ctx.save();
    (ctx.beginPath(), ctx.roundRect(left, top, now.w, now.h, [radius]));
    ctx.clip();
    if (pose.mirror) { ctx.translate(left * 2 + now.w, 0); ctx.scale(-1, 1); }
    ctx.drawImage(source, (sw - cw) / 2, (sh - ch) / 2, cw, ch, left, top, now.w, now.h);
    ctx.restore();
    if (cam.borderWidth > 0) {
      ctx.beginPath(); ctx.roundRect(left - cam.borderWidth / 2, top - cam.borderWidth / 2, now.w + cam.borderWidth, now.h + cam.borderWidth, [{ x: radius.x + cam.borderWidth / 2, y: radius.y + cam.borderWidth / 2 }]);
      ctx.lineWidth = cam.borderWidth; ctx.strokeStyle = cam.borderColor; ctx.stroke();
    }
    ctx.restore();
  }

  /** Blur regions: above video and cursor, faded with smoothstep. */
  private drawBlurs(ctx: CanvasRenderingContext2D, time: number, mx: number, my: number, L: Layout, r: { x: number; y: number; width: number; height: number }) {
    if (!this.blurs.length) return;
    const fullW = L.mediaWidth / r.width, fullH = L.mediaHeight / r.height;
    const originX = mx - r.x * fullW, originY = my - r.y * fullH;
    const m = ctx.getTransform();
    for (const region of this.blurs) {
      const tin = Math.max(0, region.transitionIn ?? region.transition ?? 0), tout = Math.max(0, region.transitionOut ?? region.transition ?? 0);
      let p = 0;
      if (time >= region.start && time <= region.end) p = 1;
      else if (tin > 0 && time >= region.start - tin && time < region.start) p = (time - (region.start - tin)) / tin;
      else if (tout > 0 && time > region.end && time <= region.end + tout) p = (region.end + tout - time) / tout;
      const factor = p * p * (3 - 2 * p);
      if (factor <= 0.001) continue;
      // Region in composition space, then in device pixels.
      const x0 = originX + region.bounds.x * fullW, y0 = originY + region.bounds.y * fullH;
      const x1 = x0 + region.bounds.width * fullW, y1 = y0 + region.bounds.height * fullH;
      const dx0 = m.a * x0 + m.e, dy0 = m.d * y0 + m.f, dx1 = m.a * x1 + m.e, dy1 = m.d * y1 + m.f;
      const radius = (region.strength ?? 24) * (fullH / 1080) * m.a;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath();
      ctx.rect(dx0, dy0, dx1 - dx0, dy1 - dy0);
      ctx.clip();
      ctx.globalAlpha = factor;
      ctx.filter = `blur(${radius}px)`;
      const pad = Math.ceil(radius * 2);
      const sx = Math.max(0, Math.floor(dx0 - pad)), sy = Math.max(0, Math.floor(dy0 - pad));
      const sw = Math.min(ctx.canvas.width - sx, Math.ceil(dx1 - dx0 + pad * 2)), sh = Math.min(ctx.canvas.height - sy, Math.ceil(dy1 - dy0 + pad * 2));
      if (sw > 0 && sh > 0) ctx.drawImage(ctx.canvas, sx, sy, sw, sh, sx, sy, sw, sh);
      ctx.restore();
    }
  }

  private drawCursor(ctx: CanvasRenderingContext2D, time: number, mx: number, my: number, L: Layout, r: { x: number; y: number; width: number; height: number }, device: number) {
    const settings = this.cursorSettings, prepared = this.prepared, input = this.input!;
    if (!settings || !prepared) return;
    const frame = cursorFrame(prepared, settings, time);
    if (!frame) return;
    // Cursor coordinates are normalized to the full source; map into the crop.
    const px = (x: number) => mx + ((x - r.x) / r.width) * L.mediaWidth;
    const py = (y: number) => my + ((y - r.y) / r.height) * L.mediaHeight;
    const size = settings.size * L.coverZoom;
    if (frame.click) {
      ctx.save();
      ctx.translate(px(frame.click.x), py(frame.click.y));
      drawClickEffect(ctx, settings.clickEffect, frame.click.since, settings.clickEffectDuration || 300, settings.highlightColor, size, time - frame.click.since, device);
      ctx.restore();
    }
    const c = input.settings.cursorSettings;
    const art = this.arts.get(`${c.cursorDesign}|${frame.cursorType}|${c.color}|${c.strokeColor}`) ?? this.arts.get(`${c.cursorDesign}|default|${c.color}|${c.strokeColor}`);
    if (!art) return;
    ctx.save();
    ctx.globalAlpha = frame.opacity;
    // Box top-left at (x - hotspot), then scale/rotate around the box's top-left.
    ctx.translate(px(frame.x) - art.hotspot.x * size, py(frame.y) - art.hotspot.y * size);
    ctx.scale(frame.scale, frame.scale);
    ctx.rotate((Number(frame.rotation.toFixed(2)) * Math.PI) / 180);
    ctx.drawImage(art.image, 0, 0, size, size);
    ctx.restore();
  }
}
