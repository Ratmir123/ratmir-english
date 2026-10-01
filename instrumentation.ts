export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertServerConfiguration } = await import('./lib/server/configuration');
    assertServerConfiguration();
  }
  // Only the managed runtime sets this flag. Build workers must never consume
  // queued personal lessons or start model requests while producing assets.
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.TRAINING_MANAGED_SERVER === '1') {
    const { ensureWorker } = await import('./lib/server/worker');
    ensureWorker();
  }
}
