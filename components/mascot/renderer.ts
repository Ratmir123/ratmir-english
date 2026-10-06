// Glass jelly body: the 0.4 liquid lens shader extended with the 32-node deformable outline
// (MASCOT-SPEC §1–2). One quad, no textures. GLSL ES 1.0: constant loop bound, uniform array
// indexed by the loop counter only.
// PASS-0.5.3: the body rolls (CSS rotate on the body element), so `u_tilt` counter-rotates the key light and the
// highlight axes and the highlights stay put on screen; app mascots compile without blocking the main thread
// (KHR_parallel_shader_compile) and lose their context on dispose; small canvases render at ≤ 1.5× density.
import { BODY_RADIUS, DARK, KERNEL_K, NODE_COUNT, SUPERELLIPSE_N } from '@/lib/mascot/constants';
import { MASCOT_PALETTE, type GlassMaterial, type GlassRGB, type MascotPaletteSpec } from '@/lib/mascot/palette';

const VERTEX = `attribute vec2 a_position; varying vec2 v_uv;
void main() { v_uv = a_position * 0.5 + 0.5; gl_Position = vec4(a_position, 0.0, 1.0); }`;

const f = (value: number) => value.toFixed(6);
const v3 = (c: GlassRGB) => `vec3(${f(c[0])}, ${f(c[1])}, ${f(c[2])})`;
const PRELUDE = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_size;
uniform float u_time;
uniform float u_energy;
uniform vec2 u_gaze;
uniform float u_disp[${NODE_COUNT}];
uniform float u_dark;
uniform vec3 u_moodTint;
uniform float u_moodAmount;
uniform float u_tilt;
const float R0 = ${f(BODY_RADIUS)};
const float KERNEL = ${f(KERNEL_K)};
const float EXPONENT = ${f(SUPERELLIPSE_N)};
const float NODE_STEP = ${f(Math.PI * 2 / NODE_COUNT)};
const float MAX_RADIUS = ${f(BODY_RADIUS * 1.27)};
float superellipse(vec2 p) { return pow(pow(abs(p.x), EXPONENT) + pow(abs(p.y), EXPONENT), 1.0 / EXPONENT); }
// D(θ) = Σ d_i·w_i / Σ w_i, w_i = exp(K·(cos(θ − θ_i) − 1));  r(θ) = R0·(1 + D(θ)).
float radiusAt(float theta) {
  float weights = 0.0;
  float sum = 0.0;
  for (int i = 0; i < ${NODE_COUNT}; i++) {
    float w = exp(KERNEL * (cos(theta - float(i) * NODE_STEP) - 1.0));
    weights += w;
    sum += u_disp[i] * w;
  }
  return R0 * (1.0 + sum / weights);
}
// The body element is CSS-rotated by u_tilt (radians, clockwise on screen, y down). Lights and highlight axes are fixed
// on screen: a screen direction v enters the body frame as R(−u_tilt)·v; cs = (cos u_tilt, sin u_tilt).
vec2 unroll(vec2 v, vec2 cs) { return vec2(cs.x * v.x + cs.y * v.y, cs.x * v.y - cs.y * v.x); }
`;
const MAIN = `void main() {
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y) * 2.0 - 1.0; // y grows down, like the physics
  if (superellipse(p) > MAX_RADIUS + 0.02) { gl_FragColor = vec4(0.0); return; }
  float r = radiusAt(atan(p.y, p.x));
  vec2 b = p / r; // body-normalised: the edge is at superellipse(b) = 1
  float dist = superellipse(b);
  float aa = 2.4 / (max(u_size.x, u_size.y) * r);
  float alpha = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, dist);
  if (alpha < 0.001) { gl_FragColor = vec4(0.0); return; }
  float z = sqrt(max(0.001, 1.0 - dist * dist));
  vec3 normal = normalize(vec3(sign(b.x) * pow(abs(b.x), 1.5), sign(b.y) * pow(abs(b.y), 1.5), z * 0.88));
  vec2 refracted = b * (0.67 + z * 0.28) + normal.xy * 0.19;
  float flow = sin(refracted.x * 3.0 + refracted.y * 2.1 + u_time * 0.48);
  float pool = sin(refracted.y * 3.7 - refracted.x * 1.3 - u_time * 0.37);
  vec2 tiltCS = vec2(cos(u_tilt), sin(u_tilt));
  vec3 light = normalize(vec3(unroll(vec2(-0.52 + u_gaze.x * 0.15, -0.69 + u_gaze.y * 0.12), tiltCS), 0.7));
  float fresnel = pow(1.0 - z, 2.0);
  float edge = exp(-abs(dist - 0.969) * 108.0) * (1.0 + ${f(DARK.rim)} * u_dark);
  float upper = smoothstep(0.30, 0.95, dot(b, unroll(vec2(-0.35, -1.0), tiltCS)));
`;
/** Shared shader head (uniforms, ring radius, canvas → body coordinates, light): lab looks append their tail to it. */
export const HEAD = PRELUDE + MAIN;
// «Glass aurora» (lib/mascot/palette GlassMaterial). The inside is sampled through the curved surface (bent and
// magnified toward the edge); two-step domain-warped sines (~10 s cycles) drive two layers of crisp-edged veils whose
// colour cycles smoothly through five colours. Legibility comes from a smooth field that knows nothing about the face:
// veils in the upper-middle interior turn deep indigo-violet, the bright ones live lower and toward the rim. A still
// pose is the flow at time 0. LiquidCompanion.metal is the same shader with the same constants.
function glassFragment(m: GlassMaterial) {
  const film = (w: string) => `(${v3(m.film[0])} * ${w}.x + ${v3(m.film[1])} * ${w}.y + ${v3(m.film[2])} * ${w}.z) / (${w}.x + ${w}.y + ${w}.z)`;
  const [c0, c1, c2, c3, c4] = m.flowColors;
  const d = 1 + m.dispersion;
  return `${PRELUDE}
vec3 auroraColor(float phase) {
  vec4 wa = 0.5 + 0.5 * cos(6.2831853 * (phase - vec4(0.0, 0.2, 0.4, 0.6)));
  float wp = 0.5 + 0.5 * cos(6.2831853 * (phase - 0.8));
  wa = wa * wa * wa;
  wp = wp * wp * wp * 0.5;
  return (${v3(c0)} * wa.x + ${v3(c1)} * wa.y + ${v3(c2)} * wa.z + ${v3(c3)} * wa.w + ${v3(c4)} * wp) / (wa.x + wa.y + wa.z + wa.w + wp);
}
${MAIN}
  float t = u_time;
  float mood = clamp(u_moodAmount, 0.0, 0.35);
  vec3 luma = vec3(0.2126, 0.7152, 0.0722);
  vec2 inner = b * (0.5 + 0.5 * z) + normal.xy * ${f(m.refract)} + u_gaze * 0.06;
  vec3 body = mix(${v3(m.coreTop)}, ${v3(m.coreBottom)}, smoothstep(-1.0, 1.0, inner.x * 0.45 + inner.y * 0.85));
  body = mix(body, u_moodTint * (dot(body, luma) / max(0.04, dot(u_moodTint, luma))), mood * ${f(m.moodCore)});
  vec2 w = inner * 1.7;
  w += 0.6 * vec2(sin(w.y * 1.6 + t * 0.61), sin(w.x * 1.8 - t * 0.53));
  w += 0.35 * vec2(sin(w.y * 2.7 - t * 0.47 + 1.7), sin(w.x * 2.2 + t * 0.67 + 0.4));
  float fieldA = sin(w.x * 1.2 + w.y * 0.8 + t * 0.29);
  float fieldB = sin(w.y * 1.5 - w.x * 0.7 - t * 0.37 + 2.0);
  float lift = smoothstep(${f(m.calmStart)}, ${f(m.calmEnd)}, length((b - vec2(0.0, -0.05)) / vec2(1.0, 0.9)));
  float moodFlow = clamp(mood * ${f(m.moodFlow)}, 0.0, 1.0);
  vec3 colorA = mix(auroraColor(fieldA * 0.3 + fieldB * 0.2 + t * 0.016 + u_gaze.x * 0.08), u_moodTint, moodFlow);
  vec3 colorB = mix(auroraColor(fieldB * 0.3 - fieldA * 0.15 + t * 0.016 + 0.45), u_moodTint, moodFlow);
  colorA = mix(mix(colorA, ${v3(m.deep)}, ${f(m.deepMix)}) * ${f(m.deepLevel)}, colorA, lift);
  colorB = mix(mix(colorB, ${v3(m.deep)}, ${f(m.deepMix)}) * ${f(m.deepLevel)}, colorB, lift);
  body = mix(body, colorB, smoothstep(${f(m.veilLow)}, ${f(m.veilHigh)}, fieldB * 0.7 - fieldA * 0.3 - 0.1) * ${f(m.flow * m.veilBack)});
  body = mix(body, colorA * (0.9 + 0.15 * fieldB), smoothstep(${f(m.veilLow)}, ${f(m.veilHigh)}, fieldA * 0.65 + fieldB * 0.35) * ${f(m.flow)});
  float glow = exp(-b.x * b.x * 2.0) * smoothstep(0.45, 0.92, b.y) * (1.0 - smoothstep(0.94, 0.995, dist));
  vec3 glowColor = mix(mix(${v3(m.glowOuter)}, ${v3(m.glowInner)}, smoothstep(0.35, 0.95, glow)), u_moodTint, clamp(mood * ${f(m.moodRim * 0.5)}, 0.0, 1.0));
  body = mix(body, glowColor, glow * ${f(m.glowAmount)});
  float lines = pow(abs(sin(inner.x * 6.5 + inner.y * 2.5 + flow * 1.4 + t * 0.4)), 14.0) * smoothstep(-0.3, 0.7, pool) * smoothstep(0.35, 0.8, b.y);
  body += ${v3(m.lineColor)} * lines * ${f(m.lines)};
  body *= ${f(m.shade)} + z * ${f(1 - m.shade)};
  vec3 rimMask = pow(vec3(smoothstep(${f(m.rimStart)}, 0.99, dist * ${f(d)}), smoothstep(${f(m.rimStart)}, 0.99, dist), smoothstep(${f(m.rimStart)}, 0.99, dist / ${f(d)})), vec3(${f(m.rimPower)}));
  vec3 rim = mix(${v3(m.rim)}, u_moodTint, clamp(mood * ${f(m.moodRim)}, 0.0, 1.0));
  body = mix(body, rim, rimMask * ${f(m.rimAmount)});
  body *= 1.0 + ${f(DARK.tint)} * u_dark;
  vec3 filmW = 0.5 + 0.5 * cos(6.2831853 * (fresnel * 1.4 + b.y * 0.3 - b.x * 0.2 + t * 0.05 + u_gaze.x * 0.2 - vec3(0.0, 0.333333, 0.666667)));
  vec3 result = mix(body, ${film('filmW')}, clamp(fresnel * (1.0 - z) * ${f(m.filmAmount)} * (1.0 + ${f(m.filmDark)} * u_dark), 0.0, 1.0));
  result += ${v3(m.innerLine)} * exp(-abs(dist - ${f(m.innerLineAt)}) * 150.0) * (0.55 + 0.45 * upper);
  float facing = max(0.0, dot(normal, light));
  result += ${v3(m.specular)} * pow(facing, ${f(m.specularPower)}) * ${f(m.specularAmount)} * (1.0 + ${f(DARK.specular)} * u_dark);
  result += vec3(1.0) * smoothstep(0.78, 0.82, dist) * (1.0 - smoothstep(0.86, 0.9, dist)) * smoothstep(0.45, 0.75, dot(b, unroll(vec2(-0.65, -0.75), tiltCS))) * ${f(m.streak)};
  result += ${v3(m.secondary)} * pow(max(0.0, dot(normal, vec3(unroll(vec2(0.6, 0.55), tiltCS), 0.58))), 10.0);
  result += ${v3(m.edgeLight)} * upper * edge;
  result += ${v3(m.rimLight)} * edge * smoothstep(-0.25, 0.7, dot(b, unroll(vec2(1.0, 1.0), tiltCS)));
  result = mix(result, ${v3(m.outline)}, smoothstep(0.968, 1.0, dist) * ${f(m.outlineAmount)} * (1.0 - u_dark));
  result += body * clamp(u_energy, 0.0, 1.0) * 0.06; // live microphone glow (same term as LiquidCompanion.metal)
  float opacity = alpha * (1.0 - ${f(m.translucency)} * smoothstep(${f(m.clearStart)}, 0.95, dist) * (1.0 - smoothstep(0.955, 0.985, dist)));
  gl_FragColor = vec4(clamp(result, 0.0, 1.0) * opacity, opacity);
}`;
}
const fragments = new WeakMap<MascotPaletteSpec, string>();
/** Fragment shader source for a palette (built once per palette; exported for tests). */
export function fragmentFor(palette: MascotPaletteSpec) {
  let source = fragments.get(palette);
  if (!source) {
    source = palette.shaderTail !== undefined ? HEAD + palette.shaderTail : glassFragment(palette.glass);
    fragments.set(palette, source);
  }
  return source;
}

export interface MascotRenderInput {
  displacement: Float32Array;
  time: number;
  energy: number;
  gazeX: number;
  gazeY: number;
  dark: number;
  tint: Float32Array;
  tintAmount: number;
  /** Body roll in radians (the body element's CSS rotation, clockwise positive); 0 when omitted (upright). */
  tilt?: number;
}
export type MascotRendererStatus = 'pending' | 'ready' | 'failed';
export interface MascotRendererOptions {
  /**
   * Compile without blocking the main thread (KHR_parallel_shader_compile when the browser has it): the program is only
   * used once COMPLETION_STATUS_KHR reports it done, and draw() returns false until then — poll status(). Default false:
   * compile and link synchronously, so the first draw() right after creation works (dev icon capture, shared stills).
   */
  parallel?: boolean;
}
export interface MascotRenderer {
  /** CSS size of the square canvas; the backing store is capped at maxDpr (≤ 1.5× below 64 px). */
  resize(cssSize: number): void;
  /** Draws one frame; false while the program is still compiling (parallel mode) or the context is lost. */
  draw(input: MascotRenderInput): boolean;
  /** 'pending' while a parallel compile runs, then 'ready', or 'failed' (no usable program: show the CSS fallback). */
  status(): MascotRendererStatus;
  /** Frees the GL objects and loses the context (WEBGL_lose_context) one task later — unless a renderer is created on
   * the same canvas first (a re-bind in the same commit), which reclaims the context. */
  dispose(): void;
  readonly canvas: HTMLCanvasElement;
}

/** Small canvases (< 64 CSS px) render at ≤ 1.5× density: the difference is invisible, the fill cost is not. */
const SMALL_SIDE = 64, SMALL_DPR = 1.5;
/** A parallel compile that has not reported completion by then is resolved synchronously (driver safety net). */
const PARALLEL_DEADLINE_MS = 2000;
/** Backing-store scale for a square canvas of `cssSize` CSS px: the device ratio, at least 1, capped at maxDpr (1.5 below 64 px). */
export function canvasScale(cssSize: number, maxDpr: number, devicePixelRatio: number): number {
  const limit = cssSize < SMALL_SIDE ? Math.min(maxDpr, SMALL_DPR) : maxDpr;
  return Math.min(limit, Math.max(1, Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1));
}
const pendingLoss = new WeakMap<HTMLCanvasElement, ReturnType<typeof setTimeout>>();

export function createMascotRenderer(canvas: HTMLCanvasElement, maxDpr = 2, palette: MascotPaletteSpec = MASCOT_PALETTE, options: MascotRendererOptions = {}): MascotRenderer | null {
  const loss = pendingLoss.get(canvas);
  if (loss !== undefined) { clearTimeout(loss); pendingLoss.delete(canvas); }
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, powerPreference: 'low-power' });
  } catch { gl = null; }
  if (!gl || gl.isContextLost()) return null;
  const context = gl;
  const parallel = options.parallel ? context.getExtension('KHR_parallel_shader_compile') : null;
  const shaders: WebGLShader[] = [];
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  const cleanup = () => {
    if (context.isContextLost()) return;
    if (buffer) context.deleteBuffer(buffer);
    if (program) context.deleteProgram(program);
    shaders.forEach(shader => context.deleteShader(shader));
    buffer = null; program = null; shaders.length = 0;
  };
  try {
    // Statuses are not queried here: with KHR_parallel_shader_compile any status query before completion would block.
    const compile = (type: number, source: string) => {
      const shader = context.createShader(type);
      if (!shader) throw new Error('No shader');
      shaders.push(shader);
      context.shaderSource(shader, source);
      context.compileShader(shader);
      return shader;
    };
    program = context.createProgram();
    if (!program) throw new Error('No program');
    context.attachShader(program, compile(context.VERTEX_SHADER, VERTEX));
    context.attachShader(program, compile(context.FRAGMENT_SHADER, fragmentFor(palette)));
    context.linkProgram(program);
  } catch {
    cleanup();
    return null;
  }

  type Uniforms = Record<'size' | 'time' | 'energy' | 'gaze' | 'disp' | 'dark' | 'tint' | 'amount' | 'tilt', WebGLUniformLocation | null>;
  let state: MascotRendererStatus = 'pending';
  let uniforms: Uniforms | null = null;
  let width = 0, disposed = false;
  const startedAt = performance.now();
  /** Finishes the setup once the program has linked; reports the state. */
  const status = (): MascotRendererStatus => {
    if (state !== 'pending' || disposed || context.isContextLost()) return state;
    const linked = program!;
    // A driver that never reports completion must not leave the mascot hidden: after 2 s resolve it the blocking way.
    if (parallel && !context.getProgramParameter(linked, parallel.COMPLETION_STATUS_KHR) && performance.now() - startedAt < PARALLEL_DEADLINE_MS) return state;
    try {
      if (!context.getProgramParameter(linked, context.LINK_STATUS)) {
        const log = shaders.map(shader => context.getShaderInfoLog(shader)).filter(Boolean).join('\n');
        throw new Error(log || context.getProgramInfoLog(linked) || 'Mascot shader unavailable');
      }
      context.useProgram(linked);
      buffer = context.createBuffer();
      context.bindBuffer(context.ARRAY_BUFFER, buffer);
      context.bufferData(context.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), context.STATIC_DRAW);
      const position = context.getAttribLocation(linked, 'a_position');
      context.enableVertexAttribArray(position);
      context.vertexAttribPointer(position, 2, context.FLOAT, false, 0, 0);
      const uniform = (name: string) => context.getUniformLocation(linked, name);
      uniforms = {
        size: uniform('u_size'), time: uniform('u_time'), energy: uniform('u_energy'), gaze: uniform('u_gaze'), disp: uniform('u_disp'),
        dark: uniform('u_dark'), tint: uniform('u_moodTint'), amount: uniform('u_moodAmount'), tilt: uniform('u_tilt'),
      };
      context.clearColor(0, 0, 0, 0);
      if (width) { context.viewport(0, 0, width, width); context.uniform2f(uniforms.size, width, width); }
      state = 'ready';
    } catch {
      cleanup();
      state = 'failed';
    }
    return state;
  };
  if (!parallel && status() !== 'ready') return null;
  return {
    canvas,
    resize(cssSize) {
      const next = Math.max(1, Math.round(cssSize * canvasScale(cssSize, maxDpr, window.devicePixelRatio)));
      if (next === width && canvas.width === next) return;
      width = next;
      canvas.width = next; canvas.height = next;
      if (state === 'ready' && uniforms && !context.isContextLost()) {
        context.viewport(0, 0, next, next);
        context.uniform2f(uniforms.size, next, next);
      }
    },
    draw(input) {
      if (disposed || context.isContextLost() || status() !== 'ready' || !uniforms) return false;
      context.uniform1f(uniforms.time, input.time);
      context.uniform1f(uniforms.energy, input.energy);
      context.uniform2f(uniforms.gaze, input.gazeX, input.gazeY);
      context.uniform1fv(uniforms.disp, input.displacement);
      context.uniform1f(uniforms.dark, input.dark);
      context.uniform3f(uniforms.tint, input.tint[0], input.tint[1], input.tint[2]);
      context.uniform1f(uniforms.amount, input.tintAmount);
      context.uniform1f(uniforms.tilt, Number.isFinite(input.tilt) ? input.tilt! : 0);
      context.clear(context.COLOR_BUFFER_BIT);
      context.drawArrays(context.TRIANGLES, 0, 6);
      return true;
    },
    status,
    dispose() {
      if (disposed) return;
      disposed = true;
      cleanup();
      const lose = context.isContextLost() ? null : context.getExtension('WEBGL_lose_context');
      if (!lose) return;
      pendingLoss.set(canvas, setTimeout(() => {
        pendingLoss.delete(canvas);
        if (!context.isContextLost()) lose.loseContext();
      }, 0));
    },
  };
}

/**
 * Still poses (thumbnails, Reduced Motion galleries) share ONE hidden WebGL context per palette and are copied
 * into each mascot's 2D canvas, so many static mascots never exhaust the browser's context limit.
 */
const stills = new Map<MascotPaletteSpec, { canvas: HTMLCanvasElement; renderer: MascotRenderer | null }>();
export function renderStill(target: HTMLCanvasElement, cssSize: number, input: MascotRenderInput, maxDpr = 2, palette: MascotPaletteSpec = MASCOT_PALETTE): boolean {
  let still = stills.get(palette);
  if (!still || (still.renderer && (still.canvas.getContext('webgl')?.isContextLost() ?? true))) {
    const canvas = document.createElement('canvas');
    still = { canvas, renderer: createMascotRenderer(canvas, maxDpr, palette) };
    stills.set(palette, still);
  }
  const { canvas: stillCanvas, renderer: stillRenderer } = still;
  if (!stillRenderer) return false;
  const context = target.getContext('2d');
  if (!context) return false;
  stillRenderer.resize(cssSize);
  stillRenderer.draw(input);
  if (target.width !== stillCanvas.width || target.height !== stillCanvas.height) { target.width = stillCanvas.width; target.height = stillCanvas.height; }
  context.clearRect(0, 0, target.width, target.height);
  context.drawImage(stillCanvas, 0, 0);
  return true;
}
