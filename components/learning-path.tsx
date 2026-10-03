'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowRightIcon, ArrowUpRightIcon, CheckIcon, FlagIcon, LockSimpleIcon, MedalIcon, TargetIcon, XIcon } from '@phosphor-icons/react';
import { SKILLS, type AppState, type LearningTrackId, type PracticeResult, type ProgressionState, type Session } from '@/lib/types';
import { achievementArt, achievementTarget, EXPERIENCE_BANDS, experienceBand, type AchievementTarget } from '@/lib/achievement-targets';
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

/** Each decoration sleeps outside the viewport, in a background window, or with reduced motion. */
function useRewardMotion(enabled: boolean) {
  const ref = useRef<HTMLSpanElement>(null);
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    if (!enabled || !ref.current) { setMoving(false); return; }
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let visible = false;
    const update = () => setMoving(visible && !document.hidden && !preference.matches);
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); });
    observer.observe(ref.current);
    document.addEventListener('visibilitychange', update); preference.addEventListener('change', update);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); preference.removeEventListener('change', update); };
  }, [enabled]);
  return { ref, moving };
}

/** Ambient motion and direct press feedback have separate transforms: neither restarts the other. */
export function RankEmblem({ level, size = 128, animated = true }: { level: number; size?: number; animated?: boolean }) {
  const { ref, moving } = useRewardMotion(animated);
  const [pressed, setPressed] = useState(false);
  const band = experienceBand(level);
  const kind = band.art.replace('rank-', '');
  const count = kind === 'gold' ? 10 : kind === 'rose' ? 6 : kind === 'sky' ? 3 : kind === 'mint' ? 2 : 4;
  const art = <><span className={styles.rankFloor} /><span className={styles.rankFeedback}>
    <span className={styles.rankFloat}>
      <span className={styles.rankAtmosphere}>{Array.from({ length: count }, (_, index) => <i key={index} style={{ '--i': index, '--angle': `${360 * index / count - 90}deg` } as CSSProperties} />)}</span>
      <img className={styles.rankArt} src={`/rewards-v041/${band.art}.png`} width={size} height={size} alt="" />
      <span className={styles.rankSheen}><i /></span>
    </span>
  </span></>;
  return <span ref={ref} className={styles.rankEmblem} data-rank={kind} data-moving={animated && moving} data-pressed={pressed} style={{ width: size, height: size, '--rank-art': `url('/rewards-v041/${band.art}.png')`, '--rank-radius': `${size * .32}px` } as CSSProperties}>
    {animated ? <button type="button" className={styles.rankTouch} aria-label={`Ранг «${band.title}». Пошевелить значок`} onPointerDown={event => { if (event.pointerType !== 'mouse' || event.button === 0) { setPressed(true); event.currentTarget.setPointerCapture(event.pointerId); } }} onPointerUp={() => setPressed(false)} onPointerCancel={() => setPressed(false)} onLostPointerCapture={() => setPressed(false)} onBlur={() => setPressed(false)}>{art}</button> : <span className={styles.rankStatic} aria-hidden="true">{art}</span>}
  </span>;
}

function AchievementEmblem({ id, size = 64, motion = 'still' }: { id: string; size?: number; motion?: 'earned' | 'goal' | 'still' }) {
  const { ref, moving } = useRewardMotion(motion !== 'still');
  return <span ref={ref} className={styles.achievementEmblem} data-reward-motion={motion} data-moving={moving} aria-hidden="true" style={{ width: size, height: size }}>
    <span className={styles.achievementFloor} /><span className={styles.achievementFeedback}><img className={styles.achievementArt} src={achievementArt(id)} width={size} height={size} alt="" /></span>
  </span>;
}

export function RankLadder({ value }: { value: ProgressionState }) {
  const current = experienceBand(value.level);
  const next = EXPERIENCE_BANDS.find(band => band.from > value.level);
  return <ol className={styles.rankLadder} aria-label="Все шесть рангов опыта" data-testid="rank-ladder">{EXPERIENCE_BANDS.map(band => {
    const minimumXP = (band.from - 1) * 100;
    const isCurrent = band.art === current.art;
    const isNext = band.art === next?.art;
    const unlocked = value.level >= band.from;
    return <li key={band.art} data-current={isCurrent} data-unlocked={unlocked}>
      <RankEmblem level={band.from} size={90} animated={isCurrent} />
      <div className={styles.rankCopy}><strong>{band.title}</strong><span>Уровень {band.from} · от {minimumXP} XP</span><small>{isCurrent ? `Твой ранг · ${value.xp} XP сейчас` : isNext ? `Следующий · ещё ${Math.max(0, minimumXP - value.xp)} XP` : unlocked ? 'Уже открыт' : 'Впереди'}</small></div>
      <span className={styles.rankStatus} aria-hidden="true">{isCurrent ? <span /> : unlocked ? <CheckIcon size={16} /> : <LockSimpleIcon size={15} />}</span>
    </li>;
  })}</ol>;
}

export function RewardsInvitation({ value, onClick }: { value: ProgressionState; onClick: () => void }) {
  return <button type="button" className={styles.rewardsInvitation} onClick={onClick} data-testid="rewards-invitation">
    <AchievementEmblem id="own-improvement" size={50} motion="goal" />
    <span className={styles.invitationCopy}><strong>Награды</strong><small>Открыто {value.achievements.filter(item => item.unlocked).length} из {value.achievements.length}</small></span><ArrowUpRightIcon size={20} aria-hidden="true" />
  </button>;
}

export function PracticeLevel({ value, compact = false, onRewards }: { value: ProgressionState; compact?: boolean; onRewards?: () => void }) {
  const band = experienceBand(value.level);
  const next = EXPERIENCE_BANDS.find(item => item.from > value.level);
  const floor = (band.from - 1) * 100;
  const nextXP = next ? (next.from - 1) * 100 : undefined;
  return <section className={`${styles.level} ${compact ? styles.compact : ''}`} aria-label="Уровень практики" data-testid="practice-level">
    <div className={styles.levelHeading}><RankEmblem level={value.level} /><div className={styles.currentRankCopy}><span className={styles.kicker}>ТВОЙ РАНГ</span><h2>{band.title}</h2><span className={styles.rankSubtitle}>Уровень опыта {value.level}</span></div><span className={styles.xp}>{value.xp} <small>XP</small></span></div>
    {next && nextXP !== undefined ? <><ProgressLine current={value.xp - floor} target={nextXP - floor} label={`Практика до ранга ${next.title}`} /><div className={styles.lineLabels}><span>До «{next.title}» ещё {Math.max(0, nextXP - value.xp)} XP</span><span>Завершено: {value.completedPractice}</span></div></> : <p className={styles.note}>Все шесть рангов открыты. Опыт практики продолжает расти.</p>}
    <p className={styles.note}>Ранги отмечают опыт практики. Языковой уровень проверяем по твоим ответам.</p>
    <details className={styles.rankDisclosure}><summary>Все ранги <span>6</span><ArrowRightIcon size={17} aria-hidden="true" /></summary><RankLadder value={value} /></details>
    {onRewards && <RewardsInvitation value={value} onClick={onRewards} />}
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

export function Achievements({ value, state, onTarget }: { value: ProgressionState; state: AppState; onTarget: (target: AchievementTarget) => void }) {
  const [all, setAll] = useState(false);
  const unlocked = value.achievements.filter(item => item.unlocked)
    .sort((a, b) => (b.unlockedAt || '').localeCompare(a.unlockedAt || ''));
  const upcoming = value.achievements.filter(item => !item.unlocked)
    .sort((a, b) => ratio(b.current, b.target) - ratio(a.current, a.target));
  const ordered = [...unlocked, ...upcoming];
  const recent = unlocked.slice(0, 2);
  const visible = all ? ordered : [...recent, ...upcoming.slice(0, 4 - recent.length)];
  return <section id="practice-achievements" className={styles.achievements} aria-labelledby="achievement-title" data-testid="achievements">
    <div className={styles.sectionHeading}><div><span className={styles.kicker}>РУБЕЖИ ПРАКТИКИ</span><h2 id="achievement-title">Есть к чему вернуться</h2></div><MedalIcon size={25} aria-hidden="true" /></div>
    <p className={styles.note}>Каждая отметка объясняет, что именно ты сделал. Можно раскрыть её условие. Дневные рубежи считаются по UTC.</p>
    <div className={styles.achievementList}>{visible.map(item => <details key={item.id} className={styles.achievement} data-unlocked={item.unlocked}>
      <summary><AchievementEmblem id={item.id} motion={item.unlocked ? 'earned' : item.id === upcoming[0]?.id ? 'goal' : 'still'} /><span className={styles.achievementCopy}><strong>{item.title}</strong><small>{item.unlocked ? 'Получено' : `${item.current} из ${item.target}`}</small></span><span className={styles.achievementState} aria-hidden="true">{item.unlocked ? <CheckIcon size={18} /> : <LockSimpleIcon size={17} />}<ArrowRightIcon size={14} className={styles.achievementChevron} /></span></summary>
      <div className={styles.achievementDetail}><p>{item.description}</p><ProgressLine current={item.current} target={item.target} label={item.title} /><span className={styles.note}>{item.current} / {item.target}{item.unlockedAt ? ` · ${shortDate(item.unlockedAt)}` : ''}</span>{!item.unlocked && <><p className={styles.targetReason}>{achievementTarget(item.id, state).reason}</p><button className="button secondary" onClick={() => onTarget(achievementTarget(item.id, state))}><TargetIcon size={18} />{achievementTarget(item.id, state).label}<ArrowUpRightIcon size={16} /></button></>}</div>
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
    {confirmed && !session.retryDeferred && unlocked.length > 0 && <div className={styles.unlock} role="status"><AchievementEmblem id={unlocked[0].id} motion="earned" /><span><strong>Новый рубеж: {unlocked[0].title}</strong><small>{unlocked[0].description}</small></span></div>}
  </section>;
}
