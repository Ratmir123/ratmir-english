import type { Session } from '../types';

/** A later failed try cannot undo an already evidenced improvement. */
export function completionRequirement(session: Session): NonNullable<Session['completion']> {
  if (!session.analysis) return { canComplete: false, needsRetry: false, reason: 'Сначала дождись разбора разговора.' };
  const improved = session.retries.some(retry => retry.improved === true
    && (retry.analysisVersion === undefined || retry.analysisVersion === session.analysis!.version));
  const needsRetry = session.analysis.priorities.length > 0 && !improved;
  return { canComplete: !needsRetry, needsRetry,
    reason: needsRetry ? 'Есть одна важная правка. Попробуй выразить мысль заново или сохрани её на потом.' : null };
}
