'use client';

import { createContext, useContext } from 'react';
import type { CatalogSection } from '@/lib/training';
import type { AchievementTarget } from '@/lib/achievement-targets';
import type { AppData } from './use-app-data';
import type { Navigation, NavigationOptions } from './use-navigation';
import type { SessionController, StartOptions, ToastAction } from './use-session-controller';
import type { TabId } from './labels';

export type PracticeTarget = { familyId: string | null; freeTopic: boolean; nonce: number };

export type AppContextValue = {
  data: AppData;
  nav: Navigation;
  lesson: SessionController;
  /** Tab change: stops voice, closes the greeting, clears inline errors, view transition. Options pick a call, a Созвоны
   *  section or a Прогресс section (incl. the full test report). */
  go: (tab: TabId, options?: NavigationOptions) => void;
  start: (options: StartOptions) => void;
  startDrill: (drillId: string, mode: 'learning' | 'call') => void;
  openPlacement: () => void;
  openFamily: (familyId: string | null, freeTopic?: boolean) => void;
  practiceTarget: PracticeTarget;
  catalog: CatalogSection[] | null;
  catalogError: string;
  reloadCatalog: () => void;
  toast: { error: (message: string, action?: ToastAction) => void; notice: (message: string, action?: ToastAction) => void };
  launchQuick: () => void;
  onAchievementTarget: (target: AchievementTarget) => void;
  /** Reviews already opened (the Today/sidebar dot marks only new ones). */
  seenReviews: ReadonlySet<string>;
  markReviewSeen: (sessionId: string) => void;
};

export const AppContext = createContext<AppContextValue | null>(null);
export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside TrainingApp');
  return value;
}
