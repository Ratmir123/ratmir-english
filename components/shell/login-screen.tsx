'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRightIcon, ShieldCheckIcon } from '@phosphor-icons/react';
import { APP_NAME } from '@/lib/app-info';
import { messageOf, request } from '../app/api';
import { useEntrance } from '../ui/entrance';
import { Companion } from './companion';

/**
 * Sign-in. Arrives as a gentle staircase while the launch layer fades over it (MOTION-PASS-0.5.2 §4): the card
 * surface fades in place and its rows rise one after another; the companion is happy and says hello once it is seen.
 */
export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => Promise<void> }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hello, setHello] = useState(false);
  const root = useRef<HTMLElement>(null);
  useEntrance(root, 'login', 'launch');
  useEffect(() => { const timer = setTimeout(() => setHello(true), 420); return () => clearTimeout(timer); }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true); setError('');
    try { await request('login', { code }); setCode(''); await onLoggedIn(); }
    catch (reason) { setError(messageOf(reason, 'Не удалось войти.')); }
    finally { setBusy(false); }
  };
  return <main ref={root} className="boot" style={{ padding: 16 }}>
    <form className="surface card" data-enter="fade" onSubmit={submit} style={{ width: 'min(420px, 100%)', display: 'grid', gap: 14, justifyItems: 'stretch' }}>
      <div data-enter style={{ width: 96, height: 96, justifySelf: 'center' }}><Companion state="idle" emotion="happy" size={96} greeting={hello} status="Ждёт тебя" /></div>
      <div data-enter style={{ display: 'grid', gap: 4, textAlign: 'center' }}>
        <h1 style={{ fontSize: 28 }}>{APP_NAME}</h1>
        <p className="caption" style={{ margin: '0 auto' }}>Твоя практика общения</p>
      </div>
      <label data-enter htmlFor="access-code">Код доступа
        <input id="access-code" type="password" autoComplete="current-password" value={code} onChange={event => setCode(event.target.value)} required autoFocus />
      </label>
      {error && <p className="error-text reveal" role="alert">{error}</p>}
      <button data-enter className="button primary large block" disabled={busy || !code.trim()}>{busy ? 'Проверяю…' : 'Открыть'}<ArrowRightIcon size={18} /></button>
      <small data-enter className="caption" style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center' }}><ShieldCheckIcon size={15} />Код защищает профиль, занятия и записи.</small>
    </form>
  </main>;
}
