import { claimAnalysisJob, finishAnalysisJob, getAppState, getSession, saveSession } from './store';
import { analyse } from './teacher';
import { SiwcError } from './siwc-protocol';
import { processPlacementQueue } from './placement/routes';
import { processCallQueue } from './calls/routes';

const globals = globalThis as unknown as { trainingWorker?: ReturnType<typeof setInterval>; trainingWorkerBusy?: boolean };
export async function processAnalysisQueue(analyser: typeof analyse = analyse) {
  if (globals.trainingWorkerBusy) return;
  globals.trainingWorkerBusy = true;
  let job: { sessionId: string } | null = null;
  try {
    job = claimAnalysisJob();
    if (!job) return;
    const session = getSession(job.sessionId);
    if (!session || session.status === 'completed') { finishAnalysisJob(job.sessionId); return; }
    const source = structuredClone(session);
    const analysis = await analyser(session, getAppState().profile);
    const latest = getSession(job.sessionId);
    if (!latest || latest.status === 'completed') { finishAnalysisJob(job.sessionId); return; }
    latest.analysis = analysis; latest.status = 'review'; latest.error = undefined; latest.processing = undefined;
    // The source condition is checked inside the SQLite transaction, not against this fresh object.
    saveSession(latest, source);
    finishAnalysisJob(job.sessionId);
  } catch (error) {
    // Limits, expired grants and an indeterminate provider timeout need an explicit user retry.
    // Automatically resubmitting can consume another billable turn with no new learner action.
    if (job) finishAnalysisJob(job.sessionId, error instanceof Error ? error.message : 'Не удалось подготовить разбор.', !(error instanceof SiwcError));
  } finally { globals.trainingWorkerBusy = false; }
}
function tick() {
  void processAnalysisQueue();
  // Feature queues own their own busy flags and never throw.
  void processPlacementQueue().catch(() => undefined);
  void processCallQueue().catch(() => undefined);
}
export function ensureWorker() {
  if (globals.trainingWorker) return;
  globals.trainingWorker = setInterval(tick, 1500);
  globals.trainingWorker.unref();
  tick();
}
