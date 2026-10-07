'use client';

/**
 * «Подготовка к созвону» on the PC (PASS-0.5.5 §3): the entry card in Созвоны → Звонки, the sheet that takes chat screenshots and a
 * few words, the list row and the prep itself (what to remember from the rehearsal, the plan, the rehearsal button). The same flow,
 * order and copy as the iPhone.
 */
import { useEffect, useId, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  ArrowClockwiseIcon, ArrowCounterClockwiseIcon, ChatsCircleIcon, CheckCircleIcon, CurrencyDollarIcon, ImageSquareIcon, LightningIcon, PhoneCallIcon,
  PlayIcon, QuestionIcon, ShieldWarningIcon, TextAaIcon, TrashIcon, WarningIcon, XCircleIcon, XIcon,
} from '@phosphor-icons/react';
import { api } from '@/lib/client/api';
import {
  PREP_COPY, PREP_GOAL_LIMIT, PREP_MAX_IMAGES, PREP_MIN_TEXT, PREP_POLL_LIMIT_MS, PREP_POLL_MS, PREP_TEXT_LIMIT, latestReminders, prepTier,
  type CallPrep, type PrepListResponse, type PrepReminder, type PrepResponse,
} from '@/lib/preps/types';
import type { Mode } from '@/lib/types';
import { MODE_HINT, MODE_LABEL } from '../app/labels';
import { Chip, cx, kit, ProgressBar, Segmented, Sheet, Spinner, TtsButton, useInterval } from './kit';
import { formatDay } from './format';
import { preparePrepImage } from './prep-images';
import calls from './calls.module.css';
import review from './review.module.css';
import styles from './prep.module.css';

const TIER_NOTE = { 2: 'Собеседник один раз упрётся в цене или условиях.', 3: 'Собеседник жёсткий: давит до конкретного довода.' } as const;

/** Where this client runs, for the server's statistics. */
function origin(): 'web' | 'desktop' { return typeof window !== 'undefined' && window.ratmirDesktop ? 'desktop' : 'web'; }

/** `datetime-local` value for a date (local time, minutes). */
function localInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** «Скоро созвон?» — the entry above «Загрузить созвон». */
export function PrepEntryCard({ onOpen }: { onOpen: () => void }) {
  return (
    <section className={cx(kit.glass, styles.entry)} aria-labelledby="prep-entry-title">
      <span className={styles.entryIcon} aria-hidden="true"><PhoneCallIcon size={22} weight="bold" /></span>
      <div className={styles.entryCopy}>
        <strong id="prep-entry-title">{PREP_COPY.entryTitle}</strong>
        <span>{PREP_COPY.entryText}</span>
      </div>
      <button type="button" className={cx(kit.btn, kit.primary, styles.entryAction)} onClick={onOpen} data-testid="prep-open">
        {PREP_COPY.entryAction}
      </button>
    </section>
  );
}

type Shot = { key: string; file: File; url: string };

/** «Подготовка к созвону»: screenshots (drop, paste, pick), a note, the goal and the time; «Подготовить» posts multipart. */
export function PrepSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (prep: CallPrep) => void }) {
  const ids = useId();
  const [shots, setShots] = useState<Shot[]>([]);
  const [text, setText] = useState('');
  const [goal, setGoal] = useState('');
  const [when, setWhen] = useState('');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<'images' | 'sending' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const shotsRef = useRef(shots);
  shotsRef.current = shots;

  useEffect(() => () => { for (const shot of shotsRef.current) URL.revokeObjectURL(shot.url); }, []);

  function reset() {
    for (const shot of shots) URL.revokeObjectURL(shot.url);
    setShots([]); setText(''); setGoal(''); setWhen(''); setError(null); setBusy(null);
    if (input.current) input.current.value = '';
  }

  async function add(files: File[]) {
    const images = files.filter(file => file.type.startsWith('image/'));
    if (!images.length) { if (files.length) setError('Это не картинки. Нужны скриншоты переписки.'); return; }
    setError(null);
    const room = PREP_MAX_IMAGES - shotsRef.current.length;
    if (room <= 0) { setError(`Не больше ${PREP_MAX_IMAGES} скриншотов.`); return; }
    if (images.length > room) setError(`Взял первые ${room}: не больше ${PREP_MAX_IMAGES} скриншотов.`);
    setBusy('images');
    try {
      const ready: Shot[] = [];
      for (const file of images.slice(0, room)) {
        try {
          const prepared = await preparePrepImage(file);
          ready.push({ key: crypto.randomUUID(), file: prepared, url: URL.createObjectURL(prepared) });
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не получилось открыть скриншот.'); }
      }
      setShots(current => [...current, ...ready].slice(0, PREP_MAX_IMAGES));
    } finally { setBusy(null); if (input.current) input.current.value = ''; }
  }

  function remove(key: string) {
    setShots(current => {
      const shot = current.find(item => item.key === key);
      if (shot) URL.revokeObjectURL(shot.url);
      return current.filter(item => item.key !== key);
    });
  }

  // Ctrl+V anywhere while the sheet is open: pasted screenshots join the list; pasted text still goes into the focused field.
  const addRef = useRef(add);
  addRef.current = add;
  useEffect(() => {
    if (!open) return;
    const onPaste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])].filter(file => file.type.startsWith('image/'));
      if (!files.length) return;
      event.preventDefault();
      void addRef.current(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [open]);

  const enough = shots.length > 0 || text.trim().length >= PREP_MIN_TEXT;
  async function submit() {
    if (busy || !enough) { if (!enough) setError(PREP_COPY.empty); return; }
    setError(null); setBusy('sending');
    const form = new FormData();
    for (const shot of shots) form.append('images', shot.file, shot.file.name);
    if (text.trim()) form.set('text', text.trim());
    if (goal.trim()) form.set('goal', goal.trim());
    if (when) { const time = new Date(when); if (Number.isFinite(time.getTime())) form.set('callAt', time.toISOString()); }
    form.set('origin', origin());
    try {
      let response: Response;
      try { response = await fetch('/api/preps', { method: 'POST', body: form }); }
      catch { throw new Error('Нет связи с сервером. Проверь интернет и попробуй ещё раз.'); }
      let data: Record<string, unknown> = {};
      try { data = await response.json(); } catch { /* a proxy page */ }
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Сервер не ответил (код ${response.status}). Повтори через минуту.`);
      const prep = (data as Partial<PrepResponse>).prep;
      if (!prep?.id) throw new Error(PREP_COPY.failed);
      reset(); onCreated(prep);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : PREP_COPY.failed); setBusy(null);
    }
  }

  const dropTarget = {
    onDragOver: (event: DragEvent) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; },
    onDragEnter: (event: DragEvent) => { event.preventDefault(); setDragging(true); },
    onDragLeave: (event: DragEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); },
    onDrop: (event: DragEvent) => { event.preventDefault(); setDragging(false); void add([...event.dataTransfer.files]); },
  };

  return (
    <Sheet open={open} onClose={() => { if (busy !== 'sending') onClose(); }} title={PREP_COPY.sheetTitle} footer={
      <div className={styles.sheetActions}>
        <span className={styles.sheetHint}>{enough ? 'Разбор займёт минуту-две.' : PREP_COPY.empty}</span>
        <button type="button" className={cx(kit.btn, kit.primary)} onClick={submit} disabled={!!busy || !enough} data-testid="prep-submit">
          {busy === 'sending' ? <Spinner /> : null}{busy === 'sending' ? 'Отправляю…' : PREP_COPY.submit}
        </button>
      </div>}>
      <div className={styles.form}>
        <div className={kit.field}>
          <span className={kit.label} id={`${ids}-shots`}>{PREP_COPY.images}</span>
          <label className={cx(calls.drop, styles.drop)} data-dragging={dragging} {...dropTarget} aria-describedby={`${ids}-shots-hint`}>
            <input ref={input} className={calls.fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/*" multiple
              onChange={event => void add([...(event.target.files ?? [])])} aria-labelledby={`${ids}-shots`} />
            <span className={calls.dropIcon} aria-hidden="true">{busy === 'images' ? <Spinner /> : <ImageSquareIcon size={22} weight="bold" />}</span>
            <strong>{dragging ? 'Отпускай' : shots.length ? 'Добавить ещё' : 'Перетащи или выбери скриншоты'}</strong>
            <span className={calls.dropHint} id={`${ids}-shots-hint`}>
              <span className={calls.pointerOnly}>Можно вставить из буфера: Ctrl+V. </span>До {PREP_MAX_IMAGES} штук, по порядку переписки.
            </span>
          </label>
          {shots.length ? (
            <ol className={styles.thumbs} aria-label="Добавленные скриншоты">
              {shots.map((shot, index) => (
                <li key={shot.key} className={styles.thumb}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={shot.url} alt={`Скриншот ${index + 1}`} />
                  <span className={styles.thumbIndex} aria-hidden="true">{index + 1}</span>
                  <button type="button" className={cx(kit.iconBtn, styles.thumbRemove)} onClick={() => remove(shot.key)} aria-label={`Убрать скриншот ${index + 1}`}>
                    <XIcon size={14} weight="bold" />
                  </button>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
        <div className={kit.field}>
          <label className={kit.label} htmlFor={`${ids}-text`}>{PREP_COPY.text}</label>
          <textarea id={`${ids}-text`} className={kit.input} rows={3} maxLength={PREP_TEXT_LIMIT} value={text} onChange={event => setText(event.target.value)}
            placeholder={PREP_COPY.textPlaceholder} data-testid="prep-text" />
        </div>
        <div className={styles.formRow}>
          <div className={cx(kit.field, styles.wide)}>
            <label className={kit.label} htmlFor={`${ids}-goal`}>{PREP_COPY.goal}</label>
            <input id={`${ids}-goal`} className={kit.input} maxLength={PREP_GOAL_LIMIT} value={goal} onChange={event => setGoal(event.target.value)}
              placeholder={PREP_COPY.goalPlaceholder} />
          </div>
          <div className={kit.field}>
            <label className={kit.label} htmlFor={`${ids}-when`}>{PREP_COPY.callAt}</label>
            <input id={`${ids}-when`} className={kit.input} type="datetime-local" value={when} min={localInput(new Date())} onChange={event => setWhen(event.target.value)} />
          </div>
        </div>
        {error ? <div className={calls.error} role="alert"><WarningIcon size={16} weight="bold" />{error}</div> : null}
      </div>
    </Sheet>
  );
}

/** One row in «Подготовки». */
export function PrepItem({ prep, selected, onSelect }: { prep: CallPrep; selected: boolean; onSelect: () => void }) {
  const remembered = !!latestReminders(prep);
  const chip = prep.status === 'reading' ? <Chip tone="violet">Читаю</Chip> : prep.status === 'failed' ? <Chip tone="error">Не вышло</Chip>
    : remembered ? <Chip tone="lime">Репетиция была</Chip> : <Chip tone="neutral">Готово</Chip>;
  const meta = [prep.counterpart, prep.when ?? formatDay(prep.createdAt)].filter(Boolean).join(' · ');
  return (
    <li>
      <button type="button" className={calls.item} aria-current={selected || undefined} onClick={onSelect}>
        <span className={calls.itemTop}><strong>{prep.title ?? (prep.status === 'reading' ? PREP_COPY.reading : PREP_COPY.sheetTitle)}</strong>{chip}</span>
        {meta ? <span className={calls.itemMeta}>{meta}</span> : null}
      </button>
    </li>
  );
}

/** The English line to say, with «Послушать». */
function Line({ label, text }: { label: string; text: string }) {
  return (
    <div className={review.better}>
      <div className={review.betterHead}><span>{label}</span><TtsButton text={text} compact label="Послушать" /></div>
      <p lang="en">{text}</p>
    </div>
  );
}

function Block({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section id={id} className={cx(kit.glass, review.section)} aria-labelledby={`${id}-title`}>
      <div className={review.sectionHead}><h3 id={`${id}-title`}>{title}</h3>{hint ? <small>{hint}</small> : null}</div>
      {children}
    </section>
  );
}

const REMINDER_ICON: Record<PrepReminder['kind'], typeof WarningIcon> = { cost: CurrencyDollarIcon, pattern: ArrowCounterClockwiseIcon, language: TextAaIcon };

/** «Перед звонком помни»: what the latest reviewed rehearsal showed. */
function Remember({ items, title }: { items: PrepReminder[]; title: string }) {
  return (
    <section className={cx(kit.glass, review.section, styles.remember)} aria-labelledby="prep-remember-title" data-testid="prep-remember">
      <div className={review.sectionHead}><h3 id="prep-remember-title">{PREP_COPY.remember}</h3><small>{title}</small></div>
      <ol className={review.entries}>
        {items.map((item, index) => {
          const Icon = REMINDER_ICON[item.kind] ?? WarningIcon;
          return (
            <li key={`${item.kind}-${index}`} className={review.entry}>
              <div className={review.entryHead}><span className={styles.reminderIcon} aria-hidden="true"><Icon size={18} weight="bold" /></span><h4>{item.title}</h4></div>
              {item.said ? <div className={review.quoteRow}><blockquote className={cx(kit.quote, kit.en)} lang="en">{item.said}</blockquote></div> : null}
              {item.better ? <Line label="Скажи" text={item.better} /> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** A prep: polls while Sol reads it, then the plan and the rehearsal. */
export function PrepDetailView({ prepId, initial, onChanged, onDeleted, onStart, onOpenSession }: {
  prepId: string; initial: CallPrep | null; onChanged: () => void; onDeleted: () => void;
  onStart: (prepId: string, mode: Mode) => void; onOpenSession: (sessionId: string) => void;
}) {
  const [prep, setPrep] = useState<CallPrep | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('call');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const started = useRef(Date.now());
  const [slow, setSlow] = useState(false);

  useEffect(() => { if (initial && (!prep || initial.updatedAt > prep.updatedAt)) setPrep(initial); }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let cancelled = false;
    api<PrepResponse>(`preps/${prepId}`).then(result => { if (!cancelled) setPrep(result.prep); })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : PREP_COPY.failed); });
    return () => { cancelled = true; };
  }, [prepId]);

  const reading = prep?.status === 'reading';
  const timedOut = reading && Date.now() - started.current > PREP_POLL_LIMIT_MS;
  useInterval(() => {
    if (Date.now() - started.current > 25_000) setSlow(true);
    void api<PrepResponse>(`preps/${prepId}`).then(result => {
      setPrep(result.prep);
      if (result.prep.status !== 'reading') onChanged();
    }).catch(() => undefined);
  }, reading && !timedOut ? PREP_POLL_MS : null);
  // Rehearsal reviews land in the background: refresh while one is being analysed.
  const analysing = prep?.rehearsals.some(item => item.status === 'analysing') ?? false;
  useInterval(() => { void api<PrepResponse>(`preps/${prepId}`).then(result => setPrep(result.prep)).catch(() => undefined); }, analysing ? 4000 : null);

  async function retry() {
    setBusy(true); setError(null);
    try { const result = await api<PrepResponse>(`preps/${prepId}/retry`, {}); setPrep(result.prep); started.current = Date.now(); setSlow(false); onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : PREP_COPY.failed); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError(null);
    try { await api(`preps/${prepId}/delete`, {}); onDeleted(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось удалить.'); setBusy(false); }
  }

  const reminders = useMemo(() => prep ? latestReminders(prep) : null, [prep]);
  if (!prep) {
    return <div className={cx(kit.glass, styles.state)}>{error ? <p className={calls.error} role="alert"><WarningIcon size={16} weight="bold" />{error}</p> : <Spinner label="Открываю подготовку" />}</div>;
  }
  if (prep.status === 'reading') {
    return (
      <div className={cx(kit.glass, styles.state)} aria-live="polite" data-testid="prep-reading">
        <strong>{PREP_COPY.reading}</strong>
        <p>{timedOut ? 'Что-то долго. Загляни сюда через пару минут или обнови страницу.' : slow ? PREP_COPY.readingSlow : `${prep.input.images ? `Скриншотов: ${prep.input.images}.` : 'Читаю твою заметку.'} Сверяю с твоими прошлыми созвонами, ставками и ошибками.`}</p>
        <ProgressBar value={Math.min(0.95, (Date.now() - started.current) / 90_000)} label={PREP_COPY.reading} />
      </div>
    );
  }
  if (prep.status === 'failed') {
    return (
      <div className={cx(kit.glass, styles.state)} role="alert">
        <strong><XCircleIcon size={18} weight="bold" /> {PREP_COPY.failed}</strong>
        {prep.note ? <p>{prep.note}</p> : null}
        {error ? <p className={calls.error}><WarningIcon size={16} weight="bold" />{error}</p> : null}
        <div className={styles.stateActions}>
          <button type="button" className={cx(kit.btn, kit.primary)} onClick={retry} disabled={busy}><ArrowClockwiseIcon size={16} weight="bold" />Повторить</button>
          <button type="button" className={cx(kit.btn, kit.quiet)} onClick={remove} disabled={busy}><TrashIcon size={16} weight="bold" />{PREP_COPY.delete}</button>
        </div>
      </div>
    );
  }

  const tier = prepTier(prep.rehearsals.length);
  const meta = [prep.counterpart, prep.when].filter(Boolean);
  return (
    <article className={styles.detail} aria-label={prep.title ?? PREP_COPY.sheetTitle} data-testid="prep-detail">
      <header className={cx(kit.glass, review.head)}>
        <div className={review.headTitle}>
          <h2>{prep.title ?? PREP_COPY.sheetTitle}</h2>
          {meta.length ? <div className={review.metaLine}>{meta.map(item => <span key={item}>{item}</span>)}</div> : null}
        </div>
        <div className={styles.rehearse}>
          <Segmented label="Режим репетиции" value={mode} onChange={setMode} options={[{ id: 'call', label: MODE_LABEL.call }, { id: 'learning', label: MODE_LABEL.learning }]} />
          <button type="button" className={cx(kit.btn, kit.primary, styles.rehearseButton)} onClick={() => onStart(prep.id, mode)} data-testid="prep-rehearse">
            {prep.rehearsals.length ? <LightningIcon size={18} weight="bold" /> : <PlayIcon size={18} weight="fill" />}
            {prep.rehearsals.length ? PREP_COPY.rehearseAgain : PREP_COPY.rehearse}
          </button>
          <small>{MODE_HINT[mode]} {TIER_NOTE[tier]}</small>
        </div>
      </header>

      {reminders ? <Remember items={reminders.remember} title={`Репетиция ${formatDay(reminders.createdAt)}`} /> : null}

      {prep.situation || prep.goal ? (
        <Block id="prep-situation" title={PREP_COPY.situation}>
          {prep.situation ? <p className={review.lead}>{prep.situation}</p> : null}
          {prep.goal ? <p className={styles.goal}><CheckCircleIcon size={18} weight="bold" aria-hidden="true" /><span><strong>{PREP_COPY.goalTitle}:</strong> {prep.goal}</span></p> : null}
        </Block>
      ) : null}

      {prep.watchouts.length ? (
        <Block id="prep-watchouts" title={PREP_COPY.watchouts} hint="из твоих прошлых созвонов">
          <ol className={review.entries}>
            {prep.watchouts.map((item, index) => (
              <li key={index} className={review.entry}>
                <div className={review.entryHead}><span className={review.rank}>{index + 1}</span><h4>{item.title}</h4></div>
                <p>{item.why}</p>
                <Line label={PREP_COPY.instead} text={item.instead} />
              </li>
            ))}
          </ol>
        </Block>
      ) : null}

      {prep.questions.length ? (
        <Block id="prep-questions" title={PREP_COPY.questions}>
          <ol className={review.entries}>
            {prep.questions.map((item, index) => (
              <li key={index} className={review.entry}>
                <div className={review.entryHead}><span className={styles.reminderIcon} aria-hidden="true"><QuestionIcon size={18} weight="bold" /></span>
                  <h4 lang="en" className={styles.english}>{item.en}</h4><TtsButton text={item.en} compact /></div>
                <p>{item.why}</p>
              </li>
            ))}
          </ol>
        </Block>
      ) : null}

      {prep.lines ? (
        <Block id="prep-lines" title={PREP_COPY.lines}>
          <div className={styles.lines}>
            <Line label={PREP_COPY.opening} text={prep.lines.opening} />
            <Line label={PREP_COPY.pitch} text={prep.lines.pitch} />
            <Line label={PREP_COPY.close} text={prep.lines.close} />
          </div>
        </Block>
      ) : null}

      {prep.price ? (
        <Block id="prep-price" title={PREP_COPY.price}>
          <dl className={styles.price}>
            <div><dt>{PREP_COPY.anchor}</dt><dd>{prep.price.anchor}</dd></div>
            <div><dt>{PREP_COPY.floor}</dt><dd>{prep.price.floor}</dd></div>
          </dl>
          <Line label={PREP_COPY.say} text={prep.price.say} />
          <Line label={PREP_COPY.ifLow} text={prep.price.ifLow} />
          {prep.price.notes ? <p className={review.muted}>{prep.price.notes}</p> : null}
        </Block>
      ) : null}

      {prep.avoid.length || prep.risks.length ? (
        <div className={styles.pair}>
          {prep.avoid.length ? (
            <Block id="prep-avoid" title={PREP_COPY.avoid}>
              <ul className={styles.bullets}>{prep.avoid.map((item, index) => <li key={index}><XCircleIcon size={16} weight="bold" aria-hidden="true" />{item}</li>)}</ul>
            </Block>
          ) : null}
          {prep.risks.length ? (
            <Block id="prep-risks" title={PREP_COPY.risks}>
              <ul className={styles.bullets}>{prep.risks.map((item, index) => <li key={index}><ShieldWarningIcon size={16} weight="bold" aria-hidden="true" />{item}</li>)}</ul>
            </Block>
          ) : null}
        </div>
      ) : null}

      {prep.rehearsals.length ? (
        <Block id="prep-rehearsals" title="Репетиции">
          <ul className={styles.rehearsals}>
            {prep.rehearsals.map((item, index) => (
              <li key={item.sessionId}>
                <ChatsCircleIcon size={18} weight="bold" aria-hidden="true" />
                <span>{index + 1}. {formatDay(item.createdAt)} · {MODE_LABEL[item.mode]} · давление {item.tier} из 3</span>
                {item.status === 'deleted' ? <span className={kit.faint}>удалена</span>
                  : item.status === 'analysing' ? <span className={kit.faint}>разбираю…</span>
                  : <button type="button" className={cx(kit.btn, kit.quiet, kit.small)} onClick={() => onOpenSession(item.sessionId)}>Открыть</button>}
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      {prep.limitations.length ? <p className={styles.footnote}>{prep.limitations.join(' ')}</p> : null}
      {error ? <p className={calls.error} role="alert"><WarningIcon size={16} weight="bold" />{error}</p> : null}
      <div className={styles.deleteRow}>
        {confirming ? <>
          <span>Удалить подготовку? Репетиции останутся в истории.</span>
          <button type="button" className={cx(kit.btn, kit.danger, kit.small)} onClick={remove} disabled={busy}>Удалить</button>
          <button type="button" className={cx(kit.btn, kit.quiet, kit.small)} onClick={() => setConfirming(false)}>Отмена</button>
        </> : <button type="button" className={cx(kit.btn, kit.quiet, kit.small)} onClick={() => setConfirming(true)}><TrashIcon size={16} weight="bold" />{PREP_COPY.delete}</button>}
      </div>
    </article>
  );
}

/** «Подготовки» above «Звонки»: refreshed from the app state, a row per prep. */
export function PrepList({ preps, selected, onSelect }: { preps: CallPrep[]; selected: string | null; onSelect: (id: string) => void }) {
  if (!preps.length) return null;
  return (
    <section className={calls.callsBlock} aria-labelledby="preps-list-title" data-enter>
      <div className={calls.sectionTitle}>
        <h2 id="preps-list-title">{PREP_COPY.list}</h2>
        <span className={calls.sectionCount}>{preps.length}</span>
      </div>
      <ul className={cx(kit.glass, calls.list)}>
        {preps.map(prep => <PrepItem key={prep.id} prep={prep} selected={prep.id === selected} onSelect={() => onSelect(prep.id)} />)}
      </ul>
    </section>
  );
}

/** Fresh list for the Созвоны screen (the app state carries the latest ten). */
export async function fetchPreps(): Promise<CallPrep[]> {
  return (await api<PrepListResponse>('preps')).preps;
}
