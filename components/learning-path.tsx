'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowRightIcon, ArrowUpRightIcon, CheckIcon, FlagIcon, LockSimpleIcon, MedalIcon, TargetIcon, XIcon } from '@phosphor-icons/react';
import { SKILLS, type LearningTrackId, type PracticeResult, type ProgressionState, type Session } from '@/lib/types';
import styles from './learning-path.module.css';
import { VoiceOrb } from './voice-orb';

const ratio = (current: number, target: number) => Math.min(1, Math.max(0, target > 0 ? current / target : 0));
const shortDate = (value: string) => new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' }).format(new Date(value));
const SEEN_KEY = 'ratmir:completed-moments:v1';

function ProgressLine({ current, target, label }: { current: number; target: number; label: string }) {
  return <div className={styles.line} role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(current, target)} aria-label={label}>
    <span style={{ transform: `scaleX(${ratio(current, target)})` }} />
  </div>;
}

export function PracticeLevel({ value, compact = false }: { value: ProgressionState; compact?: boolean }) {
  return <section className={`${styles.level} ${compact ? styles.compact : ''}`} aria-label="Уровень практики" data-testid="practice-level">
    <div className={styles.levelHeading}><span className={styles.levelMark}>{value.level}</span><div><span className={styles.kicker}>УРОВЕНЬ ПРАКТИКИ</span><h3>{value.levelTitle}</h3></div><span className={styles.xp}>{value.xp} <small>XP</small></span></div>
    <ProgressLine current={value.xpInLevel} target={value.nextLevelXP - value.levelFloorXP} label="Практика до следующего уровня" />
    <div className={styles.lineLabels}><span>{value.xpToNextLevel} XP до следующего уровня</span><span>Завершено: {value.completedPractice}</span></div>
    <p className={styles.note}>XP отмечает практику. Языковой уровень подтверждают твои ответы.</p>
  </section>;
}

export function CurriculumOverview({ value, onChoose }: { value: ProgressionState; onChoose: (track: LearningTrackId) => void }) {
  return <section className={styles.curriculum} aria-labelledby="curriculum-title">
    <div className={styles.sectionHeading}><div><span className={styles.kicker}>ТВОЙ МАРШРУТ</span><h2 id="curriculum-title">Практика с понятной целью</h2></div><FlagIcon size={24} aria-hidden="true" /></div>
    <p className={styles.note}>Один навык в разных ситуациях. Выбирай направление, Sol подберёт задачу по твоим последним ответам.</p>
    <div className={styles.trackList}>{value.tracks.map(track => <button key={track.id} className={styles.trackRow} onClick={() => onChoose(track.id)}>
      <span className={`${styles.trackMark} ${track.id === 'ielts-foundation' ? styles.ieltsMark : ''}`} aria-hidden="true">{track.id === 'ielts-foundation' ? 'I' : track.id === 'life' ? '01' : track.id === 'work' ? '02' : '03'}</span>
      <span className={styles.trackCopy}><strong>{track.title}</strong><small>{track.description}</small></span>
      <span className={styles.trackCount}>{track.completedSessions}<small>/{track.targetSessions}</small></span><ArrowUpRightIcon size={18} aria-hidden="true" />
    </button>)}</div>
    <p className={styles.note}>Числа после дроби задают стартовые ориентиры практики. Они не означают, что курс освоен или ты готов к экзамену.</p>
  </section>;
}

export function EvidenceCoverage({ value }: { value: ProgressionState }) {
  const coverage = value.evidenceCoverage;
  return <section className={styles.coverage} aria-label="На чём основан прогресс">
    <div><span className={styles.kicker}>ОСНОВАНИЯ ОЦЕНКИ</span><h2>{coverage.observedSkills} из {coverage.observableSkills} навыков с наблюдениями</h2><p className={styles.note}>Это покрытие проверок. Трудность и частичный ответ тоже помогают выбрать следующую задачу.</p></div>
    <dl className={styles.facts}><div><dt>Самостоятельных успехов</dt><dd>{coverage.independentSuccesses}</dd></div><div><dt>Наблюдений с опорой</dt><dd>{coverage.supportedObservations}</dd></div><div><dt>Частично получилось</dt><dd>{coverage.partial}</dd></div><div><dt>Есть трудность</dt><dd>{coverage.difficulty}</dd></div></dl>
  </section>;
}

export function Achievements({ value }: { value: ProgressionState }) {
  const [all, setAll] = useState(false);
  const unlocked = value.achievements.filter(item => item.unlocked)
    .sort((a, b) => (b.unlockedAt || '').localeCompare(a.unlockedAt || ''));
  const upcoming = value.achievements.filter(item => !item.unlocked)
    .sort((a, b) => ratio(b.current, b.target) - ratio(a.current, a.target));
  const ordered = [...unlocked, ...upcoming];
  const recent = unlocked.slice(0, 2);
  const visible = all ? ordered : [...recent, ...upcoming.slice(0, 4 - recent.length)];
  return <section className={styles.achievements} aria-labelledby="achievement-title" data-testid="achievements">
    <div className={styles.sectionHeading}><div><span className={styles.kicker}>РУБЕЖИ ПРАКТИКИ</span><h2 id="achievement-title">Есть к чему вернуться</h2></div><MedalIcon size={25} aria-hidden="true" /></div>
    <p className={styles.note}>Каждая отметка объясняет, что именно ты сделал. Можно раскрыть её условие. Дневные рубежи считаются по UTC.</p>
    <div className={styles.achievementList}>{visible.map(item => <details key={item.id} className={styles.achievement} data-unlocked={item.unlocked}>
      <summary><span className={styles.achievementIcon}>{item.unlocked ? <MedalIcon size={20} weight="fill" /> : <TargetIcon size={20} />}</span><span><strong>{item.title}</strong><small>{item.unlocked ? 'Получено' : `${item.current} из ${item.target}`}</small></span><span className={styles.achievementState}>{item.unlocked ? <CheckIcon size={18} /> : <LockSimpleIcon size={17} />}</span></summary>
      <div className={styles.achievementDetail}><p>{item.description}</p><ProgressLine current={item.current} target={item.target} label={item.title} /><span className={styles.note}>{item.current} / {item.target}{item.unlockedAt ? ` · ${shortDate(item.unlockedAt)}` : ''}</span></div>
    </details>)}</div>
    {ordered.length > 4 && <button type="button" className="text-button" onClick={() => setAll(previous => !previous)} aria-expanded={all}>{all ? 'Свернуть рубежи' : `Все рубежи (${ordered.length})`}<ArrowRightIcon size={16} /></button>}
  </section>;
}

/** A confirmed action creates the moment; opening history never does. */
export function SessionOutcome({ session, result, progression, confirmed, previousUnlocks, onNext, onDone }: {
  session: Session; result?: PracticeResult; progression?: ProgressionState;
  confirmed: boolean; previousUnlocks: string[]; onNext: () => void; onDone: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const consumed = useRef(false);
  const unlocked = progression?.achievements.filter(item => item.unlocked && !previousUnlocks.includes(item.id)) || [];
  const burstRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!confirmed || !result || consumed.current || session.status !== 'completed' || session.retryDeferred) return;
    consumed.current = true;
    let seen: string[] = [];
    try { const stored: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); if (Array.isArray(stored)) seen = stored.filter((value): value is string => typeof value === 'string').slice(-500); } catch { /* The mounted moment is still consumed once. */ }
    if (seen.includes(session.id)) return;
    try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, session.id].slice(-500))); } catch { /* Storage is optional. */ }
    if (document.hidden || document.documentElement.dataset.input === 'keyboard' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setCelebrating(true);
    const timer = setTimeout(() => setCelebrating(false), 900);
    return () => clearTimeout(timer);
  }, [confirmed, result?.sessionId, session.id, session.status, session.retryDeferred]);
  useEffect(() => {
    const cancel = () => { setCelebrating(false); burstRef.current?.getAnimations({ subtree: true }).forEach(animation => animation.cancel()); };
    const hidden = () => { if (document.hidden) cancel(); };
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => { if (preference.matches) cancel(); };
    document.addEventListener('visibilitychange', hidden); preference.addEventListener('change', changed);
    window.addEventListener('keydown', cancel, true);
    return () => { document.removeEventListener('visibilitychange', hidden); preference.removeEventListener('change', changed); window.removeEventListener('keydown', cancel, true); };
  }, []);
  if (dismissed) return <div className={styles.savedLine}><CheckIcon size={18} /><span>Занятие сохранено{result ? ` · ${result.xp} XP за практику` : ''}</span><button className="text-button" onClick={() => setDismissed(false)}>Результат</button></div>;
  return <section className={styles.outcome} data-testid="session-outcome" aria-labelledby={'outcome-' + session.id} data-celebrating={celebrating}>
    <div className={styles.outcomeHeading}><div className={styles.companion} ref={burstRef}><VoiceOrb state="idle" emotion={confirmed && !session.retryDeferred ? 'pleased' : 'calm'} statusDescription={confirmed && !session.retryDeferred ? 'Практика завершена и сохранена' : 'Сохранённый результат'} /><span className={styles.outcomeMark} aria-hidden="true"><CheckIcon size={16} weight="bold" /></span>{celebrating && unlocked.length > 0 && <div className={styles.burst} aria-hidden="true">{Array.from({ length: 8 }, (_, index) => <i key={index} style={{ '--dx': `${Math.cos(index * Math.PI / 4) * 56}px`, '--dy': `${Math.sin(index * Math.PI / 4) * 46}px`, '--rotation': `${index * 43}deg` } as CSSProperties} />)}</div>}</div><span className={styles.kicker}>{session.retryDeferred ? 'СОХРАНЕНО НА ПОТОМ' : 'ЗАНЯТИЕ ЗАВЕРШЕНО'}</span><button className="icon-button" onClick={() => { setCelebrating(false); setDismissed(true); }} aria-label="Свернуть результат"><XIcon size={18} /></button></div>
    <h2 id={'outcome-' + session.id}>{session.retryDeferred ? 'Попытку продолжим позже.' : result?.improvedRetry ? 'Вот, твоя мысль уже сильнее.' : session.baseline ? 'Стартовая проба сохранена.' : 'Ещё одна практика за плечами.'}</h2>
    <p>{session.retryDeferred ? 'Исходная практика и разбор сохранены. Улучшенная попытка ещё впереди.' : session.baseline ? 'Эта проба уточняет стартовый профиль. За неё не начисляется XP.' : 'Твой ответ, разбор и основания оценки остались в истории.'}</p>
    <div className={styles.outcomeActions}><button className="button primary" onClick={onNext}>Выбрать следующую практику<ArrowRightIcon size={18} /></button><button className="text-button" onClick={() => { setCelebrating(false); onDone(); }}>На сегодня всё</button></div>
    {result && <><div className={styles.resultHeading}><strong>+{result.xp} XP</strong><span>за {session.retryDeferred ? 'сохранённую' : 'завершённую'} практику</span></div><dl className={styles.facts}><div><dt>Целевых навыков с наблюдениями</dt><dd>{result.quality.observedTargets}/{result.quality.targetCount}</dd></div><div><dt>Самостоятельных успехов</dt><dd>{result.quality.independentSuccesses}</dd></div><div><dt>С опорой</dt><dd>{result.quality.supportedObservations}</dd></div><div><dt>Частично / трудность</dt><dd>{result.quality.partial} / {result.quality.difficulty}</dd></div></dl><p className={styles.note}>Наблюдение не означает, что навык освоен. Самостоятельность проверим в новых ситуациях.</p>
      {result.evidence.length > 0 && <details className={styles.resultEvidence}><summary>На каких ответах это основано</summary>{result.evidence.map((item, index) => <div key={`${item.turnId}:${item.skill}:${index}`}><strong>{SKILLS.find(skill => skill.id === item.skill)?.label}</strong><span>{item.result === 'success' ? 'Получилось' : item.result === 'partial' ? 'Частично' : 'Трудность'}{item.supported ? ' · с опорой' : ' · самостоятельно'}</span><q lang="en">{item.quote}</q></div>)}</details>}
    </>}
    {confirmed && !session.retryDeferred && unlocked.length > 0 && <div className={styles.unlock} role="status"><MedalIcon size={22} /><span><strong>Новый рубеж: {unlocked[0].title}</strong><small>{unlocked[0].description}</small></span></div>}
  </section>;
}
