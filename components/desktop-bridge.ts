export interface DesktopStatus {
  native: true;
  shortcut: string;
  shortcutRegistered: boolean;
  notificationsSupported: boolean;
}

/** Electron-only: compact mono audio extracted locally (system ffmpeg) from a large call recording before upload. */
export type PreparedCallAudio =
  | { ok: true; data: Uint8Array; name: string; mime: string; bytes: number; durationSeconds: number | null }
  | { ok: false; reason: 'unavailable' | 'unsupported' | 'failed'; message: string };

export interface DesktopBridge {
  /** v0.5: present only in the Smooth Talk desktop shell. Falls back to direct upload when missing or not ok. */
  prepareCallAudio?(file: File): Promise<PreparedCallAudio>;
  getReminderSettings?(): Promise<DailyReminderSettings>;
  saveReminderSettings?(settings: DailyReminderSettings): Promise<DailyReminderSettings>;
  readClipboard(): Promise<string>;
  openTraining(): Promise<void>;
  openQuick(): Promise<void>;
  hideQuick(): Promise<void>;
  remindLater(minutes: number): Promise<{ scheduled: true; minutes: number } | { scheduled: false; reason: string }>;
  getStatus(): Promise<DesktopStatus>;
  /** v0.5: OS notification for an in-app event while the main window is hidden (ignored when it is in front). */
  notify?(value: DesktopNotification): Promise<{ shown: boolean }>;
  /** 0.5.1: native title bar + window background follow the in-app appearance choice. */
  setTheme?(value: 'system' | 'light' | 'dark'): Promise<{ theme: string }>;
}

export interface DesktopNotification { kind: 'review-ready' | 'call-ready'; title: string; body: string }

export interface DailyReminderSettings { enabled: boolean; times: string[]; warning?: string }

declare global {
  interface Window { ratmirDesktop?: DesktopBridge }
}
