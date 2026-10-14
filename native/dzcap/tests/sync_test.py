"""Frame/cursor synchronization test for dzcap.

A Tk window jumps a red square to a new position every 100 ms and moves the real
cursor to the square's centre at the same instant. In the recording, the square's
position in each frame must agree with cursor.json at that frame's timestamp.

Usage: python sync_test.py <window|area|display> <output_dir>
Moves the mouse for about four seconds.
"""
import ctypes, json, os, random, subprocess, sys, time, tkinter as tk

ctypes.windll.shcore.SetProcessDpiAwareness(2)
HERE = os.path.dirname(os.path.abspath(__file__))
DZCAP = os.path.join(HERE, '..', 'target', 'release', 'dzcap.exe')
APP = os.path.join(HERE, '..', '..', '..')
FFMPEG = os.path.join(APP, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe')


mode, out = sys.argv[1], os.path.abspath(sys.argv[2])
SIZE, SQUARE = (640, 480), 40

root = tk.Tk()
root.title('dzcap sync test')
root.geometry(f'{SIZE[0]}x{SIZE[1]}+300+200')
root.attributes('-topmost', True)
canvas = tk.Canvas(root, width=SIZE[0], height=SIZE[1], bg='white', highlightthickness=0)
canvas.pack()
square = canvas.create_rectangle(0, 0, SQUARE, SQUARE, fill='#ff0000', outline='')
root.update()
time.sleep(0.3)
root.update()

hwnd = int(root.wm_frame(), 16)
cx, cy = canvas.winfo_rootx(), canvas.winfo_rooty()
if mode == 'window':
    source = {'kind': 'window', 'hwnd': hwnd}
elif mode == 'area':
    source = {'kind': 'area', 'display': 1, 'rect': {'x': cx, 'y': cy, 'width': SIZE[0], 'height': SIZE[1]}}
else:
    source = {'kind': 'display', 'index': 1}

proc = subprocess.Popen([DZCAP, 'record', json.dumps({'output_dir': out, 'source': source, 'fps': 60})],
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
started = json.loads(proc.stdout.readline())
assert started.get('event') == 'started', started

random.seed(7)
t0_ms = started['t0'] / 10_000  # QPC in 100 ns ticks; perf_counter_ns reads the same counter
b = started['bounds']
jumps = []
for step in range(32):
    x = random.randint(20, SIZE[0] - SQUARE - 20)
    y = random.randint(20, SIZE[1] - SQUARE - 20)
    canvas.coords(square, x, y, x + SQUARE, y + SQUARE)
    root.update()
    sx, sy = cx + x + SQUARE // 2, cy + y + SQUARE // 2
    ctypes.windll.user32.SetCursorPos(sx, sy)
    jumps.append((time.perf_counter_ns() / 1e6 - t0_ms, (sx - b['x']) / b['width'], (sy - b['y']) / b['height']))
    end = time.perf_counter() + 0.1
    while time.perf_counter() < end:
        root.update()
        time.sleep(0.002)

proc.stdin.write('stop\n'); proc.stdin.flush()
finished = json.loads(proc.stdout.readline())
proc.wait()
root.destroy()
print('dzcap:', finished)

meta = json.load(open(os.path.join(out, 'metadata.json')))
cursor = [e for e in json.load(open(os.path.join(out, 'cursor.json'))) if e['event'] == 'move']
W, H = meta['resolution']['width'], meta['resolution']['height']
import re
info = subprocess.run([FFMPEG, '-v', 'info', '-i', os.path.join(out, 'screen.mp4'), '-map', '0:v', '-vf', 'showinfo', '-f', 'null', '-'],
                      capture_output=True, text=True).stderr
pts = [float(value) for value in re.findall(r'pts_time:([0-9.]+)', info)]
raw = subprocess.run([FFMPEG, '-v', 'error', '-i', os.path.join(out, 'screen.mp4'), '-fps_mode', 'passthrough',
                      '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
frame_bytes = W * H * 3
frames = len(raw) // frame_bytes
print(f'video {W}x{H}, {frames} frames, {len(pts)} timestamps, duration {meta["duration"]:.0f} ms, cursor moves {len(cursor)}')

def centroid(index):
    data = memoryview(raw)[index * frame_bytes:(index + 1) * frame_bytes]
    sx = sy = n = 0
    for y in range(0, H, 2):
        row = y * W * 3
        for x in range(0, W, 2):
            o = row + x * 3
            if data[o] > 180 and data[o + 1] < 90 and data[o + 2] < 90:
                sx += x; sy += y; n += 1
    return (sx / n / W, sy / n / H) if n > 20 else None

def cursor_at(ms):
    last = None
    for event in cursor:
        if event['t'] > ms: break
        last = event
    return last

# Per jump: latency of video and of cursor.json relative to the true jump time.
centroids = [(pts[i] * 1000, centroid(i)) for i in range(min(frames, len(pts)))]
W2, H2 = W, H
rows = []
for t_jump, ex, ey in jumps:
    video = next((t for t, c in centroids if c and t >= t_jump - 50 and abs(c[0] - ex) * W2 < 6 and abs(c[1] - ey) * H2 < 6), None)
    cur = next((e['t'] for e in cursor if e['t'] >= t_jump - 50 and abs(e['x'] - ex) * W2 < 2 and abs(e['y'] - ey) * H2 < 2), None)
    rows.append((t_jump, video, cur))
seen = [(v - t, c - t, c - v) for t, v, c in rows if v is not None and c is not None]
print(f'jumps {len(rows)}, seen in video {sum(r[1] is not None for r in rows)}, in cursor {sum(r[2] is not None for r in rows)}')
if seen:
    for name, k in (('video latency', 0), ('cursor latency', 1), ('cursor minus video', 2)):
        v = sorted(x[k] for x in seen)
        print(f'{name} ms: min {v[0]:.1f} median {v[len(v)//2]:.1f} max {v[-1]:.1f}')
