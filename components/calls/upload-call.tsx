'use client';

/**
 * «Загрузить созвон»: drop zone + picker (audio/video, .txt/.vtt/.sbv/.srt/.md), «Описать по памяти»,
 * «Вставить текст», optional details. Audio goes through the background upload store (resumable chunks,
 * Electron extracts compact audio first); text sources are posted directly.
 */
import { useEffect, useId, useRef, useState, useSyncExternalStore, type DragEvent } from 'react';
import {
  ArrowRightIcon, BrainIcon, ClipboardTextIcon, FileAudioIcon, FileTextIcon, InfoIcon, NotePencilIcon, UploadSimpleIcon, WarningIcon, XIcon,
} from '@phosphor-icons/react';
import { api } from '@/lib/client/api';
import { MAX_CALL_UPLOAD_BYTES, type CallContext, type CallDetail, type CreateCallRequest } from '@/lib/calls/types';
import { cx, kit, Segmented, Sheet, Spinner } from './kit';
import {
  classifyCallFile, CONTEXT_LABEL, DEBRIEF_MIN_CHARS, FILE_ACCEPT, formatBytes, MEMORY_MIN_CHARS, TEXT_LIMIT_BYTES, titleFromFileName, utf8Bytes,
  type CallFileKind,
} from './format';
import { dismissUpload, getServerUploadsSnapshot, getUploadsSnapshot, startAudioUpload, subscribeUploads, type CallMeta } from './upload-store';
import styles from './calls.module.css';

type Draft =
  | { mode: 'file'; file: File; kind: CallFileKind }
  | { mode: 'paste'; kind: 'transcript' | 'debrief' }
  | { mode: 'memory' };

const CONTEXTS: CallContext[] = ['work', 'life', 'relocation', 'other'];

function localDate(value: number | Date = new Date()): string {
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function CallUploadCard({ onCreated, variant = 'full' }: { onCreated: (callId: string) => void; variant?: 'full' | 'compact' }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [jobKey, setJobKey] = useState<string | null>(null);
  const uploads = useSyncExternalStore(subscribeUploads, getUploadsSnapshot, getServerUploadsSnapshot);
  const job = jobKey ? uploads.find(item => item.key === jobKey) ?? null : null;
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [counterpart, setCounterpart] = useState('');
  const [date, setDate] = useState(localDate());
  const [context, setContext] = useState<CallContext>('work');
  const [notes, setNotes] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const firstField = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const ids = useId();
  const desktopExtract = typeof window !== 'undefined' && !!window.ratmirDesktop?.prepareCallAudio;
  const compact = variant === 'compact';

  useEffect(() => { if (draft) firstField.current?.focus(); }, [draft]);

  function reset() {
    setDraft(null); setError(null); setText(''); setTitle(''); setCounterpart(''); setNotes(''); setDate(localDate()); setContext('work');
    if (input.current) input.current.value = '';
  }

  function choose(file: File | null | undefined) {
    if (!file) return;
    setError(null);
    const kind = classifyCallFile(file.name, file.type);
    if (!kind) { setError('Такой формат не подходит. Нужна запись (mp3, m4a, mp4, mov, wav, webm…) или текст (.txt, .vtt, .srt, .sbv, .md).'); return; }
    if (kind === 'audio' && file.size > MAX_CALL_UPLOAD_BYTES && !desktopExtract) { setError('Файл больше 2 ГБ. Сохрани только звук или обрежь запись.'); return; }
    if (kind !== 'audio' && file.size > TEXT_LIMIT_BYTES[kind]) { setError(`Текст слишком большой: до ${formatBytes(TEXT_LIMIT_BYTES[kind])}.`); return; }
    setDraft({ mode: 'file', file, kind });
    setTitle(titleFromFileName(file.name));
    if (kind === 'audio' && file.lastModified) setDate(localDate(file.lastModified));
  }

  function onDrop(event: DragEvent) {
    event.preventDefault(); setDragging(false);
    choose(event.dataTransfer.files?.[0]);
  }

  const minChars = draft?.mode === 'memory' ? MEMORY_MIN_CHARS : draft?.mode === 'paste' && draft.kind === 'debrief' ? DEBRIEF_MIN_CHARS : 0;
  const memoryShort = minChars > 0 && text.trim().length < minChars;
  const textMissing = (draft?.mode === 'paste' || draft?.mode === 'memory') && !text.trim();

  async function submit() {
    if (!draft || busy) return;
    setError(null);
    const meta: CallMeta = {
      title: title.trim() || undefined, counterpart: counterpart.trim() || undefined, context,
      occurredAt: date ? new Date(`${date}T12:00:00`).toISOString() : undefined, notes: notes.trim() || undefined,
    };
    setBusy(true);
    try {
      if (draft.mode === 'file' && draft.kind === 'audio') {
        let key = '';
        const id = await startAudioUpload(draft.file, meta, value => { key = value; setJobKey(value); });
        if (!id) {
          const failed = getUploadsSnapshot().find(item => item.key === key);
          setError(failed?.error ?? 'Не удалось начать загрузку. Проверь соединение и попробуй ещё раз.');
          // The draft stays here for another try; the failed job should not linger in the calls list.
          dismissUpload(key); setJobKey(null);
          return;
        }
        setJobKey(null); reset(); onCreated(id); return;
      }
      let source: CreateCallRequest['source'];
      if (draft.mode === 'memory') {
        if (text.trim().length < MEMORY_MIN_CHARS) return;
        source = { type: 'memory', text: text.trim() };
      } else {
        const body = draft.mode === 'file' ? await draft.file.text() : text;
        const kind = draft.kind === 'debrief' ? 'debrief' : 'transcript';
        if (!body.trim()) { setError('В файле нет текста.'); return; }
        if (utf8Bytes(body) > TEXT_LIMIT_BYTES[kind]) { setError(`Текст слишком большой: до ${formatBytes(TEXT_LIMIT_BYTES[kind])}.`); return; }
        source = kind === 'debrief' ? { type: 'debrief', text: body } : { type: 'transcript', text: body, ...(draft.mode === 'file' ? { fileName: draft.file.name } : {}) };
      }
      const request: CreateCallRequest = { ...meta, source };
      const detail = await api<CallDetail>('calls', request);
      reset(); onCreated(detail.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось отправить звонок.');
    } finally { setBusy(false); }
  }

  const dropTarget = {
    onDragOver: (event: DragEvent) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; },
    onDragEnter: (event: DragEvent) => { event.preventDefault(); setDragging(true); },
    onDragLeave: (event: DragEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); },
    onDrop,
  };
  const fileInput = <input ref={input} className={styles.fileInput} type="file" accept={FILE_ACCEPT} onChange={event => choose(event.target.files?.[0])} aria-label="Выбрать файл звонка" />;

  // Compact (Today's quick list): a single row; the details form opens in a sheet instead of growing the list.
  if (compact) {
    return (
      <section className={cx(kit.scope, styles.quickUpload)} aria-label="Загрузить созвон">
        <label className={cx(styles.drop, styles.dropCompact)} data-dragging={dragging} {...dropTarget}>
          {fileInput}
          <span className={styles.dropIcon} aria-hidden="true"><UploadSimpleIcon size={20} weight="bold" /></span>
          <strong>{dragging ? 'Отпускай — разберу' : 'Загрузить созвон'}</strong>
          <span className={styles.dropHint}><span className={styles.pointerOnly}>Перетащи сюда запись, видео или текст</span><span className={styles.touchOnly}>Запись, видео или текст звонка</span></span>
        </label>
        <div className={styles.altRow}>
          <button type="button" className={cx(kit.btn, kit.quiet, kit.small)} onClick={() => { setDraft({ mode: 'memory' }); setTitle('Звонок по памяти'); }}>
            <BrainIcon size={16} weight="bold" />По памяти
          </button>
        </div>
        {error && !draft ? <div className={styles.error} role="alert"><WarningIcon size={16} weight="bold" />{error}</div> : null}
        {draft ? <Sheet open onClose={() => { if (!busy) reset(); }} title={draft.mode === 'memory' ? 'Звонок по памяти' : 'Новый созвон'}>{renderDetails(draft, true)}</Sheet> : null}
      </section>
    );
  }

  // Full (Calls tab): one surface that is itself the drop target — the file row first, the no-file options under a hairline.
  if (!draft) {
    return (
      <section className={cx(kit.scope, kit.glass, styles.upload)} aria-label="Загрузить созвон" data-dragging={dragging} {...dropTarget}>
        <label className={styles.pick}>
          {fileInput}
          <span className={styles.dropIcon} aria-hidden="true"><UploadSimpleIcon size={22} weight="bold" /></span>
          <span className={styles.pickCopy}>
            <strong>{dragging ? 'Отпускай — разберу' : 'Загрузить запись или расшифровку'}</strong>
            <span>
              <span className={styles.pointerOnly}>Перетащи файл сюда или нажми, чтобы выбрать. </span>
              <span className={styles.touchOnly}>Нажми, чтобы выбрать файл. </span>
              Аудио, видео, .txt, .vtt, .srt, .md
            </span>
          </span>
        </label>
        <div className={styles.uploadAlt}>
          <span className={styles.uploadAltLabel}>Нет файла?</span>
          <button type="button" className={cx(kit.btn, kit.quiet, kit.small)} onClick={() => { setDraft({ mode: 'memory' }); setTitle('Звонок по памяти'); }}>
            <BrainIcon size={16} weight="bold" />Описать по памяти
          </button>
          <button type="button" className={cx(kit.btn, kit.quiet, kit.small)} onClick={() => { setDraft({ mode: 'paste', kind: 'transcript' }); setTitle('Расшифровка звонка'); }}>
            <ClipboardTextIcon size={16} weight="bold" />Вставить текст
          </button>
        </div>
        {error ? <div className={cx(styles.error, styles.uploadError)} role="alert"><WarningIcon size={16} weight="bold" />{error}</div> : null}
        <p className={styles.tip}>Лучше всего — запись, где слышно обоих. Сырые записи хранятся 30 дней, расшифровка и разбор — пока не удалишь. Предупреди собеседника, что записываешь звонок.</p>
      </section>
    );
  }
  return renderDetails(draft, false);

  function renderDetails(draft: Draft, inSheet: boolean) {
  const isText = draft.mode !== 'file';
  const textLabel = draft.mode === 'memory' ? 'Как прошёл звонок' : draft.kind === 'debrief' ? 'Готовый разбор' : 'Расшифровка';
  return (
    <section className={inSheet ? styles.uploadSheet : cx(kit.scope, kit.glass, styles.uploadForm)} aria-label="Детали созвона">
      {draft.mode === 'file' ? (
        <div className={styles.fileChip}>
          <span className={styles.fileIcon} aria-hidden="true">{draft.kind === 'audio' ? <FileAudioIcon size={22} weight="bold" /> : <FileTextIcon size={22} weight="bold" />}</span>
          <span className={styles.fileName}>
            <strong title={draft.file.name}>{draft.file.name}</strong>
            <span>{formatBytes(draft.file.size)} · {draft.kind === 'audio' ? (desktopExtract ? 'звук извлечётся на компьютере' : 'запись') : draft.kind === 'debrief' ? 'готовый разбор' : 'расшифровка'}</span>
          </span>
          <button type="button" className={kit.iconBtn} onClick={reset} aria-label="Выбрать другой файл"><XIcon size={16} weight="bold" /></button>
        </div>
      ) : (
        <div className={styles.uploadHead}>
          <span className={styles.fileIcon} aria-hidden="true">{draft.mode === 'memory' ? <BrainIcon size={22} weight="bold" /> : <NotePencilIcon size={22} weight="bold" />}</span>
          <strong style={{ fontSize: 16 }}>{draft.mode === 'memory' ? 'Звонок по памяти' : 'Текст звонка'}</strong>
          {inSheet ? null : <button type="button" className={kit.iconBtn} onClick={reset} aria-label="Отменить"><XIcon size={16} weight="bold" /></button>}
        </div>
      )}

      {(draft.mode === 'file' && draft.kind !== 'audio') || draft.mode === 'paste' ? (
        <Segmented label="Что это за текст" block value={draft.kind === 'debrief' ? 'debrief' : 'transcript'}
          options={[{ id: 'transcript', label: 'Расшифровка' }, { id: 'debrief', label: 'Готовый разбор' }]}
          onChange={kind => setDraft(current => current && current.mode !== 'memory' ? { ...current, kind } as Draft : current)} />
      ) : null}

      <div className={styles.form}>
        {isText ? (
          <div className={kit.field}>
            <label className={kit.label} htmlFor={`${ids}-text`}>{textLabel}</label>
            <textarea id={`${ids}-text`} ref={element => { firstField.current = element; }} className={kit.input} rows={draft.mode === 'memory' ? 6 : 8}
              value={text} onChange={event => setText(event.target.value)}
              placeholder={draft.mode === 'memory'
                ? 'Кто звонил, о чём договорились, какие были цифры, где было неловко. Можно по-русски.'
                : draft.kind === 'debrief' ? 'Вставь свой разбор в Markdown.' : 'Вставь текст: «Имя: реплика» или строки с таймкодами.'} />
            {minChars ? (
              <span className={styles.counter}>{memoryShort ? `Ещё ${minChars - text.trim().length} символов` : 'Достаточно — чем подробнее, тем точнее разбор'}</span>
            ) : null}
            {draft.mode === 'memory' ? <p className={styles.hint}><InfoIcon size={14} weight="bold" />По памяти разбор будет только про стратегию: без цитат, английского и темпа речи.</p> : null}
          </div>
        ) : null}
        <div className={styles.formRow}>
          <div className={kit.field}>
            <label className={kit.label} htmlFor={`${ids}-title`}>Название</label>
            <input id={`${ids}-title`} ref={element => { if (!isText) firstField.current = element; }} className={kit.input} value={title} maxLength={120}
              onChange={event => setTitle(event.target.value)} placeholder="Например: скрининг агентства" />
          </div>
          <div className={kit.field}>
            <label className={kit.label} htmlFor={`${ids}-who`}>Собеседник</label>
            <input id={`${ids}-who`} className={kit.input} value={counterpart} maxLength={120} onChange={event => setCounterpart(event.target.value)} placeholder="Имя и компания" />
          </div>
        </div>
        <div className={styles.formRow}>
          <div className={kit.field}>
            <label className={kit.label} htmlFor={`${ids}-date`}>Дата звонка</label>
            <input id={`${ids}-date`} className={kit.input} type="date" value={date} max={localDate()} onChange={event => setDate(event.target.value)} />
          </div>
          <div className={kit.field}>
            <span className={kit.label} id={`${ids}-context`}>Контекст</span>
            <div className={styles.contextChips} role="radiogroup" aria-labelledby={`${ids}-context`}>
              {CONTEXTS.map(item => (
                <button key={item} type="button" role="radio" aria-checked={context === item} className={styles.contextChip} onClick={() => setContext(item)}>{CONTEXT_LABEL[item]}</button>
              ))}
            </div>
          </div>
        </div>
        <div className={kit.field}>
          <label className={kit.label} htmlFor={`${ids}-notes`}>Чего ты хотел от звонка <span className={kit.faint}>(необязательно)</span></label>
          <textarea id={`${ids}-notes`} className={kit.input} rows={2} style={{ minHeight: 72 }} maxLength={4000} value={notes} onChange={event => setNotes(event.target.value)}
            placeholder="Цель, свой пол цены, заметки к подготовке — разбор сравнит с ними." />
        </div>
      </div>

      {error ? <div className={styles.error} role="alert"><WarningIcon size={16} weight="bold" />{error}</div> : null}
      <div className={styles.formActions}>
        <button type="button" className={cx(kit.btn, kit.quiet)} onClick={reset}>Отмена</button>
        <button type="button" className={cx(kit.btn, kit.primary, styles.primaryAction)} disabled={busy || memoryShort || textMissing} onClick={() => void submit()}>
          {busy ? <Spinner /> : null}
          {busy && job?.phase === 'preparing' ? 'Извлекаю звук…' : busy && job?.phase === 'creating' ? 'Создаю звонок…'
            : draft.mode === 'file' && draft.kind === 'audio' ? 'Загрузить и разобрать' : 'Разобрать звонок'}
          {busy ? null : <ArrowRightIcon size={18} weight="bold" />}
        </button>
      </div>
    </section>
  );
  }
}
