// Keyboard shortcut overlay: key events are grouped into
// modifier+key shortcuts (plain typing is never shown) and drawn as animated badges.
import type { KeyEvent, KeyboardSettings } from './types';

export type Shortcut = { id: string; start: number; end: number; keys: string[]; displayText: string };

const MODIFIERS = new Set(['Ctrl', 'Alt', 'Shift', 'Win', 'Meta', 'Command', 'Option']);
const ORDER = ['Ctrl', 'Alt', 'Shift', 'Win', 'Meta'];
const SYMBOLS: Record<string, string> = { Ctrl: '^', Alt: '⌥', Shift: '⇧', Win: '⌘', Meta: '⌘' };

export function displayText(keys: string[], symbols: boolean) {
  return symbols ? keys.map(k => SYMBOLS[k] || k).join('') : keys.join(' + ');
}

function build(keys: string[], start: number, end: number, symbols: boolean, index: number): Shortcut {
  const sorted = [...keys].sort((a, b) => {
    const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
    return ia !== -1 && ib !== -1 ? ia - ib : ia !== -1 ? -1 : ib !== -1 ? 1 : 0;
  });
  return { id: `kb-${index}-${start}`, start, end, keys: sorted, displayText: displayText(sorted, symbols) };
}

/** Groups key events into shortcuts. */
export function shortcutsFromKeys(events: KeyEvent[], groupingThreshold: number, symbols: boolean): Shortcut[] {
  if (!events?.length) return [];
  const result: Shortcut[] = [];
  const held = new Map<string, { start: number; keyCode: number; isModifier: boolean }>();
  let groupStart: number | null = null;
  let group: string[] = [];
  let hasModifier = false, hasKey = false, last = 0;
  const flush = (end: number) => {
    if (groupStart !== null && group.length > 0) {
      if (group.length >= 2 && hasModifier && hasKey) result.push(build(group, groupStart, end, symbols, result.length));
      groupStart = null; group = []; hasModifier = false; hasKey = false;
    }
  };
  for (const event of [...events].sort((a, b) => a.t - b.t)) {
    if (event.event === 'down') {
      if (groupStart === null || event.t - last > groupingThreshold) {
        flush(last + 100);
        groupStart = event.t;
        group = [...held.entries()].filter(([, v]) => v.isModifier).map(([k]) => k);
        hasModifier = group.length > 0;
        hasKey = false;
      }
      if (!held.has(event.key)) {
        const modifier = event.isModifier || MODIFIERS.has(event.key);
        held.set(event.key, { start: event.t, keyCode: event.keyCode, isModifier: modifier });
        if (modifier) { group.unshift(event.key); hasModifier = true; } else { group.push(event.key); hasKey = true; }
      }
      last = event.t;
    } else if (event.event === 'up') {
      if (held.get(event.key)) { held.delete(event.key); last = event.t; }
      if (held.size === 0) flush(event.t);
    }
  }
  flush(last + 100);
  return result;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (v: number, [a, b]: [number, number], [c, d]: [number, number]) => c + (d - c) * clamp01((v - a) / (b - a));
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

function darken(color: string, amount: number) {
  const rgba = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(color);
  const c = (v: number) => Math.max(0, Math.min(255, v + amount));
  if (rgba) return `rgba(${c(+rgba[1])}, ${c(+rgba[2])}, ${c(+rgba[3])}, ${rgba[4] ?? 1})`;
  if (color.startsWith('#') && color.length >= 7) return `rgb(${c(parseInt(color.slice(1, 3), 16))}, ${c(parseInt(color.slice(3, 5), 16))}, ${c(parseInt(color.slice(5, 7), 16))})`;
  return color;
}

/** Draws visible shortcuts at `time` in composition coordinates (width × height). */
export function drawKeyboard(ctx: CanvasRenderingContext2D, shortcuts: Shortcut[], settings: KeyboardSettings, time: number, width: number, height: number) {
  if (!settings.enabled || !shortcuts.length) return;
  const visible = shortcuts.filter(s => time >= s.start - 150 && time <= s.end + settings.displayDuration + 200).map(s => {
    const exitStart = s.end + settings.displayDuration;
    return {
      shortcut: s,
      enter: lerp(time, [s.start - 150, s.start], [0, 1]),
      exit: lerp(time, [exitStart, exitStart + 200], [1, 0]),
      hold: s.end - s.start > 0 ? lerp(time, [s.start, s.end], [0, 1]) : 1,
    };
  }).filter(v => v.enter > 0 && v.exit > 0);
  if (!visible.length) return;

  const font = settings.fontSize, padX = Math.round(0.75 * font), padY = Math.round(0.375 * font), gap = Math.round(0.375 * font);
  const style = settings.style;
  const horizontalPad = style === 'pill' ? 1.5 * padX : style === 'glass' ? 1.2 * padX : padX;
  ctx.save();
  ctx.font = `600 ${font}px "Segoe UI", -apple-system, Roboto, monospace`;
  ctx.textBaseline = 'middle';
  const badges = visible.map(v => {
    const textWidth = ctx.measureText(v.shortcut.displayText).width;
    return { ...v, w: textWidth + horizontalPad * 2, h: font * 1.25 + padY * 2 };
  });
  const totalW = badges.reduce((sum, b) => sum + b.w, 0) + gap * 2 * (badges.length - 1);
  const rowH = Math.max(...badges.map(b => b.h));
  const margin = 40;
  const pos = settings.position;
  let x = pos.endsWith('left') ? margin : pos.endsWith('right') ? width - margin - totalW : (width - totalW) / 2;
  const y = pos.startsWith('top') ? margin : height - margin - rowH;
  ctx.globalAlpha = settings.opacity;
  for (const b of badges) {
    const appear = Math.min(b.enter, b.exit);
    const scale = lerp(appear, [0, 1], [0.8, 1]);
    // translateY: 10 → -2 → 0 px over the enter animation, eased out.
    const offset = b.enter < 0.5 ? 10 + (-2 - 10) * easeOutCubic(b.enter / 0.5) : -2 + (0 - -2) * easeOutCubic((b.enter - 0.5) / 0.5);
    const radius = style === 'pill' ? b.h / 2 : style === 'glass' ? 10 : style === 'outline' ? 8 : 6;
    ctx.save();
    ctx.globalAlpha = settings.opacity * appear;
    ctx.translate(x + b.w / 2, y + rowH / 2 + offset);
    ctx.scale(scale, scale);
    ctx.translate(-b.w / 2, -b.h / 2);
    const px = Math.hypot(ctx.getTransform().a, ctx.getTransform().b) || 1; // shadows are in device pixels
    ctx.beginPath();
    ctx.roundRect(0, 0, b.w, b.h, radius);
    if (style === 'pill') {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.3)'; ctx.shadowBlur = 12 * px; ctx.shadowOffsetY = 4 * px;
      ctx.fillStyle = settings.backgroundColor; ctx.fill();
      ctx.shadowColor = 'transparent';
    } else if (style === 'keycap') {
      const g = ctx.createLinearGradient(0, 0, 0, b.h);
      g.addColorStop(0, settings.backgroundColor); g.addColorStop(1, darken(settings.backgroundColor, -20));
      ctx.shadowColor = 'rgba(0, 0, 0, 0.3)'; ctx.shadowBlur = 8 * px; ctx.shadowOffsetY = 4 * px;
      ctx.fillStyle = g; ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.save(); ctx.clip();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'; ctx.fillRect(0, b.h - 2, b.w, 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'; ctx.fillRect(0, 0, b.w, 1);
      ctx.restore();
    } else if (style === 'glass') {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.2)'; ctx.shadowBlur = 32 * px; ctx.shadowOffsetY = 8 * px;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'; ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'; ctx.stroke();
    } else if (style === 'outline') {
      ctx.lineWidth = 2; ctx.strokeStyle = settings.textColor; ctx.stroke();
    } else if (style === 'minimal') {
      ctx.lineWidth = 1; ctx.strokeStyle = `${settings.textColor}40`; ctx.stroke();
    } else {
      ctx.fillStyle = settings.backgroundColor; ctx.fill();
    }
    if (settings.holdAnimation && b.hold < 1) {
      ctx.save(); ctx.clip();
      ctx.fillStyle = settings.holdAnimationColor; ctx.fillRect(0, 0, b.w * b.hold, b.h);
      ctx.restore();
    }
    ctx.fillStyle = settings.textColor;
    ctx.fillText(b.shortcut.displayText, horizontalPad, b.h / 2 + 1);
    ctx.restore();
    x += b.w + gap * 2;
  }
  ctx.restore();
}
