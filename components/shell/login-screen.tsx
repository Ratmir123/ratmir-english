'use client';

import { useState, type FormEvent } from 'react';
import { ArrowRightIcon, ShieldCheckIcon } from '@phosphor-icons/react';
import { APP_NAME } from '@/lib/app-info';
import { messageOf, request } from '../app/api';
import { Companion } from './companion';

export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => Promise<void> }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true); setError('');
    try { await request('login', { code }); setCode(''); await onLoggedIn(); }
    catch (reason) { setError(messageOf(reason, 'Не удалось войти.')); }
    finally { setBusy(false); }
  };
  return <main className="boot" style={{ padding: 16 }}>
    <form className="surface card" onSubmit={submit} style={{ width: 'min(420px, 100%)', display: 'grid', gap: 14, justifyItems: 'stretch' }}>
      <div style={{ width: 96, height: 96, justifySelf: 'center' }}><Companion state="idle" emotion="happy" size={96} status="Ждёт тебя" /></div>
      <span className="eyebrow" style={{ justifySelf: 'center' }}>{APP_NAME}</span>
      <h1 style={{ textAlign: 'center', fontSize: 28 }}>Твоя практика общения</h1>
      <label htmlFor="access-code">Код доступа
        <input id="access-code" type="password" autoComplete="current-password" value={code} onChange={event => setCode(event.target.value)} required autoFocus />
      </label>
      {error && <p className="error-text" role="alert">{error}</p>}
      <button className="button primary large block" disabled={busy || !code.trim()}>{busy ? 'Проверяю…' : 'Открыть'}<ArrowRightIcon size={18} /></button>
      <small className="caption" style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center' }}><ShieldCheckIcon size={15} />Код защищает профиль, занятия и записи.</small>
    </form>
  </main>;
}
