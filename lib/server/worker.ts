import { claimAnalysisJob, finishAnalysisJob, getAppState, getSession, saveSession } from './store';
import { analyse } from './teacher';

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
    latest.analysis = analysis; latest.status = 'review'; latest.error = undefined;
    // The source condition is checked inside the SQLite transaction, not against this fresh object.
    saveSession(latest, source);
    finishAnalysisJob(job.sessionId);
  } catch (error) {
    if (job) finishAnalysisJob(job.sessionId, error instanceof Error ? error.message : 'Не удалось подготовить разбор.');
  } finally { globals.trainingWorkerBusy = false; }
}
export function ensureWorker() {
  if (globals.trainingWorker) return;
  globals.trainingWorker = setInterval(() => void processAnalysisQueue(), 5000);
  globals.trainingWorker.unref();
  void processAnalysisQueue();
}
