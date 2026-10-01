'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Sandbox preloads cannot require local modules. Keep this closed, literal
// channel list here; do not expose ipcRenderer or generic invoke/send methods.
contextBridge.exposeInMainWorld('ratmirDesktop', Object.freeze({
  getStatus: () => ipcRenderer.invoke('ratmir-desktop:status'),
  readClipboard: () => ipcRenderer.invoke('ratmir-desktop:clipboard'),
  openTraining: () => ipcRenderer.invoke('ratmir-desktop:open-training'),
  openQuick: () => ipcRenderer.invoke('ratmir-desktop:open-quick'),
  hideQuick: () => ipcRenderer.invoke('ratmir-desktop:hide-quick'),
  remindLater: (minutes = 30) => ipcRenderer.invoke('ratmir-desktop:reminder', minutes),
}));
