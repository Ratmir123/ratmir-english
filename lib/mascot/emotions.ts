// Emotion table (MASCOT-SPEC §5) and app state → context emotion (§8).
// Pure data: shared by the web renderer, the tests and (by value) the iPhone port.
// PASS-0.5.3 §4: no emotion holds a fixed body tilt any more — tilts are gentle rolls centred on 0 (`body.roll`).
import type { TintName } from './constants';

export const MASCOT_EMOTIONS = [
  'calm', 'happy', 'joy', 'laugh', 'excited', 'love', 'proud', 'surprised', 'curious', 'thinking',
  'listening', 'speaking', 'sad', 'sleepy', 'dizzy', 'shy', 'annoyed', 'determined', 'wink', 'squeeze',
] as const;
export type MascotEmotion = typeof MASCOT_EMOTIONS[number];

export const MASCOT_STATES = ['idle', 'listening', 'transcribing', 'thinking', 'speaking', 'paused'] as const;
export type MascotState = typeof MASCOT_STATES[number];

export const EYE_SHAPES = ['pill', 'heart', 'spiral', 'star', 'cross', 'closed', 'caret'] as const;
export type EyeShape = typeof EYE_SHAPES[number];

export interface EyeSpec {
  /** 0–1.4: vertical scale of the pill. */
  open: number;
  /** 0–1: pill → ∩ happy arc. */
  smile: number;
  /** 0–1: flattens the top half. */
  squint: number;
  /** Degrees, positive = clockwise (screen space). */
  tilt: number;
  /** Horizontal scale (surprised ×1.15). */
  width: number;
  shape: EyeShape;
}
export interface MouthSpec {
  /** Width as a fraction of S (0.05–0.17). */
  w: number;
  /** Opening 0–1. */
  o: number;
  /** Smile −1…1. */
  s: number;
  /** Roundness 0–1 ('o' oval). */
  r: number;
  /** Horizontal offset as a fraction of S. */
  x: number;
}
export interface BodySpec {
  /** Squash target offset (q > 0 wider/shorter). */
  q: number;
  /** Uniform scale (1 = none). */
  scale: number;
  /** Extra vertical scale (1 = none). */
  scaleY: number;
  /** Hop target as a fraction of S (negative = up). */
  lift: number;
  /** Breathing applied to the squash target: q += amp·sin(freq·t), freq in rad/s. */
  breath: { amp: number; freq: number };
  /**
   * Gentle roll (PASS-0.5.3 §4): φ += sign·amp·sin(2π·local/period), amp in degrees, period in seconds, local = time since
   * the emotion began, so it starts upright and stays centred on 0. sign = ±1, random per entry (tap reactions alternate).
   */
  roll: { amp: number; period: number } | null;
  /** φ += amp·sin(2π·hz·local) while local < seconds (local = time since the emotion began). */
  shake: { amp: number; hz: number; seconds: number } | null;
  /** Squash impulse alternating ±impulse every interval seconds. */
  bounce: { interval: number; impulse: number } | null;
  /** Hop impulses on enter: h velocity = velocity·S per second (negative = up). */
  hops: { count: number; interval: number; velocity: number } | null;
  /** Squash velocity impulse on enter. */
  kick: number;
  /** Hop velocity impulse on enter (·S per second, positive = down: a nod). */
  nod: number;
  /** Circular wobble of the position target: radius ·S, frequency in Hz. */
  orbit: { radius: number; hz: number } | null;
  /** Uniform scale pulse: scale += amp·sin(2π·hz·t). */
  pulse: { amp: number; hz: number } | null;
}
export interface EmotionSpec {
  eyes: readonly [EyeSpec, EyeSpec];
  /** Fixed gaze (−1…1, screen space) or null to follow pointer/idle life. */
  gaze: readonly [number, number] | null;
  mouth: MouthSpec;
  /** Smile wobble of the mouth (dizzy). */
  mouthWobble: { amp: number; hz: number } | null;
  blush: number;
  tint: TintName | null;
  tintAmount: number;
  body: BodySpec;
  /** Default length when played as a transient reaction (seconds). */
  duration: number;
  /** Listed as transient in §5 (returns to the context emotion by itself). */
  transient: boolean;
}

const eye = (open: number, smile = 0, squint = 0, shape: EyeShape = 'pill', tilt = 0, width = 1): EyeSpec => ({ open, smile, squint, tilt, width, shape });
const both = (spec: EyeSpec): readonly [EyeSpec, EyeSpec] => [spec, { ...spec }];
const mouth = (w: number, o: number, s: number, r: number, x = 0): MouthSpec => ({ w, o, s, r, x });
const CALM_BREATH = { amp: 0.012, freq: 1.45 };
const body = (patch: Partial<BodySpec> = {}): BodySpec => ({
  q: 0, scale: 1, scaleY: 1, lift: 0, breath: CALM_BREATH, roll: null, shake: null, bounce: null,
  hops: null, kick: 0, nod: 0, orbit: null, pulse: null, ...patch,
});
const SOFT_BREATH = { amp: 0.008, freq: 1.45 };
/** PASS-0.5.3 §4 rolls (degrees / seconds). The iPhone (MascotPhysics.swift) uses the same numbers. */
export const EMOTION_ROLLS = {
  curious: { amp: 6, period: 4.2 },
  wink: { amp: 4.5, period: 3.8 },
  shy: { amp: 4, period: 4.6 },
  proud: { amp: 3, period: 5.2 },
  /** The old slow sway (4.5°·sin(0.91·t)), now centred and started per entry. */
  thinking: { amp: 4.5, period: 6.9 },
  happy: { amp: 2.5, period: 3.4 },
  joy: { amp: 2.5, period: 3.4 },
} as const satisfies Partial<Record<MascotEmotion, { amp: number; period: number }>>;

/** §5, row by row. */
export const EMOTIONS: Readonly<Record<MascotEmotion, EmotionSpec>> = {
  calm: {
    eyes: both(eye(1)), gaze: null, mouth: mouth(0.07, 0, 0.35, 0), mouthWobble: null,
    blush: 0, tint: null, tintAmount: 0, body: body(), duration: 1, transient: false,
  },
  happy: {
    eyes: both(eye(1, 0.55)), gaze: null, mouth: mouth(0.1, 0.12, 0.85, 0), mouthWobble: null,
    blush: 0.15, tint: 'lime', tintAmount: 0.1, body: body({ breath: SOFT_BREATH, kick: 0.6, roll: EMOTION_ROLLS.happy }), duration: 0.9, transient: false,
  },
  joy: {
    eyes: both(eye(0.9, 1)), gaze: null, mouth: mouth(0.13, 0.55, 1, 0), mouthWobble: null,
    blush: 0.3, tint: 'lime', tintAmount: 0.18,
    body: body({ breath: SOFT_BREATH, hops: { count: 2, interval: 0.15, velocity: -0.9 }, roll: EMOTION_ROLLS.joy }), duration: 1.2, transient: true,
  },
  laugh: {
    eyes: both(eye(0.25, 1)), gaze: null, mouth: mouth(0.15, 0.85, 1, 0), mouthWobble: null,
    blush: 0.45, tint: 'lime', tintAmount: 0.15,
    body: body({ breath: SOFT_BREATH, bounce: { interval: 0.18, impulse: 0.5 }, shake: { amp: 5, hz: 4, seconds: Infinity } }),
    duration: 1.4, transient: true,
  },
  excited: {
    eyes: both(eye(1.2, 0.25, 0, 'star')), gaze: null, mouth: mouth(0.12, 0.6, 0.9, 0.2), mouthWobble: null,
    blush: 0.25, tint: 'lime', tintAmount: 0.22,
    // The star-eyed shake lasts the first second only (PASS-0.5.3 §4, like the iPhone); then it stands upright.
    body: body({ breath: SOFT_BREATH, hops: { count: 3, interval: 0.24, velocity: -0.85 }, shake: { amp: 8, hz: 3, seconds: 1 } }),
    duration: 2, transient: false,
  },
  love: {
    eyes: both(eye(1, 0, 0, 'heart')), gaze: null, mouth: mouth(0.09, 0.18, 0.9, 0), mouthWobble: null,
    blush: 0.6, tint: 'pink', tintAmount: 0.22,
    body: body({ breath: SOFT_BREATH, lift: -0.04, pulse: { amp: 0.015, hz: 1.6 } }), duration: 2, transient: false,
  },
  proud: {
    eyes: both(eye(0.65, 0.85)), gaze: null, mouth: mouth(0.11, 0, 0.95, 0), mouthWobble: null,
    blush: 0.2, tint: 'lime', tintAmount: 0.12, body: body({ breath: SOFT_BREATH, scale: 1.06, roll: EMOTION_ROLLS.proud }), duration: 2, transient: false,
  },
  surprised: {
    eyes: both(eye(1.35, 0, 0, 'pill', 0, 1.15)), gaze: null, mouth: mouth(0.06, 0.8, 0, 1), mouthWobble: null,
    blush: 0, tint: null, tintAmount: 0, body: body({ breath: SOFT_BREATH, q: -0.25, hops: { count: 1, interval: 0, velocity: -0.7 } }),
    duration: 0.6, transient: true,
  },
  curious: {
    eyes: [eye(1.1, 0, 0, 'pill', -9), eye(0.72, 0, 0, 'pill', 10)], gaze: null, mouth: mouth(0.06, 0.05, 0.2, 0.35), mouthWobble: null,
    blush: 0, tint: null, tintAmount: 0, body: body({ breath: SOFT_BREATH, roll: EMOTION_ROLLS.curious }), duration: 1.1, transient: false,
  },
  thinking: {
    eyes: both(eye(0.85, 0, 0.2)), gaze: [-0.6, -0.7], mouth: mouth(0.06, 0, 0, 0, 0.03), mouthWobble: null,
    blush: 0, tint: 'violet', tintAmount: 0.15, body: body({ breath: SOFT_BREATH, roll: EMOTION_ROLLS.thinking }), duration: 2, transient: false,
  },
  listening: {
    eyes: both(eye(1.15)), gaze: null, mouth: mouth(0.06, 0, 0.3, 0), mouthWobble: null,
    // "cyan (base)": the body's own cyan, gently emphasised while the microphone is live.
    blush: 0, tint: 'cyan', tintAmount: 0.1, body: body({ breath: SOFT_BREATH, scale: 1.02 }), duration: 2, transient: false,
  },
  speaking: {
    // Mouth `o` is replaced by the speech envelope (§7) while speaking.
    eyes: both(eye(1, 0.2)), gaze: null, mouth: mouth(0.1, 0.08, 0.4, 0.2), mouthWobble: null,
    blush: 0, tint: null, tintAmount: 0, body: body({ breath: SOFT_BREATH }), duration: 2, transient: false,
  },
  sad: {
    eyes: [eye(0.75, 0, 0, 'pill', 12), eye(0.75, 0, 0, 'pill', -12)], gaze: null, mouth: mouth(0.08, 0.05, -0.6, 0), mouthWobble: null,
    blush: 0, tint: 'blue', tintAmount: 0.12, body: body({ scaleY: 0.95, breath: { amp: 0.016, freq: 0.9 } }), duration: 2, transient: false,
  },
  sleepy: {
    eyes: both(eye(0.12, 0, 0, 'closed')), gaze: null, mouth: mouth(0.05, 0.12, 0, 0.6), mouthWobble: null,
    blush: 0, tint: null, tintAmount: 0, body: body({ breath: { amp: 0.025, freq: Math.PI } }), duration: 2, transient: false,
  },
  dizzy: {
    eyes: both(eye(1, 0, 0, 'spiral')), gaze: null, mouth: mouth(0.1, 0.3, -0.2, 0), mouthWobble: { amp: 0.3, hz: 1.5 },
    blush: 0, tint: null, tintAmount: 0, body: body({ breath: SOFT_BREATH, orbit: { radius: 0.03, hz: 2 } }), duration: 1.8, transient: true,
  },
  shy: {
    eyes: both(eye(0.8, 0.3)), gaze: [0.5, 0.5], mouth: mouth(0.06, 0, 0.5, 0), mouthWobble: null,
    blush: 0.7, tint: 'pink', tintAmount: 0.15, body: body({ breath: SOFT_BREATH, scale: 0.95, roll: EMOTION_ROLLS.shy }), duration: 1.5, transient: false,
  },
  annoyed: {
    eyes: both(eye(0.55, 0, 0.6)), gaze: null, mouth: mouth(0.08, 0, -0.25, 0), mouthWobble: null,
    blush: 0, tint: null, tintAmount: 0, body: body({ breath: SOFT_BREATH, shake: { amp: 4, hz: 7, seconds: 0.3 } }), duration: 1.2, transient: true,
  },
  determined: {
    eyes: both(eye(0.8, 0, 0.35)), gaze: null, mouth: mouth(0.09, 0, 0.1, 0), mouthWobble: null,
    // "one firm nod (h impulse +0.04·S)": a downward velocity of 1.0·S/s peaks at ≈0.04·S with the hop spring.
    blush: 0, tint: null, tintAmount: 0, body: body({ breath: SOFT_BREATH, nod: 1 }), duration: 1.2, transient: false,
  },
  wink: {
    // Right eye "closed" as the morphing ∩ arc (smile 1), so the wink morphs geometrically like every pill.
    eyes: [eye(1, 0.5), eye(1, 1)], gaze: null, mouth: mouth(0.1, 0.1, 0.8, 0), mouthWobble: null,
    blush: 0.2, tint: null, tintAmount: 0, body: body({ breath: SOFT_BREATH, roll: EMOTION_ROLLS.wink }), duration: 0.75, transient: true,
  },
  squeeze: {
    eyes: both(eye(1, 0, 0, 'caret')), gaze: null, mouth: mouth(0.07, 0.3, -0.3, 0), mouthWobble: null,
    blush: 0.3, tint: null, tintAmount: 0, body: body({ breath: SOFT_BREATH, q: 0.22 }), duration: Infinity, transient: true,
  },
};

/** Tap reaction cycle (§3): wink → giggle (laugh 0.6 s) → happy → surprised → curious → wink… */
export const TAP_CYCLE: readonly { emotion: MascotEmotion; duration: number }[] = [
  { emotion: 'wink', duration: 0.75 },
  { emotion: 'laugh', duration: 0.6 },
  { emotion: 'happy', duration: 0.9 },
  { emotion: 'surprised', duration: 0.6 },
  { emotion: 'curious', duration: 1.1 },
];

/** Reaction chains (§3, §6). */
export const REACTIONS = {
  rapidLaugh: [{ emotion: 'laugh', duration: 1.4 }],
  tickle: [{ emotion: 'annoyed', duration: 1.2 }, { emotion: 'laugh', duration: 0.8 }],
  shake: [{ emotion: 'dizzy', duration: 1.8 }],
  release: [{ emotion: 'joy', duration: 1.2 }],
  wake: [{ emotion: 'surprised', duration: 0.5 }, { emotion: 'happy', duration: 0.8 }],
  greeting: [{ emotion: 'happy', duration: 1.4 }],
} as const satisfies Record<string, readonly { emotion: MascotEmotion; duration: number }[]>;

/** Voice/app state of the conversation → context emotion. */
export const STATE_EMOTION: Readonly<Record<MascotState, MascotEmotion>> = {
  idle: 'calm', listening: 'listening', transcribing: 'thinking', thinking: 'thinking', speaking: 'speaking', paused: 'calm',
};
export function emotionForState(state: MascotState): MascotEmotion { return STATE_EMOTION[state] ?? 'calm'; }

/**
 * §8 — where the app is → context emotion. Celebrations are a transient emotion (+ confetti) followed by `then`.
 * Both clients use these names; the shell decides which one applies.
 */
export const APP_CONTEXT_EMOTION = {
  home: 'calm',
  placementIntro: 'determined',
  placementItem: 'calm',
  placementScoring: 'thinking',
  placementResult: 'proud',
  sessionSpeaking: 'speaking',
  sessionRecording: 'listening',
  sessionWaiting: 'thinking',
  sessionError: 'sad',
  reviewReady: 'curious',
  retryImproved: 'proud',
  sessionCompleted: 'proud',
  callsProcessing: 'thinking',
  callReviewReady: 'curious',
} as const satisfies Record<string, MascotEmotion>;
export type MascotAppContext = keyof typeof APP_CONTEXT_EMOTION;

export const CELEBRATIONS = {
  /** Placement result (overall ≥ previous or first result): excited 2 s → proud. */
  placementResult: { emotion: 'excited', duration: 2, then: 'proud', confetti: false },
  /** Improved retry: joy 1.5 s + confetti → proud. */
  retryImproved: { emotion: 'joy', duration: 1.5, then: 'proud', confetti: true },
  /** Session completed / XP / achievement / level-up: love or excited 2 s + confetti. */
  sessionCompleted: { emotion: 'love', duration: 2, then: 'proud', confetti: true },
  levelUp: { emotion: 'excited', duration: 2, then: 'love', confetti: true },
} as const satisfies Record<string, { emotion: MascotEmotion; duration: number; then: MascotEmotion; confetti: boolean }>;

/** Old VoiceOrb moods (0.4) → new emotions. */
export type LegacyOrbEmotion = 'calm' | 'attentive' | 'curious' | 'friendly' | 'pleased' | 'supportive';
export const LEGACY_EMOTION: Readonly<Record<LegacyOrbEmotion, MascotEmotion>> = {
  calm: 'calm', attentive: 'listening', curious: 'curious', friendly: 'happy', pleased: 'proud', supportive: 'sad',
};
export function isMascotEmotion(value: unknown): value is MascotEmotion {
  return typeof value === 'string' && (MASCOT_EMOTIONS as readonly string[]).includes(value);
}
export function toMascotEmotion(value: LegacyOrbEmotion | MascotEmotion): MascotEmotion {
  return Object.prototype.hasOwnProperty.call(LEGACY_EMOTION, value) ? LEGACY_EMOTION[value as LegacyOrbEmotion] : value as MascotEmotion;
}

/** Russian labels for the accessible status and the dev lab. */
export const EMOTION_LABELS: Readonly<Record<MascotEmotion, string>> = {
  calm: 'Спокоен', happy: 'Рад', joy: 'Ликует', laugh: 'Смеётся', excited: 'В восторге', love: 'Обожает', proud: 'Гордится',
  surprised: 'Удивлён', curious: 'Любопытствует', thinking: 'Думает', listening: 'Слушает', speaking: 'Говорит', sad: 'Сочувствует',
  sleepy: 'Дремлет', dizzy: 'Голова кружится', shy: 'Смущён', annoyed: 'Ворчит', determined: 'Собран', wink: 'Подмигивает', squeeze: 'Сжался',
};
export const STATE_LABELS: Readonly<Record<MascotState, string>> = {
  idle: 'Ждёт твоего ответа', listening: 'Слушает тебя', speaking: 'Говорит', transcribing: 'Распознаёт запись', thinking: 'Готовит ответ', paused: 'Пауза',
};
