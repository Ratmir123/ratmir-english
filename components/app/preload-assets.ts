// The launch preloader's asset step (planning/v05/PASS-0.5.3.md §6). While the companion idles on the launch layer, the
// art the first screens show is fetched and decoded off the main thread, the UI font is loaded, and one idle moment
// passes, so the greeting and the staircase never wait for a decode, a font swap or a late layout.
// The list, the queue and the caps are pure enough to unit-test (tests/preload-assets.test.ts); the browser wrappers
// at the bottom are what the app uses.
import { ACHIEVEMENT_ART, EXPERIENCE_BANDS, experienceBand, REWARD_ART_SMALL_MAX, rewardArtUrl } from '@/lib/achievement-targets';
import { SCENARIO_ARTWORK_IDS, scenarioArtworkPath } from '@/lib/scenario-artwork';
import type { ProgressionState } from '@/lib/types';

export const PRELOAD = {
  /** Image fetch + decode jobs in flight at once. */
  concurrency: 6,
  /** Images hold the launch at most this long after the state arrived; the rest keeps decoding in the background. */
  imageCapMs: 1500,
  /** Fonts, images and the idle moment never hold the launch longer than this after its first frame. */
  hardCapMs: 6000,
  /** requestIdleCallback timeout for the last step. */
  idleTimeoutMs: 300,
} as const;
export type PreloadCaps = { imageCapMs: number; hardCapMs: number; idleTimeoutMs: number };

/** The same URLs the medals request (lib/achievement-targets `rewardArtUrl`): the 256 px variant up to 120 px, else 512 px. */
const smallArt = (art: string) => rewardArtUrl(art, REWARD_ART_SMALL_MAX);
const fullArt = (art: string) => rewardArtUrl(art);

/**
 * What the first screens show, most visible first: the current rank (sidebar chip and Today's level card from the
 * 256 px set, Progress at full size), the rank ladder, the achievement medals, the scenario artwork of the catalog, and
 * the next rank at full size for the rank-up moment. Every URL once.
 */
export function launchAssetUrls(progression: Pick<ProgressionState, 'level'> | null | undefined): string[] {
  const level = progression && Number.isFinite(progression.level) ? progression.level : 1;
  const current = experienceBand(level).art;
  const next = EXPERIENCE_BANDS.find(band => band.from > level)?.art;
  const urls = [smallArt(current), fullArt(current)];
  for (const band of EXPERIENCE_BANDS) urls.push(smallArt(band.art));
  for (const art of Object.values(ACHIEVEMENT_ART)) urls.push(smallArt(art));
  for (const id of SCENARIO_ARTWORK_IDS) { const path = scenarioArtworkPath(id); if (path) urls.push(path); }
  if (next) urls.push(fullArt(next));
  return [...new Set(urls)];
}

export type AssetLoader = (url: string) => Promise<unknown>;

/**
 * A small fetch/decode queue: at most `concurrency` jobs at once, started in list order, every URL loaded once for the
 * queue's life (a second `preload` of the same URL shares the first job). A failed image never stops the rest.
 */
export function createAssetQueue(load: AssetLoader, concurrency: number = PRELOAD.concurrency) {
  const jobs = new Map<string, Promise<void>>();
  const waiting: Array<() => void> = [];
  let active = 0;
  const pump = () => {
    while (active < concurrency && waiting.length) { active++; waiting.shift()!(); }
  };
  const job = (url: string) => {
    let entry = jobs.get(url);
    if (!entry) {
      entry = new Promise<void>(resolve => {
        waiting.push(() => {
          Promise.resolve().then(() => load(url)).catch(() => undefined).then(() => { active--; resolve(); pump(); });
        });
      });
      jobs.set(url, entry);
      pump();
    }
    return entry;
  };
  return {
    /** Resolves when every URL has loaded or failed. */
    preload: (urls: readonly string[]) => Promise.all(urls.map(job)).then(() => undefined),
    get active() { return active; },
  };
}

/** The deadlines (same clock as the inputs): images wait ≤ `imageCapMs` after the state, nothing waits past the hard cap. */
export function launchDeadlines(bootAt: number, stateAt: number, caps: PreloadCaps = PRELOAD) {
  const hard = bootAt + caps.hardCapMs;
  return { images: Math.min(hard, stateAt + caps.imageCapMs), hard };
}

/** Settles when `work` settles or after `ms`, whichever comes first; never rejects (the work itself carries on). */
export function within(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>(resolve => {
    const timer = setTimeout(resolve, Math.max(0, ms));
    work.then(() => { clearTimeout(timer); resolve(); }, () => { clearTimeout(timer); resolve(); });
  });
}

export interface LaunchReadyEnv {
  now: () => number;
  font: () => Promise<unknown>;
  images: (urls: readonly string[]) => Promise<unknown>;
  idle: (timeoutMs: number) => Promise<unknown>;
}

/**
 * «Ready» for the greeting once the state has landed and the shell is mounted (the caller's part): the UI font is loaded
 * and the images are decoded (both started here; images capped `imageCapMs` after the state, the rest continues in
 * the background), then one idle moment. Never later than `hardCapMs` after `bootAt`.
 */
export async function waitForLaunchReady(input: { bootAt: number; stateAt: number; urls: readonly string[] },
  environment?: LaunchReadyEnv, caps: PreloadCaps = PRELOAD): Promise<void> {
  const env = environment ?? browserLaunchEnv;
  const deadline = launchDeadlines(input.bootAt, input.stateAt, caps);
  const left = (until: number) => Math.max(0, until - env.now());
  const images = Promise.resolve().then(() => env.images(input.urls));
  const font = Promise.resolve().then(() => env.font());
  await Promise.all([within(font, left(deadline.hard)), within(images, left(deadline.images))]);
  await within(Promise.resolve().then(() => env.idle(caps.idleTimeoutMs)), left(deadline.hard));
}

/* ── Browser side ── */

/** The UI display face (headings, numbers, the wordmark); the body text uses system fonts and needs no load. */
export const UI_FONT = '800 1em "Nunito Variable"';
/** Cyrillic + Latin: loads both unicode-range files of the variable font (one file covers every weight). */
export const UI_FONT_SAMPLE = 'Привет, Smooth Talk';

export function loadUiFont(): Promise<void> {
  try {
    const fonts = typeof document === 'undefined' ? undefined : document.fonts;
    if (!fonts || typeof fonts.load !== 'function') return Promise.resolve();
    return fonts.load(UI_FONT, UI_FONT_SAMPLE).then(() => undefined, () => undefined);
  } catch { return Promise.resolve(); }
}

/** Decoded images stay referenced for the session, so the browser keeps them warm for the medals and the catalog. */
const kept: HTMLImageElement[] = [];
function decodeImage(url: string): Promise<void> {
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  kept.push(image);
  return image.decode();
}
let queue: ReturnType<typeof createAssetQueue> | null = null;

/** Fetches and decodes `urls` off the main thread (≤ 6 at once); safe to call again, nothing loads twice. */
export function preloadImages(urls: readonly string[]): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve();
  queue ??= createAssetQueue(decodeImage);
  return queue.preload(urls);
}

/** One idle moment (requestIdleCallback with a timeout; a short timer where it is missing). */
export function idleMoment(timeoutMs: number = PRELOAD.idleTimeoutMs): Promise<void> {
  return new Promise<void>(resolve => {
    const host = typeof window === 'undefined' ? undefined : window;
    if (host && typeof host.requestIdleCallback === 'function') host.requestIdleCallback(() => resolve(), { timeout: timeoutMs });
    else setTimeout(resolve, Math.min(timeoutMs, 32));
  });
}

export const browserLaunchEnv: LaunchReadyEnv = { now: () => performance.now(), font: loadUiFont, images: preloadImages, idle: idleMoment };
