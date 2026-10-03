'use strict';

function normalizeReminderSettings(value) {
  if (!value || typeof value !== 'object' || typeof value.enabled !== 'boolean'
    || !Array.isArray(value.times) || value.times.length > 8
    || !value.times.every(time => typeof time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))) {
    throw new Error('Choose up to eight valid reminder times.');
  }
  const times = [...new Set(value.times)].sort();
  if (times.length !== value.times.length) throw new Error('Reminder times must be different.');
  return { enabled: value.enabled && times.length > 0, times };
}

function nextDailyReminder(settings, now, delivered = {}) {
  if (!settings.enabled || !settings.times.length) return null;
  const candidates = [];
  for (const time of settings.times) {
    const [hour, minute] = time.split(':').map(Number);
    for (let day = 0; day < 3; day++) {
      const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + day, hour, minute);
      const key = `${at.getFullYear()}-${at.getMonth() + 1}-${at.getDate()}/${time}`;
      if (at.getTime() > now.getTime() && !delivered[key]) { candidates.push({ at: at.getTime(), time, key }); break; }
    }
  }
  return candidates.sort((a, b) => a.at - b.at)[0] || null;
}

function createDailyReminderScheduler({ initial, persist, notify, now = () => new Date(), timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone + '/' + now().getTimezoneOffset(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  let settings = normalizeReminderSettings(initial || { enabled: false, times: ['19:00'] });
  let delivered = {}; let timer = null; let next = null; let running = false; let zone = timeZone();
  function arm() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (!running || !next) return;
    timer = setTimer(tick, Math.min(60_000, Math.max(1, next.at - now().getTime())));
    timer?.unref?.();
  }
  function replan() { zone = timeZone(); next = nextDailyReminder(settings, now(), delivered); arm(); }
  function tick() {
    timer = null;
    if (!running) return;
    if (zone !== timeZone()) { replan(); return; }
    const stamp = now().getTime();
    if (next && stamp >= next.at) {
      // A sleeping/offline computer must not emit a backlog of stale reminders.
      if (stamp - next.at < 90_000 && !delivered[next.key]) {
        delivered[next.key] = stamp;
        notify(next.time);
      }
      delivered = Object.fromEntries(Object.entries(delivered).filter(([, at]) => stamp - at < 3 * 86_400_000));
      replan();
    } else arm();
  }
  return {
    getSettings: () => ({ enabled: settings.enabled, times: [...settings.times] }),
    save(value) {
      const validated = normalizeReminderSettings(value);
      persist(validated); // Keep the prior schedule if the disk write fails.
      settings = validated;
      replan();
      return this.getSettings();
    },
    start() { running = true; replan(); },
    resume() { if (next && now().getTime() >= next.at) tick(); else replan(); },
    stop() { running = false; if (timer !== null) clearTimer(timer); timer = null; },
  };
}
module.exports = { normalizeReminderSettings, nextDailyReminder, createDailyReminderScheduler };
