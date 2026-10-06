'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { APP_NAME } from '@/lib/app-info';
import type { DailyReminderSettings } from './desktop-bridge';
import styles from './reminder-settings.module.css';

const SUGGESTED = ['09:00', '13:00', '19:00', '21:00', '08:00', '12:00', '16:00', '18:00'];

/**
 * Daily practice reminders live in the desktop shell (the iPhone sets its own): a plain browser has none, an old shell
 * has no schedule API, otherwise the saved schedule once it has loaded.
 */
export type ReminderSource =
  | { kind: 'browser' }
  | { kind: 'outdated' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; settings: DailyReminderSettings };

/** What can be known before the schedule loads (the Profile renders only in the browser, so no flash of «Загружаю…»). */
function initialSource(): ReminderSource {
  if (typeof window === 'undefined') return { kind: 'loading' };
  const bridge = window.ratmirDesktop;
  return !bridge ? { kind: 'browser' } : !bridge.getReminderSettings ? { kind: 'outdated' } : { kind: 'loading' };
}

/** Loads the desktop schedule once (Profile row + editor); `saved` takes the shell's answer after a save. */
export function useReminderSource() {
  const [source, setSource] = useState<ReminderSource>(initialSource);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const bridge = window.ratmirDesktop;
    const load = bridge?.getReminderSettings;
    if (!bridge || !load) { setSource(current => current.kind === 'loading' ? initialSource() : current); return; }
    let alive = true;
    setSource(current => current.kind === 'loading' ? current : { kind: 'loading' });
    Promise.resolve().then(() => load.call(bridge))
      .then(settings => { if (alive) setSource({ kind: 'ready', settings }); }, () => { if (alive) setSource({ kind: 'error' }); });
    return () => { alive = false; };
  }, [attempt]);
  const saved = useCallback((settings: DailyReminderSettings) => setSource({ kind: 'ready', settings }), []);
  const reload = useCallback(() => setAttempt(value => value + 1), []);
  return { source, saved, reload };
}

/** One line for the Profile row: «19:00, 21:00», «Выключены», «Только в приложении для ПК», … */
export function reminderSummary(source: ReminderSource): string {
  switch (source.kind) {
    case 'browser': return 'Только в приложении для ПК';
    case 'outdated': return 'Нужна новая версия';
    case 'loading': return 'Загружаю…';
    case 'error': return 'Не загрузились';
    case 'ready': {
      const { enabled, times } = source.settings;
      return enabled && times.length ? [...times].sort().join(', ') : 'Выключены';
    }
  }
}

/** What the reminder row shows when there is no schedule to edit (desktop shell only; a browser row does not open). */
export function ReminderStatus({ source, onRetry }: { source: ReminderSource; onRetry: () => void }) {
  if (source.kind === 'loading') return <p className="caption">Загружаю расписание…</p>;
  if (source.kind === 'outdated') return <p className="caption">Обнови приложение на компьютере, чтобы выбрать время напоминаний.</p>;
  if (source.kind === 'error') return <div className={styles.section}>
    <p className="caption" role="status">Не удалось загрузить времена напоминаний.</p>
    <button type="button" className="text-button" onClick={onRetry}>Повторить</button>
  </div>;
  return <p className="caption">Время напоминаний выбирается в приложении {APP_NAME} на компьютере или iPhone.</p>;
}

/** The daily times (Profile → «Напоминания»): edits apply on «Сохранить»; the row above shows the saved schedule. */
export function ReminderSettings({ settings, onSaved }: { settings: DailyReminderSettings; onSaved: (value: DailyReminderSettings) => void }) {
  const [value, setValue] = useState<DailyReminderSettings>(settings);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(settings.warning ?? '');
  // The saved schedule changed (after a save or a reload): follow it while untouched.
  useEffect(() => { if (!dirty) setValue(settings); }, [settings, dirty]);
  function update(next: DailyReminderSettings) { setValue(next); setDirty(true); setMessage(''); }
  // Enabling with no times would silently save as «off» (audit U-32): say so before saving.
  const problem = value.enabled && value.times.length === 0 ? 'Добавь хотя бы одно время или выключи напоминания.'
    : new Set(value.times).size !== value.times.length ? 'Выбери разные времена.' : '';
  async function save() {
    if (busy || problem) return;
    setBusy(true); setMessage('');
    try {
      const result = await window.ratmirDesktop?.saveReminderSettings?.(value);
      if (!result) { setMessage('Обнови приложение на компьютере, чтобы настроить время.'); return; }
      // «Сохранено» next to the actions and the row's value say it; no second message.
      setValue(result); setDirty(false); onSaved(result);
    } catch { setMessage('Не удалось сохранить расписание. Изменения не применились — попробуй ещё раз.'); }
    finally { setBusy(false); }
  }
  return <div className={styles.section}>
    <label className={styles.toggle}><input type="checkbox" checked={value.enabled} disabled={busy}
      onChange={event => update({ ...value, enabled: event.target.checked, times: event.target.checked && !value.times.length ? ['19:00'] : value.times })} />Каждый день в выбранное время</label>
    <div className={styles.times}>{value.times.map((time, index) => <div key={index}>
      <label>Время {index + 1}<input type="time" required value={time} disabled={busy || !value.enabled}
        onChange={event => update({ ...value, times: value.times.map((item, position) => position === index ? event.target.value : item) })} /></label>
      <button type="button" className="icon-button plain" disabled={busy || !value.enabled} aria-label={`Удалить напоминание в ${time}`}
        onClick={() => update({ ...value, times: value.times.filter((_, position) => position !== index) })}><TrashIcon size={18} /></button>
    </div>)}</div>
    <div className={styles.actions} aria-live="polite">
      <button type="button" className="text-button" disabled={busy || !value.enabled || value.times.length >= 8} onClick={() => {
        const next = SUGGESTED.find(time => !value.times.includes(time));
        if (next) update({ ...value, times: [...value.times, next] });
      }}><PlusIcon size={17} />Добавить время</button>
      {/* No greyed-out button while nothing changed: the save action appears with the first edit. */}
      {dirty
        ? <button type="button" className="button primary small" disabled={busy || !!problem || value.times.some(time => !time)} onClick={() => void save()}>{busy ? 'Сохраняю…' : 'Сохранить'}</button>
        : <span className={styles.saved}><CheckIcon size={15} weight="bold" aria-hidden="true" />Сохранено</span>}
    </div>
    {problem && <p className="disabled-reason">{problem}</p>}
    <p className="caption">Часовой пояс этого компьютера. Напоминания приходят, пока {APP_NAME} запущен, в том числе в трее. На iPhone время настраивается отдельно.</p>
    {message && <p role="status" className={styles.message}>{message}</p>}
  </div>;
}
