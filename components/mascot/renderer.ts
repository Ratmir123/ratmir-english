// Glass jelly body: the 0.4 liquid lens shader extended with the 32-node deformable outline
// (MASCOT-SPEC §1–2). One quad, no textures. GLSL ES 1.0: constant loop bound, uniform array
// indexed by the loop counter only.
import { BODY_RADIUS, DARK, KERNEL_K, NODE_COUNT, SUPERELLIPSE_N } from '@/lib/mascot/constants';
import { MASCOT_PALETTE, type GlassRGB, type MascotMaterial, type MascotPaletteSpec } from '@/lib/mascot/palette';

const VERTEX = `attribute vec2 a_position; varying vec2 v_uv;
void main() { v_uv = a_position * 0.5 + 0.5; gl_Position = vec4(a_position, 0.0, 1.0); }`;

const f = (value: number) => value.toFixed(6);
const v3 = (c: GlassRGB) => `vec3(${f(c[0])}, ${f(c[1])}, ${f(c[2])})`;
const HEAD = `#ifdef GL_FRAGMENT_PRECISION_HIGH
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
void main() {
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
  vec3 light = normalize(vec3(-0.52 + u_gaze.x * 0.15, -0.69 + u_gaze.y * 0.12, 0.7));
  float fresnel = pow(1.0 - z, 2.0);
  float edge = exp(-abs(dist - 0.969) * 108.0) * (1.0 + ${f(DARK.rim)} * u_dark);
  float upper = smoothstep(0.30, 0.95, -b.y - b.x * 0.35);
`;
// «Black opal» (lib/mascot/palette): thick dark glass with a deep core under the face, opal flecks and veins in the
// outer body, light through coloured glass along the inner bottom, a crisp Fresnel rim, thin-film iridescence on the
// edge and a crisp key specular. The mood tint shifts the core's hue at constant luminance (the face contrast never
// drops) and shows at full strength in the rim. LiquidCompanion.metal is the same shader with the same constants.
function materialFragment(m: MascotMaterial) {
  const film = (w: string) => `(${v3(m.film[0])} * ${w}.x + ${v3(m.film[1])} * ${w}.y + ${v3(m.film[2])} * ${w}.z) / (${w}.x + ${w}.y + ${w}.z)`;
  return `${HEAD}
  vec3 body = mix(${v3(m.coreTop)}, ${v3(m.coreBottom)}, smoothstep(-1.0, 1.0, b.x * 0.45 + b.y * 0.85 + flow * ${f(m.coreFlow)}));
  float mood = clamp(u_moodAmount, 0.0, 0.35);
  vec3 luma = vec3(0.2126, 0.7152, 0.0722);
  body = mix(body, u_moodTint * (dot(body, luma) / max(0.04, dot(u_moodTint, luma))), mood * ${f(m.moodCore)});
  body *= ${f(m.shade)} + z * ${f(1 - m.shade)};
  float facing = max(0.0, dot(normal, light));
  float vein = (1.0 - smoothstep(0.0, 0.3, abs(sin(refracted.x * 4.6 - refracted.y * 2.7 + pool * 1.3 + u_time * 0.11)))) * smoothstep(0.1, 0.8, pool);
  float speck = smoothstep(0.7, 0.97, sin(refracted.x * 9.0 + u_time * 0.07) * sin(refracted.y * 8.0 - u_time * 0.05 + flow));
  float fleckMask = smoothstep(0.62, 0.76, dist) * (1.0 - smoothstep(0.9, 0.97, dist));
  vec3 opalW = 0.5 + 0.5 * cos(6.2831853 * (refracted.x * 0.35 - refracted.y * 0.25 + flow * 0.2 + u_time * 0.02 + u_gaze.x * 0.15 - vec3(0.0, 0.333333, 0.666667)));
  body = mix(body, ${film('opalW')}, clamp((vein * 0.45 + speck) * fleckMask * (0.35 + 0.65 * facing) * ${f(m.fleck)}, 0.0, 1.0));
  float glow = exp(-b.x * b.x * 2.0) * smoothstep(0.45, 0.92, b.y) * (1.0 - smoothstep(0.94, 0.995, dist));
  vec3 glowColor = mix(mix(${v3(m.glowOuter)}, ${v3(m.glowInner)}, smoothstep(0.35, 0.95, glow)), u_moodTint, clamp(mood * ${f(m.moodRim * 0.5)}, 0.0, 1.0));
  body = mix(body, glowColor, glow * ${f(m.glowAmount)});
  vec3 rim = mix(${v3(m.rim)}, u_moodTint, clamp(mood * ${f(m.moodRim)}, 0.0, 1.0));
  body = mix(body, rim, pow(smoothstep(${f(m.rimStart)}, 0.99, dist), ${f(m.rimPower)}) * ${f(m.rimAmount)});
  body *= 1.0 + ${f(DARK.tint)} * u_dark;
  vec3 filmW = 0.5 + 0.5 * cos(6.2831853 * (fresnel * 1.4 + b.y * 0.3 - b.x * 0.2 + u_time * 0.05 + u_gaze.x * 0.2 - vec3(0.0, 0.333333, 0.666667)));
  vec3 result = mix(body, ${film('filmW')}, clamp(fresnel * ${f(m.filmAmount)} * (1.0 + ${f(m.filmDark)} * u_dark), 0.0, 1.0));
  result += ${v3(m.specular)} * (pow(facing, ${f(m.specularPower)}) * ${f(m.specularAmount)} * (1.0 + ${f(DARK.specular)} * u_dark) + pow(facing, 6.0) * ${f(m.bloom)});
  result += ${v3(m.edgeLight)} * upper * edge;
  result += ${v3(m.rimLight)} * edge * smoothstep(-0.25, 0.7, b.x + b.y);
  result = mix(result, ${v3(m.outline)}, smoothstep(0.968, 1.0, dist) * ${f(m.outlineAmount)} * (1.0 - u_dark));
  result += body * clamp(u_energy, 0.0, 1.0) * 0.06; // live microphone glow (same term as LiquidCompanion.metal)
  gl_FragColor = vec4(clamp(result, 0.0, 1.0) * alpha, alpha);
}`;
}
const fragments = new WeakMap<MascotPaletteSpec, string>();
/** Fragment shader source for a palette (built once per palette; exported for tests). */
export function fragmentFor(palette: MascotPaletteSpec) {
  let source = fragments.get(palette);
  if (!source) {
    source = palette.shaderTail !== undefined ? HEAD + palette.shaderTail : materialFragment(palette.material);
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
}
export interface MascotRenderer {
  /** CSS size of the square canvas; the backing store is capped at maxDpr. */
  resize(cssSize: number): void;
  draw(input: MascotRenderInput): void;
  dispose(): void;
  readonly canvas: HTMLCanvasElement;
}

export function createMascotRenderer(canvas: HTMLCanvasElement, maxDpr = 2, palette: MascotPaletteSpec = MASCOT_PALETTE): MascotRenderer | null {
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, powerPreference: 'low-power' });
  } catch { gl = null; }
  if (!gl || gl.isContextLost()) return null;
  const context = gl;
  const shaders: WebGLShader[] = [];
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  const cleanup = () => {
    if (context.isContextLost()) return;
    if (buffer) context.deleteBuffer(buffer);
    if (program) context.deleteProgram(program);
    shaders.forEach(shader => context.deleteShader(shader));
  };
  try {
    const compile = (type: number, source: string) => {
      const shader = context.createShader(type);
      if (!shader) throw new Error('No shader');
      shaders.push(shader);
      context.shaderSource(shader, source);
      context.compileShader(shader);
      if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) throw new Error(context.getShaderInfoLog(shader) || 'Shader unavailable');
      return shader;
    };
    program = context.createProgram();
    if (!program) throw new Error('No program');
    context.attachShader(program, compile(context.VERTEX_SHADER, VERTEX));
    context.attachShader(program, compile(context.FRAGMENT_SHADER, fragmentFor(palette)));
    context.linkProgram(program);
    if (!context.getProgramParameter(program, context.LINK_STATUS)) throw new Error('Mascot shader unavailable');
    context.useProgram(program);
    buffer = context.createBuffer();
    context.bindBuffer(context.ARRAY_BUFFER, buffer);
    context.bufferData(context.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), context.STATIC_DRAW);
    const position = context.getAttribLocation(program, 'a_position');
    context.enableVertexAttribArray(position);
    context.vertexAttribPointer(position, 2, context.FLOAT, false, 0, 0);
    const uniform = (name: string) => context.getUniformLocation(program!, name);
    const sizeUniform = uniform('u_size'), timeUniform = uniform('u_time'), energyUniform = uniform('u_energy');
    const gazeUniform = uniform('u_gaze'), dispUniform = uniform('u_disp'), darkUniform = uniform('u_dark');
    const tintUniform = uniform('u_moodTint'), amountUniform = uniform('u_moodAmount');
    context.clearColor(0, 0, 0, 0);
    let width = 0;
    return {
      canvas,
      resize(cssSize) {
        const scale = Math.min(maxDpr, Math.max(1, window.devicePixelRatio || 1));
        const next = Math.max(1, Math.round(cssSize * scale));
        if (next === width && canvas.width === next) return;
        width = next;
        canvas.width = next; canvas.height = next;
        context.viewport(0, 0, next, next);
        context.uniform2f(sizeUniform, next, next);
      },
      draw(input) {
        if (context.isContextLost()) return;
        context.uniform1f(timeUniform, input.time);
        context.uniform1f(energyUniform, input.energy);
        context.uniform2f(gazeUniform, input.gazeX, input.gazeY);
        context.uniform1fv(dispUniform, input.displacement);
        context.uniform1f(darkUniform, input.dark);
        context.uniform3f(tintUniform, input.tint[0], input.tint[1], input.tint[2]);
        context.uniform1f(amountUniform, input.tintAmount);
        context.clear(context.COLOR_BUFFER_BIT);
        context.drawArrays(context.TRIANGLES, 0, 6);
      },
      dispose: cleanup,
    };
  } catch {
    cleanup();
    return null;
  }
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
