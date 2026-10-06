'use client';

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowRightIcon, CaretRightIcon, SparkleIcon, WarningCircleIcon } from '@phosphor-icons/react';
import type { Mode } from '@/lib/types';
import type { CatalogFamily, CatalogSection, LessonFormat } from '@/lib/training';
import { useApp } from '../app/app-context';
import { ScenarioArtwork } from '../app/scenario-artwork';
import { MODE_HINT, MODE_LABEL, skillLabel } from '../app/labels';
import { pendingDrills } from '../app/today-plan';
import { PracticeForYou } from '../practice/for-you';
import { useMediaQuery } from '../practice/use-media-query';
import { ScreenMascot } from '../shell/screen-mascot';
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

/** One list row: icon, title, purpose, time and mode on the right. */
function Row({ icon, artwork, title, note, meta, isNew, onClick, testId }: {
  icon?: ReactNode; artwork?: boolean; title: string; note: ReactNode; meta?: ReactNode; isNew?: boolean; onClick: () => void; testId?: string;
}) {
  return <li><button type="button" className={styles.row} onClick={onClick} data-testid={testId}>
    {icon && <span className={styles.rowIcon} data-artwork={artwork || undefined} aria-hidden="true">{icon}</span>}
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
      {section.families.map(family => <Row key={family.id} testId={`family-${family.id}`} artwork icon={<ScenarioArtwork familyId={family.id} fallback={family.icon.phosphor} />}
        title={family.title} note={firstSentence(family.description)} meta={familyMeta(family)} isNew={!allNew && family.isNew} onClick={() => onOpen(family)} />)}
    </ul>
  </section>;
}

export function PracticeScreen() {
  const app = useApp();
  const state = app.data.state!;
  const [sheet, setSheet] = useState<{ family: CatalogFamily | null; freeTopic: boolean; open: boolean }>({ family: null, freeTopic: false, open: false });
  const families = useMemo(() => app.catalog?.flatMap(section => section.families) ?? [], [app.catalog]);
  // Header companion (MOTION-PASS-0.5.2 §3): determined while drills wait; 72 px on a phone. With nothing pending the
  // «Для тебя» empty line holds the (curious) companion instead — one companion per screen, as on the iPhone.
  const determined = pendingDrills(state).length > 0;
  const narrow = useMediaQuery('(max-width: 640px)');
  // Catalog sections present at the first render join the staircase; sections that arrive later reveal on their own (§2).
  const [catalogAtMount] = useState(() => !!app.catalog);
  // Sheets requested from elsewhere (Today «Своя тема», achievements, patterns).
  useEffect(() => {
    if (!app.practiceTarget.nonce) return;
    const family = app.practiceTarget.familyId ? families.find(item => item.id === app.practiceTarget.familyId) ?? null : null;
    if (app.practiceTarget.familyId && !family) return;
    setSheet({ family, freeTopic: app.practiceTarget.freeTopic, open: true });
  }, [app.practiceTarget, families]);
  const open = (family: CatalogFamily | null, freeTopic = false) => setSheet({ family, freeTopic, open: true });

  return <div className={`screen ${styles.practice}`} data-screen="practice">
    <header className={styles.header} data-enter data-companion={determined}>
      <div className={styles.headerCopy}><h1 tabIndex={-1} data-screen-heading>Практика</h1>
        <p className="lede">Выбери ситуацию — задачу и сложность подберёт Sol по твоим последним попыткам.</p></div>
      <button type="button" className={`button secondary ${styles.freeTopic}`} onClick={() => open(null, true)}><SparkleIcon size={18} />Своя тема</button>
      {determined && <ScreenMascot emotion="determined" size={narrow ? 72 : 96} className={styles.headerMascot} />}
    </header>

    <PracticeForYou onOpenFamily={family => open(family)} />

    <div className={styles.catalog}>
      <h2 className={styles.catalogTitle} data-enter>Все ситуации</h2>
      {app.catalogError && <div className="banner error" role="alert" data-enter><WarningCircleIcon size={18} weight="fill" /><span className="banner-copy"><span>{app.catalogError}</span>
        <span className="banner-actions"><button type="button" className="button small secondary" onClick={app.reloadCatalog}>Повторить</button></span></span></div>}
      {!app.catalog && !app.catalogError && <div className={styles.group} aria-busy="true" data-enter>
        <div className={styles.groupHead}><div className="skeleton" style={{ height: 22, width: 170, borderRadius: 8 }} /></div>
        <div className="skeleton" style={{ height: 320 }} />
      </div>}
      {app.catalog?.map((section, index) => <div key={section.id} data-enter={catalogAtMount ? '' : undefined}
        className={catalogAtMount ? undefined : 'reveal'} style={catalogAtMount ? undefined : { '--i': index } as CSSProperties}>
        <CatalogGroup section={section} onOpen={family => open(family)} />
      </div>)}
    </div>

    <FamilySheet family={sheet.family} freeTopic={sheet.freeTopic} open={sheet.open} onClose={() => setSheet(previous => ({ ...previous, open: false }))} />
  </div>;
}
