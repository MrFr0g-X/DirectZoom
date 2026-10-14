/**
 * Output size for a resolution preset. "1080p" means the frame fits inside 1920×1080 (or
 * 1080×1920 for portrait canvases), like the standard video sizes: a canvas slightly wider than
 * 16:9 gets a little less height instead of a non-standard width. Standard-bounded sizes are also
 * what hardware encoders accept at 60 fps. "original" keeps the canvas size. Sizes are even.
 */
export function outputSize(canvasWidth: number, canvasHeight: number, preset: number | 'original') {
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  if (preset === 'original') return { width: even(canvasWidth), height: even(canvasHeight) };
  const long = Math.round((preset * 16) / 9);
  const [boxW, boxH] = canvasWidth >= canvasHeight ? [long, preset] : [preset, long];
  const scale = Math.min(boxW / canvasWidth, boxH / canvasHeight);
  return { width: even(canvasWidth * scale), height: even(canvasHeight * scale) };
}
