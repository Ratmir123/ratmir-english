/** A pipeline step failure with a Russian, user-facing message. Never carries provider payloads, keys or call content. */
export class CallStepError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
    this.name = 'CallStepError';
  }
}

/** The job lost its lease (call deleted, reset or re-queued elsewhere): stop quietly without publishing anything. */
export class CallCancelled extends Error {
  constructor() {
    super('Обработка созвона остановлена.');
    this.name = 'CallCancelled';
  }
}

/** Retry transient provider failures a few times inside one job attempt. */
export async function withRetries<T>(task: () => Promise<T>, sleep: (ms: number) => Promise<void>, delays: number[] = [3000, 10000]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await task(); }
    catch (error) {
      if (!(error instanceof CallStepError) || !error.retryable || attempt >= delays.length) throw error;
      await sleep(delays[attempt]);
    }
  }
}
