'use client';

import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowRightIcon, ArrowsClockwiseIcon, CaretRightIcon, ClockCounterClockwiseIcon, MegaphoneIcon, PhoneCallIcon, PlayIcon,
  SparkleIcon, WarningCircleIcon,
} from '@phosphor-icons/react';
import type { AppState, Mode, Session } from '@/lib/types';
import type { PlacementView } from '@/lib/placement/types';
import { lessonBudget } from '@/lib/lesson-budget';
import { subscriptionView } from '@/lib/subscription-view';
import { PlacementLevelCard } from '../placement/placement-result';
import { PatternsPanel } from '../calls/patterns-panel';
import { CallUploadCard } from '../calls/upload-call';
import { useApp } from '../app/app-context';
import { messageOf, request } from '../app/api';
import { greeting, MODE_HINT, MODE_LABEL, sessionStatusLabel, sessionTone, shortDate } from '../app/labels';
import { failedCalls, laterSessions, processingCalls, todayPrimary, weeklyRhythm, type TodayPrimary } from '../app/today-plan';
import { WeeklyRhythm } from './weekly-rhythm';
import { Companion, type MascotEmotion } from '../shell/companion';
import type { ToastAction } from '../shell/toasts';
import { useShellRevealed } from '../ui/entrance';
import { Segmented } from '../ui/segmented';
import { rankProgress, RankMedal } from '../ui/rewards';
import styles from './today.module.css';

let greetedThisLaunch = false;
/** The hero companion says hello once the shell is actually seen (after the launch layer), as its block settles. */
const HERO_GREET_DELAY_MS = 380;

function todayLine(now = new Date()) {
  const text = new Intl.DateTimeFormat('ru', { weekday: 'long', day: 'numeric', month: 'long' }).format(now);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The hero companion's mood follows the day's task (MOTION-PASS-0.5.2 §3): test not taken → curious; a drill or a
 * plan ready → determined; a review ready → excited; practised today → proud; otherwise happy.
 */
function heroEmotion(state: AppState, primary: TodayPrimary): MascotEmotion {
  if (primary.kind === 'placement') return 'curious';
  if (primary.kind === 'drill' || primary.kind === 'plan') return 'determined';
  if (primary.kind === 'continue' && primary.session.status === 'review') return 'excited';
  if (weeklyRhythm(state).days.some(day => day.today && day.count > 0)) return 'proud';
  return 'happy';
}

/* «Убрать» on an unfinished lesson (MOTION-PASS-0.5.2 §8.4): the row disappears at once, a toast offers «Вернуть» for
   ≈ 6 s, and only then is the lesson deleted. Kept outside the screen so a pending removal survives a tab switch. */
const UNDO_MS = 6000;
const removals = new Map<string, { timer: ReturnType<typeof setTimeout>; committing: boolean }>();
let removalIds: ReadonlySet<string> = new Set();
const removalListeners = new Set<() => void>();
const NO_REMOVALS: ReadonlySet<string> = new Set();
function publishRemovals() { removalIds = new Set(removals.keys()); removalListeners.forEach(listener => listener()); }
function subscribeRemovals(listener: () => void) { removalListeners.add(listener); return () => { removalListeners.delete(listener); }; }
function scheduleRemoval(id: string, commit: () => Promise<unknown>) {
  if (removals.has(id)) return;
  const entry = { committing: false, timer: setTimeout(() => {
    entry.committing = true;
    void commit().catch(() => undefined).finally(() => { removals.delete(id); publishRemovals(); });
  }, UNDO_MS) };
  removals.set(id, entry);
  publishRemovals();
}
function cancelRemoval(id: string) {
  const entry = removals.get(id);
  if (!entry || entry.committing) return;
  clearTimeout(entry.timer);
  removals.delete(id);
  publishRemovals();
}
const usePendingRemovals = () => useSyncExternalStore(subscribeRemovals, () => removalIds, () => NO_REMOVALS);

function ModeChoice({ value, onChange, fixed }: { value: Mode; onChange: (mode: Mode) => void; fixed?: string | null }) {
  if (fixed) return <span className="chip outline">{fixed}</span>;
  return <div className={styles.mode}>
    <Segmented label="Режим занятия" value={value} onChange={onChange} options={[{ id: 'learning', label: MODE_LABEL.learning }, { id: 'call', label: MODE_LABEL.call }]} />
    <small>{MODE_HINT[value]}</small>
  </div>;
}

/** The one task of the day on the inverted (graphite) surface: title, why, the few facts that matter, one action. */
function PrimaryCard({ primary }: { primary: TodayPrimary }) {
  const app = useApp();
  const { data, lesson } = app;
  const minutes = lessonBudget(data.state?.profile.dailyMinutes ?? 15);
  const busy = !!lesson.busy || !!lesson.starting;
  const recommendation = primary.kind === 'plan' ? primary.recommendation : null;
  const textActivity = recommendation && ['reading', 'writing'].includes(recommendation.activity);
  const [mode, setMode] = useState<Mode>(() => primary.kind === 'drill' ? (primary.drill.tier >= 2 ? 'call' : 'learning') : recommendation?.preferredMode ?? 'learning');
  const [rescoring, setRescoring] = useState(false);
  // «Посчитать снова» recalculates right here (MOTION-PASS-0.5.2 §8.11); Today then shows the scoring status row.
  const rescore = async () => {
    if (rescoring) return;
    setRescoring(true);
    try {
      const next = await request<PlacementView>('placement/rescore', {});
      data.setState(previous => previous ? { ...previous, placement: next } : previous);
    } catch (error) { app.toast.error(messageOf(error, 'Не удалось запустить подсчёт. Попробуй ещё раз.')); }
    finally { setRescoring(false); }
  };

  let title = '', why = '', facts: ReactNode = null, detail: ReactNode = null, cta = 'Начать', icon = <PlayIcon size={18} weight="fill" />;
  let run: () => void = () => {};
  switch (primary.kind) {
    case 'placement': {
      // While the test is being scored it is a status row (StatusStrip), never the day's card.
      const view = primary.view;
      title = view.status === 'error' ? 'Результат не посчитался' : primary.retake ? 'Пересдача теста уровня' : 'Узнаем твой настоящий уровень';
      why = view.status === 'error' ? (view.error || 'Ответы сохранены. Попробуй посчитать ещё раз.')
        : 'Слушать, читать, говорить и короткий рабочий разговор. По результату подберём собеседников и тренировки.';
      cta = view.status === 'in-progress' ? 'Продолжить тест' : view.status === 'error' ? 'Посчитать снова' : 'Начать тест';
      if (view.status === 'error') { icon = <ArrowsClockwiseIcon size={18} />; run = () => void rescore(); }
      else {
        facts = <><span><ClockCounterClockwiseIcon size={15} aria-hidden="true" />~{Math.max(5, view.remainingMinutes || 25)} мин</span><span>5 частей, можно в два захода</span></>;
        run = app.openPlacement;
      }
      detail = <>
        {view.status === 'in-progress' && primary.planned > 0 && <div className="progress-track lime" role="progressbar" aria-label="Пройдено в тесте" aria-valuemin={0} aria-valuemax={primary.planned} aria-valuenow={primary.answered} style={{ '--value': primary.answered / primary.planned } as CSSProperties}><span /></div>}
        {!view.audioAvailable && view.status !== 'error' && <p className="caption">Голосовой ключ не подключён: части на слух и речь пропустим, их можно пройти позже.</p>}
      </>;
      break;
    }
    case 'continue': {
      const session = primary.session;
      title = session.lesson.title;
      why = session.status === 'review' ? 'Разбор готов — сделай улучшенную попытку.'
        : session.status === 'analysing' ? 'Разбор готовится. Он откроется здесь, как только будет готов.'
          : session.status === 'error' ? (session.analysis ? 'Разбор нужно пересчитать.' : 'Разбор не получился. Ответы сохранены — повтори разбор.')
            : 'Разговор не закончен — продолжи с того же места.';
      cta = session.status === 'review' ? 'Открыть разбор' : session.status === 'error' ? 'Повторить разбор' : session.status === 'analysing' ? 'Открыть' : 'Продолжить';
      const tone = sessionTone(session);
      facts = <>{tone !== 'neutral' && session.status !== 'active' && <span className={`chip ${tone}`}>{sessionStatusLabel(session)}</span>}<span>{MODE_LABEL[session.mode]}</span><span>{shortDate(session.updatedAt)}</span></>;
      run = () => lesson.open(session, 'today');
      break;
    }
    case 'call': {
      title = primary.call.title;
      why = 'Подтверди, кто из собеседников ты — и разбор созвона продолжится.';
      cta = 'Подтвердить'; icon = <PhoneCallIcon size={18} weight="fill" />;
      run = () => app.go('calls', { callId: primary.call.id });
      break;
    }
    case 'drill': {
      const drill = primary.drill;
      title = drill.title; why = drill.why;
      facts = primary.call ? <span><PhoneCallIcon size={15} aria-hidden="true" />Из созвона «{primary.call.title}»</span> : <span>Тренировка по твоим паттернам</span>;
      detail = <>
        {drill.goal && <p className={styles.goal}><strong>Цель:</strong> {drill.goal}</p>}
        <ModeChoice value={mode} onChange={setMode} />
      </>;
      run = () => app.startDrill(drill.id, mode);
      break;
    }
    case 'plan': {
      const value = primary.recommendation;
      title = value.title; why = value.why;
      facts = <span><ClockCounterClockwiseIcon size={15} aria-hidden="true" />{minutes} мин</span>;
      detail = <ModeChoice value={mode} onChange={setMode} fixed={textActivity ? (value.activity === 'writing' ? 'Письменное задание' : 'Чтение и ответ') : null} />;
      run = () => value.drillId ? app.startDrill(value.drillId, mode) : app.start({ familyId: value.familyId, mode, from: 'today' });
      break;
    }
    default: {
      title = 'Поговорим о том, что тебе интересно';
      why = 'Выбери тему — собеседник подстроится, а разбор покажет, что усилить.';
      cta = 'Выбрать тему'; run = () => app.openFamily(null, true);
    }
  }
  const blocked = busy && primary.kind !== 'continue' && primary.kind !== 'placement';
  return <section className={`surface ink ${styles.primary}`} aria-labelledby="today-primary-title" data-testid="today-primary" data-enter>
    <h2 id="today-primary-title" className="title-28">{title}</h2>
    {why && <p className={styles.why}>{why}</p>}
    {facts && <p className={styles.facts}>{facts}</p>}
    {detail}
    <div className={styles.primaryActions}>
      <button type="button" className="button primary large" onClick={run} disabled={blocked || rescoring} data-testid="today-primary-action">
        {icon}{rescoring ? 'Запускаю подсчёт…' : lesson.starting ? 'Готовлю…' : cta}<ArrowRightIcon size={18} />
      </button>
      {blocked && <span className="disabled-reason">{lesson.starting ? 'Занятие уже готовится.' : 'Подожди, идёт действие.'}</span>}
    </div>
  </section>;
}

/** Things that are being prepared elsewhere, one row each: the level test being scored, calls in work or failed. */
function StatusStrip() {
  const app = useApp();
  const state = app.data.state!;
  const scoring = state.placement?.status === 'scoring';
  const busy = processingCalls(state).filter(call => call.status !== 'awaiting-upload');
  const failed = failedCalls(state);
  if (!scoring && !busy.length && !failed.length) return null;
  return <div className={`surface flat rows ${styles.strip}`} data-enter>
    {scoring && <button type="button" className={styles.row} onClick={app.openPlacement}>
      <span className={styles.rowIcon} data-tone="cyan"><ArrowsClockwiseIcon size={20} /></span>
      <span className={styles.rowCopy}><strong>Тест уровня</strong><small>Считаем результат — около двух минут</small></span>
      <CaretRightIcon size={16} className={styles.chevron} />
    </button>}
    {busy.map(call => <button key={call.id} type="button" className={styles.row} onClick={() => app.go('calls', { callId: call.id })}>
      <span className={styles.rowIcon} data-tone="cyan"><ArrowsClockwiseIcon size={20} /></span>
      <span className={styles.rowCopy}><strong>{call.title}</strong><small>{call.progress?.stage ?? 'Созвон обрабатывается'}{call.progress ? ` · ${Math.round(call.progress.percent)}%` : ''}</small></span>
      <CaretRightIcon size={16} className={styles.chevron} />
    </button>)}
    {failed.map(call => <button key={call.id} type="button" className={styles.row} onClick={() => app.go('calls', { callId: call.id })}>
      <span className={styles.rowIcon} data-tone="warning"><WarningCircleIcon size={20} /></span>
      <span className={styles.rowCopy}><strong>{call.title}</strong><small>Не удалось обработать — открой, чтобы повторить</small></span>
      <CaretRightIcon size={16} className={styles.chevron} />
    </button>)}
  </div>;
}

/** Everything else you can start right now, as one list: a call upload (drop target), the pitch drill, your own topic. */
function QuickActions() {
  const app = useApp();
  const pitch = useMemo(() => {
    const families = app.catalog?.flatMap(section => section.families) ?? [];
    return families.find(family => family.id === 'strategy-pitch-30') ?? families.find(family => family.id.startsWith('strategy-pitch')) ?? null;
  }, [app.catalog]);
  const busy = !!app.lesson.busy || !!app.lesson.starting;
  const actions = [
    ...(pitch ? [{ id: 'pitch', icon: MegaphoneIcon, title: 'Питч за 30 секунд', note: 'Кто ты и почему именно ты', run: () => app.start({ familyId: pitch.id, mode: pitch.preferredMode, context: pitch.context, from: 'today' as const }) }] : []),
    { id: 'free', icon: SparkleIcon, title: 'Своя тема', note: 'Разговор о том, что интересно', run: () => app.openFamily(null, true) },
  ];
  return <section className={`surface ${styles.quick}`} aria-labelledby="today-quick" data-enter>
    <h2 id="today-quick" className={styles.blockTitle}>Быстрый старт</h2>
    <div className="rows">
      <CallUploadCard variant="compact" onCreated={id => app.go('calls', { callId: id })} />
      {actions.map(action => <button key={action.id} type="button" className={styles.row} onClick={action.run} disabled={busy && action.id === 'pitch'}>
        <span className={styles.rowIcon} aria-hidden="true"><action.icon size={20} /></span>
        <span className={styles.rowCopy}><strong>{action.title}</strong><small>{action.note}</small></span>
        <CaretRightIcon size={16} className={styles.chevron} />
      </button>)}
    </div>
  </section>;
}

function LaterList() {
  const app = useApp();
  const removing = usePendingRemovals();
  const later = laterSessions(app.data.state!).filter(session => !removing.has(session.id));
  if (!later.length) return null;
  const remove = (session: Session) => {
    scheduleRemoval(session.id, () => app.lesson.deleteSession(session.id));
    const undo: ToastAction = { label: 'Вернуть', run: () => cancelRemoval(session.id), life: UNDO_MS };
    app.toast.notice('Занятие убрано', undo);
  };
  return <details className={`surface flat ${styles.later}`} data-enter>
    <summary><span className={styles.rowCopy}><strong>Незаконченные занятия</strong><small>{later.length} — можно вернуться в любой момент</small></span><CaretRightIcon size={16} className={styles.caret} /></summary>
    <ul className="rows">{later.slice(0, 8).map(session => <li key={session.id} className={styles.laterRow}>
      <button type="button" className={styles.row} onClick={() => app.lesson.open(session, 'today')}>
        <span className={styles.rowCopy}><strong>{session.lesson.title}</strong><small>{sessionStatusLabel(session)} · {shortDate(session.updatedAt)}</small></span>
      </button>
      <button type="button" className={`text-button muted ${styles.removeLater}`} onClick={() => remove(session)}
        aria-label={`Убрать занятие «${session.lesson.title}»`}>Убрать</button>
    </li>)}</ul>
  </details>;
}

function LevelCard() {
  const app = useApp();
  const state = app.data.state!;
  const progression = state.progression;
  const rank = progression ? rankProgress(progression) : null;
  return <section className={`surface ${styles.side}`} aria-labelledby="today-level" data-enter>
    <div className="section-title"><h2 id="today-level" className={styles.blockTitle}>Уровень</h2><button type="button" className="text-button" onClick={() => app.go('progress')}>Прогресс<ArrowRightIcon size={15} /></button></div>
    {/* Before the first result the test is Today's primary card; its own «Начать» here would compete with it. */}
    {state.placement?.result && <PlacementLevelCard view={state.placement} onOpen={() => app.go('progress')} onStart={app.openPlacement} embedded />}
    {progression && rank && <button type="button" className={styles.rank} onClick={() => app.go('progress', { progress: 'rewards' })}
      aria-label={`Ранг «${rank.band.title}», уровень опыта ${progression.level}, ${progression.xp} XP. Открыть награды`}>
      <RankMedal level={progression.level} size={64} />
      <span className={styles.rankCopy}>
        <strong>{rank.band.title}<small> · ур. {progression.level}</small></strong>
        <span className="progress-track lime" aria-hidden="true" style={{ '--value': rank.ratio } as CSSProperties}><span /></span>
        <small className="tabular">{progression.xp} XP{rank.next ? ` · до «${rank.next.title}» ${rank.toNext}` : ''}</small>
      </span>
    </button>}
    {progression && <p className="footnote">Опыт — за практику, не за язык. Языковой уровень меняет только тест.</p>}
  </section>;
}

function WorkingOn() {
  const app = useApp();
  const state = app.data.state!;
  const patterns = (state.patterns ?? []).filter(pattern => !pattern.dismissed && pattern.kind === 'weakness' && ['active', 'improving'].includes(pattern.status))
    .sort((a, b) => a.costRank - b.costRank).slice(0, 2);
  if (!patterns.length) return null;
  // The wrapper is the staircase block (the panel belongs to the calls feature).
  return <div data-enter>
    <PatternsPanel patterns={patterns} drills={state.drills ?? []} onStartDrill={app.startDrill} compact onChanged={() => void app.data.refresh()} onOpenAll={() => app.go('calls')} />
  </div>;
}

function LimitsWarning() {
  const app = useApp();
  const view = subscriptionView(app.data.usage);
  const low = view.windows.find(window => window.low);
  if (!low) return null;
  return <button type="button" className={`banner warning ${styles.limits}`} onClick={() => app.go('profile')} data-enter>
    <WarningCircleIcon size={18} weight="fill" /><span className="banner-copy"><strong>{low.exhausted ? 'Лимит подписки исчерпан' : 'Лимит подписки почти исчерпан'}</strong><span className="caption">{low.resetRelative || 'Подробности в профиле'}</span></span>
  </button>;
}

export function TodayScreen() {
  const app = useApp();
  const state = app.data.state!;
  const primary = useMemo(() => {
    const value = todayPrimary(state);
    // While the test is being scored it waits in the status row; the day's card is the next thing to do.
    return value.kind === 'placement' && value.view.status === 'scoring' ? todayPrimary({ ...state, placement: undefined }) : value;
  }, [state]);
  const [hello] = useState(() => { const first = !greetedThisLaunch; greetedThisLaunch = true; return first; });
  // Greeting hop only where it is seen: after the launch layer has handed over (never under it), as the hero settles.
  const revealed = useShellRevealed();
  const [greet, setGreet] = useState(false);
  useEffect(() => {
    if (!hello || !revealed) return;
    const timer = setTimeout(() => setGreet(true), HERO_GREET_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hello, revealed]);
  const primaryKey = primary.kind + ':' + (primary.kind === 'continue' ? primary.session.id : primary.kind === 'drill' ? primary.drill.id : primary.kind === 'plan' ? primary.recommendation.familyId + (primary.recommendation.drillId ?? '') : primary.kind === 'call' ? primary.call.id : primary.kind === 'placement' ? primary.view.status : '');
  return <div className={`screen ${styles.today}`} data-screen="today">
    <header className={styles.hero} data-enter>
      <div className={styles.heroCopy}>
        <h1 tabIndex={-1} data-screen-heading>{greeting(state.profile.name)}</h1>
        <p className="muted">{todayLine()} · {primary.kind === 'placement' && !primary.retake ? 'начнём с теста уровня, потом всё подстроится под тебя.' : 'один шаг на сегодня, остальное — по желанию.'}</p>
      </div>
      <div className={styles.heroMascot}>
        <Companion state="idle" emotion={heroEmotion(state, primary)} greeting={greet} status="Твой собеседник. Потрогай его" />
      </div>
    </header>
    <div className={styles.grid}>
      <div className={styles.main}>
        <PrimaryCard key={primaryKey} primary={primary} />
        <StatusStrip />
        <QuickActions />
        <LaterList />
      </div>
      <aside className={styles.aside} aria-label="Твой прогресс">
        <LimitsWarning />
        <LevelCard />
        <WorkingOn />
        <WeeklyRhythm state={state} headingId="today-rhythm" />
      </aside>
    </div>
  </div>;
}
