'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ArrowRightIcon, CaretRightIcon, DownloadSimpleIcon, MagnifyingGlassIcon, TrashIcon } from '@phosphor-icons/react';
import { SKILLS, type AppState, type SkillState } from '@/lib/types';
import { PlacementLevelCard, PlacementResultView } from '../placement/placement-result';
import { useApp } from '../app/app-context';
import { MODE_LABEL, SKILL_GROUPS, SKILL_STATE_LABEL, sessionStatusLabel, sessionTone, shortDate } from '../app/labels';
import { Segmented } from '../ui/segmented';
import { Achievements, rankProgress, RankLadder, RankMedal, XpBar } from '../ui/rewards';
import { WeeklyRhythm } from './weekly-rhythm';
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

function Skills({ state }: { state: AppState }) {
  const app = useApp();
  const observed = state.skills.filter(skill => skill.state !== 'unknown' || skill.examples.length > 0).length;
  return <div className={styles.stack}>
    <p className="caption">Наблюдения есть по {observed} из {SKILLS.length - 1} навыков. Четыре отметки: с опорой → самостоятельно → в новой ситуации → держится спустя время. «Говорить понятно» по тексту не оцениваем.</p>
    {SKILL_GROUPS.map(group => <section key={group.id} className={`glass ${styles.card}`} aria-labelledby={`skills-${group.id}`}>
      <h2 id={`skills-${group.id}`}>{group.title}</h2>
      <ul className={styles.skillList}>{SKILLS.filter(skill => skill.group === group.id).map(skill => {
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
    <div className={styles.historyTools}>
      <label className={styles.search}><MagnifyingGlassIcon size={18} aria-hidden="true" /><span className="visually-hidden">Найти занятие</span>
        <input type="search" placeholder="Найти по названию или цели" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <a className="button secondary" href="/api/export" download><DownloadSimpleIcon size={17} />Скачать историю</a>
    </div>
    {!state.sessions.length && <div className={`glass ${styles.empty}`}><strong>Пока пусто</strong><p className="caption">Твоя попытка, разбор и улучшенная версия сохранятся здесь.</p>
      <button type="button" className="button secondary" onClick={() => app.go('practice')}>К практике<ArrowRightIcon size={16} /></button></div>}
    {state.sessions.length > 0 && !sessions.length && <div className={`glass ${styles.empty}`}><strong>Ничего не нашлось</strong><button type="button" className="text-button" onClick={() => setSearch('')}>Показать всё</button></div>}
    <ul className={styles.history}>{sessions.map((session, index) => <li key={session.id} className="reveal" style={{ '--i': Math.min(index, 6) } as CSSProperties}>
      <button type="button" className={styles.historyOpen} onClick={() => app.lesson.open(session, 'progress')}>
        <span className={styles.historyCopy}><strong>{session.lesson.title}</strong>
          <small>{shortDate(session.createdAt)} · {MODE_LABEL[session.mode]} · <span className={`chip ${sessionTone(session) === 'neutral' ? '' : sessionTone(session)}`}>{sessionStatusLabel(session)}</span></small></span>
        <CaretRightIcon size={16} />
      </button>
      {confirming === session.id
        ? <span className={styles.confirm}><button type="button" className="button small danger" onClick={async () => { setConfirming(null); await app.lesson.deleteSession(session.id); }}>Удалить</button>
          <button type="button" className="button small secondary" onClick={() => setConfirming(null)}>Отмена</button></span>
        : <button type="button" className="icon-button plain" aria-label={`Удалить занятие «${session.lesson.title}»`} onClick={() => setConfirming(session.id)}><TrashIcon size={18} /></button>}
    </li>)}</ul>
  </div>;
}

export function ProgressScreen() {
  const app = useApp();
  const state = app.data.state!;
  const progression = state.progression;
  const [section, setSection] = useState<Section>(app.nav.progressSection.id);
  useEffect(() => { if (app.nav.progressSection.nonce) setSection(app.nav.progressSection.id); }, [app.nav.progressSection]);
  const placement = state.placement;
  const totals = useMemo(() => progression ? [
    { label: 'практик с разбором', value: progression.completedPractice },
    { label: 'дней с практикой', value: progression.practiceDays },
    { label: 'XP за практику', value: progression.xp },
  ] : [], [progression]);
  return <div className="screen" data-screen="progress">
    <header className="screen-header">
      <div><h1 tabIndex={-1} data-screen-heading style={{ outline: 'none' }}>Прогресс</h1><p className="lede">Уровень по тесту, опыт по практике — это разные шкалы.</p></div>
    </header>
    <div className={styles.top}>
      {placement && <div className={styles.level} aria-label="Уровень английского">
        <PlacementLevelCard view={placement} onOpen={() => { setSection('overview'); setTimeout(() => document.getElementById('progress-placement')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 80); }} onStart={app.openPlacement} />
      </div>}
      {progression && <section className={`glass ${styles.card} ${styles.rankCard}`} aria-labelledby="progress-rank">
        <RankMedal level={progression.level} size={84} interactive label={`Ранг «${rankProgress(progression).band.title}»`} />
        <div className={styles.rankCopy}><span className="eyebrow">Ранг опыта</span><h2 id="progress-rank">{rankProgress(progression).band.title}</h2>
          <XpBar value={progression} target /></div>
      </section>}
    </div>
    <Segmented kind="tabs" label="Разделы прогресса" value={section} onChange={setSection} options={SECTIONS} controls="progress" />
    <div id={`progress-${section}`} role="tabpanel" aria-labelledby={`progress-tab-${section}`} className={styles.panel}>
      {section === 'overview' && <div className={styles.stack}>
        {totals.length > 0 && <div className={styles.totals}>{totals.map(item => <div key={item.label} className={`glass flat ${styles.total}`}><strong className="number">{item.value}</strong><span className="caption">{item.label}</span></div>)}</div>}
        <WeeklyRhythm state={state} headingId="progress-rhythm" />
        {placement?.result && <section id="progress-placement" className={`glass ${styles.card}`} aria-label="Результат теста уровня">
          <PlacementResultView view={placement} onRetake={app.openPlacement} onStartPractice={() => app.go('practice')} />
        </section>}
        {!progression?.completedPractice && <p className="caption">Опыт растёт за каждую практику с разбором, тест уровня и разобранные созвоны: 15 XP за занятие, +5 за улучшенную попытку.</p>}
      </div>}
      {section === 'skills' && <Skills state={state} />}
      {section === 'history' && <History state={state} />}
      {section === 'rewards' && progression && <div className={styles.stack}>
        <Achievements value={progression} state={state} onTarget={app.onAchievementTarget} />
        <section className={`glass ${styles.card}`} aria-labelledby="progress-ladder"><h2 id="progress-ladder">Ранги опыта</h2><RankLadder value={progression} /></section>
      </div>}
    </div>
  </div>;
}
