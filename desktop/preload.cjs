'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Sandbox preloads cannot require local modules. Keep this closed, literal
// channel list here; do not expose ipcRenderer or generic invoke/send methods.
contextBridge.exposeInMainWorld('ratmirDesktop', Object.freeze({
  getStatus: () => ipcRenderer.invoke('ratmir-desktop:status'),
  readClipboard: () => ipcRenderer.invoke('ratmir-desktop:clipboard'),
  openTraining: () => ipcRenderer.invoke('ratmir-desktop:open-training'),
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
}));
