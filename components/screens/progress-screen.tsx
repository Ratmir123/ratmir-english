'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { ArrowRightIcon, CaretRightIcon, DownloadSimpleIcon, MagnifyingGlassIcon, TrashIcon } from '@phosphor-icons/react';
import { SKILLS, type AppState, type ProgressionState, type SkillState } from '@/lib/types';
import { PlacementLevelCard, PlacementResultView } from '../placement/placement-result';
import { useApp } from '../app/app-context';
import { count, MODE_LABEL, SKILL_GROUPS, SKILL_STATE_LABEL, sessionStatusLabel, sessionTone, shortDate } from '../app/labels';
import { weeklyRhythm } from '../app/today-plan';
import { ScreenMascot } from '../shell/screen-mascot';
import { Segmented } from '../ui/segmented';
import { Achievements, rankProgress, RankLadder, RankMedal, XpBar } from '../ui/rewards';
import styles from './progress.module.css';

type Section = 'overview' | 'skills' | 'history' | 'rewards';
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'overview', label: 'Обзор' }, { id: 'skills', label: 'Навыки' }, { id: 'history', label: 'История' }, { id: 'rewards', label: 'Награды' },
];

function SkillSteps({ value }: { value: SkillState | undefined }) {
  const steps = [
    { lit: !!value && (value.state === 'supported' || value.independentSuccesses > 0 || value.state === 'provisional' || value.state === 'independent'), title: 'Получается с опорой' },
    { lit: value?.state === 'independent', title: 'Самостоятельно' },
    { lit: !!value?.transfer, title: 'В новой ситуации' },
    { lit: !!value?.retention, title: 'Держится спустя время' },
  ];
  return <span className={styles.steps} role="img" aria-label={steps.map(step => `${step.title}: ${step.lit ? 'да' : 'пока нет'}`).join(', ')}>
    {steps.map(step => <i key={step.title} data-lit={step.lit} title={step.title} />)}
  </span>;
}

/** Experience rank: the second scale next to the test level. Practice facts are one sentence, not metric tiles. */
function RankCard({ progression, state, onRewards }: { progression: ProgressionState; state: AppState; onRewards: () => void }) {
  const rank = rankProgress(progression);
  const week = weeklyRhythm(state);
  const facts = progression.completedPractice
    ? `${count(progression.completedPractice, ['практика', 'практики', 'практик'])} с разбором, ${count(progression.practiceDays, ['день', 'дня', 'дней'])} с практикой. На этой неделе — ${week.activeDays} из 7.`
    : 'Опыт растёт за каждую практику с разбором, тест уровня и разобранные созвоны: 15 XP за занятие, +5 за улучшенную попытку.';
  return <section className={`surface ${styles.rank}`} aria-labelledby="progress-rank">
    <div className={styles.rankGrid}>
      <div className={styles.rankMedal}><RankMedal level={progression.level} size={104} interactive label={`Ранг «${rank.band.title}»`} /></div>
      <div className={styles.rankTitle}>
        <h2 id="progress-rank">{rank.band.title}</h2>
        <p className="caption">Ранг опыта — растёт от практики, не от языка</p>
      </div>
      <div className={styles.rankBody}>
        <XpBar value={progression} target />
        <p className={styles.rankFacts}>{facts}</p>
        <button type="button" className="text-button" onClick={onRewards}>Награды и ранги<ArrowRightIcon size={15} /></button>
      </div>
    </div>
  </section>;
}

function Skills({ state }: { state: AppState }) {
  const app = useApp();
  const observed = state.skills.filter(skill => skill.state !== 'unknown' || skill.examples.length > 0).length;
  return <div className={styles.stack}>
    <p className={styles.intro} data-enter>Наблюдения из практики есть по {observed} из {SKILLS.length - 1} навыков. Четыре отметки: получается с опорой → самостоятельно → в новой ситуации → держится спустя время. «Говорить понятно» по тексту не оцениваем.</p>
    {SKILL_GROUPS.map(group => <section key={group.id} className={`surface ${styles.group}`} aria-labelledby={`skills-${group.id}`} data-enter>
      <h2 id={`skills-${group.id}`}>{group.title}</h2>
      <ul className={`rows ${styles.skillList}`}>{SKILLS.filter(skill => skill.group === group.id).map(skill => {
        const value = state.skills.find(item => item.id === skill.id);
        const clarity = skill.id === 'clarity';
        return <li key={skill.id} className={styles.skill}>
          <div className={styles.skillHead}>
            <span className={styles.skillCopy}><strong>{skill.label}</strong><small>{clarity ? 'Произношение по расшифровке не оцениваем' : SKILL_STATE_LABEL[value?.state ?? 'unknown']}</small></span>
            {!clarity && <SkillSteps value={value} />}
          </div>
          {!!value?.examples.length && <details className={styles.evidence}><summary>На чём основано · {value.examples.length}<CaretRightIcon size={14} /></summary>
            <ul>{value.examples.slice(0, 3).map((example, index) => {
              const source = state.sessions.find(session => session.id === example.sessionId);
              return <li key={index}><q lang="en">{example.quote}</q><span className="caption">{example.reason}</span>
                {source && <button type="button" className="text-button" onClick={() => app.lesson.open(source, 'progress')}>Открыть занятие<ArrowRightIcon size={14} /></button>}</li>;
            })}</ul>
          </details>}
        </li>;
      })}</ul>
    </section>)}
  </div>;
}

function History({ state }: { state: AppState }) {
  const app = useApp();
  const [search, setSearch] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  useEffect(() => { if (!confirming) return; const timer = setTimeout(() => setConfirming(null), 6000); return () => clearTimeout(timer); }, [confirming]);
  const query = search.trim().toLowerCase();
  const sessions = [...state.sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter(session => !query || (session.lesson.title + ' ' + session.lesson.goal).toLowerCase().includes(query));
  return <div className={styles.stack}>
    <div className={styles.historyTools} data-enter>
      <label className={styles.search}><MagnifyingGlassIcon size={18} aria-hidden="true" /><span className="visually-hidden">Найти занятие</span>
        <input type="search" placeholder="Найти по названию или цели" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <a className="button secondary" href="/api/export" download><DownloadSimpleIcon size={17} />Скачать историю</a>
    </div>
    {!state.sessions.length && <div className={`surface ${styles.empty}`} data-enter><strong>Пока пусто</strong><p className="caption">Твоя попытка, разбор и улучшенная версия сохранятся здесь.</p>
      <button type="button" className="button secondary" onClick={() => app.go('practice')}>К практике<ArrowRightIcon size={16} /></button></div>}
    {state.sessions.length > 0 && !sessions.length && <div className={`surface ${styles.empty} reveal`}><strong>Ничего не нашлось</strong><button type="button" className="text-button" onClick={() => setSearch('')}>Показать всё</button></div>}
    {sessions.length > 0 && <ul className={`surface rows ${styles.history}`} aria-label="Занятия" data-enter>{sessions.map((session, index) => {
      const tone = sessionTone(session);
      return <li key={session.id} className="reveal" style={{ '--i': Math.min(index, 6) } as CSSProperties}>
        <button type="button" className={styles.historyOpen} onClick={() => app.lesson.open(session, 'progress')}>
          <span className={styles.historyCopy}><strong>{session.lesson.title}</strong>
            {/* A pill only for a state that still changes; a finished session is plain text. */}
            <small>{shortDate(session.createdAt)} · {MODE_LABEL[session.mode]}{tone === 'neutral' ? ` · ${sessionStatusLabel(session)}` : null}
              {tone !== 'neutral' && <span className={`chip ${tone}`}>{sessionStatusLabel(session)}</span>}</small></span>
          <CaretRightIcon size={16} className={styles.chevron} />
        </button>
        {confirming === session.id
          ? <span className={styles.confirm}><button type="button" className="button small danger" onClick={async () => { setConfirming(null); await app.lesson.deleteSession(session.id); }}>Удалить</button>
            <button type="button" className="button small secondary" onClick={() => setConfirming(null)}>Отмена</button></span>
          : <button type="button" className={`icon-button plain ${styles.remove}`} aria-label={`Удалить занятие «${session.lesson.title}»`} onClick={() => setConfirming(session.id)}><TrashIcon size={18} /></button>}
      </li>;
    })}</ul>}
  </div>;
}

function Rewards({ progression, state }: { progression: ProgressionState; state: AppState }) {
  const app = useApp();
  const opened = progression.achievements.filter(item => item.unlocked).length;
  const rank = rankProgress(progression);
  return <div className={styles.stack}>
    <section className={styles.block} aria-labelledby="progress-achievements" data-enter>
      <div className={styles.blockHead}><h2 id="progress-achievements">Достижения</h2><span className="caption">Открыто {opened} из {progression.achievements.length}</span></div>
      <Achievements value={progression} state={state} onTarget={app.onAchievementTarget} />
    </section>
    <section className={`surface ${styles.group}`} aria-labelledby="progress-ladder" data-enter>
      <div className={styles.blockHead}><h2 id="progress-ladder">Ранги опыта</h2><span className="caption">Сейчас «{rank.band.title}», {progression.xp} XP</span></div>
      <RankLadder value={progression} />
    </section>
  </div>;
}

export function ProgressScreen() {
  const app = useApp();
  const state = app.data.state!;
  const progression = state.progression;
  const [section, setSectionValue] = useState<Section>(app.nav.progressSection.id);
  // A section picked here (not the screen's arrival) slides its panel in softly; the arrival runs the staircase.
  const [switched, setSwitched] = useState(false);
  const setSection = (value: Section) => { setSectionValue(value); setSwitched(true); };
  useEffect(() => { if (app.nav.progressSection.nonce) { setSectionValue(app.nav.progressSection.id); setSwitched(true); } }, [app.nav.progressSection]);
  const placement = state.placement;
  // The header companion (MOTION-PASS-0.5.2 §3): proud of any progress, sleepy while there is none yet.
  const hasProgress = (progression?.xp ?? 0) > 0 || !!placement?.result || state.sessions.some(session => session.status === 'completed');
  const rankCard = progression ? <RankCard progression={progression} state={state} onRewards={() => setSection('rewards')} /> : null;
  return <div className={`screen ${styles.progress}`} data-screen="progress">
    <header className="screen-header with-mascot" data-enter>
      <div><h1 tabIndex={-1} data-screen-heading style={{ outline: 'none' }}>Прогресс</h1><p className="lede">Уровень английского меняет только тест, опыт растёт от практики.</p></div>
      <ScreenMascot emotion={hasProgress ? 'proud' : 'sleepy'} fluid className="screen-mascot" />
    </header>
    <div className={styles.tabs} data-enter><Segmented kind="tabs" label="Разделы прогресса" value={section} onChange={setSection} options={SECTIONS} controls="progress" /></div>
    {/* Overview is one block in the staircase; the other sections mark their own surfaces. */}
    <div key={section} id={`progress-${section}`} role="tabpanel" aria-labelledby={`progress-tab-${section}`} className={styles.panel}
      data-switched={switched || undefined} data-enter={section === 'overview' ? '' : undefined}>
      {section === 'overview' && (placement?.result
        // Level and why (hero) next to the experience rank, then what to do next, then the details — one place each.
        ? <PlacementResultView view={placement} onRetake={app.openPlacement} onStartPractice={() => app.go('practice')} aside={rankCard} />
        : <div className={styles.pair}>
          {placement && <PlacementLevelCard view={placement} onOpen={app.openPlacement} onStart={app.openPlacement} />}
          {rankCard}
        </div>)}
      {section === 'skills' && <Skills state={state} />}
      {section === 'history' && <History state={state} />}
      {section === 'rewards' && (progression
        ? <Rewards progression={progression} state={state} />
        : <p className={styles.intro} data-enter>Награды появятся после первой практики с разбором.</p>)}
    </div>
  </div>;
}
