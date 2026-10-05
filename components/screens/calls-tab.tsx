'use client';

import { CallsScreen } from '../calls/calls-screen';
import { useApp } from '../app/app-context';

/** «Созвоны»: upload, list, review, patterns (W3 CallsScreen) inside the shell. */
export function CallsTab() {
  const app = useApp();
  const state = app.data.state!;
  // CallsScreen renders its own «Созвоны» heading; navigation focuses the screen's first h1.
  return <div className="screen" data-screen="calls">
    <CallsScreen state={state} onRefresh={async () => { await app.data.refresh(); }} onStartDrill={app.startDrill} initialCallId={app.nav.callTarget.id} />
  </div>;
}
