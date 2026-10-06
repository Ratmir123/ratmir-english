'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowsClockwiseIcon, CaretDownIcon, CaretRightIcon, CheckIcon, DownloadSimpleIcon, KeyIcon, PencilSimpleIcon, TrashIcon, WarningCircleIcon,
} from '@phosphor-icons/react';
import type { AppState, Profile } from '@/lib/types';
import { APP_CHANNEL, APP_NAME, APP_VERSION } from '@/lib/app-info';
import { lessonBudget } from '@/lib/lesson-budget';
import { budgetDollars, limitNotice, wholeDollars, type LimitNotice } from '@/lib/limit-notice';
import { followThemeChanges, readThemePreference, saveThemePreference, THEME_LABEL, type ThemePreference } from '@/lib/client/theme';
import { useApp } from '../app/app-context';
import { messageOf, request } from '../app/api';
import { count } from '../app/labels';
import type { ProfileSection } from '../app/use-navigation';
import { ReminderSettings, ReminderStatus, reminderSummary, useReminderSource } from '../reminder-settings';
import { SubscriptionLimits } from '../subscription-limits';
import { ScreenMascot } from '../shell/screen-mascot';
import { prefersReducedMotion } from '../ui/motion';
import { Segmented } from '../ui/segmented';
import { Sheet } from '../ui/sheet';
import styles from './profile.module.css';

/*
 * Compact profile (PASS-0.5.3 §3): who you are in one summary block, then one list of settings — each row a single
 * line with its current value; details open in place (height + opacity, MOTION-PASS-0.5.2 tokens). Open rows are
 * remembered on this device; a limit notice on Today opens its row («Тренер и лимиты» or «Голос»).
 */

type Form = { name: string; goals: string; interests: string; professionalContext: string; relocation: string; dailyMinutes: string; feedback: string };
const toForm = (profile: Profile): Form => ({
  name: profile.name, goals: profile.goals, interests: profile.interests.join(', '), professionalContext: profile.professionalContext,
  relocation: profile.relocation, dailyMinutes: String(profile.dailyMinutes), feedback: profile.feedback,
});

/**
 * The summary's «тон: …»: the first clause of the coach-tone answer (up to . , ; : ! ? ( ) — – « - » or a line
 * break), lower-cased unless it opens with an abbreviation (AI, IELTS), cut at a word to ≤ 40 characters with «…».
 * An empty answer shows no tone part. The iPhone summary uses the same rule.
 */
function shortTone(feedback: string): string {
  const clause = feedback.split(/[.,;:!?()\n—–]| - /u).map(part => part.trim()).find(Boolean) ?? '';
  if (!clause) return '';
  const lowered = /^\p{Lu}\p{Lu}/u.test(clause) ? clause : clause.charAt(0).toLocaleLowerCase('ru') + clause.slice(1);
  if (lowered.length <= 40) return lowered;
  const cut = lowered.slice(0, 39);
  const space = cut.lastIndexOf(' ');
  return `${(space >= 20 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const RETENTION_LABEL: Record<number, string> = { 7: '7 дней', 30: '30 дней', 90: '3 месяца', 180: '6 месяцев' };
const retentionLabel = (days: number) => RETENTION_LABEL[days] ?? count(days, ['день', 'дня', 'дней']);

/* Which rows are open, per device (a convenience: private mode or blocked storage just starts collapsed). */
type RowId = ProfileSection | 'about';
const OPEN_ROWS_KEY = 'ratmir:profile-open:v1';
const ROW_IDS: readonly RowId[] = ['about', 'voice', 'reminders', 'limits', 'data'];
function readOpenRows(): ReadonlySet<RowId> {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(OPEN_ROWS_KEY) || '[]');
    return new Set(Array.isArray(stored) ? stored.filter((item): item is RowId => ROW_IDS.includes(item as RowId)) : []);
  } catch { return new Set(); }
}
function saveOpenRows(rows: ReadonlySet<RowId>) {
  try { window.localStorage.setItem(OPEN_ROWS_KEY, JSON.stringify([...rows])); } catch { /* Optional convenience. */ }
}
const rowElementId = (id: ProfileSection) => `profile-row-${id}`;
/** The last navigation target already shown: a section asked for once opens once, not again on every later visit. */
let consumedTarget = 0;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
/**
 * One setting that saves on its own (voice budget, audio retention): the latest server profile with just this field
 * changed. Unsaved edits in the «О тебе» editor stay in the editor.
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

/** The open part of a row: eases open (height + opacity), closes a little faster; inert and out of the layout when closed. */
function Panel({ id, open, labelledBy, children }: { id: string; open: boolean; labelledBy?: string; children: ReactNode }) {
  return <div id={id} className={styles.panel} data-open={open} inert={!open} {...(labelledBy ? { role: 'region', 'aria-labelledby': labelledBy } : {})}>
    <div className={styles.panelClip}>{children}</div>
  </div>;
}

/** One settings line that opens in place: title, current value, caret (a button with aria-expanded/aria-controls). */
function Row({ id, title, value, valueTone, open, onToggle, children }: {
  id: ProfileSection; title: string; value: ReactNode; valueTone?: LimitNotice['tone']; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  const buttonId = `${rowElementId(id)}-button`;
  const panelId = `${rowElementId(id)}-panel`;
  return <div className={styles.item} id={rowElementId(id)} data-open={open} data-testid={rowElementId(id)}>
    <h2 className={styles.itemHeading}>
      <button type="button" id={buttonId} className={styles.itemButton} aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
        <span className={styles.itemTitle}>{title}</span>
        <span className={styles.itemValue} data-tone={valueTone}>{value}</span>
        <CaretDownIcon size={16} className={styles.caret} aria-hidden="true" />
      </button>
    </h2>
    <Panel id={panelId} open={open} labelledBy={buttonId}><div className={styles.panelBody}>{children}</div></Panel>
  </div>;
}

/** «О тебе» (the 7 fields) in a sheet. While there are unsaved edits it closes only by «Сохранить» or «Отменить». */
function ProfileEditor({ open, onClose }: { open: boolean; onClose: () => void }) {
  const app = useApp();
  const profile = app.data.state!.profile;
  const formId = useId();
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
  const discard = () => { if (saving) return; setForm(toForm(profile)); setDirty(false); setError(''); onClose(); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!dirty) { onClose(); return; }
    if (problem) { setError(problem); return; }
    setSaving(true); setError('');
    try {
      const interests = form.interests.split(',').map(item => item.trim()).filter(Boolean).slice(0, 20);
      // Budget and audio retention save on their own (Голос, Данные): the latest server values go along unchanged.
      const latest = app.data.stateRef.current?.profile ?? profile;
      const next = await request<AppState>('profile', { ...latest, name: form.name.trim(), goals: form.goals.trim(), interests,
        professionalContext: form.professionalContext.trim(), relocation: form.relocation.trim(), dailyMinutes: minutes,
        feedback: form.feedback.trim() });
      app.data.setState(next); setDirty(false); onClose();
      app.toast.notice('Профиль сохранён. Следующие занятия учтут изменения.');
    } catch (reason) { setError(messageOf(reason, 'Не удалось сохранить профиль.')); }
    finally { setSaving(false); }
  };
  return <Sheet open={open} onClose={discard} dismissible={!dirty && !saving} title="О тебе" subtitle="Sol учитывает это в занятиях и разборах." testId="profile-editor"
    actions={<>
      <button type="submit" form={formId} className="button primary large block" disabled={saving}>
        {saving ? 'Сохраняю…' : dirty ? 'Сохранить' : 'Готово'}{dirty && !saving && <CheckIcon size={17} aria-hidden="true" />}</button>
      {dirty && <button type="button" className="button secondary block" disabled={saving} onClick={discard}>Отменить</button>}
    </>}>
    <form id={formId} className={styles.editor} onSubmit={submit} noValidate>
      <div className={styles.fields}>
        <label>Имя<input value={form.name} onChange={event => update('name', event.target.value)} maxLength={80} autoComplete="given-name" /></label>
        <label>Минут в день<input type="number" inputMode="numeric" min={5} max={60} step={1} value={form.dailyMinutes} onChange={event => update('dailyMinutes', event.target.value)} />
          <span className="form-help">Одно занятие — до {Number.isFinite(minutes) ? lessonBudget(Math.max(5, minutes || 5)) : 30} мин; остальное время — на следующие.</span></label>
        <label className={styles.wide}>Что хочешь развивать<textarea rows={3} value={form.goals} onChange={event => update('goals', event.target.value)} maxLength={3000} /></label>
        <label className={styles.wide}>Интересы<input value={form.interests} onChange={event => update('interests', event.target.value)} placeholder="AI-видео, игры, спорт" />
          <span className="form-help">Через запятую — темы, о которых тебе нравится говорить.</span></label>
        <label className={styles.wide}>Работа и проекты<textarea rows={2} value={form.professionalContext} onChange={event => update('professionalContext', event.target.value)} maxLength={2000} /></label>
        <label className={styles.wide}>Переезд и ближайшие интервью<textarea rows={2} value={form.relocation} onChange={event => update('relocation', event.target.value)} maxLength={1000} /></label>
        <label className={styles.wide}>Тон тренера<textarea rows={2} value={form.feedback} onChange={event => update('feedback', event.target.value)} maxLength={1000} placeholder="Например: прямо и по делу, с примерами" />
          <span className="form-help">Как объяснять ошибки. На язык собеседника не влияет.</span></label>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
    </form>
  </Sheet>;
}

/** Name, the daily plan and the coach's tone; goals, work, relocation and interests read-only on demand. */
function Summary({ detailsOpen, onToggleDetails, onEdit }: { detailsOpen: boolean; onToggleDetails: () => void; onEdit: () => void }) {
  const app = useApp();
  const profile = app.data.state!.profile;
  const tone = shortTone(profile.feedback);
  // The server's placeholder names are not a name (same list as `greeting()` in app/labels.ts).
  const name = profile.name.trim();
  const named = !!name && !['Ты', 'You', 'Learner'].includes(name);
  const details = [
    { label: 'Что хочешь развивать', value: profile.goals },
    { label: 'Работа и проекты', value: profile.professionalContext },
    { label: 'Переезд и интервью', value: profile.relocation },
    { label: 'Интересы', value: profile.interests.join(', ') },
  ].filter(item => item.value.trim());
  return <section className={`surface ${styles.summary}`} aria-labelledby="profile-name" data-enter data-testid="profile-summary">
    <div className={styles.summaryHead}>
      <h2 id="profile-name" className={styles.name}>{named ? name : 'Твой профиль'}</h2>
      <button type="button" className="button secondary small" onClick={onEdit} aria-label="Изменить профиль"><PencilSimpleIcon size={16} aria-hidden="true" />Изменить</button>
    </div>
    <p className={styles.meta}>Практика {profile.dailyMinutes} мин в день{tone ? ` · тон: ${tone}` : ''}</p>
    {details.length > 0 && <>
      <button type="button" className={`text-button ${styles.more}`} aria-expanded={detailsOpen} aria-controls="profile-about" onClick={onToggleDetails}>
        Подробнее<CaretDownIcon size={15} aria-hidden="true" />
      </button>
      <Panel id="profile-about" open={detailsOpen}>
        <dl className={styles.details}>{details.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
      </Panel>
    </>}
  </section>;
}

/** «Мой плейбук» lives in Созвоны (with the calls it comes from); here one line that goes there. */
function PlaybookRow() {
  const app = useApp();
  const facts = app.data.state!.profileFacts ?? [];
  const toCheck = facts.filter(fact => fact.status === 'suggested').length;
  const accepted = facts.filter(fact => fact.status === 'accepted').length;
  const fresh = count(toCheck, ['новое', 'новых', 'новых']);
  const value = accepted && toCheck ? `${count(accepted, ['факт', 'факта', 'фактов'])} · ${fresh}`
    : toCheck ? `${fresh} — проверь` : accepted ? count(accepted, ['факт', 'факта', 'фактов']) : 'Пока пусто';
  return <button type="button" className={`${styles.item} ${styles.itemButton}`} onClick={() => app.go('calls', { calls: 'playbook' })} data-testid="profile-row-playbook">
    <span className={styles.itemTitle}>Мой плейбук</span>
    <span className={styles.itemValue}>{value}</span>
    <span className="visually-hidden">Открыть в «Созвонах»</span>
    <CaretRightIcon size={16} className={styles.caret} aria-hidden="true" />
  </button>;
}

/** Light / dark / system, per device (like the phone's own setting); applied at once, no save step. */
function AppearanceRow() {
  // The profile renders only in the browser: start from the saved choice so the lens does not slide in on arrival.
  const [theme, setTheme] = useState<ThemePreference>(() => typeof window === 'undefined' ? 'system' : readThemePreference());
  useEffect(() => { setTheme(readThemePreference()); return followThemeChanges(setTheme); }, []);
  return <div className={`${styles.item} ${styles.static}`}>
    <div className={styles.itemCopy}>
      <h2 className={styles.itemTitle}>Оформление</h2>
      <span className={styles.itemNote}>Только на этом устройстве</span>
    </div>
    <Segmented label="Тема оформления" value={theme} onChange={value => { setTheme(value); saveThemePreference(value); }}
      options={(['system', 'light', 'dark'] as const).map(id => ({ id, label: THEME_LABEL[id] }))} />
  </div>;
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
      {[7, 30, 90, 180].map(days => <option key={days} value={days}>{retentionLabel(days)}</option>)}
    </select>
    <span className={styles.settingStatus} aria-live="polite">{instant.state === 'saving' ? 'Сохраняю…' : instant.state === 'saved' ? <><CheckIcon size={14} weight="bold" aria-hidden="true" />Сохранено</> : null}</span>
    {instant.error && <p className={`error-text ${styles.settingError}`} role="alert">{instant.error}</p>}
  </div>;
}

/** «Голос»: the OpenAI key, the monthly budget and what the month has cost so far. */
function VoicePanel() {
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
  return <>
    <p className="caption">Распознавание речи и голос собеседника работают через OpenAI API и оплачиваются отдельно. Без ключа можно заниматься текстом.</p>
    <form className={styles.inline} onSubmit={save}>
      <label className={styles.keyField}>{configured ? 'Заменить ключ OpenAI' : 'Ключ OpenAI API'}
        <input id="audio-key" type="password" autoComplete="off" placeholder="sk-…" value={key} onChange={event => { setKey(event.target.value); setError(''); }} />
      </label>
      <button type="submit" className="button secondary" disabled={busy}><KeyIcon size={16} />{busy ? 'Сохраняю…' : 'Сохранить ключ'}</button>
    </form>
    {error && <p className="error-text" role="alert">{error}</p>}
    <span className="form-help">Ключ хранится {status?.hosting === 'server' ? 'на твоём сервере' : 'на этом компьютере'} и не возвращается в браузер.</span>
    <BudgetField />
    <div className={styles.usage}><span>Голос за месяц, оценка</span><strong className="tabular">${usage.usedUsd.toFixed(2)} <span className="caption">из ${usage.budgetUsd}</span></strong></div>
  </>;
}

/** «Тренер и лимиты»: Sol's connection, a human reason when it fails, a re-check, then the subscription limits. */
function CoachPanel() {
  const app = useApp();
  const status = app.data.status;
  const [checking, setChecking] = useState(false);
  const brain = status?.brain;
  return <>
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
  </>;
}

/** «Данные»: how long audio is kept, the export and the full reset (the warning names exactly what goes and stays). */
function DataPanel() {
  const app = useApp();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const status = app.data.status;
  return <>
    <p className="caption">{status?.hosting === 'server' ? 'Компьютер и телефон используют одну историю на твоём сервере.' : 'История хранится на этом компьютере.'}</p>
    <RetentionField />
    <div className={`rows ${styles.dataRows}`}>
      <a className={styles.action} href="/api/export" download><DownloadSimpleIcon size={18} aria-hidden="true" /><span>Скачать историю (JSON)</span></a>
      {/* Same text on iPhone (PASS-0.5.3 §1.1): «Мои фразы» survive a reset, their history goes with the sessions. */}
      <details className={styles.danger}>
        <summary className={styles.action}><TrashIcon size={18} aria-hidden="true" /><span>Удалить всю практику</span><CaretRightIcon size={15} className={styles.dangerCaret} aria-hidden="true" /></summary>
        <div className={styles.dangerBody}>
          <p className="caption">Удалятся занятия, записи, созвоны с разборами, паттерны, тренировки и результат теста уровня. Профиль, принятые факты и «Мои фразы» останутся. Отменить нельзя.</p>
          <a className={`text-button ${styles.backup}`} href="/api/export" download><DownloadSimpleIcon size={16} aria-hidden="true" />Сначала скачать копию</a>
          <label>Чтобы подтвердить, введи DELETE<input value={typed} onChange={event => setTyped(event.target.value)} autoComplete="off" spellCheck={false} /></label>
          <button type="button" className="button danger" disabled={busy || typed !== 'DELETE'} onClick={async () => { setBusy(true); const done = await app.lesson.resetAll(); setBusy(false); if (done) setTyped(''); }}>
            <TrashIcon size={16} />{busy ? 'Удаляю…' : 'Удалить навсегда'}</button>
          {typed && typed !== 'DELETE' && <span className="disabled-reason"><WarningCircleIcon size={15} />Нужно ввести DELETE заглавными.</span>}
        </div>
      </details>
    </div>
  </>;
}

/** The shortcut the desktop shell actually registered for «Запомнить» (0.5.3 shells report the real one). */
function useDesktopShortcut(): { shortcut: string; registered: boolean } | null {
  const [value, setValue] = useState<{ shortcut: string; registered: boolean } | null>(null);
  useEffect(() => {
    const bridge = window.ratmirDesktop;
    if (!bridge?.getStatus) return;
    let alive = true;
    Promise.resolve().then(() => bridge.getStatus()).then(status => {
      if (alive && status) setValue({ shortcut: typeof status.shortcut === 'string' ? status.shortcut.trim() : '', registered: !!status.shortcutRegistered });
    }, () => undefined);
    return () => { alive = false; };
  }, []);
  return value;
}

function Footer() {
  const app = useApp();
  const version = app.data.status?.app?.version ?? APP_VERSION;
  const desktop = useDesktopShortcut();
  return <footer className={styles.footer} data-enter>
    <p>{APP_NAME} {version}{APP_CHANNEL ? ` · ${APP_CHANNEL}` : ''}</p>
    {desktop && (desktop.registered && desktop.shortcut
      ? <p>Запомнить фразу: <kbd className={styles.kbd}>{desktop.shortcut}</kbd></p>
      : <p>Горячая клавиша занята — открывай из значка в трее</p>)}
  </footer>;
}

/** The «Тренер и лимиты» value: a subscription limit first (what a Today notice points at), then the connection. */
function coachChip(notice: LimitNotice | null, status: ReturnType<typeof useApp>['data']['status'], statusFailed: boolean): { tone: string; label: string } {
  if (notice) {
    return notice.kind === 'subscription-low' ? { tone: 'warning', label: 'Лимит на исходе' }
      : { tone: 'error', label: notice.kind === 'rate-limited' ? 'Упёрся в лимит' : 'Лимит исчерпан' };
  }
  if (!status) return statusFailed ? { tone: 'warning', label: 'Статус недоступен' } : { tone: '', label: 'Проверяю…' };
  if (status.brain.error) return { tone: 'warning', label: 'Не подключается' };
  if (!status.brain.authenticated) return { tone: 'warning', label: 'Нужен вход в подписку' };
  return { tone: 'lime', label: 'На связи' };
}

export function ProfileScreen() {
  const app = useApp();
  const state = app.data.state!;
  const { status, statusFailed, refreshUsage } = app.data;
  const reminders = useReminderSource();
  const [editing, setEditing] = useState(false);
  const [openRows, setOpenRows] = useState<ReadonlySet<RowId>>(() => typeof window === 'undefined' ? new Set() : readOpenRows());
  // Rows open on arrival appear open at once; only a row opened here eases open (see `.panel` @starting-style).
  const [ready, setReady] = useState(false);
  useEffect(() => { const frame = requestAnimationFrame(() => setReady(true)); return () => cancelAnimationFrame(frame); }, []);
  useEffect(() => { saveOpenRows(openRows); }, [openRows]);
  const setRow = useCallback((id: RowId, open: boolean) => setOpenRows(previous => {
    if (previous.has(id) === open) return previous;
    const next = new Set(previous);
    if (open) next.add(id); else next.delete(id);
    return next;
  }), []);
  const toggle = (id: RowId) => {
    const open = !openRows.has(id);
    setRow(id, open);
    if (open && id === 'limits') void refreshUsage();
  };

  // A limit notice (or any link with a profile section): open that row, bring it into view and focus it — after the
  // tab switch has focused the screen heading (next frame). Consumed once, so a later plain visit stays put.
  const target = app.nav.profileTarget;
  useEffect(() => {
    const id = target.id;
    if (!id || target.nonce === consumedTarget) return;
    setRow(id, true);
    if (id === 'limits') void refreshUsage();
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        consumedTarget = target.nonce;
        const row = document.getElementById(rowElementId(id));
        if (!row) return;
        row.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
        row.querySelector<HTMLElement>('[aria-expanded]')?.focus({ preventScroll: true });
      });
    });
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
  }, [target, setRow, refreshUsage]);

  // Each row speaks for its own side of the same rule: subscription notices for the coach, voice ones for «Голос».
  const now = Date.now();
  const coach = coachChip(limitNotice(app.data.usage, null, now), status, statusFailed);
  const voiceNotice = limitNotice(null, state.audioUsage, now);
  const voiceValue = !status ? (statusFailed ? 'Статус недоступен' : 'Проверяю…')
    : status.audio.configured ? `Подключён · ${wholeDollars(state.audioUsage.usedUsd)} из ${budgetDollars(state.audioUsage.budgetUsd)}` : 'Нет ключа';
  const source = reminders.source;

  return <div className={`screen ${styles.profile}`} data-screen="profile" data-ready={ready}>
    <header className="screen-header with-mascot" data-enter="live">
      <div><h1 tabIndex={-1} data-screen-heading style={{ outline: 'none' }}>Профиль</h1><p className="lede">Цели, голос, напоминания и твои данные.</p></div>
      <ScreenMascot emotion="wink" fluid className="screen-mascot" />
    </header>
    <Summary detailsOpen={openRows.has('about')} onToggleDetails={() => toggle('about')} onEdit={() => setEditing(true)} />
    <div className={`surface rows ${styles.list}`} data-enter>
      <PlaybookRow />
      <AppearanceRow />
      <Row id="voice" title="Голос" value={voiceValue} valueTone={voiceNotice?.tone}
        open={openRows.has('voice')} onToggle={() => toggle('voice')}><VoicePanel /></Row>
      {source.kind === 'browser'
        ? <div className={`${styles.item} ${styles.static}`} data-testid={rowElementId('reminders')}>
          <h2 className={styles.itemTitle}>Напоминания</h2>
          <span className={styles.itemValue}>{reminderSummary(source)}</span>
        </div>
        : <Row id="reminders" title="Напоминания" value={reminderSummary(source)} open={openRows.has('reminders')} onToggle={() => toggle('reminders')}>
          {source.kind === 'ready'
            ? <ReminderSettings settings={source.settings} onSaved={reminders.saved} />
            : <ReminderStatus source={source} onRetry={reminders.reload} />}
        </Row>}
      <Row id="limits" title="Тренер и лимиты" value={<span className={`chip ${coach.tone}`}>{coach.label}</span>}
        open={openRows.has('limits')} onToggle={() => toggle('limits')}><CoachPanel /></Row>
      <Row id="data" title="Данные" value={`Аудио ${retentionLabel(state.profile.audioRetentionDays)}`}
        open={openRows.has('data')} onToggle={() => toggle('data')}><DataPanel /></Row>
    </div>
    <Footer />
    <ProfileEditor open={editing} onClose={() => setEditing(false)} />
  </div>;
}
