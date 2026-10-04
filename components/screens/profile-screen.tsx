'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ArrowsClockwiseIcon, CheckIcon, DownloadSimpleIcon, KeyIcon, ShieldCheckIcon, SparkleIcon, TrashIcon, WarningCircleIcon } from '@phosphor-icons/react';
import type { AppState, Profile } from '@/lib/types';
import { APP_CHANNEL, APP_NAME, APP_VERSION } from '@/lib/app-info';
import { lessonBudget } from '@/lib/lesson-budget';
import { FactsPanel } from '../calls/facts-panel';
import { useApp } from '../app/app-context';
import { messageOf, request } from '../app/api';
import { ReminderSettings } from '../reminder-settings';
import { SubscriptionLimits } from '../subscription-limits';
import styles from './profile.module.css';

type Form = { name: string; goals: string; interests: string; professionalContext: string; relocation: string; dailyMinutes: string; feedback: string; audioRetentionDays: number; budgetUsd: string };
const toForm = (profile: Profile): Form => ({
  name: profile.name, goals: profile.goals, interests: profile.interests.join(', '), professionalContext: profile.professionalContext,
  relocation: profile.relocation, dailyMinutes: String(profile.dailyMinutes), feedback: profile.feedback,
  audioRetentionDays: profile.audioRetentionDays, budgetUsd: String(profile.budgetUsd),
});

function ProfileForm() {
  const app = useApp();
  const profile = app.data.state!.profile;
  const [form, setForm] = useState<Form>(() => toForm(profile));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // Re-sync from the server only while untouched (audit C-11): edits on the phone show up here.
  useEffect(() => { if (!dirty) setForm(toForm(profile)); }, [profile, dirty]);
  const update = <K extends keyof Form>(key: K, value: Form[K]) => { setForm(previous => ({ ...previous, [key]: value })); setDirty(true); setError(''); };
  const minutes = Number(form.dailyMinutes);
  const budget = Number(form.budgetUsd);
  const problem = !form.name.trim() ? 'Укажи имя.' : !form.goals.trim() ? 'Опиши, что хочешь развивать.'
    : !Number.isInteger(minutes) || minutes < 5 || minutes > 60 ? 'Минуты в день — целое число от 5 до 60.'
      : !Number.isFinite(budget) || budget < 1 || budget > 50 ? 'Бюджет голоса — от 1 до 50 $ в месяц.' : '';
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (problem) { setError(problem); return; }
    setSaving(true); setError('');
    try {
      const interests = form.interests.split(',').map(item => item.trim()).filter(Boolean).slice(0, 20);
      const next = await request<AppState>('profile', { ...profile, name: form.name.trim(), goals: form.goals.trim(), interests,
        professionalContext: form.professionalContext.trim(), relocation: form.relocation.trim(), dailyMinutes: minutes,
        feedback: form.feedback.trim(), audioRetentionDays: form.audioRetentionDays, budgetUsd: budget });
      app.data.setState(next); setDirty(false);
      app.toast.notice('Профиль сохранён. Следующие занятия учтут изменения.');
    } catch (reason) { setError(messageOf(reason, 'Не удалось сохранить профиль.')); }
    finally { setSaving(false); }
  };
  return <form className={`glass ${styles.card}`} onSubmit={submit} aria-labelledby="profile-me" noValidate>
    <div className="section-title"><h2 id="profile-me">О тебе</h2></div>
    <div className={styles.fields}>
      <label>Имя<input value={form.name} onChange={event => update('name', event.target.value)} maxLength={80} autoComplete="given-name" /></label>
      <label className={styles.wide}>Что хочешь развивать<textarea rows={3} value={form.goals} onChange={event => update('goals', event.target.value)} maxLength={3000} /></label>
      <label className={styles.wide}>Интересы<input value={form.interests} onChange={event => update('interests', event.target.value)} placeholder="AI-видео, игры, спорт" />
        <span className="form-help">Через запятую — темы, о которых тебе нравится говорить.</span></label>
      <label className={styles.wide}>Работа и проекты<textarea rows={2} value={form.professionalContext} onChange={event => update('professionalContext', event.target.value)} maxLength={2000} /></label>
      <label className={styles.wide}>Переезд и ближайшие интервью<textarea rows={2} value={form.relocation} onChange={event => update('relocation', event.target.value)} maxLength={1000} /></label>
      <label>Минут в день<input type="number" inputMode="numeric" min={5} max={60} step={1} value={form.dailyMinutes} onChange={event => update('dailyMinutes', event.target.value)} />
        <span className="form-help">Одно занятие — до {Number.isFinite(minutes) ? lessonBudget(Math.max(5, minutes || 5)) : 30} мин; остальное время — на следующие.</span></label>
      <label>Хранить аудио<select value={form.audioRetentionDays} onChange={event => update('audioRetentionDays', Number(event.target.value))}>
        <option value={7}>7 дней</option><option value={30}>30 дней</option><option value={90}>3 месяца</option><option value={180}>6 месяцев</option></select></label>
      <label className={styles.wide}>Тон тренера<textarea rows={2} value={form.feedback} onChange={event => update('feedback', event.target.value)} maxLength={1000} placeholder="Например: прямо и по делу, с примерами" />
        <span className="form-help">Как объяснять ошибки. На язык собеседника не влияет.</span></label>
      <label>Бюджет голоса, $ в месяц<input type="number" inputMode="decimal" min={1} max={50} value={form.budgetUsd} onChange={event => update('budgetUsd', event.target.value)} /></label>
    </div>
    {error && <p className="error-text" role="alert">{error}</p>}
    <div className={styles.actions}>
      <button type="submit" className="button primary" disabled={!dirty || saving}>{saving ? 'Сохраняю…' : 'Сохранить'}<CheckIcon size={17} /></button>
      {!dirty && <span className="caption">Изменений нет</span>}
      {dirty && <button type="button" className="text-button muted" onClick={() => { setForm(toForm(profile)); setDirty(false); setError(''); }}>Отменить</button>}
    </div>
  </form>;
}

function VoiceCard() {
  const app = useApp();
  const status = app.data.status;
  const usage = app.data.state!.audioUsage;
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!key.trim()) return;
    setBusy(true); setError('');
    try { await request('audio-key', { key }); setKey(''); await app.data.refreshStatus(); app.toast.notice('Ключ сохранён. Голос проверим при первой озвучке.'); }
    catch (reason) { setError(messageOf(reason, 'Не удалось сохранить ключ.')); }
    finally { setBusy(false); }
  };
  return <section className={`glass ${styles.card}`} aria-labelledby="profile-voice">
    <div className="section-title"><h2 id="profile-voice">Голос</h2><span className={`chip ${status?.audio.configured ? 'lime' : 'warning'}`}>{status?.audio.configured ? 'Подключён' : 'Нет ключа'}</span></div>
    <p className="caption">Распознавание речи и голос собеседника работают через OpenAI API и оплачиваются отдельно. Без ключа можно заниматься текстом.</p>
    <form className={styles.inline} onSubmit={save}>
      <label className="visually-hidden" htmlFor="audio-key">OpenAI API-ключ</label>
      <input id="audio-key" type="password" autoComplete="off" placeholder={status?.audio.configured ? 'Заменить ключ: sk-…' : 'sk-…'} value={key} onChange={event => setKey(event.target.value)} />
      <button className="button secondary" disabled={busy || !key.trim()}><KeyIcon size={16} />{busy ? 'Сохраняю…' : 'Сохранить'}</button>
    </form>
    {error && <p className="error-text" role="alert">{error}</p>}
    <span className="form-help">Ключ хранится {status?.hosting === 'server' ? 'на твоём сервере' : 'на этом компьютере'} и не возвращается в браузер.</span>
    <div className={styles.usage}><span>Голос за месяц · оценка</span><strong className="tabular">${usage.usedUsd.toFixed(2)} <span className="caption">/ ${usage.budgetUsd}</span></strong></div>
  </section>;
}

function ModelCard() {
  const app = useApp();
  const status = app.data.status;
  const [checking, setChecking] = useState(false);
  return <section className={`glass ${styles.card}`} aria-labelledby="profile-model">
    <div className="section-title"><h2 id="profile-model">Учебная модель</h2><SparkleIcon size={20} /></div>
    <p><strong>GPT‑6.1 Sol</strong> — подбирает занятия, ведёт диалог и разбирает ответы{status?.brain.mode === 'siwc' ? ' через твою подписку ChatGPT' : ' через локальный Codex и лимиты подписки'}.</p>
    <span className={`chip ${status?.brain.authenticated ? 'lime' : 'warning'}`} style={{ justifySelf: 'start' }}>{status ? status.brain.authenticated ? 'Вход в подписку сохранён' : 'Нужен вход в подписку' : app.data.statusFailed ? 'Статус недоступен' : 'Проверяю…'}</span>
    {status?.brain.error && <p className="error-text">{status.brain.error}</p>}
    <button type="button" className="text-button" disabled={checking} onClick={async () => { setChecking(true); await app.data.refreshStatus(); setChecking(false); }}><ArrowsClockwiseIcon size={16} />{checking ? 'Проверяю…' : 'Проверить подключение'}</button>
  </section>;
}

function DataCard() {
  const app = useApp();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const status = app.data.status;
  return <section className={`glass ${styles.card}`} aria-labelledby="profile-data">
    <div className="section-title"><h2 id="profile-data">Данные</h2><ShieldCheckIcon size={20} /></div>
    <p className="caption">{status?.hosting === 'server' ? 'Компьютер и телефон используют одну историю на твоём сервере.' : 'История хранится на этом компьютере.'}</p>
    <a className="button secondary" href="/api/export" download style={{ justifySelf: 'start' }}><DownloadSimpleIcon size={16} />Скачать историю (JSON)</a>
    <details className={styles.danger}>
      <summary><TrashIcon size={16} />Удалить историю тренировок</summary>
      <p className="caption">Удалятся занятия, аудио, разборы и прогресс на их основе. Профиль останется. Отменить нельзя.</p>
      <label>Чтобы подтвердить, введи DELETE<input value={typed} onChange={event => setTyped(event.target.value)} autoComplete="off" spellCheck={false} /></label>
      <button type="button" className="button danger" disabled={busy || typed !== 'DELETE'} onClick={async () => { setBusy(true); const done = await app.lesson.resetAll(); setBusy(false); if (done) setTyped(''); }}>
        {busy ? 'Удаляю…' : 'Удалить навсегда'}</button>
      {typed && typed !== 'DELETE' && <span className="disabled-reason"><WarningCircleIcon size={15} />Нужно ввести DELETE заглавными.</span>}
    </details>
  </section>;
}

export function ProfileScreen() {
  const app = useApp();
  const state = app.data.state!;
  const version = app.data.status?.app?.version ?? APP_VERSION;
  return <div className="screen" data-screen="profile">
    <header className="screen-header"><div><h1 tabIndex={-1} data-screen-heading style={{ outline: 'none' }}>Профиль</h1><p className="lede">Цели, голос, напоминания и твои данные.</p></div></header>
    <div className={styles.grid}>
      <div className={styles.column}>
        <ProfileForm />
        {/* FactsPanel («Мой плейбук») brings its own heading and explanation. */}
        <section className={`glass ${styles.card}`} aria-label="Мой плейбук">
          <FactsPanel facts={state.profileFacts ?? []} onChanged={() => void app.data.refresh()} />
        </section>
      </div>
      <div className={styles.column}>
        <VoiceCard />
        <section className={`glass ${styles.card}`}><ReminderSettings /></section>
        <SubscriptionLimits usage={app.data.usage} loading={app.data.usageLoading} onRefresh={() => void app.data.refreshUsage(true)} />
        <ModelCard />
        <DataCard />
        <p className={styles.version}>{APP_NAME} {version}{APP_CHANNEL ? ` · ${APP_CHANNEL}` : ''}</p>
      </div>
    </div>
  </div>;
}
