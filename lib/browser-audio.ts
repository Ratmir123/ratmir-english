export const PCM_RATE = 24_000;
export const MAX_RECORDING_SECONDS = 8 * 60;

export type VoiceMeterStore = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): number;
};

export function createVoiceMeter(): VoiceMeterStore & { setLevel(level: number): void } {
  let level = 0;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot() { return level; },
    setLevel(next) {
      const rounded = Math.round(Math.min(1, Math.max(0, next)) * 100) / 100;
      if (rounded === level) return;
      level = rounded;
      listeners.forEach(listener => listener());
    },
  };
}

/**
 * Live captions of the learner's own speech (MOTION-PASS-0.5.2 §5). Kept outside React state like the meter:
 * only the caption view subscribes, so a transcript delta never re-renders the shell.
 * `phase`: starting (mic requested) → listening (capturing) → finishing (stop pressed, final text pending) → idle.
 */
export type CaptionPhase = 'idle' | 'starting' | 'listening' | 'finishing';
export type LiveTranscriptSnapshot = { phase: CaptionPhase; contextKey: string | null; text: string; status: string; final: boolean };
export type LiveTranscriptStore = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): LiveTranscriptSnapshot;
};
export const IDLE_TRANSCRIPT: LiveTranscriptSnapshot = { phase: 'idle', contextKey: null, text: '', status: '', final: false };

export function createLiveTranscriptStore(): LiveTranscriptStore & { update(patch: Partial<LiveTranscriptSnapshot>): void } {
  let snapshot = IDLE_TRANSCRIPT;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot() { return snapshot; },
    update(patch) {
      const next = { ...snapshot, ...patch };
      if ((Object.keys(next) as (keyof LiveTranscriptSnapshot)[]).every(key => next[key] === snapshot[key])) return;
      snapshot = next;
      listeners.forEach(listener => listener());
    },
  };
}

export function pcmToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

/** PCM written to the original WAV is exactly the PCM supplied to live recognition. */
export function pcmWav(chunks: readonly Int16Array[]): Blob {
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index));
  };
  text(0, 'RIFF'); view.setUint32(4, 36 + sampleCount * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, PCM_RATE, true);
  view.setUint32(28, PCM_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, sampleCount * 2, true);
  let offset = 44;
  for (const chunk of chunks) for (const sample of chunk) { view.setInt16(offset, sample, true); offset += 2; }
  return new Blob([buffer], { type: 'audio/wav' });
}

export type CapturedVoice = { blob: Blob; minutes: number; sampleCount: number; complete: boolean };

export class BrowserVoiceCapture {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private mute: GainNode | null = null;
  private chunks: Int16Array[] = [];
  private samples = 0;
  private stopped = false;
  private stopAcknowledged = false;
  private finalizing: Promise<CapturedVoice> | null = null;
  private settleStop: (() => void) | null = null;
  constructor(private onPCM: (pcm: Int16Array) => void, private onLevel: (level: number) => void,
    private onLimit: () => void) {}

  async start(stream: MediaStream) {
    if (this.stopped) return;
    const Constructor = window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) throw new Error('Этот браузер не поддерживает голосовую запись. Используй установленное приложение или обнови браузер.');
    let context: AudioContext;
    try { context = new Constructor({ sampleRate: PCM_RATE, latencyHint: 'interactive' }); }
    catch { context = new Constructor({ latencyHint: 'interactive' }); }
    this.context = context;
    if (!context.audioWorklet) throw new Error('Для живой записи нужен современный браузер с AudioWorklet.');
    await context.audioWorklet.addModule('/voice-capture.worklet.js');
    if (this.stopped) { if (context.state !== 'closed') await context.close(); return; }
    this.node = new AudioWorkletNode(context, 'training-voice-capture');
    this.node.port.onmessage = event => {
      const message = event.data as { type: string; pcm?: ArrayBuffer; level?: number };
      if (message.type === 'pcm' && message.pcm) {
        const pcm = new Int16Array(message.pcm);
        this.chunks.push(pcm); this.samples += pcm.length;
        this.onPCM(pcm); this.onLevel(message.level ?? 0);
      } else if (message.type === 'stopped') { this.stopAcknowledged = true; this.settleStop?.(); }
      else if (message.type === 'limit') this.onLimit();
    };
    this.node.onprocessorerror = () => this.onLimit();
    this.source = context.createMediaStreamSource(stream);
    this.mute = context.createGain(); this.mute.gain.value = 0;
    this.source.connect(this.node); this.node.connect(this.mute); this.mute.connect(context.destination);
    await context.resume();
  }

  finish(): Promise<CapturedVoice> {
    if (this.finalizing) return this.finalizing;
    this.stopped = true;
    this.finalizing = (async () => {
      if (this.node && !this.stopAcknowledged) {
        await new Promise<void>(resolve => {
          // The port's stopped acknowledgement follows its last PCM buffer in order.
          const timeout = setTimeout(resolve, 1500);
          this.settleStop = () => { clearTimeout(timeout); resolve(); };
          this.node!.port.postMessage({ type: 'stop' });
        });
      }
      this.source?.disconnect(); this.node?.disconnect(); this.mute?.disconnect();
      this.node?.port.close();
      if (this.context && this.context.state !== 'closed') await this.context.close().catch(() => undefined);
      this.onLevel(0);
      return { blob: pcmWav(this.chunks), minutes: this.samples / PCM_RATE / 60, sampleCount: this.samples,
        complete: this.stopAcknowledged };
    })();
    return this.finalizing;
  }
}

export type LiveCredential = { clientSecret: string; expiresAt: number; model: string; url: string; ticket?: string };
const wait = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

export class BrowserLiveTranscriber {
  private socket: WebSocket | null = null;
  private queue: Int16Array[] = [];
  private queuedBytes = 0;
  private sentBytes = 0;
  private ready = false;
  private closed = false;
  private failed = false;
  private committing = false;
  private text = '';
  private finalText: string | null = null;
  constructor(private onText: (text: string, final: boolean) => void, private onStatus: (text: string) => void) {}
  get liveMinutes() { return this.sentBytes / PCM_RATE / 2 / 60; }
  get isClosed() { return this.closed; }

  async connect(credential: LiveCredential) {
    if (this.closed) return;
    let url: URL, expected: URL;
    try { url = new URL(credential.url); expected = new URL(window.location.origin); }
    catch { this.fail(); return; }
    if (url.protocol !== 'wss:' || url.host !== expected.host || url.pathname !== '/api/audio/live-stream'
      || url.search || url.username || url.password || credential.model !== 'gpt-live-transcribe'
      || !Number.isFinite(credential.expiresAt) || credential.expiresAt * 1000 <= Date.now()
      || !/^ek_[A-Za-z0-9_-]+$/.test(credential.clientSecret)) {
      this.fail(); return;
    }
    const socket = new WebSocket(url, ['realtime-transcription', 'openai-insecure-api-key.' + credential.clientSecret]);
    this.socket = socket;
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => { this.fail(); resolve(); }, 12_000);
      socket.onopen = () => {
        clearTimeout(timeout);
        if (this.closed) { socket.close(); resolve(); return; }
        try { socket.send(JSON.stringify({ type: 'session.update', session: { type: 'transcription', audio: { input: {
          format: { type: 'audio/pcm', rate: PCM_RATE }, turn_detection: null,
          // 'minimal' = earliest partial words (MOTION-PASS-0.5.2 §5); the completed text still arrives after commit.
          transcription: { model: 'gpt-live-transcribe', languages: ['en', 'ru'], delay: 'minimal',
            prompt: 'An English learner speaking spontaneously. Preserve um, uh, like, repetitions, false starts, unfinished phrases and grammar mistakes. Transcribe what was actually said. Do not correct, translate, summarize or complete words.' },
        } } } })); } catch { this.fail(); resolve(); return; }
        this.ready = true; this.onStatus('Слушаю. Текст появляется по ходу речи.');
        this.drain(); resolve();
      };
      socket.onmessage = event => {
        if (this.closed) return;
        let message: { type?: string; delta?: string; transcript?: string };
        try { message = JSON.parse(String(event.data)); } catch { this.fail(); return; }
        if (message.type === 'conversation.item.input_audio_transcription.delta' && typeof message.delta === 'string') {
          this.text += message.delta; this.onText(this.text, false);
        } else if (message.type === 'conversation.item.input_audio_transcription.completed' && typeof message.transcript === 'string') {
          if (this.committing) this.finalText = message.transcript;
          this.text = message.transcript; this.onText(this.text, true);
        } else if (message.type === 'error' || message.type === 'conversation.item.input_audio_transcription.failed') this.fail();
      };
      socket.onerror = () => { clearTimeout(timeout); this.fail(); resolve(); };
      socket.onclose = () => { clearTimeout(timeout); if (!this.closed) this.fail(); resolve(); };
    });
  }
  append(pcm: Int16Array) {
    if (this.closed || this.committing) return;
    this.queue.push(pcm); this.queuedBytes += pcm.byteLength;
    if (this.queuedBytes > PCM_RATE * 2 * 20) { this.fail(); return; }
    this.drain();
  }
  private drain() {
    if (!this.ready || !this.socket || this.socket.readyState !== WebSocket.OPEN || this.closed) return;
    while (this.queue.length) {
      if (this.socket.bufferedAmount > 1024 * 1024) { this.fail(); return; }
      const pcm = this.queue.shift()!; this.queuedBytes -= pcm.byteLength;
      try {
        this.socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: pcmToBase64(pcm) }));
        this.sentBytes += pcm.byteLength;
      } catch { this.fail(); return; }
    }
  }
  async finish(): Promise<string | null> {
    for (let attempt = 0; attempt < 30 && !this.ready && !this.closed; attempt++) await wait(100);
    if (!this.ready || this.closed || this.failed) { this.close(); return null; }
    this.drain();
    if (this.queue.length || this.failed || !this.socket) { this.close(); return null; }
    this.committing = true;
    try { this.socket.send(JSON.stringify({ type: 'input_audio_buffer.commit' })); }
    catch { this.close(); return null; }
    for (let attempt = 0; attempt < 80 && this.finalText === null && !this.closed; attempt++) await wait(100);
    const text = this.failed ? null : this.finalText;
    this.close(); return text;
  }
  private fail() {
    this.failed = true;
    this.onStatus('Живого текста нет — распознаю после записи.');
    this.close();
  }
  close() {
    this.closed = true; this.ready = false; this.queue = []; this.queuedBytes = 0;
    this.socket?.close(); this.socket = null;
  }
}
