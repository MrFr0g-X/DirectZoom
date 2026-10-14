// Captions: data helpers and the three caption styles (classic, word pop, karaoke)
// drawn on canvas. Times in ms. Drawing happens in
// composition space.
import type { Caption, CaptionSettings, CaptionWord, Clip } from './types';

// ---------- data ----------

const splitWords = (text: string) => text.replace(/\s+/g, ' ').trim().match(/\S+/g) ?? [];

/** Evenly spaced word timings when a caption has no per-word data. */
export function spreadWords(words: string[], start: number, duration: number): CaptionWord[] {
  const total = duration > 0 ? Math.max(duration, 90 * words.length) : 360 * words.length;
  const per = Math.max(90, total / Math.max(1, words.length));
  return words.map((text, i) => ({
    text, startMs: Math.round(start + i * per),
    endMs: Math.round(i === words.length - 1 ? start + total : start + i * per + per), confidence: 1,
  }));
}

/** A caption's words clamped into its range. */
export function captionWords(caption: Caption): CaptionWord[] {
  const start = Number.isFinite(caption.startMs) ? caption.startMs : 0;
  const end = Number.isFinite(caption.endMs) && caption.endMs > start ? caption.endMs : start + Math.max(90, 360 * splitWords(caption.text).length);
  const words = (Array.isArray(caption.words) ? caption.words : []).map(word => {
    const text = word.text.trim();
    if (!text) return null;
    const ws = Number.isFinite(word.startMs) ? word.startMs : start;
    const we = Number.isFinite(word.endMs) ? word.endMs : ws + 90;
    const s = Math.max(start, Math.min(ws, Math.max(start, end - 1)));
    const e = Math.min(end, Math.max(we, s + 1));
    return e <= s ? null : { ...word, text, startMs: Math.round(s), endMs: Math.round(e) };
  }).filter((w): w is CaptionWord => w !== null);
  if (words.length) return words;
  const plain = splitWords(caption.text);
  return plain.length ? spreadWords(plain, caption.startMs, Math.max(0, caption.endMs - caption.startMs)) : [];
}

export const validCaption = (c: Caption) => Number.isFinite(c.startMs) && Number.isFinite(c.endMs) && c.endMs > c.startMs && c.text.trim().length > 0;

/**
 * Groups transcribed words into captions: a new caption starts after a pause (> 700 ms, the
 * phrase gap the word styles use), after sentence-ending punctuation, or when the
 * caption would exceed the visible word budget.
 */
export function groupWords(words: CaptionWord[], settings: Pick<CaptionSettings, 'maxWordsPerLine' | 'maxLines'>, source: Caption['source'] = 'transcription'): Caption[] {
  const budget = Math.max(2, settings.maxWordsPerLine * settings.maxLines);
  const captions: Caption[] = [];
  let current: CaptionWord[] = [];
  const flush = () => {
    if (!current.length) return;
    captions.push({
      id: `caption-${captions.length + 1}-${current[0].startMs}`, text: current.map(w => w.text).join(' '),
      startMs: current[0].startMs, endMs: current[current.length - 1].endMs, words: current, source,
    });
    current = [];
  };
  for (const word of words) {
    const prev = current[current.length - 1];
    if (prev && (word.startMs - prev.endMs > 700 || current.length >= budget || (/[.!?…]["')\]]?$/.test(prev.text) && current.length >= 3))) flush();
    current.push(word);
  }
  flush();
  return captions;
}

/** Re-times a caption after its text was edited: keeps the range, spreads the new words. */
export function retext(caption: Caption, text: string): Caption {
  const words = splitWords(text);
  return { ...caption, text: words.join(' '), words: spreadWords(words, caption.startMs, caption.endMs - caption.startMs) };
}

/**
 * Transcribed captions are in source time: split them at cuts and move them onto the
 * timeline. Voiceover captions are already on the timeline.
 */
/** Voiceover and imported captions are timed on the timeline; transcribed ones on the recording. */
export const onTimeline = (caption: Caption) => caption.source === 'voiceover' || caption.source === 'manual';

export function mapCaptions(captions: Caption[], clips: Clip[]): Caption[] {
  if (!clips.length) return captions;
  const out: Caption[] = [];
  for (const caption of captions) {
    if (onTimeline(caption)) { out.push(caption); continue; }
    for (const clip of clips) {
      const start = Math.max(caption.startMs, clip.sourceStart), end = Math.min(caption.endMs, clip.sourceEnd);
      if (start >= end) continue;
      const speed = clip.speed || 1;
      const map = (t: number) => clip.timelineStart + (t - clip.sourceStart) / speed;
      const words = captionWords(caption)
        .filter(w => w.startMs >= start && w.endMs <= end)
        .map(w => ({ ...w, startMs: map(w.startMs), endMs: map(w.endMs) }));
      if (caption.words?.length && !words.length) continue;
      out.push({
        ...caption, id: clips.length > 1 ? `${caption.id}-${clip.id}` : caption.id,
        text: words.length ? words.map(w => w.text).join(' ') : caption.text,
        startMs: map(start), endMs: map(end), words: words.length ? words : undefined,
      });
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

/**
 * Filler words (um, uh, …) in transcribed captions, as source-time ranges. Word timestamps
 * tend to start late on fillers, so ranges are widened (120 ms before, 80 ms after) without
 * reaching into the neighbouring words.
 */
export const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'uhm', 'erm', 'er', 'ah', 'ahh', 'eh', 'hmm', 'hm', 'mm', 'mhm', 'uh-huh']);
export function fillerRanges(captions: Caption[], before = 120, after = 80): Array<{ start: number; end: number }> {
  const words = captions.filter(c => !onTimeline(c)).flatMap(captionWords).sort((x, y) => x.startMs - y.startMs);
  const ranges: Array<{ start: number; end: number }> = [];
  words.forEach((word, i) => {
    if (!FILLERS.has(word.text.toLowerCase().replace(/[^a-z-]/g, ''))) return;
    const prevEnd = i > 0 ? words[i - 1].endMs : 0;
    const nextStart = i < words.length - 1 ? words[i + 1].startMs : Infinity;
    ranges.push({ start: Math.max(prevEnd, word.startMs - before, 0), end: Math.min(nextStart, word.endMs + after) });
  });
  return ranges;
}

/**
 * Parses SubRip (.srt) or WebVTT (.vtt) text into timeline captions (manual source).
 * Cue numbers, styling tags and VTT settings are ignored.
 */
export function parseSubtitles(text: string): Caption[] {
  const stamp = (s: string) => {
    const m = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/.exec(s);
    return m ? ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4].padEnd(3, '0')) : NaN;
  };
  const captions: Caption[] = [];
  for (const block of text.replace(/\r/g, '').replace(/^﻿/, '').split(/\n\s*\n/)) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    const at = lines.findIndex(l => l.includes('-->'));
    if (at < 0) continue;
    const [from, to] = lines[at].split('-->');
    const startMs = stamp(from), endMs = stamp(to);
    const body = lines.slice(at + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').trim();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || !body) continue;
    captions.push({ id: `imported-${captions.length + 1}-${startMs}`, text: body, startMs, endMs, source: 'manual' });
  }
  return captions;
}

/** SubRip export of timeline captions. */
export function toSrt(captions: Caption[]): string {
  const stamp = (ms: number) => {
    const t = Math.max(0, Math.round(ms));
    const h = Math.floor(t / 3600000), m = Math.floor((t % 3600000) / 60000), s = Math.floor((t % 60000) / 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(t % 1000).padStart(3, '0')}`;
  };
  return captions.filter(validCaption).map((c, i) => `${i + 1}\n${stamp(c.startMs)} --> ${stamp(c.endMs)}\n${c.text}\n`).join('\n');
}

// ---------- animation helpers (interpolation with clamping) ----------

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smoothstep = (v: number) => { const x = clamp01(v); return x * x * (3 - 2 * x); };
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

function interp(x: number, input: number[], output: number[], easing?: (t: number) => number) {
  // The input range must be strictly increasing.
  const xs: number[] = [];
  input.forEach((v, i) => xs.push(i === 0 ? v : Math.max(v, xs[i - 1] + 1e-9)));
  if (x <= xs[0]) return output[0];
  if (x >= xs[xs.length - 1]) return output[output.length - 1];
  let i = 1;
  while (x > xs[i]) i++;
  let t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  if (easing) t = easing(t);
  return output[i - 1] + (output[i] - output[i - 1]) * t;
}

/** Enter/exit progress over `animationDuration`. */
function progress(time: number, range: { startMs: number; endMs: number }, s: CaptionSettings) {
  if (s.animation === 'none' || s.animationDuration <= 0) return { enter: 1, exit: 1, visibility: 1 };
  const d = Math.max(1, s.animationDuration);
  const enter = interp(time, [range.startMs, range.startMs + d], [0, 1]);
  const exit = interp(time, [Math.max(range.startMs, range.endMs - d), range.endMs], [1, 0]);
  return { enter, exit, visibility: Math.min(enter, exit) };
}

// ---------- drawing ----------

type Ctx = CanvasRenderingContext2D;

function font(s: CaptionSettings, weight: number) {
  return `${weight} ${s.fontSize}px ${JSON.stringify(s.fontFamily)}, "Segoe UI", system-ui, sans-serif`;
}

const transform = (text: string, s: CaptionSettings) =>
  s.textTransform === 'uppercase' ? text.toUpperCase() : s.textTransform === 'lowercase' ? text.toLowerCase() : text;

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
}

/** Where the caption block sits: horizontal centre and the block's top edge. */
function anchor(s: CaptionSettings, height: number, blockHeight: number) {
  if (s.position === 'top') return s.marginBottom;
  if (s.position === 'center') return (height - blockHeight) / 2;
  return height - s.marginBottom - blockHeight;
}

/** Applies the style's entrance animation around the block centre. */
function animate(ctx: Ctx, kind: 'classic' | 'tiktok' | 'karaoke', s: CaptionSettings, enter: number, cx: number, cy: number) {
  const table = {
    classic: { pop: [[0, 0.5, 1], [0.9, 1.02, 1]], slide: 20, bounce: [[0, 0.4, 0.7, 1], [20, -5, 2, 0]] },
    tiktok: { pop: [[0, 0.75, 1], [0.96, 1.025, 1]], slide: 18, bounce: [[0, 0.7, 1], [18, -3, 0]] },
    karaoke: { pop: [[0, 0.75, 1], [0.97, 1.015, 1]], slide: 16, bounce: [[0, 0.7, 1], [16, -2, 0]] },
  }[kind];
  if (s.animation === 'pop') {
    const k = interp(enter, table.pop[0], table.pop[1]);
    ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy);
  } else if (s.animation === 'slide') {
    ctx.translate(0, interp(enter, [0, 1], [table.slide, 0], easeOutCubic));
  } else if (s.animation === 'bounce') {
    ctx.translate(0, interp(enter, table.bounce[0], table.bounce[1]));
  }
}

type Shadow = { x: number; y: number; blur: number; color: string };

function drawText(ctx: Ctx, text: string, x: number, y: number, s: CaptionSettings, color: string, shadows: Shadow[]) {
  ctx.fillStyle = color;
  if (shadows.length) {
    // Shadows only: the glyph is drawn far off-canvas and its shadow offset back into place, so
    // translucent text is filled exactly once (as CSS text-shadow does). Shadow offsets and
    // blur are in device pixels, so they are scaled by the current transform.
    const m = ctx.getTransform();
    const scale = Math.hypot(m.a, m.b) || 1, away = 100000;
    for (const sh of shadows) {
      ctx.save();
      ctx.shadowColor = sh.color; ctx.shadowBlur = sh.blur * scale;
      ctx.shadowOffsetX = sh.x * scale + away * m.a; ctx.shadowOffsetY = sh.y * scale + away * m.b;
      ctx.fillText(text, x - away, y);
      ctx.restore();
    }
  }
  ctx.fillText(text, x, y);
  if (s.textStroke && s.strokeWidth > 0) {
    ctx.lineWidth = s.strokeWidth; ctx.strokeStyle = s.strokeColor; ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
  }
}

/** Splits word items into rows that fit `maxWidth` (CSS flex-wrap). */
function wrap<T extends { width: number }>(items: T[], gap: number, maxWidth: number): T[][] {
  const rows: T[][] = [];
  let row: T[] = [], width = 0;
  for (const item of items) {
    const next = row.length ? width + gap + item.width : item.width;
    if (row.length && next > maxWidth) { rows.push(row); row = [item]; width = item.width; } else { row.push(item); width = next; }
  }
  if (row.length) rows.push(row);
  return rows;
}

const rowWidth = (row: Array<{ width: number }>, gap: number) => row.reduce((sum, item) => sum + item.width, 0) + gap * Math.max(0, row.length - 1);

function withAlpha(color: string, alpha: number) {
  // CSS: textColor + '82' (hex alpha) for upcoming karaoke words.
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}` : color;
}

/** Classic: whole caption, split into lines of `maxWordsPerLine` words. */
function drawClassic(ctx: Ctx, captions: Caption[], s: CaptionSettings, time: number, width: number, height: number) {
  const caption = captions.find(c => time >= c.startMs && time <= c.endMs);
  if (!caption) return;
  const words = caption.text.split(' ');
  const lines: string[] = [];
  for (let i = 0; i < words.length; i += s.maxWordsPerLine) lines.push(words.slice(i, i + s.maxWordsPerLine).join(' '));
  const shown = lines.slice(0, s.maxLines).map(l => transform(l, s));
  const weight = s.fontWeight === 'black' ? 900 : s.fontWeight === 'bold' ? 700 : 400;
  ctx.font = font(s, weight);
  ctx.letterSpacing = `${s.letterSpacing}px`;
  const maxW = Math.min(width * 0.9, 1000);
  const padX = 1.5 * s.padding, padY = s.padding, lineH = s.fontSize * s.lineHeight;
  const textW = Math.min(maxW - 2 * padX, Math.max(...shown.map(l => ctx.measureText(l).width)));
  const boxW = textW + 2 * padX, boxH = shown.length * lineH + 2 * padY;
  const cx = width / 2, top = anchor(s, height, boxH);
  const { enter, visibility } = progress(time, caption, s);
  ctx.save();
  ctx.globalAlpha *= s.animation === 'none' ? 1 : visibility;
  animate(ctx, 'classic', s, enter, cx, top + boxH / 2);
  if (s.backgroundOpacity > 0) { roundRect(ctx, cx - boxW / 2, top, boxW, boxH, 8); ctx.fillStyle = s.backgroundColor; ctx.fill(); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const shadows: Shadow[] = s.textShadow
    ? [{ x: 0, y: 0, blur: s.textShadowBlur, color: s.textShadowColor }, { x: 0, y: 2, blur: 4, color: s.textShadowColor }, { x: 1, y: 1, blur: 2, color: s.textShadowColor }]
    : [];
  shown.forEach((line, i) => drawText(ctx, line, cx, top + padY + lineH * (i + 0.5), s, s.textColor, shadows));
  ctx.restore();
}

type WordItem = { word: CaptionWord; index: number; text: string; width: number };

/** TikTok: word-by-word pages within a phrase, with proximity fade and highlight. */
function drawTiktok(ctx: Ctx, captions: Caption[], s: CaptionSettings, time: number, width: number, height: number) {
  const all = captions.flatMap(c => captionWords(c).map((w, i) => ({ ...w, id: `${c.id}-word-${i}`, captionId: c.id })))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  if (!all.length) return;
  let active = all.findIndex(w => time >= w.startMs && time <= w.endMs);
  if (active < 0) {
    const next = all.findIndex(w => time < w.startMs);
    active = next === -1 ? Math.max(0, all.length - 1) : Math.max(0, next - 1);
  }
  const activeWord = all[active];
  const caption = captions.find(c => time >= c.startMs && time <= c.endMs)
    || (!activeWord || time < activeWord.startMs || time > activeWord.endMs ? null : captions.find(c => c.id === activeWord.captionId) ?? null);
  // Phrase: neighbouring words separated by at most 700 ms.
  let lo = active, hi = active;
  while (lo > 0 && all[lo].startMs - all[lo - 1].endMs <= 700) lo--;
  while (hi < all.length - 1 && all[hi + 1].startMs - all[hi].endMs <= 700) hi++;
  const phrase = { startMs: all[lo].startMs, endMs: all[hi].endMs };
  const inPhrase = time >= phrase.startMs && time <= phrase.endMs;
  if (!caption && !inPhrase) return;
  const count = hi - lo + 1;
  const group = Math.max(2, Math.min(Math.max(2, s.maxWordsPerLine * s.maxLines), count));
  const offset = Math.max(0, Math.min(count - 1, active - lo));
  const first = lo + Math.min(Math.floor(offset / group) * group, Math.max(0, count - group));
  const page = all.slice(first, Math.min(hi + 1, first + group)).map((word, i) => ({ word, index: first + i }));
  const lines: Array<typeof page> = [];
  for (let i = 0; i < page.length; i += Math.max(1, s.maxWordsPerLine)) lines.push(page.slice(i, i + Math.max(1, s.maxWordsPerLine)));
  const shownLines = lines.slice(0, Math.max(1, s.maxLines));

  const weight = s.fontWeight === 'black' ? 900 : s.fontWeight === 'bold' ? 760 : 520;
  ctx.font = font(s, weight);
  ctx.letterSpacing = `${s.letterSpacing}px`;
  const em = s.fontSize;
  const wordPadX = s.wordBackground ? 0.22 * em : 0;
  const maxW = Math.min(width * 0.92, 1160);
  const padX = s.padding, padY = Math.max(8, 0.75 * s.padding);
  const rowGap = Math.max(4, 0.4 * s.wordSpacing), lineH = em * s.lineHeight;
  const rows = shownLines.flatMap(line => wrap(line.map(({ word, index }) => {
    const text = transform(word.text, s);
    return { word, index, text, width: ctx.measureText(text).width + 2 * wordPadX } as WordItem;
  }), s.wordSpacing, maxW - 2 * padX));
  const contentW = Math.max(...rows.map(r => rowWidth(r, s.wordSpacing)));
  const boxW = contentW + 2 * padX, boxH = rows.length * lineH + (rows.length - 1) * rowGap + 2 * padY;
  const cx = width / 2, top = anchor(s, height, boxH);
  const enter = progress(time, phrase, s).enter;
  const multi = s.maxLines > 1 && s.highlightCurrentWord && !s.wordBackground;

  ctx.save();
  if (s.animation !== 'none') ctx.globalAlpha *= enter;
  animate(ctx, 'tiktok', s, enter, cx, top + boxH / 2);
  if (s.backgroundOpacity > 0) { roundRect(ctx, cx - boxW / 2, top, boxW, boxH, 8); ctx.fillStyle = s.backgroundColor; ctx.fill(); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const baseShadows: Shadow[] = s.textShadow ? [{ x: 0, y: 2, blur: 8, color: s.textShadowColor }, { x: 0, y: 0, blur: s.textShadowBlur, color: s.textShadowColor }] : [];
  rows.forEach((row, r) => {
    let x = cx - rowWidth(row, s.wordSpacing) / 2;
    const y = top + padY + r * (lineH + rowGap) + lineH / 2;
    for (const item of row) {
      const w = item.word;
      const past = time > w.endMs + 110;
      let h = 0;
      if (s.highlightCurrentWord) {
        const ramp = Math.min(110, Math.max(24, Math.max(1, w.endMs - w.startMs) / 2));
        h = smoothstep(Math.min(interp(time, [w.startMs - ramp, w.startMs + ramp], [0, 1]), interp(time, [w.endMs - ramp, w.endMs + ramp], [1, 0])));
      }
      const distance = Math.abs(item.index - active);
      const proximity = smoothstep(1 - distance / (s.wordBackground ? 2.8 : 3.6));
      const base = multi ? 1 : past ? 0.94 : 0.62 + 0.16 * proximity;
      const opacity = Math.min(1, base + h * (1 - base));
      const scale = s.wordBackground ? 1 : 1 + 0.025 * h;
      const offsetY = s.wordBackground ? -0.75 * h : -1.4 * h;
      const wx = x + item.width / 2;
      ctx.save();
      ctx.translate(wx, y + offsetY); ctx.scale(scale, scale); ctx.translate(-wx, -y);
      if (s.wordBackground && h > 0) {
        const bw = item.width + 0.4 * em, bh = lineH + 0.08 * em; // inset: -0.04em -0.2em
        ctx.save();
        ctx.globalAlpha *= 0.9 * h;
        ctx.translate(wx, y); ctx.scale(0.86 + 0.14 * h, 0.72 + 0.28 * h); ctx.translate(-wx, -y);
        const px = Math.hypot(ctx.getTransform().a, ctx.getTransform().b) || 1;
        ctx.shadowColor = `rgba(0, 0, 0, ${0.12 + 0.1 * h})`; ctx.shadowBlur = (6 + 16 * h) * px; ctx.shadowOffsetY = (2 + 7 * h) * px;
        roundRect(ctx, wx - bw / 2, y - bh / 2, bw, bh, s.wordBorderRadius);
        ctx.fillStyle = s.wordBackgroundColor; ctx.fill();
        ctx.restore();
      }
      ctx.save();
      ctx.globalAlpha *= opacity;
      drawText(ctx, item.text, wx, y, s, s.textColor, baseShadows);
      ctx.restore();
      if (s.highlightCurrentWord && h > 0) {
        ctx.save();
        ctx.globalAlpha *= opacity * h;
        const glow: Shadow = s.wordBackground
          ? { x: 0, y: 1, blur: 2 + 4 * h, color: `rgba(0, 0, 0, ${0.16 + 0.18 * h})` }
          : { x: 0, y: 1 + h, blur: 4 + 6 * h, color: `rgba(0, 0, 0, ${0.34 + 0.22 * h})` };
        drawText(ctx, item.text, wx, y, { ...s, textStroke: false }, s.highlightColor, [glow]);
        ctx.restore();
        const underline = s.wordBackground || multi ? 0 : 0.68 * h;
        if (underline > 0) {
          ctx.save();
          ctx.globalAlpha *= opacity * underline;
          const uh = 0.07 * em, uy = y + lineH / 2 + 0.08 * em - uh;
          roundRect(ctx, x, uy, item.width, uh, uh / 2);
          ctx.fillStyle = s.highlightColor; ctx.fill();
          ctx.restore();
        }
      }
      ctx.restore();
      x += item.width + s.wordSpacing;
    }
  });
  ctx.restore();
}

/** Karaoke: current caption with the active word highlighted and a progress bar. */
function drawKaraoke(ctx: Ctx, captions: Caption[], s: CaptionSettings, time: number, width: number, height: number) {
  const caption = captions.find(c => time >= c.startMs && time <= c.endMs);
  if (!caption) return;
  const words = captionWords(caption);
  if (!words.length) return;
  let active = words.findIndex(w => time >= w.startMs && time <= w.endMs);
  if (active < 0) {
    const next = words.findIndex(w => time < w.startMs);
    active = next === -1 ? Math.max(0, words.length - 1) : Math.max(0, next - 1);
  }
  const lines: CaptionWord[][] = [];
  for (let i = 0; i < words.length; i += s.maxWordsPerLine) lines.push(words.slice(i, i + s.maxWordsPerLine));
  const shown = lines.slice(0, s.maxLines);
  const weight = s.fontWeight === 'black' ? 900 : s.fontWeight === 'bold' ? 720 : 500;
  ctx.font = font(s, weight);
  ctx.letterSpacing = `${s.letterSpacing}px`;
  const maxW = Math.min(width * 0.92, 1080);
  const padX = s.padding, padY = Math.max(8, 0.75 * s.padding);
  const gap = Math.max(4, 0.7 * s.wordSpacing), lineH = s.fontSize * s.lineHeight;
  const rows = shown.flatMap(line => wrap(line.map(word => {
    const text = transform(word.text, s);
    return { word, index: words.indexOf(word), text, width: ctx.measureText(text).width };
  }), s.wordSpacing, maxW - 2 * padX));
  const barH = Math.max(3, 0.08 * s.fontSize), barGap = Math.max(2, 0.2 * s.wordSpacing);
  const textW = Math.max(...rows.map(r => rowWidth(r, s.wordSpacing)));
  const barW = Math.min(520, maxW - 2 * padX);
  const contentW = Math.max(textW, barW);
  // Rows and the bar are flex items separated by `gap`; the bar adds its own top margin.
  const boxW = contentW + 2 * padX, boxH = rows.length * (lineH + gap) + barGap + barH + 2 * padY;
  const cx = width / 2, top = anchor(s, height, boxH);
  const enter = progress(time, caption, s).enter;
  const fill = interp(time, [caption.startMs, caption.endMs], [0, 1]);
  ctx.save();
  if (s.animation !== 'none') ctx.globalAlpha *= enter;
  animate(ctx, 'karaoke', s, enter, cx, top + boxH / 2);
  if (s.backgroundOpacity > 0) { roundRect(ctx, cx - boxW / 2, top, boxW, boxH, 8); ctx.fillStyle = s.backgroundColor; ctx.fill(); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const shadows: Shadow[] = s.textShadow ? [{ x: 0, y: 2, blur: 7, color: s.textShadowColor }, { x: 0, y: 0, blur: s.textShadowBlur, color: s.textShadowColor }] : [];
  let y = top + padY;
  for (const row of rows) {
    let x = cx - rowWidth(row, s.wordSpacing) / 2;
    for (const item of row) {
      const color = item.index === active ? s.highlightColor : time > item.word.endMs ? s.textColor : withAlpha(s.textColor, 0x82 / 255);
      drawText(ctx, item.text, x + item.width / 2, y + lineH / 2, s, color, shadows);
      x += item.width + s.wordSpacing;
    }
    y += lineH + gap;
  }
  const barTop = y + barGap;
  roundRect(ctx, cx - barW / 2, barTop, barW, barH, barH / 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.18)'; ctx.fill();
  if (fill > 0) { roundRect(ctx, cx - barW / 2, barTop, barW * fill, barH, barH / 2); ctx.fillStyle = s.highlightColor; ctx.fill(); }
  ctx.restore();
}

/** Draws timeline captions in composition space (`width`×`height`). */
export function drawCaptions(ctx: Ctx, captions: Caption[], s: CaptionSettings, time: number, width: number, height: number) {
  if (!s.enabled || !captions.length) return;
  const valid = captions.filter(validCaption);
  if (!valid.length) return;
  ctx.save();
  if (s.style === 'classic') drawClassic(ctx, valid, s, time, width, height);
  else if (s.style === 'karaoke') drawKaraoke(ctx, valid, s, time, width, height);
  else drawTiktok(ctx, valid, s, time, width, height);
  ctx.restore();
}
