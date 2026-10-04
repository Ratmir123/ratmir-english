'use client';

import { ArrowsClockwiseIcon, PlayIcon, SquareIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useApp } from '../app/app-context';
import type { DraftIntent } from '../app/use-drafts';
import styles from './session.module.css';

/** The transcribed recording waiting to be sent: listen to the original, correct the words, or drop it. */
export function RecordingEvidence({ intent, retryId }: { intent: DraftIntent; retryId?: string }) {
  const { lesson } = useApp();
  const voice = lesson.voice;
  const draft = lesson.draftFor(lesson.session?.id, intent, retryId);
  if (!draft?.audioFile) return null;
  const edited = draft.originalTranscript !== undefined && draft.originalTranscript.trim() !== draft.text.trim();
  return <div className={styles.evidence} data-testid="recording-draft">
    <div className={styles.evidenceHead}><strong>Твоя запись</strong><span className={`chip ${edited ? 'violet' : 'lime'}`}>{edited ? 'Текст исправлен' : 'Можно отправлять'}</span></div>
    <p className="caption">Послушай оригинал и проверь слова. Правка расшифровки учитывается отдельно от речи.</p>
    <div className={styles.evidenceActions}>
      <button type="button" className="button small secondary" data-testid="replay-recording" disabled={voice.state === 'listening' || !!lesson.busy}
        onClick={() => voice.playingLearnerRecording ? voice.stop() : void voice.playRecording(draft.audioFile)}>
        {voice.playingLearnerRecording ? <SquareIcon size={14} weight="fill" /> : <PlayIcon size={14} weight="fill" />}{voice.playingLearnerRecording ? 'Стоп' : 'Моя запись'}
      </button>
      <button type="button" className="text-button muted" onClick={lesson.discardDraft} disabled={!!lesson.busy}>Удалить черновик</button>
    </div>
    {edited && <details className={styles.original}><summary>Исходная расшифровка</summary><p lang="en">{draft.originalTranscript}</p></details>}
  </div>;
}

/** Recognition failed or was interrupted: the original stays here until it is sent or deleted. */
export function UnuploadedRecording() {
  const { lesson } = useApp();
  const voice = lesson.voice;
  if (!voice.hasUnuploadedRecording || voice.state === 'listening' || voice.state === 'transcribing') return null;
  return <div className={`banner warning ${styles.unuploaded}`} role="status">
    <WarningCircleIcon size={18} weight="fill" />
    <span className="banner-copy"><strong>Запись сохранена, но не распознана</strong>
      <span className="caption">Она есть только в этом окне. Распознай её ещё раз или удали, чтобы продолжить.</span>
      <span className="banner-actions">
        <button type="button" className="button small secondary" data-testid="replay-recording" disabled={!!lesson.busy} onClick={() => voice.playingLearnerRecording ? voice.stop() : void voice.playRecording()}>
          {voice.playingLearnerRecording ? <SquareIcon size={14} weight="fill" /> : <PlayIcon size={14} weight="fill" />}{voice.playingLearnerRecording ? 'Стоп' : 'Моя запись'}</button>
        <button type="button" className="button small primary" disabled={!!lesson.busy || voice.state === 'thinking'} onClick={() => void voice.retry()}><ArrowsClockwiseIcon size={15} />Распознать ещё раз</button>
        <button type="button" className="text-button muted" disabled={!!lesson.busy} onClick={() => { voice.discardRecording(); lesson.discardDraft(); }}>Удалить запись</button>
      </span></span>
  </div>;
}
