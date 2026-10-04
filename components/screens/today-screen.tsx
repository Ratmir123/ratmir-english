'use client';

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowRightIcon, ArrowsClockwiseIcon, CaretRightIcon, ClockCounterClockwiseIcon, MegaphoneIcon, PhoneCallIcon, PlayIcon,
  SparkleIcon, UploadSimpleIcon, WarningCircleIcon,
} from '@phosphor-icons/react';
import type { Mode } from '@/lib/types';
import { lessonBudget } from '@/lib/lesson-budget';
import { subscriptionView } from '@/lib/subscription-view';
import { PlacementLevelCard } from '../placement/placement-result';
import { PatternsPanel } from '../calls/patterns-panel';
import { useApp } from '../app/app-context';
import { greeting, longDate, MODE_HINT, MODE_LABEL, sessionStatusLabel, sessionTone, shortDate } from '../app/labels';
import { failedCalls, laterSessions, processingCalls, todayPrimary, type TodayPrimary } from '../app/today-plan';
import { WeeklyRhythm } from './weekly-rhythm';
import { Companion } from '../shell/companion';
import { Segmented } from '../ui/segmented';
import { rankProgress, RankMedal, XpBar } from '../ui/rewards';
import styles from './today.module.css';

let greetedThisLaunch = false;

function ModeChoice({ value, onChange, fixed }: { value: Mode; onChange: (mode: Mode) => void; fixed?: string | null }) {
  if (fixed) return <span className="chip">{fixed}</span>;
  return <div className={styles.mode}>
    <Segmented label="Режим занятия" value={value} onChange={onChange} options={[{ id: 'learning', label: MODE_LABEL.learning }, { id: 'call', label: MODE_LABEL.call }]} />
    <small>{MODE_HINT[value]}</small>
  </div>;
}

function PrimaryCard({ primary }: { primary: TodayPrimary }) {
  const app = useApp();
  const { data, lesson } = app;
  const minutes = lessonBudget(data.state?.profile.dailyMinutes ?? 15);
  const busy = !!lesson.busy || !!lesson.starting;
  const recommendation = primary.kind === 'plan' ? primary.recommendation : null;
  const textActivity = recommendation && ['reading', 'writing'].includes(recommendation.activity);
  const [mode, setMode] = useState<Mode>(() => primary.kind === 'drill' ? (primary.drill.tier >= 2 ? 'call' : 'learning') : recommendation?.preferredMode ?? 'learning');

  let eyebrow = '', title = '', why = '', detail: ReactNode = null, cta = 'Начать', icon = <PlayIcon size={18} weight="fill" />;
  let run: () => void = () => {};
  let tone = 'violet';
  switch (primary.kind) {
    case 'placement': {
      const view = primary.view;
      eyebrow = primary.retake ? 'ПЕРЕСДАЧА ТЕСТА' : 'ТЕСТ УРОВНЯ';
      title = view.status === 'scoring' ? 'Считаем твой результат' : view.status === 'error' ? 'Результат не посчитался' : 'Узнаем твой настоящий уровень';
      why = view.status === 'scoring' ? 'Речь и рабочий разговор оценивает Sol. Это займёт пару минут — можно заниматься дальше.'
        : view.status === 'error' ? (view.error || 'Ответы сохранены. Попробуй посчитать ещё раз.')
          : 'Слушать, читать, говорить и короткий рабочий разговор. По результату подберём собеседников и тренировки.';
      cta = view.status === 'in-progress' ? 'Продолжить тест' : view.status === 'scoring' ? 'Открыть тест' : view.status === 'error' ? 'Посчитать снова' : 'Начать тест';
      detail = <>
        <div className={styles.chips}><span className="chip glassy"><ClockCounterClockwiseIcon size={14} />~{Math.max(5, view.remainingMinutes || 25)} мин</span><span className="chip glassy">5 частей · можно в два захода</span></div>
        {view.status === 'in-progress' && primary.planned > 0 && <div className="progress-track" role="progressbar" aria-label="Пройдено в тесте" aria-valuemin={0} aria-valuemax={primary.planned} aria-valuenow={primary.answered} style={{ '--value': primary.answered / primary.planned } as CSSProperties}><span /></div>}
        {!view.audioAvailable && <p className="caption">Голосовой ключ не подключён: части на слух и речь пропустим, их можно пройти позже.</p>}
      </>;
      run = app.openPlacement; tone = 'lime';
      break;
    }
    case 'continue': {
      const session = primary.session;
      eyebrow = 'ПРОДОЛЖИТЬ';
      title = session.lesson.title;
      why = session.status === 'review' ? 'Разбор готов — сделай улучшенную попытку.'
        : session.status === 'analysing' ? 'Разбор готовится. Он откроется здесь, как только будет готов.'
          : session.status === 'error' ? (session.analysis ? 'Разбор нужно пересчитать.' : 'Разбор не получился. Ответы сохранены — повтори разбор.')
            : 'Разговор не закончен — продолжи с того же места.';
      cta = session.status === 'review' ? 'Открыть разбор' : session.status === 'error' ? 'Повторить разбор' : session.status === 'analysing' ? 'Открыть' : 'Продолжить';
      detail = <div className={styles.chips}><span className={`chip ${sessionTone(session) === 'neutral' ? '' : sessionTone(session)}`}>{sessionStatusLabel(session)}</span><span className="chip glassy">{MODE_LABEL[session.mode]}</span></div>;
      run = () => lesson.open(session, 'today'); tone = session.status === 'review' ? 'lime' : 'violet';
      break;
    }
    case 'call': {
      eyebrow = 'СОЗВОН'; title = primary.call.title;
      why = 'Подтверди, кто из собеседников ты — и разбор продолжится.';
      cta = 'Подтвердить'; icon = <PhoneCallIcon size={18} weight="fill" />;
      run = () => app.go('calls', { callId: primary.call.id }); tone = 'cyan';
      break;
    }
    case 'drill': {
      const drill = primary.drill;
      eyebrow = primary.call ? 'ТРЕНИРОВКА ИЗ СОЗВОНА' : 'ТРЕНИРОВКА ДЛЯ ТЕБЯ';
      title = drill.title; why = drill.why;
      detail = <>
        {drill.goal && <p className={styles.goal}><strong>Цель:</strong> {drill.goal}</p>}
        <ModeChoice value={mode} onChange={setMode} />
      </>;
      run = () => app.startDrill(drill.id, mode); tone = 'lime';
      break;
    }
    case 'plan': {
      const value = primary.recommendation;
      eyebrow = 'ПЛАН НА СЕГОДНЯ'; title = value.title; why = value.why;
      detail = <>
        <div className={styles.chips}><span className="chip glassy"><ClockCounterClockwiseIcon size={14} />{minutes} мин</span></div>
        <ModeChoice value={mode} onChange={setMode} fixed={textActivity ? (value.activity === 'writing' ? 'Письменное задание' : 'Чтение и ответ') : null} />
      </>;
      run = () => value.drillId ? app.startDrill(value.drillId, mode) : app.start({ familyId: value.familyId, mode, from: 'today' });
      break;
    }
    default: {
      eyebrow = 'СВОБОДНЫЙ РАЗГОВОР'; title = 'Поговорим о том, что тебе интересно';
      why = 'Выбери тему — собеседник подстроится, а разбор покажет, что усилить.';
      cta = 'Выбрать тему'; run = () => app.openFamily(null, true);
    }
  }
  return <section className={`glass interactive ${styles.primary}`} data-tone={tone} aria-labelledby="today-primary-title" data-testid="today-primary">
    <span className="eyebrow">{eyebrow}</span>
    <h2 id="today-primary-title" className="title-28">{title}</h2>
    {why && <p className={styles.why}>{why}</p>}
    {detail}
    <div className={styles.primaryActions}>
      <button type="button" className="button primary large" onClick={run} disabled={busy && primary.kind !== 'continue' && primary.kind !== 'placement'} data-testid="today-primary-action">
        {icon}{lesson.starting ? 'Готовлю…' : cta}<ArrowRightIcon size={18} />
      </button>
      {busy && primary.kind !== 'continue' && primary.kind !== 'placement' && <span className="disabled-reason">{lesson.starting ? 'Занятие уже готовится.' : 'Подожди, идёт действие.'}</span>}
    </div>
  </section>;
}

function StatusStrip() {
  const app = useApp();
  const state = app.data.state!;
  const busy = processingCalls(state).filter(call => call.status !== 'awaiting-upload');
  const failed = failedCalls(state);
  if (!busy.length && !failed.length) return null;
  return <div className={styles.strip}>
    {busy.map(call => <button key={call.id} type="button" className={`glass flat ${styles.stripRow}`} onClick={() => app.go('calls', { callId: call.id })}>
      <span className={styles.stripIcon} data-tone="cyan"><ArrowsClockwiseIcon size={18} /></span>
      <span className={styles.stripCopy}><strong>{call.title}</strong><small>{call.progress?.stage ?? 'Созвон обрабатывается'}{call.progress ? ` · ${Math.round(call.progress.percent)}%` : ''}</small></span>
      <CaretRightIcon size={16} />
    </button>)}
    {failed.map(call => <button key={call.id} type="button" className={`glass flat ${styles.stripRow}`} onClick={() => app.go('calls', { callId: call.id })}>
      <span className={styles.stripIcon} data-tone="warning"><WarningCircleIcon size={18} /></span>
      <span className={styles.stripCopy}><strong>{call.title}</strong><small>Не удалось обработать — открой, чтобы повторить</small></span>
      <CaretRightIcon size={16} />
    </button>)}
  </div>;
}

function QuickActions() {
  const app = useApp();
  const pitch = useMemo(() => {
    const families = app.catalog?.flatMap(section => section.families) ?? [];
    return families.find(family => family.id === 'strategy-pitch-30') ?? families.find(family => family.id.startsWith('strategy-pitch')) ?? null;
  }, [app.catalog]);
  const busy = !!app.lesson.busy || !!app.lesson.starting;
  const actions = [
    { id: 'upload', icon: UploadSimpleIcon, title: 'Загрузить созвон', note: 'Разберу и подберу тренировки', run: () => app.go('calls') },
    ...(pitch ? [{ id: 'pitch', icon: MegaphoneIcon, title: 'Питч за 30 секунд', note: 'Кто ты и почему ты', run: () => app.start({ familyId: pitch.id, mode: pitch.preferredMode, context: pitch.context, from: 'today' as const }) }] : []),
    { id: 'free', icon: SparkleIcon, title: 'Свободная тема', note: 'Разговор о своём', run: () => app.openFamily(null, true) },
  ];
  return <section aria-label="Быстрые действия" className={styles.quick}>
    {actions.map((action, index) => <button key={action.id} type="button" className={`glass interactive press reveal ${styles.quickTile}`} style={{ '--i': index } as CSSProperties}
      onClick={action.run} disabled={busy && action.id === 'pitch'}>
      <span className={styles.quickIcon} aria-hidden="true"><action.icon size={22} weight="duotone" /></span>
      <span className={styles.quickCopy}><strong>{action.title}</strong><small>{action.note}</small></span>
    </button>)}
  </section>;
}

function LaterList() {
  const app = useApp();
  const later = laterSessions(app.data.state!);
  if (!later.length) return null;
  return <details className={`glass flat ${styles.later}`}>
    <summary><span><strong>Незаконченные</strong> <span className="caption">· {later.length}</span></span><CaretRightIcon size={16} className={styles.caret} /></summary>
    <ul>{later.slice(0, 8).map(session => <li key={session.id}>
      <button type="button" onClick={() => app.lesson.open(session, 'today')}>
        <span className={styles.laterCopy}><strong>{session.lesson.title}</strong><small>{sessionStatusLabel(session)} · {shortDate(session.updatedAt)}</small></span>
        <CaretRightIcon size={16} />
      </button>
    </li>)}</ul>
  </details>;
}

function LevelCard() {
  const app = useApp();
  const state = app.data.state!;
  const progression = state.progression;
  return <section className={`glass ${styles.side}`} aria-labelledby="today-level">
    <div className="section-title"><h2 id="today-level">Уровень</h2><button type="button" className="text-button" onClick={() => app.go('progress')}>Прогресс<ArrowRightIcon size={15} /></button></div>
    {/* Before the first result the test is Today's primary card; its own «Начать» here would compete with it. */}
    {state.placement?.result && <PlacementLevelCard view={state.placement} onOpen={() => app.go('progress')} onStart={app.openPlacement} />}
    {progression && <div className={styles.rank}>
      <RankMedal level={progression.level} size={60} />
      <div className={styles.rankCopy}><strong>{rankProgress(progression).band.title}</strong><small>Уровень опыта {progression.level} · за практику, не за язык</small>
        <XpBar value={progression} compact target /></div>
    </div>}
  </section>;
}

function WorkingOn() {
  const app = useApp();
  const state = app.data.state!;
  const patterns = (state.patterns ?? []).filter(pattern => !pattern.dismissed && pattern.kind === 'weakness' && ['active', 'improving'].includes(pattern.status))
    .sort((a, b) => a.costRank - b.costRank).slice(0, 2);
  if (!patterns.length) return null;
  // W3's compact panel is a complete card with its own «Над чем работаем» heading; the shell only adds the way to all patterns.
  return <div className={styles.patterns}>
    <PatternsPanel patterns={patterns} drills={state.drills ?? []} onStartDrill={app.startDrill} compact onChanged={() => void app.data.refresh()} />
    <button type="button" className={`text-button ${styles.patternsLink}`} onClick={() => app.go('calls')}>Все<ArrowRightIcon size={15} /></button>
  </div>;
}

function LimitsWarning() {
  const app = useApp();
  const view = subscriptionView(app.data.usage);
  const low = view.windows.find(window => window.low);
  if (!low) return null;
  return <button type="button" className={`banner warning ${styles.limits}`} onClick={() => app.go('profile')}>
    <WarningCircleIcon size={18} weight="fill" /><span className="banner-copy"><strong>{low.exhausted ? 'Лимит подписки исчерпан' : 'Лимит подписки почти исчерпан'}</strong><span className="caption">{low.resetRelative || 'Подробности в профиле'}</span></span>
  </button>;
}

export function TodayScreen() {
  const app = useApp();
  const state = app.data.state!;
  const primary = useMemo(() => todayPrimary(state), [state]);
  const [hello] = useState(() => { const first = !greetedThisLaunch; greetedThisLaunch = true; return first; });
  const primaryKey = primary.kind + ':' + (primary.kind === 'continue' ? primary.session.id : primary.kind === 'drill' ? primary.drill.id : primary.kind === 'plan' ? primary.recommendation.familyId + (primary.recommendation.drillId ?? '') : primary.kind === 'call' ? primary.call.id : '');
  return <div className={`screen ${styles.today}`} data-screen="today">
    <header className={styles.hero}>
      <div className={styles.heroCopy}>
        <span className="eyebrow">{longDate(new Date())}</span>
        <h1 tabIndex={-1} data-screen-heading>{greeting(state.profile.name)}</h1>
        <p className="muted">{primary.kind === 'placement' && !primary.retake ? 'Начнём с теста уровня — потом всё подстроится под тебя.' : 'Один шаг на сегодня. Остальное — по желанию.'}</p>
      </div>
      <div className={styles.heroMascot}>
        <Companion state="idle" emotion={primary.kind === 'placement' && primary.view.status === 'scoring' ? 'thinking' : undefined} greeting={hello}
          status="Твой собеседник. Потрогай его" />
      </div>
    </header>
    <div className={styles.grid}>
      <div className={styles.main}>
        <PrimaryCard key={primaryKey} primary={primary} />
        <StatusStrip />
        <QuickActions />
        <LaterList />
        <WeeklyRhythm state={state} headingId="today-rhythm" />
      </div>
      <aside className={styles.aside} aria-label="Твой прогресс">
        <LimitsWarning />
        <LevelCard />
        <WorkingOn />
      </aside>
    </div>
  </div>;
}
