/**
 * «Подготовка к созвону» (PASS-0.5.5 §2): screenshots of a chat and a few words of context become a plan for one real call and a
 * rehearsal with that counterpart. Shared contract between the server, the web/PC client and the iPhone client. Russian coaching,
 * English lines. Keep this file free of server-only imports: it is bundled into the web client.
 */

export type PrepStatus = 'reading' | 'ready' | 'failed';
export type PrepOrigin = 'web' | 'desktop' | 'ios';

/** A past mistake that is likely in this call: Russian title and reason, the English line to say instead. */
export interface PrepWatchout { title: string; why: string; instead: string; patternId: string | null }
/** A question to ask them (English) and why it matters here (Russian). */
export interface PrepQuestion { en: string; why: string }
/** English key lines for this call. */
export interface PrepLines { opening: string; pitch: string; close: string }
/** Russian anchor and floor with numbers, English lines to say them and to answer a low offer, an optional Russian note. */
export interface PrepPrice { anchor: string; floor: string; say: string; ifLow: string; notes: string | null }

/** One thing the rehearsal showed: what he said and what to say in the real call. */
export interface PrepReminder { kind: 'cost' | 'language' | 'pattern'; title: string; said: string | null; better: string | null }

export interface PrepRehearsal {
  sessionId: string; createdAt: string; tier: 1 | 2 | 3; mode: 'learning' | 'call';
  /** The session's status; 'deleted' when the session was deleted from the history. */
  status: 'active' | 'analysing' | 'review' | 'completed' | 'error' | 'deleted';
  /** Filled once the rehearsal has a review: at most PREP_REMINDER_LIMIT items, most expensive first. */
  remember: PrepReminder[];
}

export interface CallPrep {
  id: string; createdAt: string; updatedAt: string; status: PrepStatus;
  /** What the learner sent. Screenshots themselves are never returned and are deleted once read. */
  input: { images: number; text: string | null; goal: string | null; callAt: string | null; origin: PrepOrigin };
  /** Russian short title, e.g. «Фильм к запуску приложения». */
  title: string | null;
  /** Who will be on the call, e.g. «Alex, co-founder, Northwind». */
  counterpart: string | null;
  /** Russian, the call time in the learner's local time when it is known. */
  when: string | null;
  /** Russian: who they are and what they want (2–3 sentences). */
  situation: string | null;
  /** Russian: what success on this call means, with the minimum. */
  goal: string | null;
  watchouts: PrepWatchout[];
  questions: PrepQuestion[];
  lines: PrepLines | null;
  price: PrepPrice | null;
  /** Russian: what not to say on this call. */
  avoid: string[];
  /** Russian: risks to close before working (payment, rights, claims). */
  risks: string[];
  /** Russian: what could not be read or is unknown. */
  limitations: string[];
  /** Russian status note (why reading failed). */
  note: string | null;
  /** Oldest first. */
  rehearsals: PrepRehearsal[];
}

export interface PrepResponse { prep: CallPrep }
export interface PrepListResponse { preps: CallPrep[] }

export const PREP_MAX_IMAGES = 8;
export const PREP_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const PREP_MAX_TOTAL_BYTES = 32 * 1024 * 1024;
export const PREP_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
/** Clients scale the long side of a screenshot down to this before upload (JPEG 0.86, or PNG when smaller). */
export const PREP_IMAGE_LONG_SIDE = 2048;
export const PREP_TEXT_LIMIT = 6000;
export const PREP_GOAL_LIMIT = 600;
/** Without screenshots the text must say at least this much. */
export const PREP_MIN_TEXT = 20;
export const PREP_POLL_MS = 2000;
export const PREP_POLL_LIMIT_MS = 240_000;
export const PREP_DAILY_LIMIT = 20;
export const PREP_REMINDER_LIMIT = 5;
/** «Сегодня» shows a prep created within this window or one whose call time is still ahead. */
export const PREP_TODAY_WINDOW_MS = 24 * 60 * 60_000;
/** The hidden family of rehearsal sessions. */
export const PREP_FAMILY_ID = 'call-prep';

export const PREP_COPY = {
  entryTitle: 'Скоро созвон?',
  entryText: 'Закинь переписку — соберу план и репетицию под этот проект за 15 минут.',
  entryAction: 'Подготовиться',
  sheetTitle: 'Подготовка к созвону',
  images: 'Скриншоты переписки',
  imagesHint: 'Перетащи, вставь или выбери до 8 скриншотов.',
  text: 'Что ещё важно',
  textPlaceholder: 'Их сайт, кто будет на звонке, что уже обсуждали, в чём сомневаешься',
  goal: 'Чего хочешь от звонка',
  goalPlaceholder: 'Например: рекламный фильм, не ниже $1 500',
  callAt: 'Когда созвон',
  submit: 'Подготовить',
  reading: 'Читаю переписку…',
  readingSlow: 'Ещё немного: собираю план под твои прошлые созвоны.',
  failed: 'Не получилось подготовиться. Попробуй ещё раз.',
  empty: 'Добавь скриншоты переписки или пару фраз о созвоне.',
  remember: 'Перед звонком помни',
  situation: 'О чём звонок',
  goalTitle: 'Цель',
  watchouts: 'Твои ловушки',
  instead: 'Скажи вместо:',
  questions: 'Спроси их',
  lines: 'Ключевые фразы',
  opening: 'Начало',
  pitch: 'Питч',
  close: 'Закрытие',
  price: 'Цена',
  anchor: 'Называешь',
  floor: 'Пол',
  say: 'Как сказать',
  ifLow: 'Если давят',
  avoid: 'Не говори',
  risks: 'Риски',
  rehearse: 'Репетиция · ~10 мин',
  rehearseAgain: 'Ещё раз, жёстче',
  delete: 'Удалить подготовку',
  list: 'Подготовки',
  todayTitle: 'Созвон',
  backToPrep: 'К подготовке',
  rehearsalOf: 'Репетиция созвона',
} as const;

/** Rehearsal pressure: the first one is firm (2), every next one tough (3). */
export function prepTier(rehearsals: number): 2 | 3 { return rehearsals > 0 ? 3 : 2; }

/** The latest rehearsal that already has reminders, or null. */
export function latestReminders(prep: Pick<CallPrep, 'rehearsals'>): PrepRehearsal | null {
  for (let index = prep.rehearsals.length - 1; index >= 0; index--) if (prep.rehearsals[index].remember.length) return prep.rehearsals[index];
  return null;
}

/** «Сегодня» card: the newest ready prep created within a day or whose call time is still ahead. */
export function todayPrep(preps: readonly CallPrep[] | undefined, now = Date.now()): CallPrep | null {
  for (const prep of preps ?? []) {
    if (prep.status !== 'ready') continue;
    const callAt = Date.parse(prep.input.callAt ?? '');
    if (Number.isFinite(callAt) ? callAt > now - 60 * 60_000 : now - Date.parse(prep.createdAt) < PREP_TODAY_WINDOW_MS) return prep;
  }
  return null;
}
