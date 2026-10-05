// Mascot lab only (/mascot-lab?palette=…): comparison looks next to the shipped «Glass aurora». Never imported by the
// app, so the opal shader generator and these presets stay out of production paths.
import { DARK } from './constants';
import { CYAN, LAVENDER, LIME, MASCOT_PALETTE, type GlassMaterial, type GlassRGB, type MascotPaletteSpec } from './palette';

const f = (value: number) => value.toFixed(6);
const v3 = (c: GlassRGB) => `vec3(${f(c[0])}, ${f(c[1])}, ${f(c[2])})`;
const VIOLET: GlassRGB = [0.435, 0.361, 0.949];

/** 0.5.1 opal family (shipped briefly as «Black opal»): thick dark glass, opal flecks, lime → lavender bottom light. */
interface OpalMaterial {
  coreTop: GlassRGB; coreBottom: GlassRGB; coreFlow: number; shade: number; fleck: number;
  glowOuter: GlassRGB; glowInner: GlassRGB; glowAmount: number;
  rim: GlassRGB; rimStart: number; rimPower: number; rimAmount: number;
  film: readonly [GlassRGB, GlassRGB, GlassRGB]; filmAmount: number; filmDark: number;
  specular: GlassRGB; specularAmount: number; specularPower: number; bloom: number;
  edgeLight: GlassRGB; rimLight: GlassRGB; outline: GlassRGB; outlineAmount: number;
  moodCore: number; moodRim: number;
}
/** Shader tail (appended to the renderer's shared head) for an opal-family material. */
function opalTail(m: OpalMaterial) {
  const film = (w: string) => `(${v3(m.film[0])} * ${w}.x + ${v3(m.film[1])} * ${w}.y + ${v3(m.film[2])} * ${w}.z) / (${w}.x + ${w}.y + ${w}.z)`;
  return `
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
  result += body * clamp(u_energy, 0.0, 1.0) * 0.06;
  gl_FragColor = vec4(clamp(result, 0.0, 1.0) * alpha, alpha);
}`;
}

/** The 0.5 cyan glass, verbatim. */
const CLASSIC_TAIL = `
  vec3 tint = mix(vec3(0.24, 0.86, 0.96), vec3(0.42, 0.34, 0.94), smoothstep(-0.85, 0.9, flow + b.x * 0.35));
  tint = mix(tint, vec3(0.83, 0.91, 0.99), smoothstep(0.32, 1.22, pool + b.y * 0.38) * 0.48);
  tint = mix(tint, u_moodTint, u_moodAmount);
  tint *= 1.0 + ${f(DARK.tint)} * u_dark;
  float specular = pow(max(0.0, dot(normal, light)), 25.0) * (1.0 + ${f(DARK.specular)} * u_dark);
  vec3 reflection = mix(vec3(0.72, 0.92, 1.0), vec3(0.91, 0.86, 1.0), 0.5 + 0.5 * sin(u_time * 0.32 + b.y * 2.0));
  vec3 result = mix(tint * (0.70 + z * 0.28), reflection, fresnel * 0.47);
  result += vec3(specular * 0.64 + upper * edge * 0.44);
  result += vec3(0.18, 0.24, 0.32) * edge * smoothstep(-0.25, 0.7, b.x + b.y) * 0.55;
  result += tint * clamp(u_energy, 0.0, 1.0) * 0.06;
  gl_FragColor = vec4(clamp(result, 0.0, 1.0) * alpha, alpha);
}`;

const OPAL: OpalMaterial = {
  coreTop: [0.06, 0.05, 0.14], coreBottom: [0.15, 0.1, 0.34], coreFlow: 0.12, shade: 0.84, fleck: 0.6,
  glowOuter: [0.5, 0.4, 0.92], glowInner: LIME, glowAmount: 0.82,
  rim: [0.74, 0.69, 1.0], rimStart: 0.76, rimPower: 1.3, rimAmount: 0.92,
  film: [LIME, LAVENDER, CYAN], filmAmount: 0.9, filmDark: 0.1,
  specular: [1, 1, 1], specularAmount: 1, specularPower: 52, bloom: 0.05,
  edgeLight: [0.75, 0.72, 0.95], rimLight: [0.5, 0.7, 0.3], outline: [0.19, 0.12, 0.42], outlineAmount: 0.75,
  moodCore: 1.4, moodRim: 3,
};
const SHIPPED_GLASS = MASCOT_PALETTE.glass as GlassMaterial;
const WHITE_FACE = MASCOT_PALETTE.face;

export const LAB_PALETTES = {
  aurora: MASCOT_PALETTE,
  opal: {
    label: 'Чёрный опал',
    shaderTail: opalTail(OPAL),
    face: WHITE_FACE,
    fallback: {
      background: 'radial-gradient(ellipse at 27% 18%, rgba(255, 255, 255, 0.85), transparent 16%), radial-gradient(ellipse 46% 20% at 50% 85%, rgba(218, 241, 99, 0.7), rgba(128, 102, 235, 0.45) 55%, transparent 100%), radial-gradient(closest-side, #120d30 0%, #1d1446 62%, #2f2373 84%, #bdb0ff 97%, #ece8ff 100%)',
      boxShadow: 'inset 0 0 0 1px rgba(48, 31, 107, 0.6)',
    },
    floor: MASCOT_PALETTE.floor,
  },
  ink: {
    label: 'Стекло · чернила',
    glass: {
      ...SHIPPED_GLASS,
      coreTop: [0.05, 0.04, 0.12], coreBottom: [0.12, 0.08, 0.28], shade: 0.84, refract: 0.22,
      flowColors: [[0.52, 0.38, 1.0], [0.85, 0.95, 0.39], [0.8, 0.74, 1.0], [0.3, 0.82, 0.95], [1.0, 0.55, 0.78]],
      flow: 0.85, veilBack: 0.5, veilLow: 0.55, veilHigh: 0.75, glowAmount: 0.75, lines: 0.16, translucency: 0.14, clearStart: 0.74,
    },
    face: WHITE_FACE, fallback: MASCOT_PALETTE.fallback, floor: MASCOT_PALETTE.floor,
  },
  pearl: {
    label: 'Сиреневый жемчуг',
    shaderTail: opalTail({
      coreTop: [0.9, 0.86, 1.0], coreBottom: [0.97, 0.89, 0.98], coreFlow: 0.5, shade: 0.9, fleck: 0.35,
      glowOuter: [0.8, 0.74, 1.0], glowInner: LIME, glowAmount: 0.45,
      rim: [0.6, 0.52, 0.97], rimStart: 0.7, rimPower: 1.5, rimAmount: 0.75,
      film: [LIME, VIOLET, [1, 0.72, 0.87]], filmAmount: 0.95, filmDark: 0.1,
      specular: [1, 1, 1], specularAmount: 0.75, specularPower: 36, bloom: 0.04,
      edgeLight: [0.5, 0.5, 0.55], rimLight: [0.3, 0.26, 0.5], outline: [0.36, 0.29, 0.72], outlineAmount: 0.6,
      moodCore: 1.2, moodRim: 1.8,
    }),
    face: { eye: '#221A50', glow: '#FFFFFF', glowOpacity: 0.35, mouthInterior: '#140D36', mouthInteriorOpacity: 0.95, lipStroke: 0.6 },
    fallback: {
      background: 'radial-gradient(ellipse at 28% 20%, rgba(255, 255, 255, 0.95), transparent 30%), radial-gradient(ellipse 50% 24% at 50% 86%, rgba(218, 241, 99, 0.45), transparent 70%), radial-gradient(closest-side, #f4ebfc 50%, #d3c8fb 78%, #8f7ff0 100%)',
      boxShadow: 'inset 0 0 0 1.5px rgba(111, 92, 242, 0.45)',
    },
    floor: { caustic: [[187, 178, 245], [218, 241, 99]], pool: [[187, 178, 245], [218, 241, 99]], poolAlpha: { light: 0, dark: 0.26 } },
  },
  graphite: {
    label: 'Графит и лайм',
    shaderTail: opalTail({
      coreTop: [0.06, 0.058, 0.075], coreBottom: [0.14, 0.1, 0.28], coreFlow: 0.15, shade: 0.8, fleck: 0.4,
      glowOuter: [0.35, 0.3, 0.6], glowInner: LIME, glowAmount: 0.85,
      rim: [0.26, 0.24, 0.36], rimStart: 0.75, rimPower: 1.3, rimAmount: 0.85,
      film: [LIME, [0.96, 0.99, 0.62], LAVENDER], filmAmount: 0.95, filmDark: 0.1,
      specular: [1, 1, 1], specularAmount: 0.95, specularPower: 52, bloom: 0.05,
      edgeLight: [0.75, 0.88, 0.45], rimLight: [0.55, 0.72, 0.22], outline: [0.06, 0.06, 0.08], outlineAmount: 0.4,
      moodCore: 1.4, moodRim: 2.2,
    }),
    face: { eye: '#FDFEFF', glow: '#FFFFFF', glowOpacity: 0.5, mouthInterior: '#0A090E', mouthInteriorOpacity: 0.95, lipStroke: 0.6 },
    fallback: {
      background: 'radial-gradient(ellipse at 26% 18%, rgba(255, 255, 255, 0.8), transparent 18%), radial-gradient(ellipse 55% 26% at 50% 86%, rgba(218, 241, 99, 0.7), transparent 70%), radial-gradient(closest-side, #15131d 55%, #2a2350 80%, #3d3760 100%)',
      boxShadow: 'inset 0 0 0 1.5px rgba(218, 241, 99, 0.6)',
    },
    floor: { caustic: [[218, 241, 99], [111, 92, 242]], pool: [[218, 241, 99], [111, 92, 242]], poolAlpha: { light: 0, dark: 0.3 } },
  },
  classic: {
    label: '0.5 · голубое стекло',
    shaderTail: CLASSIC_TAIL,
    face: { eye: '#FDFEFF', glow: '#FFFFFF', glowOpacity: 0.6, mouthInterior: '#2A1F5E', mouthInteriorOpacity: 0.85, lipStroke: 0 },
    fallback: {
      background: 'radial-gradient(ellipse at 26% 20%, rgba(244, 252, 255, 0.85), transparent 32%), linear-gradient(135deg, #55dbe8, #7060e7 56%, #82d7e8)',
      boxShadow: 'inset 1px 2px 3px rgba(255, 255, 255, 0.63), inset -4px -7px 13px rgba(66, 58, 150, 0.37), inset 8px 8px 25px rgba(168, 245, 255, 0.44)',
    },
    floor: { caustic: [[63, 213, 234], [123, 108, 246]], pool: [[63, 213, 234], [123, 108, 246]], poolAlpha: { light: 0, dark: 0 } },
  },
} satisfies Record<string, MascotPaletteSpec>;

export type LabPaletteName = keyof typeof LAB_PALETTES;
export const LAB_PALETTE_NAMES = Object.keys(LAB_PALETTES) as LabPaletteName[];
export function isLabPalette(value: unknown): value is LabPaletteName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LAB_PALETTES, value);
}
