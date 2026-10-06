// App-icon candidates for the dev-only mascot lab (app/mascot-lab?icon=…). Plain data, safe on the server: the lab page
// validates ?icon= with isIconVariant before it renders the client view (./mascot-icon-view.tsx).

/** `body` = body width as a fraction of the icon; `floor` = the floor shadow under it (and the stage lifted to centre both). */
export const ICON_VARIANTS = {
  pearl: {
    dark: false, body: 0.67, floor: true,
    background: 'radial-gradient(ellipse 70% 60% at 50% 30%, #fdfcff 0%, rgba(253, 252, 255, 0) 70%), radial-gradient(ellipse 60% 50% at 12% 88%, rgba(196, 184, 250, 0.45), transparent 70%), radial-gradient(ellipse 55% 45% at 90% 86%, rgba(226, 242, 160, 0.4), transparent 70%), linear-gradient(180deg, #f3f0fb 0%, #e9e4f7 100%)',
  },
  graphite: {
    dark: true, body: 0.67, floor: true,
    background: 'radial-gradient(ellipse 65% 55% at 22% 18%, rgba(111, 92, 242, 0.28), transparent 70%), radial-gradient(ellipse 60% 40% at 50% 92%, rgba(218, 241, 99, 0.1), transparent 70%), linear-gradient(160deg, #18171c 0%, #221e33 55%, #2a2440 100%)',
  },
  'aurora-glow': {
    dark: false, body: 0.67, floor: true,
    background: 'radial-gradient(ellipse 65% 55% at 45% 30%, rgba(255, 255, 255, 0.75), transparent 70%), linear-gradient(150deg, #ddd5fb 0%, #ebe8f8 45%, #eef4d6 75%, #e5f3b4 100%)',
  },
  /**
   * 0.5.3 PC app icon (PASS-0.5.3 §7): the light glass chubrik alone — transparent canvas, no floor shadow, body ≈ 86 %
   * of the icon and centred on its own outline. Capture it into a transparent window (alpha kept) for the RGBA ICO.
   */
  clear: { dark: false, body: 0.86, floor: false, background: 'transparent' },
} as const;
export type IconVariant = keyof typeof ICON_VARIANTS;
export const isIconVariant = (value: unknown): value is IconVariant => typeof value === 'string' && Object.prototype.hasOwnProperty.call(ICON_VARIANTS, value);
