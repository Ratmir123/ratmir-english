'use client';

import { useEffect, useState } from 'react';
import { BellIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { APP_NAME } from '@/lib/app-info';
import type { DailyReminderSettings } from './desktop-bridge';
import styles from './reminder-settings.module.css';

const SUGGESTED = ['09:00', '13:00', '19:00', '21:00', '08:00', '12:00', '16:00', '18:00'];

export function ReminderSettings() {
  const [value, setValue] = useState<DailyReminderSettings | null>(null);
  const [native, setNative] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let alive = true;
    const bridge = window.ratmirDesktop;
    setNative(!!bridge);
    if (bridge?.getReminderSettings) void bridge.getReminderSettings().then(settings => { if (alive) { setValue(settings); if (settings.warning) setMessage(settings.warning); } })
      .catch(() => { if (alive) setMessage('Не удалось загрузить времена. Открой профиль ещё раз.'); });
    return () => { alive = false; };
  }, []);
  function update(next: DailyReminderSettings) { setValue(next); setDirty(true); setMessage(''); }
  // Enabling with no times would silently save as «off» (audit U-32): say so before saving.
  const problem = value && value.enabled && value.times.length === 0 ? 'Добавь хотя бы одно время или выключи напоминания.'
    : value && new Set(value.times).size !== value.times.length ? 'Выбери разные времена.' : '';
  async function save() {
    if (!value || busy || problem) return;
    setBusy(true); setMessage('');
    try {
      const result = await window.ratmirDesktop?.saveReminderSettings?.(value);
      if (!result) { setMessage('Обнови приложение на компьютере, чтобы настроить время.'); return; }
      setValue(result); setDirty(false); setMessage(result.enabled ? 'Расписание сохранено.' : 'Напоминания выключены.');
    } catch { setMessage('Не удалось сохранить расписание. Изменения не применились — попробуй ещё раз.'); }
    finally { setBusy(false); }
  }
  return <div className={styles.section} aria-labelledby="reminder-title">
    <div className="section-title"><h2 id="reminder-title">Напоминания</h2><BellIcon size={21} /></div>
    {value ? <>
      <label className={styles.toggle}><input type="checkbox" checked={value.enabled} disabled={busy}
        onChange={event => update({ ...value, enabled: event.target.checked, times: event.target.checked && !value.times.length ? ['19:00'] : value.times })} />Каждый день в выбранное время</label>
      <div className={styles.times}>{value.times.map((time, index) => <div key={index}>
        <label>Время {index + 1}<input type="time" required value={time} disabled={busy || !value.enabled}
          onChange={event => update({ ...value, times: value.times.map((item, position) => position === index ? event.target.value : item) })} /></label>
        <button type="button" className="icon-button plain" disabled={busy || !value.enabled} aria-label={`Удалить напоминание в ${time}`}
          onClick={() => update({ ...value, times: value.times.filter((_, position) => position !== index) })}><TrashIcon size={18} /></button>
      </div>)}</div>
      <div className={styles.actions}>
        <button type="button" className="text-button" disabled={busy || !value.enabled || value.times.length >= 8} onClick={() => {
          const next = SUGGESTED.find(time => !value.times.includes(time));
          if (next) update({ ...value, times: [...value.times, next] });
        }}><PlusIcon size={17} />Добавить время</button>
        <button type="button" className="button secondary" disabled={busy || !dirty || !!problem || value.times.some(time => !time)} onClick={() => void save()}>{busy ? 'Сохраняю…' : 'Сохранить'}</button>
      </div>
      {problem && <p className="disabled-reason">{problem}</p>}
      <p className="caption">Часовой пояс этого компьютера. Напоминания приходят, пока {APP_NAME} запущен, в том числе в трее. На iPhone время настраивается отдельно.</p>
    </> : <p className="caption">{native ? 'Обнови приложение на компьютере, чтобы выбрать время напоминаний.' : `Время напоминаний выбирается в приложении ${APP_NAME} на компьютере или iPhone.`}</p>}
    {message && <p role="status" className={styles.message}>{message}</p>}
  </div>;
}
