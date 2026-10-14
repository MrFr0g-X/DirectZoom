// Renders media/demo/index.html frame by frame (render(t) for every frame) and encodes
// media/demo.mp4 (1920×1080, 60 fps) and media/demo.webp (README: animated WebP, 1280 px, 30 fps;
// a GIF of the same clip is about five times larger and bands the gradients).
// Usage: npx electron scripts/render-demo.cjs [--still seconds]
const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ffmpeg = require('ffmpeg-static');

const root = path.join(__dirname, '..');
const page = path.join(root, 'media', 'demo', 'index.html');
const out = path.join(root, 'media');
const FPS = 60;
const stillAt = process.argv.includes('--still') ? Number(process.argv[process.argv.indexOf('--still') + 1]) : null;

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['pipe', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
    run.child = child;
  });
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  // Hidden windows produce no animation frames, so the window is shown but fully transparent,
  // unfocusable and off the taskbar. Each frame waits two animation frames after render(t).
  const win = new BrowserWindow({
    show: true, opacity: 0, focusable: false, skipTaskbar: true, frame: false, width: 1920, height: 1080, useContentSize: true,
    webPreferences: { sandbox: true, backgroundThrottling: false },
  });
  win.setIgnoreMouseEvents(true);
  await win.loadFile(page, { search: 'render' });
  await win.webContents.executeJavaScript(`window.__renderer = true;
    Promise.all(['400 20px Outfit', '500 20px Outfit', '600 20px Outfit', '700 20px Outfit', '500 20px Mono'].map(f => document.fonts.load(f)))
      .then(() => Promise.all([...document.images].map(img => img.decode().catch(() => {})))).then(() => true)`);
  const frame = async t => {
    await win.webContents.executeJavaScript(`render(${t}); new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => r(true), 40))))`);
    const image = await win.webContents.capturePage();
    const size = image.getSize();
    if (size.width !== 1920 || size.height !== 1080) throw new Error(`Unexpected capture size ${size.width}×${size.height}`);
    return image.toPNG();
  };
  await frame(0);

  if (stillAt !== null) {
    const file = path.join(out, `demo-still-${stillAt}.png`);
    fs.writeFileSync(file, await frame(stillAt));
    console.log(file);
    app.quit();
    return;
  }

  const duration = await win.webContents.executeJavaScript('DURATION');
  const total = Math.round(duration * FPS);
  const mp4 = path.join(out, 'demo.mp4');
  const encoding = run(['-f', 'image2pipe', '-framerate', String(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
  const stdin = run.child.stdin;
  for (let i = 0; i < total; i++) {
    const png = await frame(i / FPS);
    if (!stdin.write(png)) await new Promise(r => stdin.once('drain', r));
    if (i % 60 === 0) process.stdout.write(`\rframe ${i}/${total}`);
  }
  stdin.end();
  await encoding;
  console.log(`\n${mp4}`);

  const webp = path.join(out, 'demo.webp');
  await run(['-i', mp4, '-vf', 'fps=30,scale=1280:-1:flags=lanczos', '-c:v', 'libwebp_anim', '-quality', '80', '-compression_level', '6', '-loop', '0', webp]);
  console.log(webp);
  app.quit();
});
