// CPU-profiles the running DirectZoom renderer for a few seconds and prints the functions with the
// most self time (testing aid). Usage: node scripts/profile.mjs [seconds] [--port 9333]
const args = process.argv.slice(2);
const seconds = Number(args.find(a => /^\d+$/.test(a)) ?? 5);
const port = args.includes('--port') ? args[args.indexOf('--port') + 1] : '9333';
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find(t => t.type === 'page' && !t.url.includes('recording-bar'));
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 1;
const pending = new Map();
socket.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(resolve => { const id = nextId++; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })); });

await send('Profiler.enable');
await send('Profiler.setSamplingInterval', { interval: 500 });
await send('Profiler.start');
await new Promise(r => setTimeout(r, seconds * 1000));
const { profile } = await send('Profiler.stop');
socket.close();

const byId = new Map(profile.nodes.map(n => [n.id, n]));
const self = new Map();
const dt = profile.timeDeltas;
profile.samples.forEach((id, i) => { self.set(id, (self.get(id) ?? 0) + (dt[i] ?? 0)); });
const total = dt.reduce((a, b) => a + b, 0);
const agg = new Map();
for (const [id, us] of self) {
  const f = byId.get(id).callFrame;
  const key = `${f.functionName || '(anonymous)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
  agg.set(key, (agg.get(key) ?? 0) + us);
}
const rows = [...agg].sort((a, b) => b[1] - a[1]).slice(0, 18);
for (const [key, us] of rows) console.log(`${(100 * us / total).toFixed(1).padStart(5)}%  ${key}`);
