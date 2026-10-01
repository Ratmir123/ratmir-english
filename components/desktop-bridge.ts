export interface DesktopStatus {
  native: true;
  shortcut: string;
  shortcutRegistered: boolean;
  notificationsSupported: boolean;
}

export interface DesktopBridge {
  readClipboard(): Promise<string>;
  openTraining(): Promise<void>;
  openQuick(): Promise<void>;
  hideQuick(): Promise<void>;
  remindLater(minutes: number): Promise<{ scheduled: true; minutes: number } | { scheduled: false; reason: string }>;
  getStatus(): Promise<DesktopStatus>;
}

declare global {
  interface Window { ratmirDesktop?: DesktopBridge }
}
