// Mascot lab only (/mascot-lab?palette=…): comparison looks next to the shipped «Black opal». Never imported by the app.
import { DARK } from './constants';
import { CYAN, LAVENDER, LIME, MASCOT_PALETTE, type GlassMaterial, type GlassRGB, type MascotPaletteSpec } from './palette';

const f = (value: number) => value.toFixed(6);
const VIOLET: GlassRGB = [0.435, 0.361, 0.949];

/** Shared by both glass looks; each overrides what makes it itself. */
const GLASS_BASE: GlassMaterial = {
  coreTop: [0.07, 0.055, 0.17], coreBottom: [0.16, 0.11, 0.36], shade: 0.86,
  refract: 0.28,
  flowColors: [[0.45, 0.33, 0.98], [0.76, 0.7, 1.0], [0.8, 0.93, 0.36], [0.3, 0.82, 0.95]], flow: 0.62, faceFloor: 0.12,
  ribbonLow: -0.2, ribbonHigh: 0.9, veinWidth: 0.3, veinMix: 0,
  glowOuter: [0.5, 0.4, 0.92], glowInner: LIME, glowAmount: 0.6,
  lineColor: [0.82, 0.9, 0.62], lines: 0.35,
  rim: [0.76, 0.71, 1.0], rimStart: 0.78, rimPower: 1.4, rimAmount: 0.9, dispersion: 0.012,
  film: [LIME, LAVENDER, CYAN], filmAmount: 0.9, filmDark: 0.1,
  innerLine: [0.5, 0.48, 0.62], innerLineAt: 0.935,
  specular: [1, 1, 1], specularAmount: 1, specularPower: 60, streak: 0.55, secondary: [0.1, 0.09, 0.15],
  edgeLight: [0.8, 0.78, 1.0], rimLight: [0.5, 0.7, 0.3],
  outline: [0.19, 0.12, 0.42], outlineAmount: 0.65,
  translucency: 0.32, clearStart: 0.68,
  moodCore: 1.4, moodFlow: 1.6, moodRim: 3,
};
const OPAL_FACE = MASCOT_PALETTE.face;
const OPAL_FALLBACK = MASCOT_PALETTE.fallback;

/** The 0.5 cyan glass, verbatim (appended to the shared shader head). */
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

export const LAB_PALETTES = {
  a: MASCOT_PALETTE,
  aurora: {
    label: 'Стекло · аврора',
    glass: GLASS_BASE,
    face: OPAL_FACE, fallback: OPAL_FALLBACK, floor: MASCOT_PALETTE.floor,
  },
  ink: {
    label: 'Стекло · чернила',
    glass: {
      ...GLASS_BASE,
      coreTop: [0.05, 0.04, 0.12], coreBottom: [0.12, 0.08, 0.28], shade: 0.84, refract: 0.22,
      flowColors: [[0.52, 0.38, 1.0], [0.85, 0.95, 0.39], [0.8, 0.74, 1.0], [0.3, 0.82, 0.95]], flow: 0.85, faceFloor: 0.08,
      veinWidth: 0.28, veinMix: 1, glowAmount: 0.75, lines: 0.25, translucency: 0.14, clearStart: 0.74,
    },
    face: OPAL_FACE, fallback: OPAL_FALLBACK, floor: MASCOT_PALETTE.floor,
  },
  b: {
    label: 'B · сиреневый жемчуг',
    material: {
      coreTop: [0.9, 0.86, 1.0], coreBottom: [0.97, 0.89, 0.98], coreFlow: 0.5,
      shade: 0.9, fleck: 0.35,
      glowOuter: [0.8, 0.74, 1.0], glowInner: LIME, glowAmount: 0.45,
      rim: [0.6, 0.52, 0.97], rimStart: 0.7, rimPower: 1.5, rimAmount: 0.75,
      film: [LIME, VIOLET, [1, 0.72, 0.87]], filmAmount: 0.95, filmDark: 0.1,
      specular: [1, 1, 1], specularAmount: 0.75, specularPower: 36, bloom: 0.04,
      edgeLight: [0.5, 0.5, 0.55], rimLight: [0.3, 0.26, 0.5],
      outline: [0.36, 0.29, 0.72], outlineAmount: 0.6,
      moodCore: 1.2, moodRim: 1.8,
    },
    face: { eye: '#221A50', glow: '#FFFFFF', glowOpacity: 0.35, mouthInterior: '#140D36', mouthInteriorOpacity: 0.95, lipStroke: 0.6 },
    fallback: {
      background: 'radial-gradient(ellipse at 28% 20%, rgba(255, 255, 255, 0.95), transparent 30%), radial-gradient(ellipse 50% 24% at 50% 86%, rgba(218, 241, 99, 0.45), transparent 70%), radial-gradient(closest-side, #f4ebfc 50%, #d3c8fb 78%, #8f7ff0 100%)',
      boxShadow: 'inset 0 0 0 1.5px rgba(111, 92, 242, 0.45)',
    },
    floor: { caustic: [[187, 178, 245], [218, 241, 99]], pool: [[187, 178, 245], [218, 241, 99]], poolAlpha: { light: 0, dark: 0.26 } },
  },
  c: {
    label: 'C · графит и лайм',
    material: {
      coreTop: [0.06, 0.058, 0.075], coreBottom: [0.14, 0.1, 0.28], coreFlow: 0.15,
      shade: 0.8, fleck: 0.4,
      glowOuter: [0.35, 0.3, 0.6], glowInner: LIME, glowAmount: 0.85,
      rim: [0.26, 0.24, 0.36], rimStart: 0.75, rimPower: 1.3, rimAmount: 0.85,
      film: [LIME, [0.96, 0.99, 0.62], LAVENDER], filmAmount: 0.95, filmDark: 0.1,
      specular: [1, 1, 1], specularAmount: 0.95, specularPower: 52, bloom: 0.05,
      edgeLight: [0.75, 0.88, 0.45], rimLight: [0.55, 0.72, 0.22],
      outline: [0.06, 0.06, 0.08], outlineAmount: 0.4,
      moodCore: 1.4, moodRim: 2.2,
    },
    face: { eye: '#FDFEFF', glow: '#FFFFFF', glowOpacity: 0.5, mouthInterior: '#0A090E', mouthInteriorOpacity: 0.95, lipStroke: 0 },
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
