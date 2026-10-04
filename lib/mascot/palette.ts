// Smooth Talk mascot — body material and face colours (0.5.1 «Black opal»).
// Thick dark glass: a deep graphite-violet core under a white face (≥ 7:1), a crisp Fresnel rim of luminous
// lavender, opal flecks and veins in the outer body, thin-film iridescence on the edge and light passing through
// coloured glass along the inner bottom. The shader takes the material as compile-time constants (no per-frame
// cost); the iPhone mirrors every number in ios/Sources/LiquidCompanion.metal and MascotFace.swift.
// Lab-only comparison presets live in ./palette-lab (never imported by the app).
import { SHIPPING_GLASS, type ShadowGlass } from './shadow';

/** Linear 0–1 sRGB triplet (shader constants). */
export type GlassRGB = readonly [number, number, number];

export interface MascotMaterial {
  /** Thick dark glass: a gentle top-left → bottom-right gradient, barely moved by the slow inner flow. */
  coreTop: GlassRGB; coreBottom: GlassRGB; coreFlow: number;
  /** Depth shading of the core: ×(shade + z·(1 − shade)). */
  shade: number;
  /** Opal flecks and veins in the outer body (never under the face), coloured by the film palette; they live in
   * refracted space and brighten where the surface faces the key light, so deformation and gaze move them. */
  fleck: number;
  /** Light through coloured glass along the inner bottom: glowOuter at its edge → glowInner at the hottest point. */
  glowOuter: GlassRGB; glowInner: GlassRGB; glowAmount: number;
  /** Fresnel rim: mix toward `rim` over smoothstep(rimStart, 0.99, dist)^rimPower — near the edge only, crisp. */
  rim: GlassRGB; rimStart: number; rimPower: number; rimAmount: number;
  /** Thin-film iridescence along the Fresnel edge: three colours cycled by angle, time and gaze. */
  film: readonly [GlassRGB, GlassRGB, GlassRGB]; filmAmount: number; filmDark: number;
  /** Key light top-left: crisp specular + broad bloom. */
  specular: GlassRGB; specularAmount: number; specularPower: number; bloom: number;
  /** Rim line lit from the top-left, faint secondary rim light bottom-right. */
  edgeLight: GlassRGB; rimLight: GlassRGB;
  /** Light theme only: a thin deeper outer line so the silhouette stays solid on a pale page. */
  outline: GlassRGB; outlineAmount: number;
  /** Mood tint: hue shift of the core at constant luminance (keeps the face contrast); raw tint toward the rim. */
  moodCore: number; moodRim: number;
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
/**
 * Translucent thick glass with flowing colour inside: the inside is seen through the curved surface (bent and
 * magnified toward the edge), two-step domain-warped colour fields drift on ~10 s cycles as veils or ink veins,
 * a calm dark zone stays behind the face, caustic light lines move with the deformation, the rim disperses
 * slightly (R/G/B at different radii), a thin bright inner edge line, a curved window streak plus a soft secondary
 * highlight, and the outer band lets the page show through.
 */
export interface GlassMaterial {
  coreTop: GlassRGB; coreBottom: GlassRGB; shade: number;
  /** How strongly the surface normal bends the view of the inside. */
  refract: number;
  /** Four flowing colours, cycled smoothly; `flow` is their strength, `faceFloor` what remains behind the face. */
  flowColors: readonly [GlassRGB, GlassRGB, GlassRGB, GlassRGB]; flow: number; faceFloor: number;
  /** Veils: smoothstep(ribbonLow, ribbonHigh, field); ink veins: |field| < veinWidth. veinMix 0 = veils, 1 = veins. */
  ribbonLow: number; ribbonHigh: number; veinWidth: number; veinMix: number;
  /** Light through coloured glass along the inner bottom (outer → hottest colour). */
  glowOuter: GlassRGB; glowInner: GlassRGB; glowAmount: number;
  /** Caustic light lines in the lower body, moving with the deformation. */
  lineColor: GlassRGB; lines: number;
  rim: GlassRGB; rimStart: number; rimPower: number; rimAmount: number; dispersion: number;
  film: readonly [GlassRGB, GlassRGB, GlassRGB]; filmAmount: number; filmDark: number;
  innerLine: GlassRGB; innerLineAt: number;
  specular: GlassRGB; specularAmount: number; specularPower: number; streak: number; secondary: GlassRGB;
  edgeLight: GlassRGB; rimLight: GlassRGB;
  outline: GlassRGB; outlineAmount: number;
  /** Outer band alpha 1 − translucency (from clearStart to the rim line, which stays solid). */
  translucency: number; clearStart: number;
  moodCore: number; moodFlow: number; moodRim: number;
}

/** A material the shader builds from (opal or glass) or, for the lab's 0.5 reference, a verbatim shader tail. */
export type MascotPaletteSpec = MascotPaletteBase & (
  | { material: MascotMaterial; glass?: undefined; shaderTail?: undefined }
  | { glass: GlassMaterial; material?: undefined; shaderTail?: undefined }
  | { shaderTail: string; material?: undefined; glass?: undefined });

export const LIME: GlassRGB = [0.855, 0.945, 0.388];
export const LAVENDER: GlassRGB = [0.733, 0.698, 0.961];
export const CYAN: GlassRGB = [0.247, 0.835, 0.918];

/** The look the app ships. */
export const MASCOT_PALETTE: MascotPaletteSpec = {
  label: 'A · чёрный опал',
  material: {
    coreTop: [0.06, 0.05, 0.14], coreBottom: [0.15, 0.1, 0.34], coreFlow: 0.12,
    shade: 0.84,
    fleck: 0.6,
    glowOuter: [0.5, 0.4, 0.92], glowInner: LIME, glowAmount: 0.82,
    rim: [0.74, 0.69, 1.0], rimStart: 0.76, rimPower: 1.3, rimAmount: 0.92,
    film: [LIME, LAVENDER, CYAN], filmAmount: 0.9, filmDark: 0.1,
    specular: [1, 1, 1], specularAmount: 1, specularPower: 52, bloom: 0.05,
    edgeLight: [0.75, 0.72, 0.95], rimLight: [0.5, 0.7, 0.3],
    outline: [0.19, 0.12, 0.42], outlineAmount: 0.75,
    moodCore: 1.4, moodRim: 3,
  },
  face: { eye: '#FDFEFF', glow: '#E9E4FF', glowOpacity: 0.55, mouthInterior: '#0E0A22', mouthInteriorOpacity: 0.95, lipStroke: 0.6 },
  fallback: {
    background: 'radial-gradient(ellipse at 27% 18%, rgba(255, 255, 255, 0.85), transparent 16%), radial-gradient(ellipse 46% 20% at 50% 85%, rgba(218, 241, 99, 0.7), rgba(128, 102, 235, 0.45) 55%, transparent 100%), radial-gradient(closest-side, #120d30 0%, #1d1446 62%, #2f2373 84%, #bdb0ff 97%, #ece8ff 100%)',
    boxShadow: 'inset 0 0 0 1px rgba(48, 31, 107, 0.6)',
  },
  floor: SHIPPING_GLASS,
};
