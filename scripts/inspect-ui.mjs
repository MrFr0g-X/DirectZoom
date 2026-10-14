import { writeFileSync } from 'node:fs';
const targets = await (await fetch(`http://127.0.0.1:${process.env.DIRECTZOOM_DEBUG_PORT || '9224'}/json`)).json();
const page = targets.find(item => item.type === 'page' && item.title === 'DirectZoom');
if (!page) throw new Error('DirectZoom page not found');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 1;
const pending = new Map();
socket.onmessage = event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const { resolve, reject } = pending.get(message.id); pending.delete(message.id); message.error ? reject(new Error(message.error.message)) : resolve(message.result); } };
function send(method, params = {}) { const id = nextId++; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }); }
const expression = process.argv[2] || '({text:document.body.innerText, url:location.href, api:!!window.directzoom})';
const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
console.log(JSON.stringify(result.result.value ?? result.exceptionDetails ?? result.result, null, 2).slice(0, 5000));
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
writeFileSync('D:/directzoom/app/ui-screenshot.png', Buffer.from(shot.data, 'base64'));
socket.close();
