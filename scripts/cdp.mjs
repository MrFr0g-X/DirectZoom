// Drives a running DirectZoom instance over the Chrome DevTools Protocol (testing aid).
// Usage: node scripts/cdp.mjs "<expression>" [--port 9333] [--match /library] [--shot file.png]
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const expression = args[0] && !args[0].startsWith('--') ? args[0] : 'location.href';
const port = option('--port', process.env.DIRECTZOOM_DEBUG_PORT || '9333');
const match = option('--match', '');
const shot = option('--shot', '');

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const pages = targets.filter(t => t.type === 'page' && (!match || t.url.includes(match)));
if (!pages.length) throw new Error(`no page matching "${match}": ${targets.map(t => t.url).join(', ')}`);
const socket = new WebSocket(pages[0].webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 1;
const pending = new Map();
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(message.error.message)) : resolve(message.result);
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
const value = result.exceptionDetails ? { error: result.exceptionDetails.exception?.description ?? result.exceptionDetails.text } : result.result.value;
console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 1)?.slice(0, 6000));
if (shot) {
  const image = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(shot, Buffer.from(image.data, 'base64'));
  console.log(`screenshot: ${shot}`);
}
socket.close();
