import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPreset, builtInPresets } from '../src/brandPresets.ts';

const settings = {
  backgroundSettings: { type: 'wallpaper', wallpaper: 'dusk', gradient: 'g', color: '#000', imagePath: null, aspectRatio: 'original', fitMode: 'contain', padding: 40, borderRadius: 12, inset: 0, backgroundBlur: 0, shadow: true, shadowSettings: { blur: 40, offsetX: 0, offsetY: 20, opacity: 0.3 } },
  cursorSettings: { cursorDesign: 'macos', size: 98, color: '#fff', strokeColor: '#000', clickEffect: 'ring', highlightColor: 'x', clickShrink: true, clickShrinkAmount: 0.8 },
  captionSettings: { enabled: true, style: 'classic', fontFamily: 'Inter', textTransform: 'none', textStroke: false },
  keyboardSettings: { style: 'pill', backgroundColor: 'a', textColor: 'b', holdAnimationColor: 'c' },
  cameraSettings: { borderColor: 'x', borderWidth: 3, roundness: 50, shadow: true },
  zoomSettings: { defaultScale: 1.5 },
};

test('four built-in brand presets', () => {
  assert.deepEqual(builtInPresets.map(p => p.id), ['midnight', 'sunrise', 'paper', 'neon']);
});

test('applying a preset merges known keys and skips unknown ones', () => {
  const neon = builtInPresets.find(p => p.id === 'neon');
  const next = applyPreset({ ...settings, animationSettings: undefined }, { ...neon, settings: { ...neon.settings, animationSettings: { style: 'x' }, backgroundSettings: { ...neon.settings.backgroundSettings, unknownKey: 1 } } });
  assert.equal(next.backgroundSettings.type, 'gradient');
  assert.equal(next.backgroundSettings.padding, 52);
  assert.equal(next.backgroundSettings.shadowSettings.blur, 60);
  assert.equal('unknownKey' in next.backgroundSettings, false);
  assert.equal(next.cursorSettings.cursorDesign, 'lavender');
  assert.equal(next.cursorSettings.clickEffect, 'burst');
  assert.equal(next.captionSettings.style, 'tiktok');
  assert.equal(next.captionSettings.enabled, true);
  assert.equal(next.keyboardSettings.style, 'outline');
  assert.equal(next.cameraSettings.borderWidth, 4);
  assert.equal(next.zoomSettings, settings.zoomSettings);
});
