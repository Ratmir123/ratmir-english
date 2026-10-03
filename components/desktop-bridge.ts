export interface DesktopStatus {
  native: true;
  shortcut: string;
  shortcutRegistered: boolean;
  notificationsSupported: boolean;
}

export interface DesktopBridge {
  getReminderSettings?(): Promise<DailyReminderSettings>;
  saveReminderSettings?(settings: DailyReminderSettings): Promise<DailyReminderSettings>;
  readClipboard(): Promise<string>;
  openTraining(): Promise<void>;
  openQuick(): Promise<void>;
  hideQuick(): Promise<void>;
  remindLater(minutes: number): Promise<{ scheduled: true; minutes: number } | { scheduled: false; reason: string }>;
  getStatus(): Promise<DesktopStatus>;
}

export interface DailyReminderSettings { enabled: boolean; times: string[]; warning?: string }

declare global {
  interface Window { ratmirDesktop?: DesktopBridge }
}
