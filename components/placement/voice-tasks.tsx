'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowsClockwiseIcon, CheckCircleIcon, LightningIcon, MicrophoneIcon, PaperPlaneRightIcon, SkipForwardIcon, SpeakerHighIcon, StopIcon, WarningIcon } from '@phosphor-icons/react';
import { ApiRequestError, mediaUrl } from '@/lib/client/api';
import { createVoiceMeter } from '@/lib/browser-audio';
import type { PlacementTask, PlacementView } from '@/lib/placement/types';
import { cx, kit, Spinner } from '../calls/kit';
import { formatClock } from '../calls/format';
import { recordingGate } from './flow-model';
import { FeatureMascot } from './placement-mascot';
import { micMessage, playMetered, transcribeAnswer, type MeteredPlayback, type TaskRecorder, type TaskRecording } from './use-task-recorder';
import styles from './placement.module.css';

type SpeakingTask = Extract<PlacementTask, { kind: 'speaking' }>;
type RoleplayTask = Extract<PlacementTask, { kind: 'roleplay' }>;

export interface VoiceTaskProps {
  recorder: TaskRecorder;
  /** POST placement/speak; resolves with the next view (not applied yet) or null when the parent handled an error. */
  submit: (text: string, audioFile: string) => Promise<PlacementView | null>;
  /** Apply the next view (after the short «Ответ принят» moment). */
  advance: (next: PlacementView) => void;
  onSkipSection: (() => void) | null;
}

type Phase =
  | { kind: 'mic' }
  | { kind: 'partner' }
  | { kind: 'blocked' }
  | { kind: 'read' }
  | { kind: 'prep'; endsAt: number }
  | { kind: 'ready' }
  | { kind: 'recording'; startedAt: number }
  | { kind: 'stopping' }
  | { kind: 'uploading' }
  | { kind: 'accepted' }
  | { kind: 'error'; message: string; retry: 'send' | 'record' };

/** Ticks while `active` so timers re-render a few times per second. */
function useNow(active: boolean, ms = 250) {
  const [now, setNow] = useState(() => (typeof performance === 'undefined' ? 0 : performance.now()));
  useEffect(() => {
    if (!active) return;
    setNow(performance.now());
    const timer = setInterval(() => setNow(performance.now()), ms);
    return () => clearInterval(timer);
  }, [active, ms]);
  return now;
}

/** Shared recording/upload logic for speaking tasks and roleplay turns. */
function useAnswerCycle({ recorder, submit, advance, maxSeconds, minSeconds }: VoiceTaskProps & { maxSeconds: number; minSeconds: number }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'mic' });
  const [confirmShort, setConfirmShort] = useState(false);
  const phaseRef = useRef<Phase>(phase); phaseRef.current = phase;
  // The recorder object is re-created on every render: read it through a ref so effects stay stable.
  const recorderRef = useRef(recorder); recorderRef.current = recorder;
  const recordingRef = useRef<TaskRecording | null>(null);
  const transcriptRef = useRef<{ text: string; audioFile: string } | null>(null);
  const timers = useRef<number[]>([]);
  const alive = useRef(true);
  const finishing = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      timers.current.forEach(clearTimeout);
      // Leaving mid-recording discards it (nothing is sent).
      if (phaseRef.current.kind === 'recording') void recorderRef.current.stop();
    };
  }, []);
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };

  const send = useCallback(async () => {
    const recording = recordingRef.current;
    if (!recording) return;
    setPhase({ kind: 'uploading' });
    try {
      if (!transcriptRef.current) transcriptRef.current = await transcribeAnswer(recording);
    } catch (error) {
      if (!alive.current) return;
      const unrecognised = error instanceof ApiRequestError && error.status === 422;
      setPhase({ kind: 'error', retry: unrecognised ? 'record' : 'send',
        message: error instanceof Error ? error.message : 'Не удалось отправить ответ.' });
      return;
    }
    const next = await submit(transcriptRef.current.text, transcriptRef.current.audioFile);
    if (!alive.current) return;
    if (!next) { setPhase({ kind: 'error', retry: 'send', message: 'Ответ записан, но не дошёл до сервера. Отправь ещё раз — перезаписывать не нужно.' }); return; }
    setPhase({ kind: 'accepted' });
    later(() => { if (alive.current) advance(next); }, 750);
  }, [submit, advance]);

  const finish = useCallback(async (force: boolean) => {
    const current = phaseRef.current;
    if (current.kind !== 'recording' || finishing.current) return;
    const elapsed = (performance.now() - current.startedAt) / 1000;
    if (!force && elapsed < minSeconds) { setConfirmShort(true); return; }
    finishing.current = true; setConfirmShort(false);
    // Respond at once: finalising the WAV can take a moment.
    setPhase({ kind: 'stopping' });
    try {
      const recording = await recorderRef.current.stop();
      if (!alive.current) return;
      if (!recording || recording.seconds < 1.2) {
        setPhase({ kind: 'error', retry: 'record', message: 'Запись получилась слишком короткой. Запиши ответ ещё раз.' });
        return;
      }
      recordingRef.current = recording; transcriptRef.current = null;
      await send();
    } finally { finishing.current = false; }
  }, [minSeconds, send]);

  const startRecording = useCallback(async () => {
    setConfirmShort(false);
    const ok = await recorderRef.current.start(() => { void finish(true); });
    if (!alive.current) return;
    if (!ok) { setPhase({ kind: 'mic' }); return; }
    const startedAt = performance.now();
    setPhase({ kind: 'recording', startedAt });
    later(() => { if (phaseRef.current.kind === 'recording' && phaseRef.current.startedAt === startedAt) void finish(true); }, Math.max(1, maxSeconds) * 1000);
  }, [finish, maxSeconds]);

  return { phase, phaseRef, setPhase, confirmShort, setConfirmShort, startRecording, finish, send, later, alive };
}

function MicGate({ recorder, onReady, onSkipSection }: { recorder: TaskRecorder; onReady: () => void; onSkipSection: (() => void) | null }) {
  const message = micMessage(recorder.mic);
  const requested = useRef(false);
  useEffect(() => {
    if (recorder.mic === 'ready') { onReady(); return; }
    if (requested.current || recorder.mic !== 'idle') return;
    requested.current = true;
    void recorder.acquire().then(ok => { if (ok) onReady(); });
  }, [recorder, onReady]);
  if (!message) return <p className={styles.statusLine}><Spinner /> Подключаю микрофон…</p>;
  return (
    <div className={styles.recorderInner}>
      <div className={styles.inlineError}><WarningIcon size={18} weight="bold" />{message}</div>
      <div className={styles.actions}>
        <button type="button" className={cx(kit.btn, kit.primary)} onClick={() => { void recorder.acquire().then(ok => { if (ok) onReady(); }); }}>
          <MicrophoneIcon size={18} weight="bold" />Разрешить микрофон
        </button>
        {onSkipSection ? <button type="button" className={cx(kit.btn, kit.quiet)} onClick={onSkipSection}><SkipForwardIcon size={18} weight="bold" />Пропустить раздел</button> : null}
      </div>
    </div>
  );
}

function RecordingPanel({ startedAt, now, minSeconds, maxSeconds, confirmShort, onStop, onForceStop, onKeepTalking, stopLabel }: {
  startedAt: number; now: number; minSeconds: number; maxSeconds: number; confirmShort: boolean;
  onStop: () => void; onForceStop: () => void; onKeepTalking: () => void; stopLabel: string;
}) {
  const elapsed = Math.max(0, (now - startedAt) / 1000);
  const gate = recordingGate(elapsed, minSeconds, maxSeconds);
  return (
    <div className={styles.recorderInner} aria-live="polite">
      <span className={styles.speaking}><span className={styles.recDot} aria-hidden="true" />Говорю</span>
      <div className={styles.timer}>{formatClock(elapsed)} <span className={styles.timerMax}>/ {formatClock(maxSeconds)}</span></div>
      <div className={styles.recBar} aria-hidden="true">
        <span style={{ transform: `scaleX(${gate.fraction})` }} />
        {minSeconds > 0 ? <i style={{ left: `${gate.minFraction * 100}%` }} /> : null}
      </div>
      <span className={styles.recBarLabel}>
        {minSeconds > 0 && gate.belowMin ? `Минимум ${minSeconds} с — ещё ${gate.remainingToMin} с` : `Запись остановится сама на ${formatClock(maxSeconds)}`}
      </span>
      {confirmShort && gate.belowMin ? (
        <div className={styles.confirmShort} role="alert">
          Ответ короче {minSeconds} с может не засчитаться.
          <div className={styles.actions}>
            <button type="button" className={cx(kit.btn, kit.secondary, kit.small)} onClick={onKeepTalking}>Говорить дальше</button>
            <button type="button" className={cx(kit.btn, kit.quiet, kit.small)} onClick={onForceStop}>Отправить так</button>
          </div>
        </div>
      ) : (
        <button type="button" className={cx(kit.btn, kit.primary)} onClick={onStop}><StopIcon size={18} weight="fill" />{stopLabel}</button>
      )}
    </div>
  );
}

function AfterRecording({ phase, onRetrySend, onRerecord, onSkipSection }: {
  phase: Phase; onRetrySend: () => void; onRerecord: () => void; onSkipSection: (() => void) | null;
}) {
  if (phase.kind === 'stopping') return <p className={styles.statusLine}><Spinner /> Сохраняю запись…</p>;
  if (phase.kind === 'uploading') return <p className={styles.statusLine}><Spinner /> Отправляю ответ…</p>;
  if (phase.kind === 'accepted') return <span className={styles.accepted}><CheckCircleIcon size={20} weight="fill" />Ответ принят</span>;
  if (phase.kind !== 'error') return null;
  return (
    <div className={styles.recorderInner}>
      <div className={styles.inlineError} role="alert"><WarningIcon size={18} weight="bold" />{phase.message}</div>
      <div className={styles.actions}>
        {phase.retry === 'send'
          ? <button type="button" className={cx(kit.btn, kit.primary)} onClick={onRetrySend}><PaperPlaneRightIcon size={18} weight="bold" />Отправить ещё раз</button>
          : <button type="button" className={cx(kit.btn, kit.primary)} onClick={onRerecord}><MicrophoneIcon size={18} weight="bold" />Записать ещё раз</button>}
        {phase.retry === 'send' ? <button type="button" className={cx(kit.btn, kit.quiet)} onClick={onRerecord}><ArrowsClockwiseIcon size={18} weight="bold" />Перезаписать</button> : null}
        {onSkipSection ? <button type="button" className={cx(kit.btn, kit.quiet)} onClick={onSkipSection}><SkipForwardIcon size={18} weight="bold" />Пропустить раздел</button> : null}
      </div>
    </div>
  );
}

/* ───────────── speaking ───────────── */

export function SpeakingTaskView(props: VoiceTaskProps & { task: SpeakingTask }) {
  const { task, recorder, onSkipSection } = props;
  const cycle = useAnswerCycle({ ...props, maxSeconds: task.maxSeconds, minSeconds: task.minSeconds });
  const { phase, setPhase, startRecording, later } = cycle;
  const now = useNow(phase.kind === 'prep' || phase.kind === 'recording');
  const started = useRef(false);

  const begin = useCallback(() => {
    if (started.current) return;
    started.current = true;
    if (task.prepSeconds > 0) {
      const endsAt = performance.now() + task.prepSeconds * 1000;
      setPhase({ kind: 'prep', endsAt });
      later(() => {
        const current = cycle.phaseRef.current;
        // Skipped early with «Начать говорить сейчас», or the task changed: nothing to do.
        if (!cycle.alive.current || current.kind !== 'prep' || current.endsAt !== endsAt) return;
        // Recording starts on its own when the countdown ends (real response latency).
        if (task.autoStart) void startRecording(); else setPhase({ kind: 'ready' });
      }, task.prepSeconds * 1000);
    } else if (task.autoStart) void startRecording();
    else setPhase({ kind: 'ready' });
  }, [task.prepSeconds, task.autoStart, setPhase, later, startRecording, cycle.alive, cycle.phaseRef]);

  const prepLeft = phase.kind === 'prep' ? Math.max(0, Math.ceil((phase.endsAt - now) / 1000)) : 0;
  const circumference = 2 * Math.PI * 60;
  const mascotState = phase.kind === 'recording' ? 'listening' : phase.kind === 'uploading' || phase.kind === 'stopping' ? 'thinking' : 'idle';

  return (
    <div className={styles.task}>
      <div className={styles.voiceStage}>
        <div className={styles.voiceText}>
          {task.followUp ? <p className={styles.followUp}><LightningIcon size={16} weight="fill" aria-hidden="true" />Неожиданный вопрос — отвечай сразу</p> : null}
          <p className={styles.instruction}><MicrophoneIcon size={18} weight="bold" aria-hidden="true" />{task.instruction}</p>
          {task.readAloud
            ? <p className={cx(kit.solid, styles.readAloud, kit.en)} lang="en">{task.prompt}</p>
            : <p className={cx(styles.voicePrompt, kit.en)} lang="en">{task.prompt}</p>}
        </div>
        <div className={styles.mascotWrap} aria-hidden="true">
          <FeatureMascot size={120} state={mascotState} mic={recorder.meterStore} interactive={false} label="Слушает твой ответ" />
        </div>
      </div>

      <div className={cx(kit.glass, styles.recorder)}>
        {phase.kind === 'mic' ? <MicGate recorder={recorder} onReady={begin} onSkipSection={onSkipSection} /> : null}
        {phase.kind === 'prep' ? (
          <>
            <div className={styles.countdown} style={{ ['--prep' as string]: `${task.prepSeconds}s`, ['--len' as string]: circumference } as CSSProperties}>
              <svg viewBox="0 0 132 132" aria-hidden="true">
                <circle className={styles.track} cx="66" cy="66" r="60" />
                <circle className={styles.value} cx="66" cy="66" r="60" strokeDasharray={circumference} />
              </svg>
              <span className={styles.countdownNumber} aria-live="off">{prepLeft}</span>
            </div>
            <span className={styles.countdownLabel} aria-live="polite">
              {task.autoStart ? 'Подумай. Запись начнётся сама, когда время выйдет.' : 'Подумай над ответом.'}
            </span>
            <button type="button" className={cx(kit.btn, kit.secondary)} onClick={() => { void startRecording(); }}>
              <MicrophoneIcon size={18} weight="bold" />Начать говорить сейчас
            </button>
          </>
        ) : null}
        {phase.kind === 'ready' ? (
          <button type="button" className={cx(kit.btn, kit.primary)} onClick={() => { void startRecording(); }}><MicrophoneIcon size={18} weight="bold" />Начать запись</button>
        ) : null}
        {phase.kind === 'recording' ? (
          <RecordingPanel startedAt={phase.startedAt} now={now} minSeconds={task.minSeconds} maxSeconds={task.maxSeconds} confirmShort={cycle.confirmShort}
            onStop={() => { void cycle.finish(false); }} onForceStop={() => { void cycle.finish(true); }} onKeepTalking={() => cycle.setConfirmShort(false)}
            stopLabel="Закончить ответ" />
        ) : null}
        <AfterRecording phase={phase} onRetrySend={() => { void cycle.send(); }} onRerecord={() => { void startRecording(); }} onSkipSection={onSkipSection} />
      </div>
    </div>
  );
}

/* ───────────── roleplay ───────────── */

export function RoleplayTaskView(props: VoiceTaskProps & { task: RoleplayTask }) {
  const { task, recorder, onSkipSection } = props;
  const cycle = useAnswerCycle({ ...props, maxSeconds: task.maxSeconds, minSeconds: 0 });
  const { phase, setPhase, startRecording, later } = cycle;
  const now = useNow(phase.kind === 'recording');
  const speech = useMemo(() => createVoiceMeter(), []);
  const playback = useRef<MeteredPlayback | null>(null);
  const [micReady, setMicReady] = useState(recorder.mic === 'ready');
  const started = useRef(false);

  useEffect(() => () => { playback.current?.stop(); playback.current = null; }, []);

  const playLine = useCallback(() => {
    const url = task.partnerLine.audioUrl;
    if (!url) { setPhase({ kind: 'read' }); return; }
    setPhase({ kind: 'partner' });
    const current = playMetered(mediaUrl(url), speech);
    playback.current = current;
    current.done.then(result => {
      if (playback.current !== current || !cycle.alive.current) return;
      playback.current = null;
      // The answer starts right after the partner's line, as on a real call.
      if (result === 'ended') later(() => { void startRecording(); }, 300);
    }).catch(error => {
      if (playback.current !== current || !cycle.alive.current) return;
      playback.current = null;
      setPhase(error instanceof DOMException && error.name === 'NotAllowedError' ? { kind: 'blocked' } : { kind: 'read' });
    });
  }, [task.partnerLine.audioUrl, speech, setPhase, later, startRecording, cycle.alive]);

  // Microphone first (so the answer can start instantly), then the partner speaks.
  useEffect(() => {
    if (started.current || !micReady) return;
    started.current = true;
    playLine();
  }, [micReady, playLine]);

  const mascotState = phase.kind === 'partner' ? 'speaking' : phase.kind === 'recording' ? 'listening' : phase.kind === 'uploading' || phase.kind === 'stopping' ? 'thinking' : 'idle';

  return (
    <div className={styles.task}>
      <div className={styles.scene}>
        <strong>{task.instruction}</strong>
        <span lang="en">{task.partnerRole}</span>
      </div>
      <div className={styles.partnerRow}>
        <div className={styles.mascotWrap}>
          <FeatureMascot size={124} state={mascotState} speech={speech} mic={recorder.meterStore} interactive={false}
            label={phase.kind === 'partner' ? 'Собеседник говорит' : 'Слушает тебя'} />
        </div>
        <div className={cx(kit.glass, styles.bubble, kit.en)} lang="en">
          <span className={kit.visuallyHidden} lang="ru">Собеседник: </span>
          {task.partnerLine.text}
        </div>
      </div>

      <div className={cx(kit.glass, styles.recorder)}>
        {!micReady ? <MicGate recorder={recorder} onReady={() => setMicReady(true)} onSkipSection={onSkipSection} /> : null}
        {micReady && phase.kind === 'mic' ? <p className={styles.statusLine}><Spinner /> Собеседник подключается…</p> : null}
        {phase.kind === 'partner' ? <p className={styles.statusLine}><SpeakerHighIcon size={18} weight="fill" /> Собеседник говорит. Ответ запишется сразу после реплики.</p> : null}
        {phase.kind === 'blocked' ? (
          <button type="button" className={cx(kit.btn, kit.primary)} onClick={playLine}><SpeakerHighIcon size={18} weight="fill" />Слушать реплику</button>
        ) : null}
        {phase.kind === 'read' ? (
          <>
            <p className={styles.statusLine}>Голос собеседника не загрузился — прочитай реплику и ответь.</p>
            <button type="button" className={cx(kit.btn, kit.primary)} onClick={() => { void startRecording(); }}><MicrophoneIcon size={18} weight="bold" />Ответить голосом</button>
          </>
        ) : null}
        {phase.kind === 'recording' ? (
          <RecordingPanel startedAt={phase.startedAt} now={now} minSeconds={0} maxSeconds={task.maxSeconds} confirmShort={false}
            onStop={() => { void cycle.finish(true); }} onForceStop={() => { void cycle.finish(true); }} onKeepTalking={() => undefined} stopLabel="Готово" />
        ) : null}
        <AfterRecording phase={phase} onRetrySend={() => { void cycle.send(); }} onRerecord={() => { void startRecording(); }} onSkipSection={onSkipSection} />
      </div>
    </div>
  );
}
