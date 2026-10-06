'use client';

/*
 * «Мои фразы» sheet (planning/v05/PASS-0.5.3.md §1.6): the capture field on top, «К повторению · N» / «Все · M», rows with the
 * phrase (or the raw text while Sol works), its meaning and when it comes back; a tap opens the note, the example, the
 * history and the actions. «Удалить» hides the row at once and sends the delete only after the 6 s «Вернуть» window (the
 * 0.5.2 undo queue). Footer: «Повторить · N» starts a phrase round.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowsClockwiseIcon, CaretRightIcon } from '@phosphor-icons/react';
import type { SavedPhrase, UpdatePhraseRequest } from '@/lib/phrases/types';
import {
  allPhrases, enrichmentProblem, headlineIsEnglish, phraseDueLabel, phraseHeadline, phraseHistoryLine, phrasesOverview,
  phrasesToRepeat, removePhrase, upsertPhrase,
} from '@/lib/phrases/labels';
import { useApp } from '../app/app-context';
import { messageOf, request } from '../app/api';
import { createUndoQueue, UNDO_MS, usePendingRemovals } from '../app/undo-queue';
import { CaptureCard } from '../capture/capture-card';
import { pollPhrase, useCapture } from '../capture/use-capture';
import { Segmented } from '../ui/segmented';
import { Sheet } from '../ui/sheet';
import styles from './phrases.module.css';

type Tab = 'due' | 'all';
/** Pending deletes outlive the sheet (closing it inside the window still deletes, «Вернуть» still works). */
const removals = createUndoQueue(UNDO_MS);
/** Phrases saved elsewhere (the overlay, the iPhone) that Sol is still working on: followed while the sheet is open. */
const FOLLOW_LIMIT = 5;
const rowId = (id: string) => `phrase-row-${id}`;

function PhraseRow({ phrase, open, busy, onToggle, onArchive, onRestore, onRetry, onRemove }: {
  phrase: SavedPhrase; open: boolean; busy: boolean;
  onToggle: () => void; onArchive: () => void; onRestore: () => void; onRetry: () => void; onRemove: () => void;
}) {
  const id = useId();
  const english = headlineIsEnglish(phrase);
  const enriching = phrase.enrichment === 'pending';
  const due = phraseDueLabel(phrase);
  const resting = phrase.archived || phrase.status === 'learned';
  const tone = resting ? 'done' : due === 'сегодня' ? 'now' : undefined;
  const sub = enriching ? 'Разбираю…' : phrase.enrichment === 'failed' ? enrichmentProblem(phrase) : phrase.meaning;
  const target = phrase.phrase?.trim();
  const original = phrase.enrichment === 'ready' && target && phrase.text.trim().toLowerCase() !== target.toLowerCase() ? phrase.text.trim() : null;
  return <li className={styles.row} data-open={open} id={rowId(phrase.id)}>
    <button type="button" className={styles.rowHead} aria-expanded={open} aria-controls={`${id}-details`} onClick={onToggle}>
      <span className={styles.rowCopy}>
        <strong lang={english ? 'en' : undefined}>{phraseHeadline(phrase)}</strong>
        {sub && <small data-working={enriching || undefined}>{sub}</small>}
      </span>
      {due && <span className={styles.due} data-tone={tone}>{due}</span>}
      <CaretRightIcon size={15} className={styles.caret} aria-hidden="true" />
    </button>
    {open && <div id={`${id}-details`} className={styles.details}>
      {original && <p className="caption">Сохранено: «{original}»</p>}
      {phrase.enrichment === 'ready' && phrase.note && <p className={styles.note}>{phrase.note}</p>}
      {phrase.example && <div className={styles.example}>
        <p lang="en">{phrase.example}</p>
        {phrase.exampleRu && <p className="caption">{phrase.exampleRu}</p>}
      </div>}
      {phrase.history.length > 0 && <ul className={styles.history} aria-label="Как она звучала">
        {phrase.history.map((entry, index) => <li key={`${entry.sessionId}-${index}`}>{phraseHistoryLine(entry)}</li>)}
      </ul>}
      <div className={styles.rowActions}>
        {phrase.enrichment === 'failed' && <button type="button" className="text-button" onClick={onRetry} disabled={busy}>
          <ArrowsClockwiseIcon size={15} aria-hidden="true" />Повторить разбор</button>}
        {resting
          ? <button type="button" className="text-button" onClick={onRestore} disabled={busy}>Вернуть в повторение</button>
          : <button type="button" className="text-button" onClick={onArchive} disabled={busy}>Уже знаю</button>}
        <button type="button" className="text-button danger" onClick={onRemove} disabled={busy}
          aria-label={`Удалить фразу «${phraseHeadline(phrase)}»`}>Удалить</button>
      </div>
    </div>}
  </li>;
}

export function PhrasesSheet({ open, focus, nonce, onClose }: {
  open: boolean;
  /** A phrase to open right away (a chip on Practice). */
  focus: string | null;
  /** Grows with every request to open, so the same phrase can be asked for twice. */
  nonce: number;
  onClose: () => void;
}) {
  const app = useApp();
  const { data, lesson, toast } = app;
  const setState = data.setState;
  const removing = usePendingRemovals(removals);
  const phrases = data.state?.phrases;
  const visible = useMemo(() => (phrases ?? []).filter(item => !removing.has(item.id)), [phrases, removing]);
  const overview = useMemo(() => phrasesOverview(visible), [visible]);
  const [tab, setTab] = useState<Tab>('due');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const tabsId = useId();
  const keep = (phrase: SavedPhrase) => setState(previous => previous ? { ...previous, phrases: upsertPhrase(previous.phrases, phrase) } : previous);
  const capture = useCapture({ onPhrase: keep });
  const captureRef = useRef(capture);
  captureRef.current = capture;

  const reveal = (id: string) => requestAnimationFrame(() => document.getElementById(rowId(id))?.scrollIntoView({ block: 'nearest' }));
  const show = (phrase: SavedPhrase) => {
    setTab(phrasesToRepeat(visible).some(item => item.id === phrase.id) ? 'due' : 'all');
    setExpanded(phrase.id);
    reveal(phrase.id);
  };
  // Each opening: the waiting ones first when there are any; a phrase asked for opens in place. The field starts clean
  // (an unsaved text stays).
  useEffect(() => {
    if (!open) return;
    if (captureRef.current.saved) captureRef.current.reset();
    const target = focus ? visible.find(item => item.id === focus) : undefined;
    if (target) { show(target); return; }
    setTab(overview.due > 0 ? 'due' : 'all');
    setExpanded(null);
    // Only a new request re-runs this, not every change of the list.
  }, [open, nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  // A phrase saved here shows up at the top of «Все» (with «Разбираю…» until Sol is done).
  useEffect(() => { if (capture.serial) setTab('all'); }, [capture.serial]);

  // Sol's work on phrases saved elsewhere lands while the sheet is open (the field above follows its own).
  const own = capture.saved?.phrase?.id;
  const pendingKey = open ? visible.filter(item => item.enrichment === 'pending' && item.id !== own).slice(0, FOLLOW_LIMIT).map(item => item.id).join(' ') : '';
  useEffect(() => {
    if (!pendingKey) return;
    const stops = pendingKey.split(' ').map(id => pollPhrase(id, fresh => setState(previous => previous ? { ...previous, phrases: upsertPhrase(previous.phrases, fresh) } : previous),
      { everyMs: 3000, limitMs: 45_000 }));
    return () => stops.forEach(stop => stop());
  }, [pendingKey, setState]);

  const update = async (phrase: SavedPhrase, body: UpdatePhraseRequest, failure: string) => {
    setBusyId(phrase.id);
    try { keep((await request<{ phrase: SavedPhrase }>(`phrases/${encodeURIComponent(phrase.id)}`, body)).phrase); }
    catch (error) { toast.error(messageOf(error, failure)); }
    finally { setBusyId(current => current === phrase.id ? null : current); }
  };
  const remove = (phrase: SavedPhrase) => {
    const scheduled = removals.schedule(phrase.id, async () => {
      try {
        await request(`phrases/${encodeURIComponent(phrase.id)}/delete`, {});
        // Out of the state before the queue lets go of it, so the row never flickers back.
        setState(previous => previous ? { ...previous, phrases: removePhrase(previous.phrases, phrase.id) } : previous);
      } catch (error) {
        toast.error(messageOf(error, 'Не удалось удалить фразу. Она вернулась в список.'));
        throw error;
      }
    });
    if (!scheduled) return;
    setExpanded(current => current === phrase.id ? null : current);
    toast.notice('Фраза удалена', { label: 'Вернуть', run: () => removals.cancel(phrase.id), life: UNDO_MS });
  };
  const startRound = () => { onClose(); lesson.startPhraseRound(); };

  // The sheet stays mounted with the app: the list is built only while it is open (closing fades the last open content).
  if (!open) return <Sheet open={false} onClose={onClose} title="Мои фразы" className={styles.sheet} testId="phrases-sheet" />;
  const list = tab === 'due' ? phrasesToRepeat(visible) : allPhrases(visible);
  const busy = !!lesson.starting || !!lesson.busy;
  const empty = !overview.total ? 'Пока пусто. Запомни первую фразу — она вернётся в разговорах.'
    : tab === 'due' ? `Сейчас нечего повторять${overview.next ? ` — следующая ${overview.next}` : ''}.` : '';

  return <Sheet open={open} onClose={onClose} title="Мои фразы" subtitle="Возвращаются в разговорах, пока не станут твоими." className={styles.sheet}
    testId="phrases-sheet"
    actions={overview.round > 0 ? <button type="button" className="button primary large block" onClick={startRound} disabled={busy} data-testid="phrases-round">
      Повторить · <span className="tabular">{overview.round}</span></button> : undefined}>
    <CaptureCard variant="inline" capture={capture} onDuplicate={show} />
    <Segmented kind="tabs" block label="Какие фразы показать" value={tab} onChange={setTab} controls={tabsId}
      options={[{ id: 'due', label: `К повторению · ${overview.due}` }, { id: 'all', label: `Все · ${overview.total}` }]} />
    <div className={styles.panel} role="tabpanel" id={`${tabsId}-${tab}`} aria-labelledby={`${tabsId}-tab-${tab}`}>
      {list.length > 0 ? <ul className={styles.list}>
        {list.map(phrase => <PhraseRow key={phrase.id} phrase={phrase} open={expanded === phrase.id} busy={busyId === phrase.id}
          onToggle={() => setExpanded(current => current === phrase.id ? null : phrase.id)}
          onArchive={() => void update(phrase, { archived: true }, 'Не удалось отметить фразу.')}
          onRestore={() => void update(phrase, !phrase.archived ? { relearn: true } : phrase.status === 'learned' ? { archived: false, relearn: true } : { archived: false },
            'Не удалось вернуть фразу в повторение.')}
          onRetry={() => void update(phrase, { retryEnrichment: true }, 'Не удалось повторить разбор.')}
          onRemove={() => remove(phrase)} />)}
      </ul> : <p className={styles.empty}>{empty}</p>}
    </div>
  </Sheet>;
}
