// 3D effect: timed keyframes tilt the recording frame in perspective. The state
// logic uses a smootherstep ramp (ramp over `transitionDuration` before and after
// each keyframe, interpolating from the neutral pose). Canvas 2D has no perspective, so the
// frame is rendered to a texture and projected with a WebGL quad using CSS transform math:
// rotateX(a) rotateY(b) rotateZ(c) scale(s) about the frame centre, `perspective: p` with the
// origin at the composition centre.
import type { ThreeDKeyframe, ThreeDSettings } from './types';

export type ThreeDState = { rotateX: number; rotateY: number; rotateZ: number; perspective: number; scale: number };

const smootherstep = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * x * (x * (6 * x - 15) + 10); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function pose(k: ThreeDKeyframe, t: number): ThreeDState {
  return { rotateX: lerp(0, k.rotateX, t), rotateY: lerp(0, k.rotateY, t), rotateZ: lerp(0, k.rotateZ, t), perspective: lerp(1200, k.perspective, t), scale: lerp(1, k.scale, t) };
}

/** Pose at `time` (timeline ms) from timeline-mapped keyframes, or null when neutral. */
export function threeDAt(keyframes: ThreeDKeyframe[], time: number, settings: ThreeDSettings): ThreeDState | null {
  if (!settings.enabled) return null;
  const T = settings.transitionDuration ?? 800;
  for (const k of keyframes.filter(k => k.endTime >= 0)) {
    if (T > 0 && time >= k.startTime - T && time < k.startTime) return pose(k, smootherstep((time - (k.startTime - T)) / T));
    if (time >= k.startTime && time <= k.endTime) return pose(k, 1);
    if (T > 0 && time > k.endTime && time <= k.endTime + T) return pose(k, smootherstep((k.endTime + T - time) / T));
  }
  return null;
}

export const isNeutral = (s: ThreeDState | null) => !s || (s.rotateX === 0 && s.rotateY === 0 && s.rotateZ === 0 && s.scale === 1);

/**
 * Projects a point given relative to the frame centre (u, v, design px) to composition space.
 * `extra` is applied before the rotation (used for the reflection's translateY/scaleY).
 */
export function projectPoint(state: ThreeDState, u: number, v: number, centre: { x: number; y: number }, origin: { x: number; y: number }, extra?: (u: number, v: number) => [number, number]) {
  let [x, y] = extra ? extra(u, v) : [u, v];
  let z = 0;
  x *= state.scale; y *= state.scale;
  const rz = (state.rotateZ * Math.PI) / 180, ry = (state.rotateY * Math.PI) / 180, rx = (state.rotateX * Math.PI) / 180;
  // rotateZ
  [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
  // rotateY: x' = x cos + z sin, z' = -x sin + z cos
  [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
  // rotateX: y' = y cos - z sin, z' = y sin + z cos
  [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
  const px = centre.x + x - origin.x, py = centre.y + y - origin.y;
  const w = Math.max(1e-3, (state.perspective - z) / state.perspective);
  return { x: origin.x + px / w, y: origin.y + py / w, w };
}

type Vertex = { x: number; y: number; w: number; u: number; v: number };

/** Draws textured quads with perspective-correct interpolation onto a transparent canvas. */
export class QuadRenderer {
  readonly canvas = document.createElement('canvas');
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private buffer: WebGLBuffer;
  private texture: WebGLTexture;

  constructor() {
    const gl = this.canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL is not available');
    this.gl = gl;
    const shader = (type: number, source: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, `
      attribute vec2 a_pos; attribute float a_w; attribute vec2 a_uv;
      uniform vec2 u_size; varying vec2 v_uv;
      void main() {
        vec2 ndc = vec2(a_pos.x / u_size.x * 2.0 - 1.0, 1.0 - a_pos.y / u_size.y * 2.0);
        gl_Position = vec4(ndc * a_w, 0.0, a_w);
        v_uv = a_uv;
      }`));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform sampler2D u_tex; uniform float u_opacity; varying vec2 v_uv;
      void main() { gl_FragColor = texture2D(u_tex, v_uv) * u_opacity; }`));
    gl.linkProgram(program);
    this.program = program;
    this.buffer = gl.createBuffer()!;
    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  begin(width: number, height: number) {
    const gl = this.gl;
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** `quad`: top-left, top-right, bottom-right, bottom-left in device px. */
  draw(source: TexImageSource, quad: Vertex[], opacity = 1) {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    const [a, b, c, d] = quad;
    const data = new Float32Array([a, b, c, a, c, d].flatMap(p => [p.x, p.y, p.w, p.u, p.v]));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
    const attr = (name: string, size: number, offset: number) => {
      const loc = gl.getAttribLocation(this.program, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 20, offset);
    };
    attr('a_pos', 2, 0); attr('a_w', 1, 8); attr('a_uv', 2, 12);
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_size'), this.canvas.width, this.canvas.height);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_opacity'), opacity);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_tex'), 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
