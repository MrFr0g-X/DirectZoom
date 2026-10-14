"""System-audio placement test: silence, then three beeps 1 s apart at known QPC times.

Usage: python audio_test.py <output_dir>
Checks that audio.wav spans the whole recording and that beeps land at their times.
"""
import json, os, struct, subprocess, sys, time, winsound

HERE = os.path.dirname(os.path.abspath(__file__))
DZCAP = os.path.join(HERE, '..', 'target', 'release', 'dzcap.exe')
out = os.path.abspath(sys.argv[1])
proc = subprocess.Popen([DZCAP, 'record', json.dumps({'output_dir': out, 'source': {'kind': 'display', 'index': 1}, 'fps': 30, 'system_audio': True})],
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
started = json.loads(proc.stdout.readline())
assert started['event'] == 'started', started
t0_ms = started['t0'] / 10_000
# One stream with beeps exactly 1 s apart, so device start-up latency cancels out.
import math, tempfile
rate_out = 48000
pcm = bytearray()
for i in range(int(rate_out * 3.3)):
    t = i / rate_out
    on = any(0.2 + k <= t < 0.32 + k for k in range(3))
    pcm += struct.pack('<h', int(12000 * math.sin(2 * math.pi * 1000 * t)) if on else 0)
wav = os.path.join(tempfile.gettempdir(), 'dzcap-beeps.wav')
with open(wav, 'wb') as f:
    f.write(b'RIFF' + struct.pack('<I', 36 + len(pcm)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, rate_out, rate_out * 2, 2, 16) + b'data' + struct.pack('<I', len(pcm)) + pcm)
time.sleep(1.0)
start = time.perf_counter_ns() / 1e6 - t0_ms
winsound.PlaySound(wav, winsound.SND_FILENAME)
beeps = [start + 200 + 1000 * k for k in range(3)]
time.sleep(0.4)
proc.stdin.write('stop\n'); proc.stdin.flush()
lines = [json.loads(line) for line in proc.stdout]
proc.wait()
print('dzcap:', lines)

data = open(os.path.join(out, 'audio.wav'), 'rb').read()
rate = struct.unpack('<I', data[24:28])[0]
samples = struct.unpack(f'<{(len(data) - 44) // 2}h', data[44:])
left = samples[0::2]
meta = json.load(open(os.path.join(out, 'metadata.json')))
print(f'wav {len(left) / rate * 1000:.1f} ms vs recording {meta["duration"]:.1f} ms')
onsets, quiet = [], 0
for i, v in enumerate(left):
    if abs(v) > 2000 and quiet > rate * 0.3: onsets.append(i / rate * 1000)
    quiet = 0 if abs(v) > 2000 else quiet + 1
print('beep sent  ms:', [round(b, 1) for b in beeps])
print('beep onset ms:', [round(o, 1) for o in onsets])
print('onset - sent :', [round(o - b, 1) for o, b in zip(onsets, beeps)])
print('onset spacing:', [round(b - a, 2) for a, b in zip(onsets, onsets[1:])])
