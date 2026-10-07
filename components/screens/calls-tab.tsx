'use client';

import { CallsScreen } from '../calls/calls-screen';
import { useApp } from '../app/app-context';

/** «Созвоны»: calls (upload, list, review), «Мои паттерны» and «Мой плейбук» (W3 CallsScreen) inside the shell. */
export function CallsTab() {
  const app = useApp();
  const state = app.data.state!;
  // CallsScreen renders its own «Созвоны» heading; navigation focuses the screen's first h1.
  return <div className="screen" data-screen="calls">
    <CallsScreen state={state} onRefresh={async () => { await app.data.refresh(); }} onStartDrill={app.startDrill} initialCallId={app.nav.callTarget.id}
      initialSection={app.nav.callTarget.section} sectionNonce={app.nav.callTarget.nonce} initialPrepId={app.nav.callTarget.prepId}
      onStartPrep={(prepId, mode) => app.start({ prepId, mode, from: 'calls' })}
      onOpenSession={sessionId => { const value = state.sessions.find(item => item.id === sessionId); if (value) app.lesson.open(value, 'calls'); }} />
  </div>;
}
