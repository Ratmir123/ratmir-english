// One naming set for the PC/web client (planning/v05/DESIGN-SYSTEM.md §3–4, audit U-14/U-15).
// The iPhone client mirrors these strings; change both together.
import { SKILL_GROUP_LABELS, SKILL_STATE_LABELS, SKILLS, type Mode, type Session, type SkillGroup, type SkillId, type SkillState } from '@/lib/types';

export type TabId = 'today' | 'practice' | 'calls' | 'progress' | 'profile';
export const TAB_NAMES: Record<TabId, string> = {
  today: 'Сегодня', practice: 'Практика', calls: 'Созвоны', progress: 'Прогресс', profile: 'Профиль',
};
export const TAB_ORDER: TabId[] = ['today', 'practice', 'calls', 'progress', 'profile'];

export const MODE_LABEL: Record<Mode, string> = { learning: 'С опорами', call: 'Созвон' };
export const MODE_HINT: Record<Mode, string> = {
  learning: 'Текст собеседника виден, есть подсказки — удобно пробовать новое.',
  call: 'Как настоящий звонок: только голос, без подсказок.',
};

// Skill, group and state names come from lib/types.ts (canonical for iPhone and PC).
export const SKILL_GROUPS: { id: SkillGroup; title: string }[] = (['language', 'dialogue', 'strategy'] as const)
  .map(id => ({ id, title: SKILL_GROUP_LABELS[id] }));
export const SKILL_STATE_LABEL: Record<SkillState['state'], string> = SKILL_STATE_LABELS;
export function skillLabel(id: SkillId): string { return SKILLS.find(skill => skill.id === id)?.label ?? id; }

export const CTA = {
  start: 'Начать',
  continue: 'Продолжить',
  finish: 'Закончить и получить разбор',
  back: 'Вернуться к занятию',
  complete: 'Завершить занятие',
  defer: 'На сегодня всё',
  retry: 'Проверить попытку',
  reanalyse: 'Повторить разбор',
} as const;

/** One status per session, same words on Today, History and inside the session. */
export function sessionStatusLabel(session: Session): string {
  if (session.retryDeferred) return 'Попытка на потом';
  if (session.status === 'completed') return 'Завершено';
  if (session.status === 'analysing') return 'Готовится разбор';
  if (session.status === 'review') return 'Разбор готов';
  if (session.status === 'error') return session.analysis ? 'Можно повторить разбор' : 'Разбор не получился';
  return 'Можно продолжить';
}
export function sessionTone(session: Session): 'lime' | 'violet' | 'cyan' | 'warning' | 'neutral' {
  if (session.status === 'review' && !session.retryDeferred) return 'lime';
  if (session.status === 'analysing') return 'cyan';
  if (session.status === 'error') return 'warning';
  if (session.status === 'active') return 'violet';
  return 'neutral';
}

/** Russian plural: plural(3, ['занятие', 'занятия', 'занятий']). */
export function plural(value: number, forms: readonly [string, string, string]): string {
  const n = Math.abs(Math.trunc(value)) % 100;
  const last = n % 10;
  if (n > 10 && n < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}
export const count = (value: number, forms: readonly [string, string, string]) => `${value} ${plural(value, forms)}`;

export function shortDate(value: string | number | Date): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' }).format(date) : '';
}
export function longDate(value: string | number | Date): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' }).format(date) : '';
}
/** Local calendar day (device time zone) — the only day boundary the PC client uses. */
export function localDayKey(value: string | number | Date): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function greeting(name: string, now = new Date()): string {
  const hour = now.getHours();
  const part = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
  const clean = name.trim();
  return clean && !['Ты', 'You', 'Learner'].includes(clean) ? `${part}, ${clean}` : part;
}
