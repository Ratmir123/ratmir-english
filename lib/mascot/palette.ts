// Smooth Talk mascot — body material and face colours (0.5.1 «Glass aurora»).
// Translucent thick glass with smoothly shimmering colour veils inside (violet → lavender → lime → cyan, a touch of
// pink) on a deep graphite-violet core. Veils in the upper-middle interior run deep indigo-violet and the bright ones
// live lower and toward the rim, so the white face reads (≥ 4.5:1 in every frame) without any shape that follows it.
// A crisp lavender rim with a slight chromatic fringe, a thin inner edge line, a window reflection streak and lime →
// lavender light along the inner bottom. The shader takes the material as compile-time constants (no per-frame cost);
// the iPhone mirrors every number in ios/Sources/LiquidCompanion.metal and MascotFace.swift.
// Lab-only comparison looks (opal, pearl, graphite, 0.5 cyan, ink) live in ./palette-lab (never imported by the app).
import { SHIPPING_GLASS, type ShadowGlass } from './shadow';

/** Linear 0–1 sRGB triplet (shader constants). */
export type GlassRGB = readonly [number, number, number];

/**
 * Glass with flowing colour inside. The inside is seen through the curved surface (bent and magnified toward the
 * edge, crisp, not frosted); two-step domain-warped sine fields (~10 s cycles) drive two layers of crisp-edged veils
 * whose colour cycles smoothly through `flowColors`. A smooth radial field (centred a little above the body centre,
 * independent of the face) turns the veils deep in the upper-middle interior and lets them brighten toward the rim
 * and the bottom.
 */
export interface GlassMaterial {
  coreTop: GlassRGB; coreBottom: GlassRGB; shade: number;
  /** How strongly the surface normal bends the view of the inside. */
  refract: number;
  /** Veil colours, cycled smoothly (the last one gets half the share: a touch). */
  flowColors: readonly [GlassRGB, GlassRGB, GlassRGB, GlassRGB, GlassRGB];
  /** Veil strength (front layer; the back layer is `veilBack` of it). */
  flow: number; veilBack: number;
  /** Calm interior: veils are mixed toward `deep` by deepMix and scaled by deepLevel, fading back to full colour
   * over smoothstep(calmStart, calmEnd, radial distance from (0, −0.05)). */
  deep: GlassRGB; deepMix: number; deepLevel: number; calmStart: number; calmEnd: number;
  /** Veil edge: smoothstep(veilLow, veilHigh, field) — narrow = crisp. */
  veilLow: number; veilHigh: number;
  /** Light through coloured glass along the inner bottom (outer → hottest colour). */
  glowOuter: GlassRGB; glowInner: GlassRGB; glowAmount: number;
  /** Caustic light lines in the lower body, moving with the deformation. */
  lineColor: GlassRGB; lines: number;
  /** Crisp Fresnel rim; `dispersion` spreads R/G/B rims apart (chromatic fringe). */
  rim: GlassRGB; rimStart: number; rimPower: number; rimAmount: number; dispersion: number;
  /** Thin-film iridescence on the very edge ((1 − z)³). */
  film: readonly [GlassRGB, GlassRGB, GlassRGB]; filmAmount: number; filmDark: number;
  innerLine: GlassRGB; innerLineAt: number;
  specular: GlassRGB; specularAmount: number; specularPower: number; streak: number; secondary: GlassRGB;
  edgeLight: GlassRGB; rimLight: GlassRGB;
  /** Light theme only: a thin deep-violet outer line. */
  outline: GlassRGB; outlineAmount: number;
  /** Outer band alpha 1 − translucency (from clearStart to the rim line, which stays solid). */
  translucency: number; clearStart: number;
  /** Mood tint: core hue at constant luminance, veils, rim. */
  moodCore: number; moodFlow: number; moodRim: number;
}

export interface MascotFaceColors {
  /** Eyes, closed mouth, open-mouth rim, special eye shapes. */
  eye: string;
  /** Emissive halo around eyes and mouth. */
  glow: string; glowOpacity: number;
  mouthInterior: string; mouthInteriorOpacity: number;
  /** Outline on the closed mouth (100-unit face box), so frowns and small mouths never thin to a hairline. 0.6 = the
   * open-mouth rim (FACE.mouthRim) and the iPhone's mouth stroke (0.006·S). */
  lipStroke: number;
}

interface MascotPaletteBase {
  label: string;
  face: MascotFaceColors;
  /** Same silhouette without WebGL. */
  fallback: { background: string; boxShadow: string };
  /** Caustic inside the contact shadow and the light pool in front of the body. */
  floor: ShadowGlass;
}
/** Glass the shader builds from, or (lab only) a verbatim shader tail appended to the shared head. */
export type MascotPaletteSpec = MascotPaletteBase & (
  | { glass: GlassMaterial; shaderTail?: undefined }
  | { shaderTail: string; glass?: undefined });

export const LIME: GlassRGB = [0.855, 0.945, 0.388];
export const LAVENDER: GlassRGB = [0.733, 0.698, 0.961];
export const CYAN: GlassRGB = [0.247, 0.835, 0.918];

/** The look the app ships. */
export const MASCOT_PALETTE: MascotPaletteSpec = {
  label: 'Стекло · аврора',
  glass: {
    coreTop: [0.07, 0.055, 0.17], coreBottom: [0.15, 0.1, 0.34], shade: 0.86,
    refract: 0.28,
    flowColors: [[0.52, 0.38, 1.0], [0.82, 0.76, 1.0], [0.86, 0.98, 0.45], [0.32, 0.88, 1.0], [1.0, 0.58, 0.8]],
    flow: 0.8, veilBack: 0.7,
    deep: [0.28, 0.2, 0.62], deepMix: 0.5, deepLevel: 0.62, calmStart: 0.42, calmEnd: 0.88,
    veilLow: 0.0, veilHigh: 0.22,
    glowOuter: [0.5, 0.4, 0.92], glowInner: LIME, glowAmount: 0.6,
    lineColor: [0.82, 0.9, 0.62], lines: 0.18,
    rim: [0.76, 0.71, 1.0], rimStart: 0.86, rimPower: 1.6, rimAmount: 0.9, dispersion: 0.012,
    film: [LIME, LAVENDER, CYAN], filmAmount: 1.2, filmDark: 0.1,
    innerLine: [0.5, 0.48, 0.62], innerLineAt: 0.935,
    specular: [1, 1, 1], specularAmount: 1, specularPower: 60, streak: 0.55, secondary: [0.1, 0.09, 0.15],
    edgeLight: [0.8, 0.78, 1.0], rimLight: [0.5, 0.7, 0.3],
    outline: [0.19, 0.12, 0.42], outlineAmount: 0.65,
    translucency: 0.32, clearStart: 0.68,
    moodCore: 1.4, moodFlow: 1.2, moodRim: 3,
  },
  face: { eye: '#FDFEFF', glow: '#E9E4FF', glowOpacity: 0.55, mouthInterior: '#0E0A22', mouthInteriorOpacity: 0.95, lipStroke: 0.6 },
  fallback: {
    background: 'radial-gradient(ellipse at 27% 17%, rgba(255, 255, 255, 0.85), transparent 15%), radial-gradient(ellipse 46% 20% at 50% 86%, rgba(218, 241, 99, 0.65), rgba(128, 102, 235, 0.4) 55%, transparent 100%), radial-gradient(ellipse 30% 22% at 78% 30%, rgba(77, 219, 250, 0.4), transparent 100%), radial-gradient(ellipse 34% 26% at 20% 62%, rgba(204, 189, 255, 0.4), transparent 100%), radial-gradient(closest-side, #140e33 0%, #1d1446 64%, #3a2b86 86%, #c4b8ff 97%, #ece8ff 100%)',
    boxShadow: 'inset 0 0 0 1px rgba(48, 31, 107, 0.6)',
  },
  floor: SHIPPING_GLASS,
};
