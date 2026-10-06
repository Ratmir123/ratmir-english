import { performance } from 'node:perf_hooks';

export type InferencePurpose = 'planning' | 'partner' | 'review' | 'retry' | 'hint' | 'baseline' | 'quick-coach' | 'call-review' | 'phrase' | 'listen' | 'other';
export type InferenceUsage = { inputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null; cachedInputTokens: number | null };
export type StreamTimingEvent = { phase: 'first-byte' | 'created' | 'text' | 'completed'; characters?: number; usage?: InferenceUsage };
export type TimingObserver<T> = (result: T) => void | Promise<void>;
export type InferenceTiming = {
  version: 1; model: 'gpt-6.1-sol'; purpose: InferencePurpose; effort: 'low' | 'medium' | 'high';
  promptCharacters: number; instructionsCharacters: number; schemaCharacters: number;
  accessReadyMs: number | null; requestStartMs: number | null; headersMs: number | null;
  firstByteMs: number | null; createdMs: number | null; firstTextMs: number | null;
  lastTextMs: number | null; completedMs: number | null; totalMs: number;
  outputCharacters: number; textDeltas: number; usage: InferenceUsage | null;
  outcome: 'success' | 'failed'; failure: string | null;
};

/** Diagnostics never block inference or surface observer failures and payloads. */
export function observeTiming<T>(observer: TimingObserver<T> | undefined, result: T): void {
  if (!observer) return;
  try {
    const pending = observer(result);
    if (pending !== undefined) void Promise.resolve(pending).catch(() => undefined);
  }
  catch { /* A synchronous observer failure is equally non-fatal. */ }
}

const tokenCount = (input: unknown) => typeof input === 'number' && Number.isSafeInteger(input) && input >= 0 ? input : null;
function usageSnapshot(usage: InferenceUsage | null | undefined): InferenceUsage | null {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  return { inputTokens: tokenCount(usage.inputTokens), outputTokens: tokenCount(usage.outputTokens),
    reasoningTokens: tokenCount(usage.reasoningTokens), cachedInputTokens: tokenCount(usage.cachedInputTokens) };
}

/** Count-only diagnostics. Never accept text, reasoning, credentials, IDs or headers. */
export function inferenceTiming(input: Pick<InferenceTiming, 'purpose' | 'effort' | 'promptCharacters' | 'instructionsCharacters' | 'schemaCharacters'>,
  now: () => number = () => performance.now()) {
  const started = now();
  const data: InferenceTiming = { version: 1, model: 'gpt-6.1-sol', purpose: input.purpose, effort: input.effort,
    promptCharacters: input.promptCharacters, instructionsCharacters: input.instructionsCharacters, schemaCharacters: input.schemaCharacters,
    accessReadyMs: null, requestStartMs: null, headersMs: null, firstByteMs: null, createdMs: null,
    firstTextMs: null, lastTextMs: null, completedMs: null, totalMs: 0,
    outputCharacters: 0, textDeltas: 0, usage: null, outcome: 'failed', failure: null };
  const elapsed = () => Math.max(0, Math.round(now() - started));
  return {
    mark(stage: 'accessReadyMs' | 'requestStartMs' | 'headersMs') { data[stage] ??= elapsed(); },
    event(event: StreamTimingEvent) {
      const at = elapsed();
      if (event.phase === 'first-byte') data.firstByteMs ??= at;
      else if (event.phase === 'created') data.createdMs ??= at;
      else if (event.phase === 'text') {
        data.firstTextMs ??= at; data.lastTextMs = at; data.textDeltas++;
        if (typeof event.characters === 'number' && Number.isSafeInteger(event.characters) && event.characters >= 0) data.outputCharacters += event.characters;
      } else if (event.phase === 'completed') {
        data.completedMs ??= at; data.usage = usageSnapshot(event.usage);
      }
    },
    finish(outcome: InferenceTiming['outcome'], failure: string | null = null): InferenceTiming {
      return { ...data, usage: usageSnapshot(data.usage), outcome, failure, totalMs: elapsed() };
    },
  };
}

/** Whitelist fields rather than logging the Responses usage object wholesale. */
export function inferenceUsage(raw: unknown): InferenceUsage | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const value = raw as Record<string, unknown>;
  const details = (input: unknown) => input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  return { inputTokens: tokenCount(value.input_tokens), outputTokens: tokenCount(value.output_tokens),
    reasoningTokens: tokenCount(details(value.output_tokens_details).reasoning_tokens),
    cachedInputTokens: tokenCount(details(value.input_tokens_details).cached_tokens) };
}
