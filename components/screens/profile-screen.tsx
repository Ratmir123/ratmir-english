'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowsClockwiseIcon, CaretRightIcon, CheckIcon, DownloadSimpleIcon, KeyIcon, TrashIcon, WarningCircleIcon } from '@phosphor-icons/react';
import type { AppState, Profile } from '@/lib/types';
import { APP_CHANNEL, APP_NAME, APP_VERSION } from '@/lib/app-info';
import { lessonBudget } from '@/lib/lesson-budget';
import { followThemeChanges, readThemePreference, saveThemePreference, THEME_LABEL, type ThemePreference } from '@/lib/client/theme';
import { useApp } from '../app/app-context';
import { messageOf, request } from '../app/api';
import { count } from '../app/labels';
import { ReminderSettings } from '../reminder-settings';
import { SubscriptionLimits } from '../subscription-limits';
import { ScreenMascot } from '../shell/screen-mascot';
import { Segmented } from '../ui/segmented';
import styles from './profile.module.css';

type Form = { name: string; goals: string; interests: string; professionalContext: string; relocation: string; dailyMinutes: string; feedback: string };
const toForm = (profile: Profile): Form => ({
  name: profile.name, goals: profile.goals, interests: profile.interests.join(', '), professionalContext: profile.professionalContext,
  relocation: profile.relocation, dailyMinutes: String(profile.dailyMinutes), feedback: profile.feedback,
});

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
/**
 * One setting that saves on its own, without the «О тебе» form (voice budget, audio retention): the latest server
 * profile with just this field changed. Unsaved edits in the form stay in the form.
 */
function useInstantProfileSave() {
  const app = useApp();
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState('');
  useEffect(() => {
    if (state !== 'saved') return;
    const timer = setTimeout(() => setState('idle'), 2400);
    return () => clearTimeout(timer);
  }, [state]);
  const save = async (patch: Partial<Profile>, failure: string) => {
    const current = app.data.stateRef.current?.profile;
    if (!current) return;
    setState('saving'); setError('');
    try { app.data.setState(await request<AppState>('profile', { ...current, ...patch })); setState('saved'); }
    catch (reason) { setState('error'); setError(messageOf(reason, failure)); }
  };
  const fail = (message: string) => { setState('error'); setError(message); };
  const reset = () => { setState('idle'); setError(''); };
  return { state, error, save, fail, reset };
}

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
  const problem = !form.name.trim() ? 'Укажи имя.' : !form.goals.trim() ? 'Опиши, что хочешь развивать.'
    : !Number.isInteger(minutes) || minutes < 5 || minutes > 60 ? 'Минуты в день — целое число от 5 до 60.' : '';
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!dirty) return;
    if (problem) { setError(problem); return; }
    setSaving(true); setError('');
    try {
      const interests = form.interests.split(',').map(item => item.trim()).filter(Boolean).slice(0, 20);
      // Budget and audio retention save on their own (Голос, Данные): the latest server values go along unchanged.
      const latest = app.data.stateRef.current?.profile ?? profile;
      const next = await request<AppState>('profile', { ...latest, name: form.name.trim(), goals: form.goals.trim(), interests,
        professionalContext: form.professionalContext.trim(), relocation: form.relocation.trim(), dailyMinutes: minutes,
        feedback: form.feedback.trim() });
      app.data.setState(next); setDirty(false);
      app.toast.notice('Профиль сохранён. Следующие занятия учтут изменения.');
    } catch (reason) { setError(messageOf(reason, 'Не удалось сохранить профиль.')); }
    finally { setSaving(false); }
  };
  return <form className={`surface ${styles.card}`} onSubmit={submit} aria-labelledby="profile-me" noValidate data-enter>
    <div className={styles.head}><h2 id="profile-me">О тебе</h2></div>
    <div className={styles.fields}>
      <label>Имя<input value={form.name} onChange={event => update('name', event.target.value)} maxLength={80} autoComplete="given-name" /></label>
      <label className={styles.wide}>Что хочешь развивать<textarea rows={3} value={form.goals} onChange={event => update('goals', event.target.value)} maxLength={3000} /></label>
      <label className={styles.wide}>Интересы<input value={form.interests} onChange={event => update('interests', event.target.value)} placeholder="AI-видео, игры, спорт" />
        <span className="form-help">Через запятую — темы, о которых тебе нравится говорить.</span></label>
      <label className={styles.wide}>Работа и проекты<textarea rows={2} value={form.professionalContext} onChange={event => update('professionalContext', event.target.value)} maxLength={2000} /></label>
      <label className={styles.wide}>Переезд и ближайшие интервью<textarea rows={2} value={form.relocation} onChange={event => update('relocation', event.target.value)} maxLength={1000} /></label>
      <label>Минут в день<input type="number" inputMode="numeric" min={5} max={60} step={1} value={form.dailyMinutes} onChange={event => update('dailyMinutes', event.target.value)} />
        <span className="form-help">Одно занятие — до {Number.isFinite(minutes) ? lessonBudget(Math.max(5, minutes || 5)) : 30} мин; остальное время — на следующие.</span></label>
      <label className={styles.wide}>Тон тренера<textarea rows={2} value={form.feedback} onChange={event => update('feedback', event.target.value)} maxLength={1000} placeholder="Например: прямо и по делу, с примерами" />
        <span className="form-help">Как объяснять ошибки. На язык собеседника не влияет.</span></label>
    </div>
    {error && <p className="error-text" role="alert">{error}</p>}
    {/* Untouched: a calm saved state instead of a greyed-out button; the action appears with the first edit. */}
    <div className={styles.actions} aria-live="polite">
      {dirty
        ? <>
          <button type="submit" className="button primary" disabled={saving}>{saving ? 'Сохраняю…' : 'Сохранить'}<CheckIcon size={17} /></button>
          <button type="button" className="text-button muted" disabled={saving} onClick={() => { setForm(toForm(profile)); setDirty(false); setError(''); }}>Отменить</button>
        </>
        : <span className={styles.saved}><CheckIcon size={16} weight="bold" aria-hidden="true" />Всё сохранено</span>}
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
  const configured = !!status?.audio.configured;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!key.trim()) { setError('Вставь ключ OpenAI — он начинается с sk-.'); return; }
    setBusy(true); setError('');
    try { await request('audio-key', { key }); setKey(''); await app.data.refreshStatus(); app.toast.notice('Ключ сохранён. Голос проверим при первой озвучке.'); }
    catch (reason) { setError(messageOf(reason, 'Не удалось сохранить ключ.')); }
    finally { setBusy(false); }
  };
  return <section className={`surface ${styles.card}`} aria-labelledby="profile-voice" data-enter>
    <div className={styles.head}><h2 id="profile-voice">Голос</h2>{status && <span className={`chip ${configured ? 'lime' : 'warning'}`}>{configured ? 'Подключён' : 'Нет ключа'}</span>}</div>
    <p className="caption">Распознавание речи и голос собеседника работают через OpenAI API и оплачиваются отдельно. Без ключа можно заниматься текстом.</p>
    <form className={styles.inline} onSubmit={save}>
      <label className={styles.keyField}>{configured ? 'Заменить ключ OpenAI' : 'Ключ OpenAI API'}
        <input id="audio-key" type="password" autoComplete="off" placeholder="sk-…" value={key} onChange={event => { setKey(event.target.value); setError(''); }} />
      </label>
      <button type="submit" className="button secondary" disabled={busy}><KeyIcon size={16} />{busy ? 'Сохраняю…' : 'Сохранить ключ'}</button>
    </form>
    {error && <p className="error-text" role="alert">{error}</p>}
    <span className="form-help">Ключ хранится {status?.hosting === 'server' ? 'на твоём сервере' : 'на этом компьютере'} и не возвращается в браузер.</span>
    <div className={styles.usage}><span>Голос за месяц, оценка</span><strong className="tabular">${usage.usedUsd.toFixed(2)} <span className="caption">из ${usage.budgetUsd}</span></strong></div>
    <BudgetField />
  </section>;
}

/** Monthly voice budget, saved on its own a moment after typing stops, on Enter or when the field is left. */
function BudgetField() {
  const app = useApp();
  const saved = app.data.state!.profile.budgetUsd;
  const [value, setValue] = useState(String(saved));
  const editing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const instant = useInstantProfileSave();
  useEffect(() => { if (!editing.current) setValue(String(saved)); }, [saved]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const commit = (text: string) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    editing.current = false;
    const amount = Number(text);
    if (!text.trim() || !Number.isFinite(amount) || amount < 1 || amount > 50) { instant.fail('Бюджет голоса — от 1 до 50 $ в месяц.'); return; }
    if (amount === app.data.stateRef.current?.profile.budgetUsd) { instant.reset(); return; }
    void instant.save({ budgetUsd: amount }, 'Не удалось сохранить бюджет.');
  };
  const change = (text: string) => {
    editing.current = true; setValue(text); instant.reset();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(text), 900);
  };
  return <div className={styles.setting}>
    <label className={styles.settingLabel} htmlFor="voice-budget">Бюджет голоса, $ в месяц</label>
    <input id="voice-budget" className={styles.settingInput} type="number" inputMode="decimal" min={1} max={50} value={value}
      onChange={event => change(event.target.value)} onBlur={() => { if (editing.current) commit(value); }}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(value); } }} />
    <span className={styles.settingStatus} aria-live="polite">{instant.state === 'saving' ? 'Сохраняю…' : instant.state === 'saved' ? <><CheckIcon size={14} weight="bold" aria-hidden="true" />Сохранено</> : null}</span>
    {instant.error && <p className={`error-text ${styles.settingError}`} role="alert">{instant.error}</p>}
  </div>;
}

/** How long recordings are kept, saved as soon as it is picked. */
function RetentionField() {
  const app = useApp();
  const saved = app.data.state!.profile.audioRetentionDays;
  const [value, setValue] = useState(saved);
  const instant = useInstantProfileSave();
  useEffect(() => { if (instant.state !== 'saving') setValue(saved); }, [saved, instant.state]);
  return <div className={styles.setting}>
    <label className={styles.settingLabel} htmlFor="audio-retention">Хранить аудио</label>
    <select id="audio-retention" className={styles.settingInput} value={value} onChange={event => {
      const days = Number(event.target.value); setValue(days);
      void instant.save({ audioRetentionDays: days }, 'Не удалось сохранить срок хранения.');
    }}>
      <option value={7}>7 дней</option><option value={30}>30 дней</option><option value={90}>3 месяца</option><option value={180}>6 месяцев</option>
    </select>
    <span className={styles.settingStatus} aria-live="polite">{instant.state === 'saving' ? 'Сохраняю…' : instant.state === 'saved' ? <><CheckIcon size={14} weight="bold" aria-hidden="true" />Сохранено</> : null}</span>
    {instant.error && <p className={`error-text ${styles.settingError}`} role="alert">{instant.error}</p>}
  </div>;
}

/** «Мой плейбук» lives in Созвоны (with the calls it comes from); here a short way there. */
function PlaybookLink() {
  const app = useApp();
  const facts = app.data.state!.profileFacts ?? [];
  const toCheck = facts.filter(fact => fact.status === 'suggested').length;
  const accepted = facts.filter(fact => fact.status === 'accepted').length;
  const detail = toCheck ? `${count(toCheck, ['новое предложение', 'новых предложения', 'новых предложений'])} — проверь`
    : accepted ? `${count(accepted, ['факт', 'факта', 'фактов'])} в плейбуке` : 'Ставки, кейсы и цифры из твоих звонков — попадает только то, что ты подтвердил.';
  return <button type="button" className={`surface ${styles.card} ${styles.linkCard}`} data-enter onClick={() => app.go('calls', { calls: 'playbook' })}>
    <span className={styles.linkCopy}><strong>Мой плейбук</strong><span>{detail}</span></span>
    <span className={styles.linkAction}>Открыть<CaretRightIcon size={16} aria-hidden="true" /></span>
  </button>;
}

/** Sol and the subscription it runs on: connection state, a human reason when it fails, then the limits. */
function ModelCard() {
  const app = useApp();
  const status = app.data.status;
  const [checking, setChecking] = useState(false);
  const brain = status?.brain;
  const state = !status ? app.data.statusFailed ? { tone: 'warning', label: 'Статус недоступен' } : { tone: '', label: 'Проверяю…' }
    : brain?.authenticated ? { tone: 'lime', label: 'Подключена' } : { tone: 'warning', label: 'Нужен вход в подписку' };
  return <section className={`surface ${styles.card}`} aria-labelledby="profile-model" data-enter>
    <div className={styles.head}><h2 id="profile-model">Учебная модель</h2><span className={`chip ${state.tone}`}>{state.label}</span></div>
    <p className={styles.body}><strong>GPT‑6.1 Sol</strong> подбирает занятия, ведёт диалог и разбирает ответы{brain?.mode === 'siwc' ? ' через твою подписку ChatGPT' : ' через локальный Codex и лимиты подписки'}.</p>
    {status && !brain?.authenticated && !brain?.error && <p className="caption">Войди в подписку, чтобы Sol мог вести занятия и разборы.</p>}
    {brain?.error && <div className={styles.problem} role="status">
      <WarningCircleIcon size={18} weight="fill" aria-hidden="true" />
      <div className={styles.problemCopy}>
        <strong>Sol не подключается</strong>
        <span>Занятия и разборы идут через Sol. Проверь подключение ещё раз; если не поможет, техническая причина ниже пригодится для настройки.</span>
        <details className={styles.detail}><summary>Техническая причина<CaretRightIcon size={13} aria-hidden="true" /></summary><code>{brain.error}</code></details>
      </div>
    </div>}
    <button type="button" className={`button secondary small ${styles.check}`} disabled={checking} onClick={async () => { setChecking(true); await app.data.refreshStatus(); setChecking(false); }}>
      <ArrowsClockwiseIcon size={16} />{checking ? 'Проверяю…' : 'Проверить подключение'}</button>
    <div className={styles.divider} />
    <SubscriptionLimits embedded usage={app.data.usage} loading={app.data.usageLoading} onRefresh={() => void app.data.refreshUsage(true)} />
  </section>;
}

function DataCard() {
  const app = useApp();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const status = app.data.status;
  return <section className={`surface ${styles.card} ${styles.dataCard}`} aria-labelledby="profile-data" data-enter>
    <div className={styles.head}><h2 id="profile-data">Данные</h2></div>
    <p className="caption">{status?.hosting === 'server' ? 'Компьютер и телефон используют одну историю на твоём сервере.' : 'История хранится на этом компьютере.'}</p>
    <RetentionField />
    <div className="rows">
      <a className={styles.row} href="/api/export" download><DownloadSimpleIcon size={18} aria-hidden="true" /><span>Скачать историю (JSON)</span></a>
      {/* The warning says exactly what goes (MOTION-PASS-0.5.2 §8.2, same text on iPhone). */}
      <details className={styles.danger}>
        <summary className={styles.row}><TrashIcon size={18} aria-hidden="true" /><span>Удалить всю практику</span><CaretRightIcon size={15} className={styles.caret} aria-hidden="true" /></summary>
        <div className={styles.dangerBody}>
          <p className="caption">Удалятся занятия, записи, созвоны с разборами, паттерны, тренировки и результат теста уровня. Профиль и принятые факты останутся. Отменить нельзя.</p>
          <a className={`text-button ${styles.backup}`} href="/api/export" download><DownloadSimpleIcon size={16} aria-hidden="true" />Сначала скачать копию</a>
          <label>Чтобы подтвердить, введи DELETE<input value={typed} onChange={event => setTyped(event.target.value)} autoComplete="off" spellCheck={false} /></label>
          <button type="button" className="button danger" disabled={busy || typed !== 'DELETE'} onClick={async () => { setBusy(true); const done = await app.lesson.resetAll(); setBusy(false); if (done) setTyped(''); }}>
            <TrashIcon size={16} />{busy ? 'Удаляю…' : 'Удалить навсегда'}</button>
          {typed && typed !== 'DELETE' && <span className="disabled-reason"><WarningCircleIcon size={15} />Нужно ввести DELETE заглавными.</span>}
        </div>
      </details>
    </div>
  </section>;
}

/** Light / dark / system, per device (like the phone's own setting); applied instantly, no save step. */
function AppearanceCard() {
  const [theme, setTheme] = useState<ThemePreference>('system');
  useEffect(() => { setTheme(readThemePreference()); return followThemeChanges(setTheme); }, []);
  return <section className={`surface ${styles.card}`} aria-labelledby="profile-appearance" data-enter>
    <div className={styles.head}><h2 id="profile-appearance">Оформление</h2></div>
    <Segmented label="Тема оформления" block value={theme} onChange={value => { setTheme(value); saveThemePreference(value); }}
      options={(['system', 'light', 'dark'] as const).map(id => ({ id, label: THEME_LABEL[id] }))} />
    <p className="caption">Только на этом устройстве. «Как в системе» переключается вместе с Windows или iPhone.</p>
  </section>;
}

export function ProfileScreen() {
  const app = useApp();
  const version = app.data.status?.app?.version ?? APP_VERSION;
  return <div className={`screen ${styles.profile}`} data-screen="profile">
    <header className="screen-header with-mascot" data-enter>
      <div><h1 tabIndex={-1} data-screen-heading style={{ outline: 'none' }}>Профиль</h1><p className="lede">Цели, голос, напоминания и твои данные.</p></div>
      <ScreenMascot emotion="wink" fluid className="screen-mascot" />
    </header>
    <div className={styles.grid}>
      <div className={styles.column}>
        <ProfileForm />
        <PlaybookLink />
      </div>
      <div className={styles.column}>
        <AppearanceCard />
        <VoiceCard />
        <section className={`surface ${styles.card}`} aria-labelledby="reminder-title" data-enter><ReminderSettings /></section>
        <ModelCard />
        <DataCard />
        <p className={styles.version} data-enter>{APP_NAME} {version}{APP_CHANNEL ? ` · ${APP_CHANNEL}` : ''}</p>
      </div>
    </div>
  </div>;
}
