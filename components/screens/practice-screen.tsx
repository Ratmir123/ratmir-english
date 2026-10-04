'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ArrowRightIcon, CaretRightIcon, ClockCounterClockwiseIcon, LightbulbIcon, SparkleIcon, TargetIcon, WarningCircleIcon } from '@phosphor-icons/react';
import type { Mode } from '@/lib/types';
import { familyForPattern, type CatalogFamily, type LessonFormat } from '@/lib/training';
import { DrillsList } from '../calls/drills-list';
import { useApp } from '../app/app-context';
import { CatalogIcon } from '../app/catalog-icons';
import { MODE_HINT, MODE_LABEL, sessionStatusLabel, shortDate, skillLabel } from '../app/labels';
import { laterSessions, pendingDrills } from '../app/today-plan';
import { Segmented } from '../ui/segmented';
import { Sheet } from '../ui/sheet';
import styles from './practice.module.css';

const FORMAT_NOTE: Record<LessonFormat, string> = {
  conversation: 'Живой разговор: собеседник отвечает на твои реплики.',
  pitch: 'Короткий питч на время: кто ты и чем полезен.',
  rapidfire: 'Несколько быстрых вопросов подряд — отвечай коротко и по делу.',
  replay: 'Переиграешь реальный момент из созвона.',
  cards: 'Карточки твоих лучших ответов — проговорить по памяти.',
  writing: 'Напишешь текст и улучшишь его по разбору. Микрофон не нужен.',
  reading: 'Прочитаешь текст и покажешь, что понял. Ответ можно написать.',
  listening: 'Сначала слушаешь — текст скрыт. Услышанное пригодится в ответе.',
};

function fixedMode(family: CatalogFamily | null): { mode: Mode; label: string; reason: string } | null {
  if (!family) return null;
  if (family.activity === 'writing') return { mode: 'learning', label: 'Письменное задание', reason: 'Пишешь в своём темпе, подсказки доступны.' };
  if (family.activity === 'reading') return { mode: 'learning', label: 'Чтение и ответ', reason: 'Текст перед глазами, ответ можно написать.' };
  if (family.category === 'ielts') return { mode: family.preferredMode, label: MODE_LABEL[family.preferredMode], reason: 'В основе IELTS режим задан форматом задания.' };
  return null;
}

/** Detail sheet: goal, skills, mode with a one-line explanation, optional topic → «Начать». */
export function FamilySheet({ family, freeTopic, open, onClose }: { family: CatalogFamily | null; freeTopic: boolean; open: boolean; onClose: () => void }) {
  const app = useApp();
  const fixed = fixedMode(family);
  const [mode, setMode] = useState<Mode>(family?.preferredMode ?? 'learning');
  const [topic, setTopic] = useState('');
  useEffect(() => { if (open) { setMode(family?.preferredMode ?? 'learning'); setTopic(''); } }, [open, family?.id, family?.preferredMode]);
  const busy = !!app.lesson.starting || !!app.lesson.busy;
  const title = family?.title ?? 'Своя тема';
  const begin = () => {
    app.start({ familyId: family?.id, context: family?.context, mode: fixed?.mode ?? mode, topic, from: 'practice' });
    onClose();
  };
  return <Sheet open={open} onClose={onClose} title={title} eyebrow={family ? app.catalog?.find(section => section.id === family.category)?.title : 'Свободный разговор'} testId="family-sheet"
    actions={<>
      <button type="button" className="button primary large block" onClick={begin} disabled={busy} data-testid="family-start">
        Начать<ArrowRightIcon size={18} />
      </button>
      {busy && <span className="disabled-reason"><WarningCircleIcon size={15} />{app.lesson.starting ? 'Уже готовлю другое занятие.' : 'Подожди, идёт действие.'}</span>}
    </>}>
    {family ? <>
      <div className={styles.sheetLead}><span className={styles.sheetIcon}><CatalogIcon name={family.icon.phosphor} size={28} /></span><p>{family.description}</p></div>
      <p className="caption">{FORMAT_NOTE[family.format] ?? FORMAT_NOTE.conversation}</p>
      {family.skills.length > 0 && <div className={styles.sheetBlock}><span className="eyebrow">Что потренируем</span>
        <div className={styles.chips}>{family.skills.map(skill => <span key={skill} className="chip violet">{skillLabel(skill)}</span>)}</div></div>}
      <div className={styles.chips}><span className="chip glassy"><ClockCounterClockwiseIcon size={14} />~{family.minutes} мин</span></div>
    </> : <p className="muted">О чём угодно: проект, игра, спорт, переезд. Собеседник подстроится, разбор покажет, что усилить.</p>}
    <div className={styles.sheetBlock}>
      <span className="eyebrow">Режим</span>
      {fixed ? <><span className="chip glassy" style={{ justifySelf: 'start' }}>{fixed.label}</span><small>{fixed.reason}</small></>
        : <><Segmented block label="Режим занятия" value={mode} onChange={setMode} options={[{ id: 'learning', label: MODE_LABEL.learning }, { id: 'call', label: MODE_LABEL.call }]} /><small>{MODE_HINT[mode]}</small></>}
    </div>
    <label className={styles.sheetBlock}>{family ? 'Своя тема (необязательно)' : 'Тема разговора'}
      <input value={topic} onChange={event => setTopic(event.target.value)} maxLength={300} placeholder={family ? 'Например: мой новый проект' : 'AI-видео, игра, спорт, идея проекта…'}
        onKeyDown={event => { if (event.key === 'Enter' && !busy) { event.preventDefault(); begin(); } }} />
      <span className="form-help">{family ? 'Тема нужна только для этого занятия.' : 'Можно оставить пустым — тему подберёт Sol.'}</span>
    </label>
  </Sheet>;
}

function FamilyTile({ family, index, onOpen }: { family: CatalogFamily; index: number; onOpen: () => void }) {
  return <button type="button" className={`glass interactive press reveal ${styles.tile}`} style={{ '--i': index } as CSSProperties} onClick={onOpen} data-testid={`family-${family.id}`}>
    <span className={styles.tileTop}>
      <span className={styles.tileIcon} data-category={family.category}><CatalogIcon name={family.icon.phosphor} size={24} /></span>
      {family.isNew && <span className="chip new">Новое</span>}
    </span>
    <strong className={styles.tileTitle}>{family.title}</strong>
    <span className={styles.tileText}>{family.description}</span>
    <span className={styles.tileMeta}><span className="tabular">~{family.minutes} мин</span><span aria-hidden="true">·</span><span>{['reading', 'writing'].includes(family.activity) ? 'Текст' : MODE_LABEL[family.preferredMode]}</span></span>
  </button>;
}

export function PracticeScreen() {
  const app = useApp();
  const state = app.data.state!;
  const [sheet, setSheet] = useState<{ family: CatalogFamily | null; freeTopic: boolean; open: boolean }>({ family: null, freeTopic: false, open: false });
  const families = useMemo(() => app.catalog?.flatMap(section => section.families) ?? [], [app.catalog]);
  const drills = pendingDrills(state);
  const later = laterSessions(state);
  // Sheets requested from elsewhere (Today «Свободная тема», achievements, patterns).
  useEffect(() => {
    if (!app.practiceTarget.nonce) return;
    const family = app.practiceTarget.familyId ? families.find(item => item.id === app.practiceTarget.familyId) ?? null : null;
    if (app.practiceTarget.familyId && !family) return;
    setSheet({ family, freeTopic: app.practiceTarget.freeTopic, open: true });
  }, [app.practiceTarget, families]);
  const suggestions = useMemo(() => {
    const busyPatterns = new Set(drills.flatMap(drill => drill.patternIds));
    const result: { patternTitle: string; family: CatalogFamily }[] = [];
    for (const pattern of (state.patterns ?? []).filter(item => !item.dismissed && item.kind === 'weakness' && ['active', 'improving'].includes(item.status)).sort((a, b) => a.costRank - b.costRank)) {
      if (busyPatterns.has(pattern.id) || result.length >= 2) continue;
      const curated = familyForPattern(pattern, result.map(item => item.family.id));
      const family = curated ? families.find(item => item.id === curated.id) : undefined;
      if (family) result.push({ patternTitle: pattern.title, family });
    }
    return result;
  }, [drills, families, state.patterns]);
  const recommendation = state.progression?.recommendation;
  const recommended = recommendation && !recommendation.drillId ? families.find(item => item.id === recommendation.familyId) : undefined;
  const forYou = drills.length > 0 || suggestions.length > 0 || later.length > 0 || !!recommended;

  return <div className="screen" data-screen="practice">
    <header className="screen-header">
      <div><h1 tabIndex={-1} data-screen-heading style={{ outline: 'none' }}>Практика</h1>
        <p className="lede">Выбери ситуацию — задачу и сложность подберёт Sol по твоим последним попыткам.</p></div>
      <button type="button" className="button secondary" onClick={() => setSheet({ family: null, freeTopic: true, open: true })}><SparkleIcon size={18} />Своя тема</button>
    </header>

    {forYou && <section className={styles.section} aria-labelledby="practice-for-you">
      <div className="section-title"><h2 id="practice-for-you">Для тебя</h2></div>
      {recommended && <button type="button" className={`glass interactive press ${styles.recommended}`} onClick={() => setSheet({ family: recommended, freeTopic: false, open: true })}>
        <span className={styles.tileIcon} data-category={recommended.category}><TargetIcon size={24} weight="duotone" /></span>
        <span className={styles.recommendedCopy}><span className="eyebrow">План на сегодня</span><strong>{recommended.title}</strong><small>{recommendation?.why}</small></span>
        <CaretRightIcon size={18} />
      </button>}
      {drills.length > 0 && <DrillsList drills={drills} onStartDrill={app.startDrill} limit={3} />}
      {suggestions.length > 0 && <div className={styles.grid}>{suggestions.map((item, index) => <button key={item.family.id} type="button" className={`glass interactive press reveal ${styles.tile}`} style={{ '--i': index } as CSSProperties} onClick={() => setSheet({ family: item.family, freeTopic: false, open: true })}>
        <span className={styles.tileTop}><span className={styles.tileIcon} data-category="pattern"><LightbulbIcon size={24} weight="duotone" /></span><span className="chip lime">Паттерн</span></span>
        <strong className={styles.tileTitle}>{item.family.title}</strong>
        <span className={styles.tileText}>Против «{item.patternTitle}»</span>
      </button>)}</div>}
      {later.length > 0 && <div className={`glass flat ${styles.panel}`}>
        <span className="eyebrow">Попытки на потом · {later.length}</span>
        <ul className={styles.rows}>{later.slice(0, 5).map(session => <li key={session.id}><button type="button" onClick={() => app.lesson.open(session, 'practice')}>
          <span className={styles.rowCopy}><strong>{session.lesson.title}</strong><small>{sessionStatusLabel(session)} · {shortDate(session.updatedAt)}</small></span><CaretRightIcon size={16} />
        </button></li>)}</ul>
      </div>}
    </section>}

    {app.catalogError && <div className="banner error" role="alert"><WarningCircleIcon size={18} weight="fill" /><span className="banner-copy"><span>{app.catalogError}</span>
      <span className="banner-actions"><button type="button" className="button small secondary" onClick={app.reloadCatalog}>Повторить</button></span></span></div>}
    {!app.catalog && !app.catalogError && <div className={styles.grid} aria-busy="true">{Array.from({ length: 6 }, (_, index) => <div key={index} className="skeleton" style={{ height: 150 }} />)}</div>}
    {app.catalog?.map(section => <section key={section.id} id={`practice-section-${section.id}`} className={styles.section} aria-labelledby={`section-${section.id}`}>
      <div className={styles.sectionHead}><h2 id={`section-${section.id}`}>{section.title}</h2><p className="caption">{section.description}</p></div>
      <div className={styles.grid}>{section.families.map((family, index) => <FamilyTile key={family.id} family={family} index={index} onOpen={() => setSheet({ family, freeTopic: false, open: true })} />)}</div>
    </section>)}

    <FamilySheet family={sheet.family} freeTopic={sheet.freeTopic} open={sheet.open} onClose={() => setSheet(previous => ({ ...previous, open: false }))} />
  </div>;
}
