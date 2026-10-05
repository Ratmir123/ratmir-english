'use client';

import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { ArrowRightIcon, LightningIcon } from '@phosphor-icons/react';
import { APP_NAME } from '@/lib/app-info';
import { useApp } from '../app/app-context';
import { sessionStatusLabel, TAB_NAMES, TAB_ORDER, type TabId } from '../app/labels';
import { rankProgress, RankMedal } from '../ui/rewards';
import { ElapsedTime } from '../ui/elapsed';
import { RollingNumber } from '../ui/rolling-number';
import { Companion } from './companion';
import { TAB_ICONS } from './navigation-icons';

function useBadges() {
  const { data, seenReviews } = useApp();
  const state = data.state;
  const needsSpeaker = state?.calls?.filter(call => call.status === 'needs-speaker').length ?? 0;
  const reviewReady = state?.sessions.some(session => session.status === 'review' && !session.retryDeferred && !seenReviews.has(session.id)) ?? false;
  return { calls: needsSpeaker, todayDot: reviewReady };
}

/** The current lesson stays one click away while you look elsewhere (audit U-18/U-23). */
function useMinimizedSession() {
  const { lesson, nav } = useApp();
  const session = lesson.session;
  return session && !nav.sessionOpen && session.status !== 'completed' ? session : null;
}

export function Sidebar() {
  const app = useApp();
  const { nav, data, lesson } = app;
  const list = useRef<HTMLDivElement>(null);
  const badges = useBadges();
  const minimized = useMinimizedSession();
  const progression = data.state?.progression;
  useLayoutEffect(() => {
    const element = list.current; if (!element) return;
    const current = element.querySelector<HTMLElement>('[aria-current="page"]');
    element.style.setProperty('--lens-o', current ? '1' : '0');
    if (current) element.style.setProperty('--lens-y', `${current.offsetTop}px`);
  }, [nav.tab, nav.sessionOpen]);
  const engineOk = !!data.status?.brain.authenticated;
  return <aside className="sidebar glass" aria-label="Навигация">
    <button type="button" className="brand" onClick={() => app.go('today')} aria-label={`${APP_NAME} — на главную`}>
      <span className="brand-mark" aria-hidden="true">S</span>
      <span className="brand-copy">{APP_NAME}<small>Тренинг общения</small></span>
    </button>
    {minimized && <button type="button" className="nav-session" onClick={() => nav.openSession()} aria-label={`Текущее занятие: ${sessionStatusLabel(minimized)}`} title="Вернуться к занятию">
      <span className="pulse" aria-hidden="true" />
      <span style={{ minWidth: 0 }}><strong>Текущее занятие</strong><small>{sessionStatusLabel(minimized)}</small></span>
      <ArrowRightIcon size={16} style={{ marginLeft: 'auto', flexShrink: 0 }} />
    </button>}
    <nav aria-label="Разделы">
      <div ref={list} className="nav-list">
        <span className="nav-lens" aria-hidden="true" />
        {TAB_ORDER.map(id => {
          const Icon = TAB_ICONS[id];
          const current = nav.tab === id;
          return <button key={id} type="button" className="nav-item" aria-current={current ? 'page' : undefined} onClick={() => app.go(id)}>
            <Icon size={21} weight={current ? 'fill' : 'regular'} aria-hidden="true" /><span>{TAB_NAMES[id]}</span>
            {id === 'calls' && badges.calls > 0 && <span className="badge" aria-label={`Нужно действие: ${badges.calls}`}>{badges.calls}</span>}
            {id === 'today' && badges.todayDot && <span className="badge" aria-label="Разбор готов" style={{ minWidth: 10, width: 10, height: 10, padding: 0 }} />}
          </button>;
        })}
      </div>
    </nav>
    <div className="sidebar-footer">
      {progression && <button type="button" className="sidebar-rank" data-xp-target onClick={() => app.go('progress', { progress: 'rewards' })}
        aria-label={`Ранг «${rankProgress(progression).band.title}», ${progression.xp} XP. Открыть награды`}>
        <span className="row"><RankMedal level={progression.level} size={34} animated={false} />
          <span className="sidebar-rank-copy"><strong>{rankProgress(progression).band.title}</strong><span className="caption tabular"><RollingNumber value={progression.xp} /> XP · ур. {progression.level}</span></span></span>
        <span className="progress-track lime" style={{ '--value': rankProgress(progression).ratio } as CSSProperties}><span /></span>
      </button>}
      <button type="button" className="nav-item" onClick={app.launchQuick} title="Быстрый разбор фразы — Ctrl+Alt+E из любого окна" aria-keyshortcuts="Control+Alt+E">
        <LightningIcon size={21} aria-hidden="true" /><span>Быстрый разбор</span>
      </button>
      {(() => {
        const engine = `Sol · ${data.status ? engineOk ? data.status.brain.mode === 'siwc' ? 'подписка ChatGPT' : 'подписка Codex' : 'нужно подключение' : data.statusFailed ? 'статус недоступен' : 'проверяю…'}`;
        return <div className="engine-status" role="status" title={`GPT‑6.1 ${engine}`}><i data-ok={engineOk} aria-hidden="true" /><span>{engine}</span></div>;
      })()}
    </div>
    {lesson.starting && <span className="visually-hidden" role="status">{lesson.starting.label}</span>}
  </aside>;
}

export function TabBar() {
  const app = useApp();
  const badges = useBadges();
  const index = Math.max(0, TAB_ORDER.indexOf(app.nav.tab));
  return <nav className="tab-bar glass" aria-label="Разделы" style={{ '--tab-index': index } as CSSProperties}>
    <span className="tab-lens" aria-hidden="true" />
    {TAB_ORDER.map((id: TabId) => {
      const Icon = TAB_ICONS[id];
      const current = app.nav.tab === id;
      return <button key={id} type="button" aria-current={current ? 'page' : undefined} onClick={() => app.go(id)}>
        <Icon size={24} weight={current ? 'fill' : 'regular'} aria-hidden="true" /><span>{TAB_NAMES[id]}</span>
        {((id === 'calls' && badges.calls > 0) || (id === 'today' && badges.todayDot)) && <span className="dot" aria-hidden="true" />}
      </button>;
    })}
  </nav>;
}

export function SessionPill() {
  const { nav } = useApp();
  const minimized = useMinimizedSession();
  // Today already shows the unfinished lesson as its primary card (or in «Незаконченные»).
  if (!minimized || nav.tab === 'today') return null;
  return <button type="button" className="session-pill glass" onClick={() => nav.openSession()}>
    <span>Текущее занятие · {sessionStatusLabel(minimized)}</span>
    <span className="button small primary" aria-hidden="true">Открыть</span>
  </button>;
}

/** Non-blocking: planning a lesson can take a while; the rest of the app stays usable. */
export function PreparationPanel() {
  const { lesson } = useApp();
  if (!lesson.starting) return null;
  return <div className="glass" role="status" style={{ position: 'fixed', zIndex: 40, right: 20, bottom: 'calc(20px + env(safe-area-inset-bottom))', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px 10px 10px', borderRadius: 26, maxWidth: 'calc(100vw - 40px)' }}>
    <span style={{ width: 52, height: 52, flexShrink: 0 }}><Companion state="thinking" size={52} interactive={false} exclusive={false} status="Готовлю занятие" /></span>
    <span style={{ display: 'grid' }}><strong>{lesson.starting.label}…</strong><span className="caption">Подбираю задачу по твоим последним попыткам · <ElapsedTime startedAt={lesson.starting.since} /></span></span>
  </div>;
}
