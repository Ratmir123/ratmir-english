'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

// 0.5.3: places the shell asks this page to open (tray «Мои фразы» → 'phrases'). The listener is registered here,
// before any page script runs, so a request that arrives before the page subscribes is kept (the latest one) and handed
// to the subscribers on the next microtask. Only the target string crosses the bridge, never the IPC event.
const navigationListeners = new Set();
let pendingNavigation = null;
function deliverNavigation() {
  if (!pendingNavigation || navigationListeners.size === 0) return;
  const target = pendingNavigation;
  pendingNavigation = null;
  for (const listener of [...navigationListeners]) {
    try { listener(target); } catch { }
  }
}
ipcRenderer.on('ratmir-desktop:navigate', (_event, target) => {
  if (target !== 'phrases') return;
  pendingNavigation = target;
  deliverNavigation();
});

// Sandbox preloads cannot require local modules. Keep this closed, literal
// channel list here; do not expose ipcRenderer or generic invoke/send methods.
contextBridge.exposeInMainWorld('ratmirDesktop', Object.freeze({
  getStatus: () => ipcRenderer.invoke('ratmir-desktop:status'),
  readClipboard: () => ipcRenderer.invoke('ratmir-desktop:clipboard'),
  // 0.5.3: openTraining('phrases') opens the main window on «Мои фразы»; any other argument is dropped (plain open).
  openTraining: (target) => target === 'phrases'
    ? ipcRenderer.invoke('ratmir-desktop:open-training', 'phrases')
    : ipcRenderer.invoke('ratmir-desktop:open-training'),
  openQuick: () => ipcRenderer.invoke('ratmir-desktop:open-quick'),
  hideQuick: () => ipcRenderer.invoke('ratmir-desktop:hide-quick'),
  remindLater: (minutes = 30) => ipcRenderer.invoke('ratmir-desktop:reminder', minutes),
  getReminderSettings: () => ipcRenderer.invoke('ratmir-desktop:reminder-settings'),
  saveReminderSettings: (settings) => ipcRenderer.invoke('ratmir-desktop:save-reminder-settings', settings),
  // v0.5: the main process extracts compact mono audio from a large call recording with the system ffmpeg.
  // Only the on-disk path of a File the user picked crosses the bridge; the main process validates it again.
  prepareCallAudio: (file) => {
    let path = '';
    try { path = webUtils.getPathForFile(file); } catch { path = ''; }
    return ipcRenderer.invoke('ratmir-desktop:prepare-call-audio', typeof path === 'string' ? path : '');
  },
  notify: (value) => ipcRenderer.invoke('ratmir-desktop:notify', value),
  setTheme: (value) => ipcRenderer.invoke('ratmir-desktop:set-theme', value),
  // 0.5.3 overlay: true lets clicks pass through the transparent quick window (mouse moves still reach the page, which
  // switches back to false over its content). Only the overlay window is affected; anything but true means false.
  setClickThrough: (ignore) => ipcRenderer.invoke('ratmir-desktop:set-click-through', ignore === true).then(() => undefined),
  // 0.5.3: subscribe to the shell's navigation requests ('phrases'). Returns the unsubscribe function.
  onNavigate: (callback) => {
    if (typeof callback !== 'function') return () => {};
    navigationListeners.add(callback);
    if (pendingNavigation) Promise.resolve().then(deliverNavigation);
    return () => { navigationListeners.delete(callback); };
  },
}));
