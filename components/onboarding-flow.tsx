'use client';

import { useState, type ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, Check, Clock, Ear, Microphone, Play, SlidersHorizontal } from '@phosphor-icons/react';
import { SKILLS, type AppState, type BaselineReport, type BaselineStepId, type OnboardingState, type Session } from '@/lib/types';
import { VoiceOrb } from './voice-orb';
import styles from './onboarding-flow.module.css';

type OnboardingProps = {
  state: AppState; onboarding: OnboardingState; busy: string; audioReady: boolean;
  onIntro: (russianControl: string) => void; onStart: (stepId: BaselineStepId) => void;
  onResume: (session: Session) => void; onSettings: () => void;
};

export function OnboardingFlow({ state, onboarding, busy, audioReady, onIntro, onStart, onResume, onSettings }: OnboardingProps) {
  const [russianControl, setRussianControl] = useState(onboarding.russianControl || '');
  const [confirmed, setConfirmed] = useState(false);
  const pending = !!busy;
  if (onboarding.status === 'intro') return <section className={styles.intro} data-testid="onboarding-intro">
    <div className={styles.welcome}>
      <VoiceOrb state={pending ? 'thinking' : 'idle'} emotion="friendly" statusDescription="Знакомимся перед первой практикой" />
      <span className="eyebrow">ТВОЙ ЛИЧНЫЙ ТРЕНЕР</span>
      <h1>{state.profile.name.trim() ? `${state.profile.name}, сначала познакомимся.` : 'Сначала познакомимся.'}</h1>
      <p>Ты уже понимаешь английский. Теперь проверим, что получается говорить самому и как ты ведёшь разговор.</p>
      <div className={styles.features}><span><Microphone size={19} />Живой разговор голосом</span><span><Ear size={19} />Слушать и подхватывать</span><span><SlidersHorizontal size={19} />Практика под твой прогресс</span></div>
      <div className={styles.note}><Clock size={19} /><div><strong>Три коротких разговора</strong><p>Около 20 минут. Можно пройти по одному. Ошибки помогают выбрать тренировку, хорошая оценка не обязательна.</p></div></div>
      <button className="text-button" onClick={onSettings}>Голос и настройки<ArrowUpRight size={15} /></button>
    </div>
    <form className={styles.control} onSubmit={event => { event.preventDefault(); if (!pending && confirmed && russianControl.trim().length >= 20) onIntro(russianControl.trim()); }}>
      <span className="eyebrow">СНАЧАЛА БЕЗ ЯЗЫКОВОГО БАРЬЕРА</span><h2>Как бы ты ответил по-русски?</h2>
      <p className={styles.prompt}>{onboarding.russianPrompt}</p>
      <label htmlFor="russian-control">Твоя обычная реакция</label>
      <textarea id="russian-control" data-testid="russian-control" lang="ru" rows={5} value={russianControl} maxLength={2000} onChange={event => setRussianControl(event.target.value)} disabled={pending} placeholder="Как ответил бы знакомому…" />
      <small>Напиши 2–4 предложения. Это короткая точка сравнения: поможет отличать языковую трудность от привычки вести разговор. По одному ответу выводы будут предварительными.</small>
      <label className={styles.confirmation}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={pending} /><span>На стартовой проверке отвечаю своими словами. Ошибаться нормально.</span></label>
      <button className="button primary" data-testid="confirm-intro" disabled={pending || !confirmed || russianControl.trim().length < 20}>{busy || 'Начать знакомство с уровнем'}<ArrowRight size={18} /></button>
    </form>
  </section>;

  return <section className={styles.baseline} data-testid="baseline-flow">
    <div className={styles.baselineHeading}><div><span className="eyebrow">СТАРТОВАЯ ПРОВЕРКА</span><h1>Узнаем, как ты говоришь.</h1><p>Без заготовок и подсказок. Сначала твои настоящие ответы, потом стартовый профиль.</p></div><div className={styles.stageCount}><strong>{onboarding.completedStages}<small>/3</small></strong><span>этапа с наблюдениями</span></div></div>
    {!audioReady && <div className={styles.audioNotice}><Microphone size={21} /><div><strong>Для проверки нужен голос</strong><p>Подключи озвучку и микрофон. По переписке нельзя проверить понимание на слух и твою самостоятельную речь.</p></div><button className="button primary" onClick={onSettings}>Настроить голос<ArrowRight size={17} /></button></div>}
    <ol className={styles.steps}>{onboarding.steps.map((step, index) => {
      const current = state.sessions.find(value => value.id === step.sessionId);
      const resumable = current && (current.status === 'active' || current.status === 'error' || current.status === 'analysing');
      const available = index === 0 || onboarding.steps.slice(0, index).every(previous => previous.status === 'ready');
      const ready = step.status === 'ready';
      return <li className={styles.step} data-ready={ready} key={step.id} data-testid={'baseline-step-' + step.id}>
        <span className={styles.stepNumber}>{ready ? <Check size={20} /> : String(index + 1).padStart(2, '0')}</span>
        <div className={styles.stepCopy}><span className="eyebrow">{ready ? 'НАБЛЮДЕНИЯ СОХРАНЕНЫ' : step.status === 'analysing' ? 'РАЗБОР ГОТОВИТСЯ' : resumable ? 'МОЖНО ПРОДОЛЖИТЬ' : available ? 'СЛЕДУЮЩИЙ ЭТАП' : 'ЧУТЬ ПОЗЖЕ'}</span><h2>{step.title}</h2><p>{step.focus}</p>
          {step.missingEvidence && !resumable && <p className={styles.missingEvidence}>{step.missingEvidence}</p>}
          {current && (ready || !resumable) && <button className="text-button" disabled={pending} onClick={() => onResume(current)}>Посмотреть свою попытку<ArrowUpRight size={15} /></button>}
        </div>
        <div className={styles.stepAction}><span><Clock size={14} />{step.minutes} мин.</span>{!ready && <button className="button primary" disabled={pending || !available || (!audioReady && !resumable)} onClick={() => resumable ? onResume(current) : onStart(step.id)}><Play size={16} />{pending && available ? busy : resumable ? current.status === 'analysing' ? 'Открыть разбор' : 'Продолжить' : step.missingEvidence ? 'Новый короткий эпизод' : 'Начать'}</button>}</div>
      </li>;
    })}</ol>
    <p className={styles.baselineNote}>Каждый этап нужен для наблюдений. Низкая оценка не мешает двигаться дальше. Исправленная расшифровка сохраняется честно, но может потребоваться ещё один самостоятельный ответ голосом.</p>
    <button className="text-button" onClick={onSettings}>Голос и настройки<ArrowUpRight size={15} /></button>
  </section>;
}

export function BaselineProfile({ report, busy, disabled, activity, onBuild, onOpenEvidence }: { report: BaselineReport | null; busy: string; disabled?: boolean; activity?: ReactNode; onBuild: () => void; onOpenEvidence: (sessionId: string) => void }) {
  if (!report) return <section className={styles.reportInvitation} data-testid="baseline-report-pending"><div><span className="eyebrow">СТАРТОВЫЙ ПРОФИЛЬ</span><h2>Три разговора пройдены.</h2><p>Соберём наблюдения о твоём английском и самом разговоре. Практику уже можно продолжать.</p>{activity}</div><button className="button primary" disabled={disabled || !!busy} onClick={onBuild}>{busy || 'Показать стартовый профиль'}<ArrowRight size={18} /></button></section>;
  return <section className={styles.report} data-testid="baseline-report">
    <div className={styles.reportHeading}><span className="eyebrow">СТАРТОВЫЙ ПРОФИЛЬ</span><span className="quiet-tag">Предварительная оценка</span></div>
    <h2>Отсюда начнём расти.</h2><p className={styles.reportSummary}>{report.summary}</p>
    {report.cefr ? <div className={styles.cefr}><strong>{report.cefr.from === report.cefr.to ? report.cefr.from : `${report.cefr.from}–${report.cefr.to}`}</strong><div><span>Предварительный диапазон CEFR</span><p>{report.cefr.scope}</p><small>{report.cefr.reason} Это не результат сертификационного экзамена.</small></div></div> : <p className={styles.reportLimitation}>Пока недостаточно оснований для диапазона CEFR. Ниже есть наблюдения по конкретным навыкам.</p>}
    <div className={styles.reportPriorities}><h3>С чего начинаем</h3><ol>{report.priorities.map((priority, index) => <li key={index}>{priority}</li>)}</ol></div>
    <details><summary>На чём основана оценка</summary>{report.skills.map(skill => <section className={styles.skillEvidence} key={skill.skill}><h3>{SKILLS.find(value => value.id === skill.skill)?.label || skill.skill}</h3><span className="caption">{skill.confidence === 'unobserved' ? 'Не наблюдалось' : skill.confidence === 'limited' ? 'Пока мало данных' : 'Несколько согласованных наблюдений'}</span><p>{skill.observation}</p>{skill.evidence.map((evidence, index) => <button className={styles.evidence} key={index} onClick={() => onOpenEvidence(evidence.sessionId)}><q lang="en">{evidence.quote}</q><span>Открыть исходную попытку<ArrowUpRight size={14} /></span></button>)}</section>)}</details>
    <details><summary>Английский и привычки разговора</summary><p>{report.languageVsCommunication.observation}</p><blockquote>{report.languageVsCommunication.russianQuote}</blockquote><small>{report.languageVsCommunication.limitation}</small></details>
    <details><summary>Что пока нельзя оценить</summary>{report.limitations.map((limitation, index) => <p key={index}>{limitation}</p>)}</details>
    <div className={styles.nextFocus}><strong>Следующий шаг</strong><p>{report.nextFocus}</p></div>
  </section>;
}
