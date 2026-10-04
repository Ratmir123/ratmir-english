'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowRightIcon, CaretRightIcon, LightbulbIcon, SparkleIcon, TargetIcon, WarningCircleIcon } from '@phosphor-icons/react';
import type { Mode } from '@/lib/types';
import { familyForPattern, type CatalogFamily, type CatalogSection, type LessonFormat } from '@/lib/training';
import { DrillsList } from '../calls/drills-list';
import { useApp } from '../app/app-context';
import { CatalogIcon } from '../app/catalog-icons';
import { MODE_HINT, MODE_LABEL, sessionStatusLabel, sessionTone, shortDate, skillLabel } from '../app/labels';
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

const plural = (n: number, one: string, few: string, many: string) => {
  const ten = n % 10, hundred = n % 100;
  return ten === 1 && hundred !== 11 ? one : ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14) ? few : many;
};
/** The catalog row shows only the first sentence (the situation); the sheet has the whole description. */
const firstSentence = (text: string) => text.match(/^.+?[.!?](?=\s|$)/u)?.[0] ?? text;
const textActivity = (family: CatalogFamily) => family.activity === 'reading' || family.activity === 'writing';

function fixedMode(family: CatalogFamily | null): { mode: Mode; label: string; reason: string } | null {
  if (!family) return null;
  if (family.activity === 'writing') return { mode: 'learning', label: 'Письменное задание', reason: 'Пишешь в своём темпе, подсказки доступны.' };
  if (family.activity === 'reading') return { mode: 'learning', label: 'Чтение и ответ', reason: 'Текст перед глазами, ответ можно написать.' };
  if (family.category === 'ielts') return { mode: family.preferredMode, label: MODE_LABEL[family.preferredMode], reason: 'В основе IELTS режим задан форматом задания.' };
  return null;
}

/** Detail sheet: what happens, what it trains, how to run it, optional topic → «Начать». */
export function FamilySheet({ family, freeTopic, open, onClose }: { family: CatalogFamily | null; freeTopic: boolean; open: boolean; onClose: () => void }) {
  const app = useApp();
  const fixed = fixedMode(family);
  const [mode, setMode] = useState<Mode>(family?.preferredMode ?? 'learning');
  const [topic, setTopic] = useState('');
  useEffect(() => { if (open) { setMode(family?.preferredMode ?? 'learning'); setTopic(''); } }, [open, family?.id, family?.preferredMode]);
  const busy = !!app.lesson.starting || !!app.lesson.busy;
  const section = family ? app.catalog?.find(item => item.id === family.category)?.title : null;
  const begin = () => {
    app.start({ familyId: family?.id, context: family?.context, mode: fixed?.mode ?? mode, topic, from: 'practice' });
    onClose();
  };
  return <Sheet open={open} onClose={onClose} title={family?.title ?? 'Своя тема'} testId="family-sheet"
    subtitle={family ? [section, `~${family.minutes} мин`].filter(Boolean).join(' · ') : 'Свободный разговор'}
    actions={<>
      <button type="button" className="button primary large block" onClick={begin} disabled={busy} data-testid="family-start">
        Начать<ArrowRightIcon size={18} />
      </button>
      {busy && <span className="disabled-reason"><WarningCircleIcon size={15} />{app.lesson.starting ? 'Уже готовлю другое занятие.' : 'Подожди, идёт действие.'}</span>}
    </>}>
    {family ? <div className={styles.sheetAbout}>
      <p className={styles.sheetLead}>{family.description}</p>
      <p className="caption">{FORMAT_NOTE[family.format] ?? FORMAT_NOTE.conversation}</p>
      {family.skills.length > 0 && <p className={styles.sheetSkills}><strong>Что потренируем:</strong> {family.skills.map(skillLabel).join(' · ')}</p>}
    </div> : <p className={styles.sheetLead}>О чём угодно: проект, игра, спорт, переезд. Собеседник подстроится, разбор покажет, что усилить.</p>}
    <fieldset className={styles.sheetBlock}>
      <legend>Как пройти</legend>
      {fixed ? <p className={styles.sheetFixed}><strong>{fixed.label}.</strong> {fixed.reason}</p>
        : <><Segmented block label="Режим занятия" value={mode} onChange={setMode} options={[{ id: 'learning', label: MODE_LABEL.learning }, { id: 'call', label: MODE_LABEL.call }]} /><small>{MODE_HINT[mode]}</small></>}
    </fieldset>
    <label className={styles.sheetBlock}>{family ? 'Своя тема (необязательно)' : 'Тема разговора'}
      <input value={topic} onChange={event => setTopic(event.target.value)} maxLength={300} placeholder={family ? 'Например: мой новый проект' : 'AI-видео, игра, спорт, идея проекта…'}
        onKeyDown={event => { if (event.key === 'Enter' && !busy) { event.preventDefault(); begin(); } }} />
      <span className="form-help">{family ? 'Тема нужна только для этого занятия.' : 'Можно оставить пустым — тему подберёт Sol.'}</span>
    </label>
  </Sheet>;
}

/** One list row: stroke icon, title, one line of purpose, time and mode on the right. */
function Row({ icon, title, note, meta, isNew, onClick, testId }: {
  icon?: ReactNode; title: string; note: ReactNode; meta?: ReactNode; isNew?: boolean; onClick: () => void; testId?: string;
}) {
  return <li><button type="button" className={styles.row} onClick={onClick} data-testid={testId}>
    {icon && <span className={styles.rowIcon} aria-hidden="true">{icon}</span>}
    <span className={styles.rowCopy}>
      <strong>{title}{isNew && <span className={styles.newDot} title="Новое"><span className="visually-hidden">, новое</span></span>}</strong>
      <small>{note}</small>
    </span>
    {meta && <span className={styles.rowMeta}>{meta}</span>}
    <CaretRightIcon size={16} className={styles.chevron} aria-hidden="true" />
  </button></li>;
}

function familyMeta(family: CatalogFamily) {
  return <><span className="tabular">~{family.minutes} мин</span><span>{textActivity(family) ? 'Текст' : MODE_LABEL[family.preferredMode]}</span></>;
}

function CatalogGroup({ section, onOpen }: { section: CatalogSection; onOpen: (family: CatalogFamily) => void }) {
  const total = section.families.length;
  const fresh = section.families.filter(family => family.isNew).length;
  // When every item of a group is new, say it once in the group head instead of marking each row.
  const allNew = fresh === total;
  const count = `${total} ${plural(total, 'ситуация', 'ситуации', 'ситуаций')}${allNew ? ' · все новые' : fresh ? ` · ${fresh} ${plural(fresh, 'новая', 'новые', 'новых')}` : ''}`;
  return <section id={`practice-section-${section.id}`} className={styles.group} aria-labelledby={`section-${section.id}`}>
    <div className={styles.groupHead}>
      <h3 id={`section-${section.id}`}>{section.title}</h3>
      <p className="caption">{section.description}</p>
      <p className={styles.count}>{count}</p>
    </div>
    <ul className={`surface ${styles.list}`}>
      {section.families.map(family => <Row key={family.id} testId={`family-${family.id}`} icon={<CatalogIcon name={family.icon.phosphor} size={20} />}
        title={family.title} note={firstSentence(family.description)} meta={familyMeta(family)} isNew={!allNew && family.isNew} onClick={() => onOpen(family)} />)}
    </ul>
  </section>;
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
  const open = (family: CatalogFamily | null, freeTopic = false) => setSheet({ family, freeTopic, open: true });
  const planned = !!recommended || suggestions.length > 0;

  return <div className={`screen ${styles.practice}`} data-screen="practice">
    <header className={styles.header}>
      <div className={styles.headerCopy}><h1 tabIndex={-1} data-screen-heading>Практика</h1>
        <p className="lede">Выбери ситуацию — задачу и сложность подберёт Sol по твоим последним попыткам.</p></div>
      <button type="button" className="button secondary" onClick={() => open(null, true)}><SparkleIcon size={18} />Своя тема</button>
    </header>

    {(planned || drills.length > 0) && <section className={styles.group} aria-labelledby="practice-for-you">
      <div className={styles.groupHead}>
        <h2 id="practice-for-you">Для тебя</h2>
        <p className="caption">По твоим созвонам и последним разборам.</p>
        {drills.length > 3 && <p className={styles.count}>Тренировки: 3 из {drills.length} · <button type="button" className="text-button" onClick={() => app.go('calls')}>все в «Созвонах»</button></p>}
      </div>
      <div className={styles.groupBody}>
        {planned && <ul className={`surface ${styles.list}`}>
          {recommended && <Row icon={<TargetIcon size={20} />} title={recommended.title} meta={familyMeta(recommended)} onClick={() => open(recommended)}
            note={recommendation?.why ? `План на сегодня: ${recommendation.why}` : 'План на сегодня'} />}
          {suggestions.map(item => <Row key={item.family.id} icon={<LightbulbIcon size={20} />} title={item.family.title} meta={familyMeta(item.family)}
            note={`Против паттерна «${item.patternTitle}»`} onClick={() => open(item.family)} />)}
        </ul>}
        {drills.length > 0 && (planned ? <div className={styles.drills}>
          <h3 className={styles.subhead}>Личные тренировки</h3>
          <DrillsList drills={drills} onStartDrill={app.startDrill} limit={3} />
        </div> : <DrillsList drills={drills} onStartDrill={app.startDrill} limit={3} />)}
      </div>
    </section>}

    {later.length > 0 && <section className={styles.group} aria-labelledby="practice-later">
      <div className={styles.groupHead}>
        <h2 id="practice-later">Незаконченные занятия</h2>
        <p className="caption">{later.length > 5 ? `5 последних из ${later.length}` : 'Можно вернуться в любой момент.'}</p>
      </div>
      <ul className={`surface flat ${styles.list}`}>{later.slice(0, 5).map(session => {
        const tone = sessionTone(session);
        return <Row key={session.id} title={session.lesson.title} onClick={() => app.lesson.open(session, 'practice')}
          note={<><span className={styles.status} data-tone={tone}>{sessionStatusLabel(session)}</span> · {shortDate(session.updatedAt)}</>} />;
      })}</ul>
    </section>}

    <div className={styles.catalog}>
      <h2 className={styles.catalogTitle}>Все ситуации</h2>
      {app.catalogError && <div className="banner error" role="alert"><WarningCircleIcon size={18} weight="fill" /><span className="banner-copy"><span>{app.catalogError}</span>
        <span className="banner-actions"><button type="button" className="button small secondary" onClick={app.reloadCatalog}>Повторить</button></span></span></div>}
      {!app.catalog && !app.catalogError && <div className={styles.group} aria-busy="true">
        <div className={styles.groupHead}><div className="skeleton" style={{ height: 22, width: 170, borderRadius: 8 }} /></div>
        <div className="skeleton" style={{ height: 320 }} />
      </div>}
      {app.catalog?.map(section => <CatalogGroup key={section.id} section={section} onOpen={family => open(family)} />)}
    </div>

    <FamilySheet family={sheet.family} freeTopic={sheet.freeTopic} open={sheet.open} onClose={() => setSheet(previous => ({ ...previous, open: false }))} />
  </div>;
}
