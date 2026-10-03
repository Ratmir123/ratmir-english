'use client';

import { useEffect, useState } from 'react';
import { BellIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import type { DailyReminderSettings } from './desktop-bridge';
import styles from './reminder-settings.module.css';

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
      .catch(() => { if (alive) setMessage('Не удалось загрузить времена. Открой настройки ещё раз.'); });
    return () => { alive = false; };
  }, []);
  function update(next: DailyReminderSettings) { setValue(next); setDirty(true); setMessage(''); }
  async function save() {
    if (!value || busy) return;
    if (new Set(value.times).size !== value.times.length) { setMessage('Выбери разные времена для напоминаний.'); return; }
    setBusy(true); setMessage('');
    try {
      const result = await window.ratmirDesktop?.saveReminderSettings?.(value);
      if (!result) { setMessage('Обнови приложение на компьютере до 0.4.2.'); return; }
      setValue(result); setDirty(false); setMessage('Расписание сохранено.');
    } catch { setMessage('Не удалось сохранить расписание на компьютере. Изменения не применились. Попробуй ещё раз.'); }
    finally { setBusy(false); }
  }
  return <section className={`settings-section ${styles.section}`} aria-labelledby="reminder-title">
    <div className="section-title"><h2 id="reminder-title">Напоминания</h2><BellIcon size={21} /></div>
    {value ? <>
      <label className={styles.toggle}><input type="checkbox" checked={value.enabled} disabled={busy}
        onChange={event => update({ ...value, enabled: event.target.checked })} />Каждый день в выбранное время</label>
      <div className={styles.times}>{value.times.map((time, index) => <div key={index}>
        <label>Время {index + 1}<input type="time" required value={time} disabled={busy}
          onChange={event => update({ ...value, times: value.times.map((item, position) => position === index ? event.target.value : item) })} /></label>
        <button type="button" className="icon-button" disabled={busy} aria-label={`Удалить напоминание в ${time}`}
          onClick={() => update({ ...value, times: value.times.filter((_, position) => position !== index) })}><TrashIcon size={19} /></button>
      </div>)}</div>
      <div className={styles.actions}>
        <button type="button" className="text-button" disabled={busy || value.times.length >= 8} onClick={() => {
          const next = ['09:00', '13:00', '19:00', '21:00', '08:00', '12:00', '16:00', '18:00'].find(time => !value.times.includes(time));
          if (next) update({ ...value, times: [...value.times, next] });
        }}><PlusIcon size={17} />Добавить время</button>
        <button type="button" className="button secondary" disabled={busy || !dirty || value.times.some(time => !time)} onClick={() => void save()}>{busy ? 'Сохраняю…' : 'Сохранить'}</button>
      </div>
      <p className="caption">Часовой пояс этого компьютера. Напоминания работают, пока Smooth English запущен, в том числе в трее. Времена на iPhone настраиваются отдельно.</p>
    </> : <p className="caption">{native ? 'Для настройки времени обнови приложение на компьютере до 0.4.2.' : 'Открой настройки в приложении Smooth English на iPhone или компьютере, чтобы выбрать времена уведомлений.'}</p>}
    {message && <p role="status" className={styles.message}>{message}</p>}
  </section>;
}
