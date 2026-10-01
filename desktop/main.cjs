'use strict';

const { app, BrowserWindow, Tray, Menu, globalShortcut, Notification, ipcMain, clipboard, dialog, nativeImage, shell, session } = require('electron');
const { mkdirSync, writeFileSync, renameSync } = require('node:fs');
const { join } = require('node:path');
const {
  SHORTCUT, USAGE_URL, IPC, isAllowedExternalLink,
  safeClipboardText, readConfiguration, prepareRuntime, configureSessionProxy,
  validReminderMinutes, safeNetworkError,
} = require('./runtime.cjs');

app.setName('Ratmir English');
const userDataPath = join(app.getPath('appData'), 'Ratmir English');
mkdirSync(userDataPath, { recursive: true });
app.setPath('userData', userDataPath);
app.setPath('sessionData', userDataPath);
app.setAppUserModelId('com.ratmir.english');

let mainWindow = null;
let quickWindow = null;
let tray = null;
let quitting = false;
let ready = false;
let shortcutRegistered = false;
let reminderTimer = null;
let reminderNotification = null;
let pendingQuick = false;
let mainLoaded = false;
let quickLoaded = false;
let applicationPolicy = null;
let startupStage = 'starting';
let bootErrorCode = null;
let lastDeniedPermission = null;
const networkDiagnostics = { proxyBefore: 'unknown', proxyAfter: 'unknown', started: 0, completed: 0, failed: 0, documentStatusCode: null, documentErrorCode: null, lastStatusCode: null, lastErrorCode: null };
const windowDiagnostics = {
  main: { created: false, event: 'none', loadErrorCode: null, preloadFailed: false, rendererGone: false, rendererReason: null, bridgeConnected: false, shown: false, presentedOnce: false, paintReady: false },
  quick: { created: false, event: 'none', loadErrorCode: null, preloadFailed: false, rendererGone: false, rendererReason: null, bridgeConnected: false, shown: false, presentedOnce: false, paintReady: false },
};
const diagnosticPath = join(userDataPath, 'desktop-status.json');
const iconPath = app.isPackaged
  ? join(process.resourcesPath, 'app-icons', 'icon.ico')
  : join(app.getAppPath(), '..', 'public', 'icon.ico');
const preloadPath = join(__dirname, 'preload.cjs');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (ready) showTraining(); });
  app.on('activate', () => { if (ready) showTraining(); });
  app.on('window-all-closed', () => { /* Closing a window leaves the trainer in the tray. */ });
  app.on('before-quit', () => {
    quitting = true;
    clearTimeout(reminderTimer);
    reminderTimer = null;
    globalShortcut.unregisterAll();
    shortcutRegistered = false;
    if (tray) { tray.destroy(); tray = null; }
    writeDiagnostics();
  });
  app.whenReady().then(async () => { writeDiagnostics(); await boot(); }).catch((error) => {
    bootErrorCode = ['DESKTOP_CONFIG_INVALID', 'DESKTOP_WORKSPACE_INVALID', 'DESKTOP_NODE_INVALID', 'DESKTOP_SERVER_UNAVAILABLE'].includes(error?.message) ? error.message : 'APP_BOOT_FAILED';
    writeDiagnostics();
    dialog.showErrorBox('Ratmir English', applicationPolicy?.mode === 'remote'
      ? 'Не удалось открыть подключение к серверу тренинга. Проверь настройки приложения и доступ к интернету.'
      : 'Не удалось открыть тренинг. Проверь установку через Install Desktop.cmd и наличие Node.js 24 или новее. Личные ключи и записи остаются в папке тренинга.');
    app.quit();
  });
}

function writeDiagnostics() {
  // Integration status contains no workspace paths, URLs, account information,
  // clipboard text or keys. A failed write never prevents the app from running.
  try {
    const value = {
      ready: ready && !quitting,
      mode: applicationPolicy?.mode || 'local',
      shortcutRegistered,
      notificationsSupported: Notification.isSupported(),
      mainLoaded,
      quickLoaded,
      mainReady: windowDiagnostics.main.shown && windowDiagnostics.main.bridgeConnected,
      quickReady: windowDiagnostics.quick.shown && windowDiagnostics.quick.bridgeConnected,
      startupStage,
      bootErrorCode,
      lastDeniedPermission,
      network: networkDiagnostics,
      windows: windowDiagnostics,
      updatedAt: new Date().toISOString(),
      pid: process.pid,
      version: app.getVersion(),
    };
    const temporary = diagnosticPath + '.' + process.pid + '.tmp';
    writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
    renameSync(temporary, diagnosticPath);
  } catch { }
}

function secureWindow(window) {
  const contents = window.webContents;
  const allow = (event, url) => { if (!applicationPolicy.isAllowedPageUrl(url)) event.preventDefault(); };
  contents.on('will-navigate', allow);
  contents.on('will-redirect', allow);
  contents.setWindowOpenHandler(({ url }) => {
    if (isTrustedContents(contents) && isAllowedExternalLink(url)) {
      shell.openExternal(USAGE_URL).catch(() => {});
    }
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.session.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    const allowed = isTrustedContents(_webContents) && applicationPolicy.isAllowedMicrophoneCheck(permission, requestingOrigin, details);
    if (!allowed) recordDeniedPermission(permission);
    return allowed;
  });
  contents.session.setPermissionRequestHandler((requestingContents, permission, callback, details) => {
    const allowed = isTrustedContents(requestingContents) && applicationPolicy.isAllowedMicrophoneRequest(permission, details);
    if (!allowed) recordDeniedPermission(permission);
    callback(allowed);
  });
}

function recordDeniedPermission(permission) {
  const known = ['ar', 'automatic-fullscreen', 'background-fetch', 'background-sync', 'captured-surface-control', 'clipboard-read', 'clipboard-sanitized-write', 'deprecated-sync-clipboard-read', 'display-capture', 'fileSystem', 'fullscreen', 'geolocation', 'geolocation-approximate', 'hand-tracking', 'hid', 'idle-detection', 'keyboardLock', 'local-fonts', 'local-network', 'local-network-access', 'loopback-network', 'media', 'mediaKeySystem', 'midi', 'midiSysex', 'nfc', 'notifications', 'openExternal', 'payment-handler', 'periodic-background-sync', 'persistent-storage', 'pointerLock', 'screen-wake-lock', 'sensors', 'serial', 'smart-card', 'speaker-selection', 'storage-access', 'system-wake-lock', 'top-level-storage-access', 'usb', 'vr', 'web-app-installation', 'web-printing', 'window-management', 'unknown'];
  const value = known.includes(permission) ? permission : 'other';
  if (value !== lastDeniedPermission) { lastDeniedPermission = value; writeDiagnostics(); }
}

async function configureDesktopSession() {
  const nativeSession = session.fromPartition(applicationPolicy.partition);
  async function proxyMode() {
    let timer;
    try {
      const value = await Promise.race([
        nativeSession.resolveProxy(applicationPolicy.origin),
        new Promise((done) => { timer = setTimeout(() => done(null), 1000); }),
      ]);
      return value === 'DIRECT' ? 'direct' : typeof value === 'string' ? 'configured' : 'unknown';
    } catch { return 'unknown'; }
    finally { clearTimeout(timer); }
  }
  networkDiagnostics.proxyBefore = await proxyMode();
  await configureSessionProxy(nativeSession, applicationPolicy);
  networkDiagnostics.proxyAfter = await proxyMode();
  const filter = { urls: [applicationPolicy.origin + '/*'] };
  nativeSession.webRequest.onBeforeRequest(filter, (details, callback) => {
    if (applicationPolicy.isPublicLoadRequest(details)) { networkDiagnostics.started += 1; writeDiagnostics(); }
    callback({ cancel: false });
  });
  nativeSession.webRequest.onCompleted(filter, (details) => {
    if (!applicationPolicy.isPublicLoadRequest(details)) return;
    networkDiagnostics.completed += 1;
    const code = Number.isInteger(details.statusCode) ? details.statusCode : null;
    networkDiagnostics.lastStatusCode = code;
    if (details.resourceType === 'mainFrame') networkDiagnostics.documentStatusCode = code;
    writeDiagnostics();
  });
  nativeSession.webRequest.onErrorOccurred(filter, (details) => {
    if (!applicationPolicy.isPublicLoadRequest(details)) return;
    networkDiagnostics.failed += 1;
    networkDiagnostics.lastErrorCode = safeNetworkError(details.error);
    if (details.resourceType === 'mainFrame') networkDiagnostics.documentErrorCode = safeNetworkError(details.error);
    writeDiagnostics();
  });
  writeDiagnostics();
}

function isTrustedContents(contents) {
  return [mainWindow, quickWindow].some((window) => window && !window.isDestroyed() && window.webContents === contents) &&
    !contents.isDestroyed() && applicationPolicy.isAllowedPageUrl(contents.getURL());
}

function makeWindow(quick) {
  const diagnostics = windowDiagnostics[quick ? 'quick' : 'main'];
  diagnostics.event = 'creating';
  writeDiagnostics();
  const window = new BrowserWindow({
    title: quick ? 'Ratmir English · Быстрый разбор' : 'Ratmir English',
    width: quick ? 420 : 1280,
    height: quick ? 720 : 920,
    minWidth: quick ? 360 : 820,
    minHeight: quick ? 480 : 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#E1E1E1',
    icon: iconPath,
    alwaysOnTop: quick,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: false,
      partition: applicationPolicy.partition,
    },
  });
  diagnostics.created = true;
  diagnostics.event = 'created';
  writeDiagnostics();
  secureWindow(window);
  diagnostics.event = 'secured';
  writeDiagnostics();
  window.webContents.on('did-start-loading', () => {
    if (quick) quickLoaded = false; else mainLoaded = false;
    diagnostics.event = 'loading';
    diagnostics.loadErrorCode = null;
    diagnostics.bridgeConnected = false;
    writeDiagnostics();
  });
  window.webContents.on('dom-ready', () => { diagnostics.event = 'dom-ready'; writeDiagnostics(); });
  window.webContents.on('did-finish-load', () => {
    const loaded = applicationPolicy.isAllowedPageUrl(window.webContents.getURL());
    if (quick) quickLoaded = loaded; else mainLoaded = loaded;
    diagnostics.event = loaded ? 'loaded' : 'unexpected-page';
    writeDiagnostics();
  });
  window.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (!isMainFrame) return;
    if (quick) quickLoaded = false; else mainLoaded = false;
    diagnostics.event = 'load-failed';
    diagnostics.loadErrorCode = Number.isInteger(code) ? code : null;
    writeDiagnostics();
  });
  window.webContents.on('preload-error', () => { diagnostics.preloadFailed = true; writeDiagnostics(); });
  window.webContents.on('render-process-gone', (_event, details) => {
    diagnostics.rendererGone = true;
    diagnostics.bridgeConnected = false;
    const known = ['clean-exit', 'abnormal-exit', 'killed', 'crashed', 'oom', 'launch-failed', 'integrity-failure'];
    diagnostics.rendererReason = known.includes(details?.reason) ? details.reason : 'other';
    diagnostics.event = 'renderer-gone';
    if (quick) quickLoaded = false; else mainLoaded = false;
    writeDiagnostics();
  });
  window.on('unresponsive', () => { diagnostics.event = 'unresponsive'; writeDiagnostics(); });
  window.on('close', (event) => {
    if (!quitting) { event.preventDefault(); diagnostics.presentedOnce = true; window.hide(); }
  });
  window.on('show', () => { diagnostics.shown = true; writeDiagnostics(); });
  window.on('hide', () => { diagnostics.shown = false; diagnostics.presentedOnce = true; writeDiagnostics(); });
  window.on('closed', () => {
    if (quick) { quickWindow = null; quickLoaded = false; }
    else { mainWindow = null; mainLoaded = false; }
    diagnostics.created = false;
    diagnostics.shown = false;
    diagnostics.bridgeConnected = false;
    diagnostics.event = 'closed';
    writeDiagnostics();
  });
  window.once('ready-to-show', () => {
    diagnostics.paintReady = true;
    presentInitialWindow(window, diagnostics);
    writeDiagnostics();
  });
  diagnostics.event = 'load-requested';
  writeDiagnostics();
  window.loadURL(quick ? applicationPolicy.quickUrl : applicationPolicy.startupUrl).then(() => {
    if (diagnostics.event !== 'loaded') { diagnostics.event = 'load-resolved'; writeDiagnostics(); }
  }).catch(() => {
    if (diagnostics.event !== 'load-failed') { diagnostics.event = 'load-rejected'; writeDiagnostics(); }
    dialog.showErrorBox('Ratmir English', applicationPolicy.mode === 'remote'
      ? 'Сервер тренинга не ответил. Проверь интернет и попробуй открыть приложение снова из значка рядом с часами.'
      : 'Окно тренинга не загрузилось. Попробуй открыть его снова из значка рядом с часами.');
  });
  return window;
}

function presentInitialWindow(window, diagnostics) {
  // A streaming Next document can keep did-finish-load pending after its React
  // UI and profile are ready. A trusted status handshake also presents it once.
  // Later paint events must never resurrect a window that was hidden to tray.
  if (quitting || diagnostics.presentedOnce || !window || window.isDestroyed()) return;
  diagnostics.presentedOnce = true;
  window.show();
  window.focus();
}

function hideWindow(window, diagnostics) {
  if (!window || window.isDestroyed()) return;
  diagnostics.presentedOnce = true;
  window.hide();
}

function showTraining() {
  if (!ready) return;
  hideWindow(quickWindow, windowDiagnostics.quick);
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = makeWindow(false);
  else {
    windowDiagnostics.main.presentedOnce = true;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

function showQuick() {
  if (!ready) { pendingQuick = true; return; }
  hideWindow(mainWindow, windowDiagnostics.main);
  if (!quickWindow || quickWindow.isDestroyed()) quickWindow = makeWindow(true);
  else {
    windowDiagnostics.quick.presentedOnce = true;
    if (quickWindow.isMinimized()) quickWindow.restore();
    quickWindow.show();
    quickWindow.focus();
  }
}

function status() {
  return {
    native: true,
    shortcut: 'Ctrl+Alt+E',
    shortcutRegistered,
    notificationsSupported: Notification.isSupported(),
  };
}

function scheduleReminder(minutes) {
  if (!validReminderMinutes(minutes)) throw new Error('Only the explicit 30 minute reminder is supported.');
  if (!Notification.isSupported()) return { scheduled: false, reason: 'unsupported' };
  clearTimeout(reminderTimer);
  reminderTimer = setTimeout(() => {
    reminderTimer = null;
    if (quitting) return;
    if (reminderNotification) reminderNotification.close();
    reminderNotification = new Notification({
      title: 'Ratmir English',
      body: 'Есть пять минут? Начни с одного короткого ответа по-английски.',
      icon: iconPath,
    });
    reminderNotification.on('click', showTraining);
    reminderNotification.on('failed', () => { reminderNotification = null; });
    reminderNotification.show();
  }, minutes * 60_000);
  reminderTimer.unref();
  return { scheduled: true, minutes };
}

function registerIpc() {
  const handle = (channel, callback) => ipcMain.handle(channel, (event, ...args) => {
    if (!applicationPolicy.isTrustedSender(event, [mainWindow, quickWindow])) throw new Error('Untrusted desktop request.');
    return callback(event, ...args);
  });
  handle(IPC.status, (event) => {
    if (mainWindow && event.sender === mainWindow.webContents) {
      windowDiagnostics.main.bridgeConnected = true;
      presentInitialWindow(mainWindow, windowDiagnostics.main);
    }
    if (quickWindow && event.sender === quickWindow.webContents) {
      windowDiagnostics.quick.bridgeConnected = true;
      presentInitialWindow(quickWindow, windowDiagnostics.quick);
    }
    writeDiagnostics();
    return status();
  });
  // Clipboard is read only for this explicit renderer request, never for a
  // global shortcut, on startup, a notification, or an automatic timer.
  handle(IPC.clipboard, () => safeClipboardText(clipboard.readText()));
  handle(IPC.openTraining, () => {
    showTraining();
    return { opened: true };
  });
  handle(IPC.openQuick, () => { showQuick(); return { opened: true }; });
  handle(IPC.hideQuick, () => { hideWindow(quickWindow, windowDiagnostics.quick); return { hidden: true }; });
  handle(IPC.reminder, (_event, minutes) => scheduleReminder(minutes));
}

async function boot() {
  startupStage = 'configuration';
  writeDiagnostics();
  const configPath = app.isPackaged
    ? join(app.getPath('userData'), 'desktop-config.json')
    : join(app.getAppPath(), '..', '.runtime', 'desktop-config.json');
  const config = readConfiguration(configPath);
  applicationPolicy = await prepareRuntime(config, {
    onStage: (stage) => { startupStage = stage; writeDiagnostics(); },
  });
  startupStage = 'desktop-session';
  writeDiagnostics();
  await configureDesktopSession();
  startupStage = 'native-controls';
  writeDiagnostics();
  registerIpc();
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip('Ratmir English · Ctrl+Alt+E');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть тренинг', click: showTraining },
    { label: 'Быстрый разбор · Ctrl+Alt+E', click: showQuick },
    { type: 'separator' },
    { label: 'Напомнить через 30 минут', enabled: Notification.isSupported(), click: () => scheduleReminder(30) },
    { type: 'separator' },
    { label: 'Выйти из приложения', click: () => app.quit() },
  ]));
  tray.on('click', showTraining);
  ready = true;
  try { shortcutRegistered = globalShortcut.register(SHORTCUT, showQuick); } catch { shortcutRegistered = false; }
  writeDiagnostics();
  startupStage = 'main-window';
  showTraining();
  startupStage = 'ready';
  writeDiagnostics();
  if (pendingQuick) { pendingQuick = false; showQuick(); }
}
