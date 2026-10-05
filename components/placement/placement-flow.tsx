'use client';

/**
 * Placement test v2 — full-screen flow (W3). Server is the source of truth (PlacementView);
 * this component only decides which screen to show, talks to /api/placement/* and records voice answers.
 * Never shows right/wrong during the test.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowCounterClockwiseIcon, ArrowRightIcon, BookOpenIcon, ChatsCircleIcon, CheckIcon, ClockIcon, CoffeeIcon,
  HeadphonesIcon, MicrophoneIcon, PauseIcon, SkipForwardIcon, TextAaIcon, WarningIcon, type Icon,
} from '@phosphor-icons/react';
import { api, ApiRequestError } from '@/lib/client/api';
import type { PlacementSectionId, PlacementSectionView, PlacementView } from '@/lib/placement/types';
import { cx, kit, ProgressBar, Sheet, Spinner, useInterval } from '../calls/kit';
import {
  attemptHasProgress, DEFAULT_SECTIONS, flowScreen, progressModel, remainingLabel, SECTION_TIPS, seenOnMount, SKIPPABLE, VOICE_SECTIONS,
  type FlowMemory, type FlowScreen,
} from './flow-model';
import { retakeNote } from './result-model';
import { ChoiceTaskView } from './choice-task';
import { RoleplayTaskView, SpeakingTaskView } from './voice-tasks';
import { FeatureMascot } from './placement-mascot';
import { PlacementResultView } from './placement-result';
import { useTaskRecorder } from './use-task-recorder';
import styles from './placement.module.css';

export const SECTION_ICON: Record<PlacementSectionId, Icon> = {
  listening: HeadphonesIcon, reading: BookOpenIcon, language: TextAaIcon, speaking: MicrophoneIcon, interaction: ChatsCircleIcon,
};

function initialMemory(view: PlacementView): FlowMemory {
  return {
    resumed: !(view.status === 'in-progress' && attemptHasProgress(view)),
    // Opened on a finished result (e.g. «Пересдать» in Progress): go straight to the retake intro.
    seenIntros: seenOnMount(view), breakDismissed: false, wantsRetakeIntro: view.status === 'completed',
  };
}

function screenKey(screen: FlowScreen): string {
  switch (screen.kind) {
    case 'task': return `task:${screen.task.id}`;
    case 'section-intro': return `intro:${screen.section.id}`;
    case 'intro': return `start:${screen.retake}`;
    default: return screen.kind;
  }
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError || error instanceof Error) return error.message || fallback;
  return fallback;
}

export function PlacementFlow({ state, onState, onClose, onDone }: {
  state: PlacementView; onState: (next: PlacementView) => void; onClose: () => void; onDone?: () => void;
}) {
  const [memory, setMemory] = useState<FlowMemory>(() => initialMemory(state));
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: 'skip'; section: PlacementSectionView } | { kind: 'abandon' }>(null);
  const recorder = useTaskRecorder();
  const root = useRef<HTMLDivElement>(null);
  /** The flow was opened for a retake from outside: «Не сейчас» closes it instead of showing the result here. */
  const openedForRetake = useRef(state.status === 'completed');
  const screen = flowScreen(state, memory);
  const key = screenKey(screen);
  const progress = progressModel(state);

  // Full-screen: lock the page behind and restore on close.
  useLayoutEffect(() => {
    const html = document.documentElement;
    const previous = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => { html.style.overflow = previous; };
  }, []);

  // Accessibility: move focus to the new screen's heading on every screen change.
  useEffect(() => {
    const target = root.current?.querySelector<HTMLElement>('[data-autofocus]');
    target?.focus({ preventScroll: true });
    root.current?.scrollTo?.({ top: 0 });
  }, [key]);

  // Free the microphone outside the voice sections.
  const voiceSection = screen.kind === 'task' && screen.task.kind !== 'choice';
  const voiceIntro = screen.kind === 'section-intro' && VOICE_SECTIONS.includes(screen.section.id);
  const { mic, release } = recorder;
  useEffect(() => {
    if (!voiceSection && !voiceIntro && mic !== 'idle') release();
  }, [voiceSection, voiceIntro, mic, release]);

  const apply = useCallback((next: PlacementView) => { setNotice(null); onState(next); }, [onState]);

  /** Runs a server action; 409 (the test moved on, e.g. on the phone) refetches the current state. */
  const run = useCallback(async (label: string, action: () => Promise<PlacementView>): Promise<PlacementView | null> => {
    setBusy(label); setNotice(null);
    try { return await action(); }
    catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        try { apply(await api<PlacementView>('placement')); setNotice('Тест продолжился на другом устройстве — показываю актуальное задание.'); }
        catch { setNotice('Задание сменилось. Обнови экран.'); }
        return null;
      }
      setNotice(errorText(error, 'Не получилось. Проверь соединение и попробуй ещё раз.'));
      return null;
    } finally { setBusy(null); }
  }, [apply]);

  // Poll while the server scores (or prepares the next section).
  useInterval(() => {
    void api<PlacementView>('placement').then(next => {
      if (next.status !== state.status || next.task?.id !== state.task?.id || next.result?.attemptId !== state.result?.attemptId) apply(next);
    }).catch(() => undefined);
  }, screen.kind === 'scoring' || screen.kind === 'waiting' ? 2500 : null);

  /**
   * Resume = POST placement/start on the in-progress attempt: the server swaps a listening clip that was already
   * played (first hearing only) and a speaking prompt that was seen before the interruption for parallel ones.
   */
  async function resume(): Promise<boolean> {
    const next = await run('resume', () => api<PlacementView>('placement/start', {}));
    if (!next) return false;
    setMemory(current => ({ ...current, resumed: true, breakDismissed: true, seenIntros: [...new Set([...current.seenIntros, ...seenOnMount(next)])] }));
    apply(next);
    return true;
  }
  const resumedOnMount = useRef(false);
  useEffect(() => {
    if (resumedOnMount.current) return;
    resumedOnMount.current = true;
    // With answers already given the resume screen asks first; a fresh attempt is normalised silently.
    if (state.status === 'in-progress' && !attemptHasProgress(state)) {
      void run('resume', () => api<PlacementView>('placement/start', {})).then(next => { if (next) apply(next); });
    }
  }, [state, run, apply]);

  async function start(retake: boolean) {
    const next = await run('start', () => api<PlacementView>('placement/start', retake ? { retake: true } : {}));
    if (!next) return;
    setMemory({ resumed: true, seenIntros: seenOnMount(next), breakDismissed: false, wantsRetakeIntro: false });
    openedForRetake.current = false;
    apply(next);
  }
  async function answer(choice: number, plays: number | undefined, elapsedMs: number) {
    const task = state.task;
    if (!task) return;
    const next = await run('answer', () => api<PlacementView>('placement/answer', { taskId: task.id, choice, ...(plays !== undefined ? { plays } : {}), elapsedMs }));
    if (next) apply(next);
  }
  const submitSpeech = useCallback(async (text: string, audioFile: string) => {
    const task = state.task;
    if (!task) return null;
    return run('speak', () => api<PlacementView>('placement/speak', { taskId: task.id, text, audioFile, originalTranscript: text }));
  }, [run, state.task]);
  async function skip(section: PlacementSectionView) {
    setConfirm(null);
    recorder.release();
    const next = await run('skip', () => api<PlacementView>('placement/skip', { section: section.id, reason: 'Пропущено вручную' }));
    if (next) { setMemory(current => ({ ...current, seenIntros: [...current.seenIntros, section.id] })); apply(next); }
  }
  async function abandon() {
    setConfirm(null);
    const next = await run('abandon', () => api<PlacementView>('placement/abandon', {}));
    if (next) { setMemory({ ...initialMemory(next), resumed: true }); apply(next); }
  }
  async function rescore() {
    const next = await run('rescore', () => api<PlacementView>('placement/rescore', {}));
    if (next) apply(next);
  }
  function later() { recorder.release(); onClose(); }

  const skippable = (section: PlacementSectionView | null) => !!section && SKIPPABLE.includes(section.id) && section.status !== 'completed';
  const showProgress = state.status === 'in-progress' && screen.kind !== 'intro';
  const wide = screen.kind === 'task' && screen.task.kind === 'choice' && screen.task.section === 'reading';

  let body: ReactNode;
  switch (screen.kind) {
    case 'intro':
      body = <IntroScreen view={state} retake={screen.retake} busy={busy === 'start'} onStart={() => void start(screen.retake)}
        backToResult={screen.retake && !openedForRetake.current}
        onLater={screen.retake && !openedForRetake.current ? () => setMemory(current => ({ ...current, wantsRetakeIntro: false })) : later} />;
      break;
    case 'resume':
      body = <ResumeScreen view={state} busy={busy === 'resume'} onContinue={() => { void resume(); }}
        onLater={later} onRestart={() => setConfirm({ kind: 'abandon' })} />;
      break;
    case 'break':
      body = <BreakScreen view={state} onContinue={() => setMemory(current => ({ ...current, breakDismissed: true }))} onLater={later} />;
      break;
    case 'section-intro':
      body = <SectionIntro view={state} section={screen.section} busy={busy !== null}
        onBegin={async () => {
          if (VOICE_SECTIONS.includes(screen.section.id)) await recorder.acquire();
          setMemory(current => ({ ...current, seenIntros: [...current.seenIntros, screen.section.id] }));
        }}
        onSkip={skippable(screen.section) ? () => setConfirm({ kind: 'skip', section: screen.section }) : null} />;
      break;
    case 'task': {
      const task = screen.task;
      const onSkipSection = skippable(screen.section) && screen.section ? () => setConfirm({ kind: 'skip', section: screen.section! }) : null;
      body = (
        <div className={styles.screen}>
          <h1 className={kit.visuallyHidden} tabIndex={-1} data-autofocus>{progress.sectionTitle}: {progress.position}</h1>
          {task.kind === 'choice' ? <ChoiceTaskView key={task.id} task={task} busy={busy === 'answer'} onAnswer={(choice, plays, elapsed) => void answer(choice, plays, elapsed)} /> : null}
          {task.kind === 'speaking' ? <SpeakingTaskView key={task.id} task={task} recorder={recorder} submit={submitSpeech} advance={apply} onSkipSection={onSkipSection} /> : null}
          {task.kind === 'roleplay' ? <RoleplayTaskView key={task.id} task={task} recorder={recorder} submit={submitSpeech} advance={apply} onSkipSection={onSkipSection} /> : null}
        </div>
      );
      break;
    }
    case 'waiting':
      body = <Centered mascot="thinking" title="Готовлю следующий раздел" lead="Пара секунд — сервер подбирает задания."><p className={styles.statusLine}><Spinner /> Загружаю…</p></Centered>;
      break;
    case 'scoring':
      body = (
        <Centered mascot="thinking" title="Считаю результат" lead="Оцениваю речь и разговор. Обычно это занимает до двух минут. Можно закрыть тест — результат появится сам.">
          <p className={styles.statusLine} aria-live="polite"><Spinner /> Слушаю твои ответы ещё раз…</p>
          <div className={styles.actions}><button type="button" className={cx(kit.btn, kit.secondary)} onClick={later}>Закрыть, подожду</button></div>
        </Centered>
      );
      break;
    case 'error':
      body = (
        <Centered mascot="sad" title="Не получилось посчитать результат" lead="Ответы сохранены — ничего проходить заново не нужно.">
          <div className={cx(styles.inlineError, styles.errorBox)} role="alert"><WarningIcon size={18} weight="bold" />{screen.message}</div>
          <div className={styles.actions}>
            <button type="button" className={cx(kit.btn, kit.primary)} disabled={busy === 'rescore'} onClick={() => void rescore()}>
              {busy === 'rescore' ? <Spinner /> : <ArrowCounterClockwiseIcon size={18} weight="bold" />}Повторить подсчёт
            </button>
            <button type="button" className={cx(kit.btn, kit.quiet)} onClick={later}>Закрыть</button>
          </div>
        </Centered>
      );
      break;
    case 'result':
      body = (
        <div className={styles.screen}>
          <h1 className={kit.visuallyHidden} tabIndex={-1} data-autofocus>Результат теста уровня</h1>
          <PlacementResultView view={state} onStartPractice={() => { recorder.release(); (onDone ?? onClose)(); }}
            onRetake={() => setMemory(current => ({ ...current, wantsRetakeIntro: true }))} />
        </div>
      );
      break;
  }

  return (
    <div ref={root} className={cx(kit.scope, styles.flow)} data-wide={wide || undefined} role="dialog" aria-modal="true" aria-label="Тест уровня">
      <div className={styles.ambient} aria-hidden="true"><i /><i /></div>
      <header className={styles.header}>
        <div className={cx(kit.chrome, styles.headerBar)}>
          <div className={styles.headerTitle}>
            <strong>Тест уровня</strong>
            <span>{showProgress && progress.sectionTitle ? `${progress.sectionTitle}${progress.position && screen.kind === 'task' ? ` · ${progress.position}` : ''}`
              : screen.kind === 'result' ? 'Результат' : screen.kind === 'scoring' || screen.kind === 'error' ? 'Подсчёт результата' : '≈ 25 минут · два подхода'}</span>
          </div>
          {showProgress ? <ProgressDots view={state} /> : null}
          <div className={styles.headerEnd}>
            {screen.kind === 'result' || (screen.kind === 'intro' && screen.retake)
              ? <button type="button" className={cx(kit.btn, kit.quiet, kit.small)} onClick={later}>Закрыть</button>
              : <button type="button" className={cx(kit.btn, kit.quiet, kit.small)} onClick={later}><PauseIcon size={16} weight="fill" />Продолжу позже</button>}
          </div>
        </div>
        {showProgress ? <div className={styles.headerFraction}><ProgressBar value={progress.fraction} label="Пройдено теста" /></div> : null}
      </header>
      <main className={cx(styles.main, wide && styles.mainWide)}>
        {notice ? <div className={styles.note} role="status" style={{ marginBottom: 16 }}><WarningIcon size={18} weight="bold" />{notice}</div> : null}
        <div key={key} className={styles.fadeKey}>{body}</div>
      </main>
      <Sheet open={confirm?.kind === 'skip'} onClose={() => setConfirm(null)} title={confirm?.kind === 'skip' ? `Пропустить «${confirm.section.title}»?` : 'Пропустить раздел?'}
        footer={<>
          <button type="button" className={cx(kit.btn, kit.quiet)} onClick={() => setConfirm(null)}>Вернуться</button>
          <button type="button" className={cx(kit.btn, kit.primary)} disabled={busy === 'skip'} onClick={() => { if (confirm?.kind === 'skip') void skip(confirm.section); }}>
            <SkipForwardIcon size={18} weight="bold" />Пропустить
          </button>
        </>}>
        <p className={kit.muted} style={{ margin: 0 }}>Этот навык в результате будет «не измерено» — остальное оценим как обычно. Пересдать раздел можно в следующей попытке.</p>
      </Sheet>
      <Sheet open={confirm?.kind === 'abandon'} onClose={() => setConfirm(null)} title="Начать тест заново?"
        footer={<>
          <button type="button" className={cx(kit.btn, kit.quiet)} onClick={() => setConfirm(null)}>Вернуться</button>
          <button type="button" className={cx(kit.btn, kit.primary, kit.danger)} disabled={busy === 'abandon'} onClick={() => void abandon()}>Начать заново</button>
        </>}>
        <p className={kit.muted} style={{ margin: 0 }}>Ответы этой попытки удалятся. Прошлые результаты останутся в истории.</p>
      </Sheet>
    </div>
  );
}

/* ───────────── screens ───────────── */

function Centered({ mascot, title, lead, children }: { mascot: 'thinking' | 'sad' | 'determined' | 'happy'; title: string; lead?: string; children?: ReactNode }) {
  return (
    <div className={cx(styles.screen, styles.screenCentered)}>
      <div className={styles.mascotWrap}><FeatureMascot size={128} emotion={mascot} state={mascot === 'thinking' ? 'thinking' : 'idle'} /></div>
      <h1 className={styles.title} tabIndex={-1} data-autofocus>{title}</h1>
      {lead ? <p className={styles.lead}>{lead}</p> : null}
      {children}
    </div>
  );
}

function SectionList({ view, compact, neutral }: { view: PlacementView; compact?: boolean; neutral?: boolean }) {
  const sections = view.sections.length ? view.sections.map(section => neutral ? { ...section, status: 'pending' as const } : section) : DEFAULT_SECTIONS;
  const parts = ([1, 2] as const).map(sitting => sections.filter(section => section.sitting === sitting)).filter(list => list.length);
  return (
    <>
      {parts.map((list, index) => {
        const minutes = list.reduce((sum, section) => sum + section.minutes, 0);
        return (
          <div key={index} className={styles.partBlock}>
            <div className={styles.partHead}><span>Часть {index + 1}{index === 0 ? ' · понимание' : ' · голос'}</span><span className={kit.num}>≈ {Math.round(minutes)} мин</span></div>
            {list.map(section => {
              const SectionIcon = SECTION_ICON[section.id];
              return (
                <div key={section.id} className={styles.sectionLine} data-status={section.status}>
                  <span className={styles.sectionIcon} aria-hidden="true">{section.status === 'completed' ? <CheckIcon size={20} weight="bold" /> : <SectionIcon size={20} />}</span>
                  <span>
                    <strong>{section.title}</strong>
                    {compact ? null : <small>{section.status === 'skipped' ? section.note || 'Пропущен' : section.description}</small>}
                  </span>
                  <span className={styles.minutes}>{section.status === 'completed' ? 'готово' : section.status === 'skipped' ? 'пропущен' : `${Math.round(section.minutes)} мин`}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

function IntroScreen({ view, retake, busy, backToResult, onStart, onLater }: { view: PlacementView; retake: boolean; busy: boolean; backToResult: boolean; onStart: () => void; onLater: () => void }) {
  const note = retake ? retakeNote(view) : null;
  return (
    <div className={styles.intro}>
      <div className={styles.introText}>
        <div className={styles.mascotWrap}><FeatureMascot size={128} emotion="determined" /></div>
        <h1 className={styles.heroTitle} tabIndex={-1} data-autofocus>{retake ? 'Проверим, что изменилось' : 'Узнаем твой настоящий уровень'}</h1>
        <p className={styles.lead}>
          {retake
            ? 'Те же пять разделов, новые задания. Изменение покажу, только если оно больше погрешности теста.'
            : 'Слушание, чтение, грамматика и слова, речь и короткий рабочий созвон. По результату собеседники в практике заговорят на твоём уровне, а тренировки пойдут в слабые места.'}
        </p>
        <ul className={styles.promise}>
          <li><ClockIcon size={18} weight="bold" />Удобно в два подхода по ≈ 12 минут.</li>
          <li><PauseIcon size={18} weight="bold" />Можно прерваться — прогресс сохраняется после каждого ответа.</li>
          <li><CheckIcon size={18} weight="bold" />Во время теста нет «верно/неверно» — разбор ответов будет в результате.</li>
        </ul>
        {!view.audioAvailable ? (
          <div className={styles.note}><WarningIcon size={18} weight="bold" />Голос не подключён: слушание, речь и разговор будут пропущены, и результат получится неполным. Ключ OpenAI добавляется в Профиле.</div>
        ) : null}
        {note?.early && note.text ? <div className={styles.note}><ClockIcon size={18} weight="bold" />{note.text}</div> : null}
        <div className={styles.actions}>
          <button type="button" className={cx(kit.btn, kit.primary)} disabled={busy} onClick={onStart}>
            {busy ? <Spinner /> : null}{retake ? 'Начать пересдачу' : 'Начать тест'}{busy ? null : <ArrowRightIcon size={18} weight="bold" />}
          </button>
          <button type="button" className={cx(kit.btn, kit.quiet)} onClick={onLater}>{backToResult ? 'Назад к результату' : retake ? 'Не сейчас' : 'Продолжу позже'}</button>
        </div>
      </div>
      <div className={cx(kit.glass, styles.introCard)}>
        <SectionList view={view} neutral={retake} />
      </div>
    </div>
  );
}

function ResumeScreen({ view, busy, onContinue, onLater, onRestart }: { view: PlacementView; busy: boolean; onContinue: () => void; onLater: () => void; onRestart: () => void }) {
  const progress = progressModel(view);
  const task = view.task;
  const nextSection = task ? view.sections.find(section => section.id === (task.kind === 'choice' ? task.section : task.kind === 'speaking' ? 'speaking' : 'interaction')) : null;
  const atBreak = nextSection?.sitting === 2 && !view.sections.some(section => section.sitting === 2 && (section.answered > 0 || section.status === 'completed'));
  return (
    <div className={styles.intro}>
      <div className={styles.introText}>
        <div className={styles.mascotWrap}><FeatureMascot size={120} emotion="happy" /></div>
        <h1 className={styles.heroTitle} tabIndex={-1} data-autofocus>{atBreak ? 'Часть 1 готова. Дальше — голос' : 'Продолжим с того же места'}</h1>
        <p className={styles.lead}>
          {atBreak
            ? `С возвращением! Осталась речь и короткий рабочий созвон, ${remainingLabel(view.remainingMinutes)}. Нужны микрофон и тихое место.`
            : `С возвращением! Следующее: ${progress.sectionTitle ?? 'задание'}${progress.position ? `, ${progress.position.toLowerCase()}` : ''}. Осталось ${remainingLabel(view.remainingMinutes)}.`}
        </p>
        <div className={styles.actions}>
          <button type="button" className={cx(kit.btn, kit.primary)} disabled={busy} onClick={onContinue}>
            {busy ? <Spinner /> : null}Продолжить{busy ? null : <ArrowRightIcon size={18} weight="bold" />}
          </button>
          <button type="button" className={cx(kit.btn, kit.quiet)} onClick={onLater}>Продолжу позже</button>
        </div>
        <button type="button" className={kit.linkBtn} onClick={onRestart}>Начать тест заново</button>
      </div>
      <div className={cx(kit.glass, styles.introCard)}><SectionList view={view} compact /></div>
    </div>
  );
}

function BreakScreen({ view, onContinue, onLater }: { view: PlacementView; onContinue: () => void; onLater: () => void }) {
  const voice = view.sections.filter(section => section.sitting === 2);
  const minutes = Math.round(voice.reduce((sum, section) => sum + (section.status === 'skipped' ? 0 : section.minutes), 0));
  return (
    <Centered mascot="happy" title="Первая часть готова" lead={`Дальше — речь и короткий рабочий созвон, ≈ ${minutes || 10} мин. Понадобятся микрофон и тихое место. Можно сделать перерыв: прогресс сохранён.`}>
      <div className={styles.actions}>
        <button type="button" className={cx(kit.btn, kit.primary)} onClick={onContinue}>Продолжить сейчас<ArrowRightIcon size={18} weight="bold" /></button>
        <button type="button" className={cx(kit.btn, kit.secondary)} onClick={onLater}><CoffeeIcon size={18} weight="bold" />Продолжу позже</button>
      </div>
    </Centered>
  );
}

function SectionIntro({ view, section, busy, onBegin, onSkip }: {
  view: PlacementView; section: PlacementSectionView; busy: boolean; onBegin: () => Promise<void>; onSkip: (() => void) | null;
}) {
  const [starting, setStarting] = useState(false);
  const SectionIcon = SECTION_ICON[section.id];
  const index = view.sections.findIndex(item => item.id === section.id);
  const voice = VOICE_SECTIONS.includes(section.id);
  return (
    <div className={cx(styles.screen, styles.screenCentered)}>
      <div className={cx(kit.glass, styles.sectionCard)}>
        <span className={styles.sectionBadge}><SectionIcon size={30} weight="bold" /></span>
        <div className={styles.sectionHead}>
          <h1 className={styles.title} tabIndex={-1} data-autofocus>{section.title}</h1>
          <p className={styles.sectionPlace}>Часть {section.sitting}, раздел {index + 1} из {view.sections.length}</p>
        </div>
        {section.description ? <p className={styles.lead}>{section.description}</p> : null}
        <p className={styles.tip}>{SECTION_TIPS[section.id]}</p>
        <ul className={styles.meta}>
          <li><ClockIcon size={16} weight="bold" aria-hidden="true" />≈ {Math.round(section.minutes)} мин</li>
          {section.planned ? <li>{section.id === 'interaction' ? `${section.planned} реплики` : section.id === 'speaking' ? `${section.planned} задания` : `до ${section.planned} вопросов`}</li> : null}
          {voice ? <li><MicrophoneIcon size={16} weight="bold" aria-hidden="true" />Нужен микрофон</li> : null}
        </ul>
        <div className={styles.actions}>
          <button type="button" className={cx(kit.btn, kit.primary)} disabled={busy || starting}
            onClick={async () => { setStarting(true); try { await onBegin(); } finally { setStarting(false); } }}>
            {starting ? <Spinner /> : null}Начать раздел{starting ? null : <ArrowRightIcon size={18} weight="bold" />}
          </button>
          {onSkip ? <button type="button" className={cx(kit.btn, kit.quiet)} onClick={onSkip}><SkipForwardIcon size={18} weight="bold" />Пропустить раздел</button> : null}
        </div>
      </div>
    </div>
  );
}

function ProgressDots({ view }: { view: PlacementView }) {
  const model = progressModel(view);
  return (
    <div className={styles.progress} aria-label={`Пройдено разделов: ${view.sections.filter(section => section.status === 'completed' || section.status === 'skipped').length} из ${view.sections.length}`} role="img">
      {model.groups.map(group => (
        <div key={group.sitting} className={styles.part}>
          <span className={styles.partLabel}>{group.label}</span>
          <span className={styles.dots}>
            {group.dots.map(dot => <i key={dot.id} className={styles.dot} data-status={dot.status} data-current={dot.current} title={dot.title} />)}
          </span>
        </div>
      ))}
    </div>
  );
}
