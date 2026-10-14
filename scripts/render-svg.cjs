// Renders SVG (or HTML) files to PNG with Electron's Chromium, so icon artwork can be kept as SVG.
// Usage: npx electron scripts/render-svg.cjs <input.svg> <output.png> <width> [height]
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const args = process.argv.slice(process.argv.findIndex(a => a.endsWith('render-svg.cjs')) + 1);
  const [input, output, w, h] = args;
  const width = Number(w), height = Number(h ?? w);
  if (!input || !output || !(width > 0) || !(height > 0)) {
    console.error('Usage: electron scripts/render-svg.cjs <input.svg> <output.png> <width> [height]');
    app.exit(1);
    return;
  }
  const source = fs.readFileSync(path.resolve(input), 'utf8');
  const win = new BrowserWindow({ show: false, width: 64, height: 64, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<canvas></canvas>');
  const png = await win.webContents.executeJavaScript(`(async () => {
    const svg = ${JSON.stringify(source)};
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    await img.decode();
    const c = document.querySelector('canvas');
    c.width = ${width}; c.height = ${height};
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, ${width}, ${height});
    return c.toDataURL('image/png');
  })()`);
  fs.writeFileSync(path.resolve(output), Buffer.from(png.split(',')[1], 'base64'));
  app.quit();
});
