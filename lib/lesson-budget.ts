/** A one-session choice never changes the learner's normal practice duration. */
export function lessonBudget(dailyMinutes: number, requestedMinutes?: number): number {
  if (requestedMinutes !== undefined) {
    if (!Number.isInteger(requestedMinutes) || requestedMinutes < 5 || requestedMinutes > 30) {
      throw new Error('Для одного занятия выбери от 5 до 30 минут.');
    }
    return requestedMinutes;
  }
  return Math.min(30, Math.max(5, Math.floor(dailyMinutes)));
}
