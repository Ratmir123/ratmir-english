'use strict';

const { app, BrowserWindow, Tray, Menu, globalShortcut, Notification, ipcMain, clipboard, dialog, nativeImage, nativeTheme, shell, session, powerMonitor, screen } = require('electron');
const { mkdirSync, writeFileSync, renameSync, readFileSync, statSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const {
  USAGE_URL, IPC, isAllowedExternalLink,
  safeClipboardText, readConfiguration, prepareRuntime, configureSessionProxy,
  validReminderMinutes, safeNetworkError, safeNotification,
  readThemePreference, writeThemePreference,
  QUICK_OVERLAY, chooseShortcut, overlayBounds, overlayWindowOptions, pointerInWindow, trayMenuItems, trayTooltip, navigationTarget,
} = require('./runtime.cjs');
const { prepareCallAudio } = require('./call-audio.cjs');

const { createDailyReminderScheduler, normalizeReminderSettings } = require('./daily-reminders.cjs');
// Display name only. appId, userData folder, partitions and IPC channel names keep their
// original technical identities so installed profiles survive the 0.5 rename.
const APP_TITLE = 'Smooth Talk';
app.setName(APP_TITLE);
// Preserve the installed profile, cookies and remote origin across the brand rename.
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
// The hotkey that actually registered ({ accelerator, label }), or null when every candidate is taken (tray only).
let shortcut = null;
let reminderTimer = null;
let reminderNotification = null;
let dailyReminders = null;
let reminderLoadWarning = null;
let pendingQuick = false;
// Quick overlay opened from the main window returns there when closed (not to the tray).
let quickReturnsToMain = false;
// A requested overlay appears only after its page answered the status handshake (never a blank layer).
let quickShowPending = false;
let quickPrewarmTimer = null;
// Click-through state of the overlay (set by its page) and the shell's own cursor forwarding while it is on.
let quickIgnoringMouse = false;
let quickPointerTimer = null;
let quickPointerLast = null;
// Main → page navigation ('phrases'), sent once the main document is ready (dom-ready or its status handshake).
let mainDocumentReady = false;
let pendingNavigation = null;
// The overlay's current document answered the status handshake (shown on request without waiting). Both flags reset
// only when a new main-frame document commits (did-navigate) or the renderer dies — never on 'did-start-loading',
// which also fires for subframes and other loads inside a document that stays ready.
let quickDocumentReady = false;
const callAudioJobs = new Map();
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
// The in-app appearance choice, remembered here so the next start creates its window in that theme (no flash).
const appearancePath = join(userDataPath, 'appearance.json');
let rememberedTheme = 'system';
// 0.5.3: the transparent multi-size chubrik (16…256 px PNG entries): window, taskbar, tray and notifications pick
// the exact size for the current DPI. Packaged builds copy it to resources/app-icons/icon.ico (electron-builder.json).
const iconPath = app.isPackaged
  ? join(process.resourcesPath, 'app-icons', 'icon.ico')
  : join(app.getAppPath(), '..', 'public', 'icon-smooth-v053.ico');
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
    clearTimeout(quickPrewarmTimer);
    clearInterval(quickPointerTimer);
    quickPointerTimer = null;
    dailyReminders?.stop();
    stopCallAudioJobs();
    globalShortcut.unregisterAll();
    shortcutRegistered = false;
    shortcut = null;
    if (tray) { tray.destroy(); tray = null; }
    writeDiagnostics();
  });
  app.whenReady().then(async () => { writeDiagnostics(); await boot(); }).catch((error) => {
    bootErrorCode = ['DESKTOP_CONFIG_INVALID', 'DESKTOP_WORKSPACE_INVALID', 'DESKTOP_NODE_INVALID', 'DESKTOP_SERVER_UNAVAILABLE'].includes(error?.message) ? error.message : 'APP_BOOT_FAILED';
    writeDiagnostics();
    dialog.showErrorBox(APP_TITLE, applicationPolicy?.mode === 'remote'
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
      shortcut: shortcut ? shortcut.label : null,
      quickStyle: 'overlay',
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
  // The page blocks unload only while a recording exists solely in this window.
  contents.on('will-prevent-unload', (event) => {
    const options = {
      type: 'warning', title: APP_TITLE, buttons: ['Остаться', 'Уйти без записи'], defaultId: 0, cancelId: 0, noLink: true,
      message: 'Запись ещё не распознана и есть только в этом окне.',
      detail: 'Останься, чтобы распознать или удалить её. Если уйти, запись пропадёт.',
    };
    // A hidden (tray) window cannot host a visible modal: show the question on its own then.
    const choice = !window.isDestroyed() && window.isVisible() ? dialog.showMessageBoxSync(window, options) : dialog.showMessageBoxSync(options);
    if (choice === 1) event.preventDefault();
  });
  contents.on('destroyed', () => stopCallAudioJobs(contents));
  contents.on('render-process-gone', () => stopCallAudioJobs(contents));
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
  // The quick window is the 0.5.3 overlay: a transparent floating layer for the chubrik's capture card (runtime.cjs).
  const window = new BrowserWindow(quick
    ? overlayWindowOptions({ title: APP_TITLE + ' · Запомнить фразу', icon: iconPath, preload: preloadPath, partition: applicationPolicy.partition })
    : {
      title: APP_TITLE,
      width: 1280,
      height: 920,
      minWidth: 820,
      minHeight: 600,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: windowBackground(),
      icon: iconPath,
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
  // Above other always-on-top windows and fullscreen video players.
  if (quick) window.setAlwaysOnTop(true, 'screen-saver');
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
  // A new main-frame document committed (first load, reload, recovery): its handshake and readiness start over, and a
  // new overlay document starts out catching clicks (its page decides where they pass through).
  window.webContents.on('did-navigate', () => {
    if (quick) { quickDocumentReady = false; setQuickClickThrough(window, false); }
    else mainDocumentReady = false;
  });
  window.webContents.on('dom-ready', () => {
    diagnostics.event = 'dom-ready';
    if (!quick) { mainDocumentReady = true; flushNavigation(); }
    writeDiagnostics();
  });
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
    if (quick) { quickLoaded = false; quickDocumentReady = false; } else { mainLoaded = false; mainDocumentReady = false; }
    writeDiagnostics();
  });
  window.on('unresponsive', () => { diagnostics.event = 'unresponsive'; writeDiagnostics(); });
  window.on('close', (event) => {
    if (!quitting) { event.preventDefault(); diagnostics.presentedOnce = true; window.hide(); }
  });
  window.on('show', () => {
    diagnostics.shown = true;
    writeDiagnostics();
    if (quick) syncQuickPointer(); else scheduleQuickPrewarm();
  });
  window.on('hide', () => {
    diagnostics.shown = false;
    diagnostics.presentedOnce = true;
    writeDiagnostics();
    if (quick) syncQuickPointer();
  });
  window.on('closed', () => {
    if (quick) { quickWindow = null; quickLoaded = false; quickDocumentReady = false; quickShowPending = false; quickIgnoringMouse = false; syncQuickPointer(); }
    else { mainWindow = null; mainLoaded = false; mainDocumentReady = false; }
    diagnostics.created = false;
    diagnostics.shown = false;
    diagnostics.bridgeConnected = false;
    diagnostics.event = 'closed';
    writeDiagnostics();
  });
  // The overlay never presents itself on paint: it is shown on request, after its page's status handshake. It gets no
  // ready-to-show listener at all — listening alone makes a hidden renderer count as visible (no 'hidden' first load).
  if (!quick) window.once('ready-to-show', () => {
    diagnostics.paintReady = true;
    presentInitialWindow(window, diagnostics);
    writeDiagnostics();
  });
  loadWindow(window, quick);
  return window;
}

function loadWindow(window, quick) {
  const diagnostics = windowDiagnostics[quick ? 'quick' : 'main'];
  diagnostics.event = 'load-requested';
  writeDiagnostics();
  window.loadURL(quick ? applicationPolicy.quickUrl : applicationPolicy.startupUrl).then(() => {
    if (diagnostics.event !== 'loaded') { diagnostics.event = 'load-resolved'; writeDiagnostics(); }
  }).catch(() => {
    if (diagnostics.event !== 'load-failed') { diagnostics.event = 'load-rejected'; writeDiagnostics(); }
    // A prewarmed overlay fails quietly: the next hotkey or tray use loads it again and reports a failure then.
    if (quick && !quickShowPending) return;
    if (quick) quickShowPending = false;
    dialog.showErrorBox(APP_TITLE, applicationPolicy.mode === 'remote'
      ? 'Сервер тренинга не ответил. Проверь интернет и попробуй открыть приложение снова из значка рядом с часами.'
      : 'Окно тренинга не загрузилось. Попробуй открыть его снова из значка рядом с часами.');
  });
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
  quickReturnsToMain = false;
  quickShowPending = false;
  hideWindow(quickWindow, windowDiagnostics.quick);
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = makeWindow(false);
  else {
    windowDiagnostics.main.presentedOnce = true;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

/**
 * Summons the overlay (hotkey, tray, or the page's openQuick). It floats above everything, so the main window stays
 * where it is. A first request creates it at once and shows it after the page's status handshake; a prewarmed one
 * (scheduleQuickPrewarm) appears instantly.
 */
function showQuick(fromMain = false) {
  if (!ready) { pendingQuick = true; return; }
  quickReturnsToMain = fromMain === true;
  if (!quickWindow || quickWindow.isDestroyed()) {
    quickShowPending = true;
    quickWindow = makeWindow(true);
    return;
  }
  if (quickDocumentReady) { presentQuick(); return; }
  // Still loading (prewarm in progress) or its last load failed: show it after the handshake, retrying a failed load.
  quickShowPending = true;
  if (['load-failed', 'load-rejected', 'renderer-gone', 'unexpected-page'].includes(windowDiagnostics.quick.event)) loadWindow(quickWindow, true);
}

/** Shows the overlay with keyboard focus: the page plays its entrance on visibilitychange/focus and types at once. */
function presentQuick() {
  if (quitting || !quickWindow || quickWindow.isDestroyed()) return;
  quickShowPending = false;
  placeQuick(quickWindow);
  quickWindow.setAlwaysOnTop(true, 'screen-saver');
  windowDiagnostics.quick.presentedOnce = true;
  quickWindow.show();
  quickWindow.moveTop();
  quickWindow.focus();
}

/** Bottom-right of the work area of the display under the cursor (12 px margin), recomputed on every show. */
function placeQuick(window) {
  try {
    const bounds = overlayBounds(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea);
    if (!bounds) return;
    window.setBounds(bounds);
    // Moving between displays with different scale factors can resize a window on Windows: apply once more.
    const [width, height] = window.getSize();
    if (width !== bounds.width || height !== bounds.height) window.setBounds(bounds);
  } catch { }
}

/**
 * Click-through for the overlay's transparent parts. Windows forwards mouse moves to an ignoring window only through a
 * low-level hook that some setups never feed (injected or remote input, hook-filtering tools), and a page that stops
 * hearing the cursor can never take clicks back. So while the overlay is visible and ignoring, the shell also sends the
 * cursor position to the page itself (pointerInWindow, ~20 Hz, only when it moved inside the window).
 */
function setQuickClickThrough(window, ignore) {
  if (!window || window.isDestroyed()) return;
  quickIgnoringMouse = ignore === true;
  if (quickIgnoringMouse) window.setIgnoreMouseEvents(true, { forward: true });
  else window.setIgnoreMouseEvents(false);
  syncQuickPointer();
}

function syncQuickPointer() {
  const active = quickIgnoringMouse && !quitting && !!quickWindow && !quickWindow.isDestroyed() && quickWindow.isVisible();
  if (active && !quickPointerTimer) quickPointerTimer = setInterval(forwardQuickPointer, QUICK_OVERLAY.pointerMs);
  if (!active && quickPointerTimer) { clearInterval(quickPointerTimer); quickPointerTimer = null; }
  if (!active) quickPointerLast = null;
}

function forwardQuickPointer() {
  if (!quickIgnoringMouse || !quickWindow || quickWindow.isDestroyed() || !quickWindow.isVisible()) { syncQuickPointer(); return; }
  try {
    const point = pointerInWindow(screen.getCursorScreenPoint(), quickWindow.getContentBounds());
    if (!point) { quickPointerLast = null; return; }
    if (quickPointerLast && quickPointerLast.x === point.x && quickPointerLast.y === point.y) return;
    quickPointerLast = point;
    quickWindow.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
  } catch { }
}

/** Hides the overlay; when it was opened from the main window, that window comes back to the front instead. */
function dismissQuick() {
  quickShowPending = false;
  if (quickReturnsToMain) { showTraining(); return { hidden: true, returned: true }; }
  hideWindow(quickWindow, windowDiagnostics.quick);
  return { hidden: true, returned: false };
}

/** The hotkey toggles the overlay (Esc, a save timeout and focus loss are the page's own way out, via hideQuick). */
function toggleQuick() {
  if (quickWindow && !quickWindow.isDestroyed() && quickWindow.isVisible()) dismissQuick();
  else showQuick(false);
}

/** Creates the overlay hidden ~6 s after the main window first appears, so it never competes with the launch. */
function scheduleQuickPrewarm() {
  if (quickPrewarmTimer || quitting) return;
  quickPrewarmTimer = setTimeout(() => {
    if (!quitting && ready && (!quickWindow || quickWindow.isDestroyed())) quickWindow = makeWindow(true);
  }, QUICK_OVERLAY.prewarmMs);
}

/**
 * Tray «Мои фразы» and openTraining('phrases') from a page (e.g. the overlay's capture card): the main window opens
 * on the Practice phrases sheet (the page decides how, via onNavigate). The overlay hides on the way (showTraining).
 */
function openPhrases() {
  showTraining();
  pendingNavigation = 'phrases';
  flushNavigation();
}

function flushNavigation() {
  if (!pendingNavigation || !mainDocumentReady || !mainWindow || mainWindow.isDestroyed()) return;
  const contents = mainWindow.webContents;
  if (contents.isDestroyed() || !applicationPolicy.isAllowedPageUrl(contents.getURL())) return;
  const target = navigationTarget(pendingNavigation);
  pendingNavigation = null;
  if (target) contents.send(IPC.navigate, target);
}

function status(sender) {
  const value = {
    native: true,
    // The label of the hotkey that actually registered; '' with shortcutRegistered false when every candidate was taken.
    shortcut: shortcut ? shortcut.label : '',
    shortcutRegistered,
    notificationsSupported: Notification.isSupported(),
  };
  if (quickWindow && !quickWindow.isDestroyed() && sender === quickWindow.webContents) value.quickStyle = 'overlay';
  return value;
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
      title: APP_TITLE,
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
      mainDocumentReady = true;
      flushNavigation();
    }
    if (quickWindow && event.sender === quickWindow.webContents) {
      windowDiagnostics.quick.bridgeConnected = true;
      quickDocumentReady = true;
      // The page is up: a requested overlay appears a moment after this answer, so the page has applied quickStyle.
      if (quickShowPending) setTimeout(() => { if (quickShowPending) presentQuick(); }, 80);
    }
    writeDiagnostics();
    return status(event.sender);
  });
  // Clipboard is read only for this explicit renderer request, never for a
  // global shortcut, on startup, a notification, or an automatic timer.
  handle(IPC.clipboard, () => safeClipboardText(clipboard.readText()));
  // 0.5.3: an optional place to open; only the literal 'phrases' navigates, anything else just opens the main window.
  handle(IPC.openTraining, (_event, target) => {
    if (navigationTarget(target) === 'phrases') openPhrases();
    else showTraining();
    return { opened: true };
  });
  // Opened from the main window: closing the overlay brings the main window back to the front.
  handle(IPC.openQuick, (event) => { showQuick(!!mainWindow && event.sender === mainWindow.webContents); return { opened: true }; });
  handle(IPC.hideQuick, () => dismissQuick());
  // 0.5.3 overlay: clicks pass through its transparent parts (true) or land on its content (false). Mouse moves keep
  // reaching the page (forwarded, see setQuickClickThrough), so it can switch back over its content. Never applies to
  // the main window.
  handle(IPC.setClickThrough, (event, ignore) => {
    if (typeof ignore !== 'boolean') throw new Error('Expected a boolean.');
    if (!quickWindow || quickWindow.isDestroyed() || event.sender !== quickWindow.webContents) return { applied: false };
    setQuickClickThrough(quickWindow, ignore);
    return { applied: true, ignore };
  });
  handle(IPC.prepareCallAudio, (event, filePath) => runCallAudioJob(event.sender, filePath));
  handle(IPC.notify, (_event, value) => showAppNotification(value));
  // The in-app appearance choice also drives the native title bar and window background (Windows follows themeSource).
  // It is remembered for the next start (applied before the first window in boot), written only when it changes.
  // The overlay keeps its transparent background in every theme.
  handle(IPC.setTheme, (_event, value) => {
    if (!['system', 'light', 'dark'].includes(value)) throw new Error('Unknown theme.');
    nativeTheme.themeSource = value;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(windowBackground());
    if (value !== rememberedTheme) {
      try { writeThemePreference(appearancePath, value); rememberedTheme = value; } catch { }
    }
    return { theme: value };
  });
  handle(IPC.reminder, (_event, minutes) => scheduleReminder(minutes));
  handle(IPC.reminderSettings, () => ({ ...dailyReminders.getSettings(), ...(reminderLoadWarning ? { warning: reminderLoadWarning } : {}) }));
  handle(IPC.saveReminderSettings, (_event, settings) => { const result = dailyReminders.save(settings); reminderLoadWarning = null; return result; });
}

function setupDailyReminders() {
  const path = join(userDataPath, 'daily-reminders.json');
  let initial = { enabled: false, times: ['19:00'] };
  if (existsSync(path)) {
    try {
      if (statSync(path).size > 4096) throw new Error('Reminder settings are too large.');
      initial = normalizeReminderSettings(JSON.parse(readFileSync(path, 'utf8')));
    } catch { reminderLoadWarning = 'Не удалось прочитать прежнее расписание. Напоминания приостановлены. Выбери времена и сохрани их заново.'; }
  }
  dailyReminders = createDailyReminderScheduler({
    initial,
    persist(settings) {
      const temporary = path + '.tmp';
      writeFileSync(temporary, JSON.stringify(settings), { mode: 0o600 });
      renameSync(temporary, path);
    },
    notify() {
      if (quitting || !Notification.isSupported()) return;
      if (reminderNotification) reminderNotification.close();
      reminderNotification = new Notification({ title: APP_TITLE, body: 'Время для короткого разговора. Начнём с одного ответа?', icon: iconPath });
      reminderNotification.on('click', showTraining);
      reminderNotification.on('failed', () => { reminderNotification = null; });
      reminderNotification.show();
    },
  });
  dailyReminders.start();
  powerMonitor.on('resume', () => dailyReminders.resume());
}

/** The app background of the current theme (globals.css --bg-base), so a window never paints the other theme first. */
function windowBackground() {
  return nativeTheme.shouldUseDarkColors ? '#0B0B10' : '#EEEEF3';
}

async function boot() {
  // Before any window exists: the remembered appearance drives the native frame, backgroundColor and the page's
  // prefers-color-scheme from the very first paint (MOTION-PASS-0.5.2 §4).
  rememberedTheme = readThemePreference(appearancePath);
  nativeTheme.themeSource = rememberedTheme;
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
  setupDailyReminders();
  registerIpc();
  // No default menu in the installed app: its Ctrl+R / F5 reload would drop an unsent recording.
  if (app.isPackaged) Menu.setApplicationMenu(null);
  // The first free hotkey of SHORTCUT_CANDIDATES toggles the overlay; the tray and the page show the one that registered.
  shortcut = chooseShortcut((accelerator) => globalShortcut.register(accelerator, toggleQuick));
  shortcutRegistered = shortcut !== null;
  const shortcutText = shortcut ? shortcut.label : null;
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip(trayTooltip(shortcutText, APP_TITLE));
  const trayActions = { open: showTraining, capture: () => showQuick(false), phrases: openPhrases, remind: () => scheduleReminder(30), quit: () => app.quit() };
  tray.setContextMenu(Menu.buildFromTemplate(trayMenuItems({ shortcut: shortcutText, notificationsSupported: Notification.isSupported(), title: APP_TITLE })
    .map((item) => item.type === 'separator' ? { type: 'separator' } : { label: item.label, enabled: item.enabled !== false, click: trayActions[item.id] })));
  tray.on('click', showTraining);
  ready = true;
  writeDiagnostics();
  startupStage = 'main-window';
  showTraining();
  startupStage = 'ready';
  writeDiagnostics();
  if (pendingQuick) { pendingQuick = false; showQuick(false); }
}

function stopCallAudioJobs(contents) {
  for (const [child, owner] of callAudioJobs) {
    if (contents && owner !== contents) continue;
    try { child.kill(); } catch { }
    callAudioJobs.delete(child);
  }
}

/** One local ffmpeg extraction per request; killed when its window goes away or the app quits. */
async function runCallAudioJob(sender, filePath) {
  if (quitting) return { ok: false, reason: 'failed', message: 'Приложение закрывается.' };
  if ([...callAudioJobs.values()].filter((owner) => owner === sender).length >= 2) {
    return { ok: false, reason: 'failed', message: 'Уже готовлю аудио другого созвона. Подожди немного.' };
  }
  return prepareCallAudio(filePath, {
    tempRoot: app.getPath('temp'),
    track(child) {
      callAudioJobs.set(child, sender);
      return () => callAudioJobs.delete(child);
    },
  });
}

/** OS notification for in-app events (a review became ready) only while the main window is not in front. */
function showAppNotification(value) {
  const payload = safeNotification(value);
  if (!payload || quitting || !Notification.isSupported()) return { shown: false };
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused()) return { shown: false };
  const notification = new Notification({ title: payload.title, body: payload.body, icon: iconPath });
  notification.on('click', showTraining);
  notification.show();
  return { shown: true };
}
