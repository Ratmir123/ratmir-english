'use strict';

const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { lstatSync, readFileSync } = require('node:fs');
const { isIP } = require('node:net');
const { extname, isAbsolute, join, resolve } = require('node:path');

const APP_ORIGIN = 'http://127.0.0.1:3000';
const STARTUP_URL = APP_ORIGIN + '/?entry=startup';
const QUICK_URL = APP_ORIGIN + '/?entry=quick';
const CLIPBOARD_LIMIT = 6000;
const SHORTCUT = 'Control+Alt+E';
const USAGE_URL = 'https://chatgpt.com/settings/usage';
const IPC = Object.freeze({
  status: 'ratmir-desktop:status',
  clipboard: 'ratmir-desktop:clipboard',
  openTraining: 'ratmir-desktop:open-training',
  openQuick: 'ratmir-desktop:open-quick',
  hideQuick: 'ratmir-desktop:hide-quick',
  reminder: 'ratmir-desktop:reminder',
});

function isAllowedPageUrl(value, expectedOrigin = APP_ORIGIN) {
  try {
    const url = new URL(value);
    if (url.origin !== expectedOrigin || url.username || url.password || url.pathname !== '/' || url.hash) return false;
    const entries = [...url.searchParams.entries()];
    return entries.length === 0 || (entries.length === 1 && entries[0][0] === 'entry' && ['startup', 'quick'].includes(entries[0][1]));
  } catch { return false; }
}

function isTrustedSender(event, windows, expectedOrigin = APP_ORIGIN) {
  if (!event || !event.sender || !event.senderFrame || event.sender.isDestroyed()) return false;
  const known = windows.some((window) => window && !window.isDestroyed() && window.webContents === event.sender);
  return known && event.senderFrame === event.sender.mainFrame && isAllowedPageUrl(event.senderFrame.url, expectedOrigin);
}

function safeClipboardText(value) {
  return typeof value === 'string' ? value.slice(0, CLIPBOARD_LIMIT) : '';
}

function isAllowedExternalLink(value) {
  // This one fixed link is the explicit subscription settings action. Never
  // forward a URL provided by lesson content, clipboard text or an AI reply.
  return typeof value === 'string' && value === USAGE_URL;
}

function isPublicLoadRequest(details, expectedOrigin = APP_ORIGIN) {
  if (details?.method !== 'GET') return false;
  try {
    const url = new URL(details.url);
    if (url.origin !== expectedOrigin || url.username || url.password) return false;
    return url.pathname === '/' || url.pathname.startsWith('/_next/static/') ||
      ['/manifest.webmanifest', '/favicon.ico', '/icon.svg', '/icon.ico', '/icon-192.png', '/icon-512.png', '/icon-pearl-v04-192.png', '/icon-pearl-v04-512.png', '/icon-pearl-v04-64.png'].includes(url.pathname);
  } catch { return false; }
}

function safeNetworkError(value) {
  return typeof value === 'string' && /^net::ERR_[A-Z_]{1,90}$/u.test(value) ? value : 'OTHER_NETWORK_ERROR';
}

function isAllowedMicrophoneCheck(permission, origin, details, expectedOrigin = APP_ORIGIN) {
  try {
    return permission === 'media' && new URL(origin).origin === expectedOrigin &&
      details?.isMainFrame === true && details?.mediaType === 'audio' &&
      isAllowedPageUrl(details?.requestingUrl, expectedOrigin);
  } catch { return false; }
}

function isAllowedMicrophoneRequest(permission, details, expectedOrigin = APP_ORIGIN) {
  return permission === 'media' && details?.isMainFrame === true &&
    isAllowedPageUrl(details?.requestingUrl, expectedOrigin) && Array.isArray(details?.mediaTypes) &&
    details.mediaTypes.length > 0 && details.mediaTypes.every((type) => type === 'audio');
}

function validateRemoteOrigin(value) {
  try {
    if (typeof value !== 'string' || value.length > 2048 || /[\s\\\x00-\x1f\x7f]/u.test(value)) throw new Error();
    const url = new URL(value);
    const hostname = url.hostname;
    // A cloud connection is one canonical public DNS HTTPS origin. In particular,
    // numeric/IPv6/alternate-form loopback URLs must never enable the native bridge.
    if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash || url.port || isIP(hostname.replace(/^\[|\]$/gu, '')) ||
        hostname.length > 253 || !hostname.includes('.') || hostname.endsWith('.') ||
        /(?:^|\.)(?:localhost|localdomain|local|internal|home|lan|onion)$/u.test(hostname) || hostname.endsWith('.home.arpa')) throw new Error();
    const labels = hostname.split('.');
    if (!labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)) ||
        !/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/u.test(labels.at(-1))) throw new Error();
    return value;
  } catch { throw new Error('DESKTOP_CONFIG_INVALID'); }
}

function validateConfig(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && value.mode === 'remote') {
    if (Object.keys(value).sort().join(',') !== 'mode,origin') throw new Error('DESKTOP_CONFIG_INVALID');
    return Object.freeze({ mode: 'remote', origin: validateRemoteOrigin(value.origin) });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'nodePath,workspace' ||
      typeof value.workspace !== 'string' || typeof value.nodePath !== 'string' ||
      /[\x00-\x1f"]/u.test(value.workspace + value.nodePath) ||
      !isAbsolute(value.workspace) || !isAbsolute(value.nodePath) ||
      extname(value.nodePath).toLowerCase() !== '.exe') {
    throw new Error('DESKTOP_CONFIG_INVALID');
  }
  return Object.freeze({ workspace: resolve(value.workspace), nodePath: resolve(value.nodePath) });
}

function readRegularJson(file, maximumBytes) {
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > maximumBytes) throw new Error('invalid file');
    return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
  } catch { throw new Error('DESKTOP_CONFIG_INVALID'); }
}

function readConfiguration(file) {
  const config = validateConfig(readRegularJson(file, 8192));
  if (config.mode === 'remote') return config;
  const metadata = readRegularJson(join(config.workspace, 'package.json'), 256 * 1024);
  if (metadata.name !== 'ratmir-english') throw new Error('DESKTOP_WORKSPACE_INVALID');
  for (const relative of ['scripts/start.mjs', '.next/BUILD_ID', 'node_modules/next/dist/bin/next']) {
    try {
      const stat = lstatSync(join(config.workspace, relative));
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('invalid file');
    } catch { throw new Error('DESKTOP_WORKSPACE_INVALID'); }
  }
  return config;
}

function createApplicationPolicy(configuration) {
  const config = validateConfig(configuration);
  const remote = config.mode === 'remote';
  const origin = remote ? config.origin : APP_ORIGIN;
  // Separate remote hosts also separate cookies, cached assets and proxy settings.
  // A cloud connection never inherits the local session's explicit DIRECT proxy.
  const partition = remote
    ? 'persist:ratmir-training-remote-' + createHash('sha256').update(origin).digest('hex').slice(0, 20)
    : 'persist:ratmir-training';
  return Object.freeze({
    mode: remote ? 'remote' : 'local', origin, partition,
    startupUrl: origin + '/?entry=startup', quickUrl: origin + '/?entry=quick',
    isAllowedPageUrl: (value) => isAllowedPageUrl(value, origin),
    isTrustedSender: (event, windows) => isTrustedSender(event, windows, origin),
    isPublicLoadRequest: (details) => isPublicLoadRequest(details, origin),
    isAllowedMicrophoneCheck: (permission, requestingOrigin, details) => isAllowedMicrophoneCheck(permission, requestingOrigin, details, origin),
    isAllowedMicrophoneRequest: (permission, details) => isAllowedMicrophoneRequest(permission, details, origin),
  });
}

async function prepareRuntime(configuration, operations = {}) {
  const config = validateConfig(configuration);
  const policy = createApplicationPolicy(config);
  if (policy.mode === 'remote') return policy;
  const stage = operations.onStage || (() => {});
  stage('node');
  await (operations.validateNode || validateNode)(config);
  stage('server');
  await (operations.startLocalTraining || startLocalTraining)(config);
  await (operations.waitForTraining || waitForTraining)();
  return policy;
}

async function configureSessionProxy(nativeSession, policy) {
  // Remote mode retains Chromium's normal system proxy and certificate checks.
  // No session settings or global OS networking are modified for a cloud host.
  if (policy.mode === 'local') await nativeSession.setProxy({ mode: 'direct' });
}

function validateNode(config, spawnFunction = spawn) {
  return new Promise((done, fail) => {
    let version = '';
    let settled = false;
    const child = spawnFunction(config.nodePath, ['--version'], {
      cwd: config.workspace, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const timer = setTimeout(() => { child.kill(); finish(new Error('DESKTOP_NODE_INVALID')); }, 5000);
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? fail(error) : done();
    }
    child.stdout.on('data', (chunk) => { version = (version + chunk.toString()).slice(0, 100); });
    child.once('error', () => finish(new Error('DESKTOP_NODE_INVALID')));
    child.once('exit', (code) => {
      const match = /^v(\d+)\.\d+\.\d+(?:[-+].*)?\s*$/u.exec(version);
      finish(code === 0 && match && Number(match[1]) >= 24 ? null : new Error('DESKTOP_NODE_INVALID'));
    });
  });
}

function startLocalTraining(config, spawnFunction = spawn) {
  return new Promise((done, fail) => {
    let settled = false;
    const child = spawnFunction(config.nodePath, [join(config.workspace, 'scripts', 'start.mjs')], {
      cwd: config.workspace, windowsHide: true, shell: false, stdio: 'ignore',
    });
    const timer = setTimeout(() => { child.kill(); finish(new Error('DESKTOP_SERVER_UNAVAILABLE')); }, 40_000);
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? fail(error) : done();
    }
    child.once('error', () => finish(new Error('DESKTOP_SERVER_UNAVAILABLE')));
    child.once('exit', (code) => finish(code === 0 ? null : new Error('DESKTOP_SERVER_UNAVAILABLE')));
  });
}

async function readManifest(response) {
  if (!response.ok || !response.headers.get('content-type')?.includes('json') || !response.body) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) { await reader.cancel(); return null; }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { return null; }
  finally { reader.releaseLock(); }
}

async function waitForTraining(fetchFunction = fetch, options = {}) {
  const attempts = options.attempts ?? 12;
  const pause = options.pause ?? ((milliseconds) => new Promise((done) => setTimeout(done, milliseconds)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchFunction(APP_ORIGIN + '/manifest.webmanifest', { redirect: 'error', signal: AbortSignal.timeout(2000) });
      const manifest = await readManifest(response);
      if (manifest?.name === 'Ratmir English' && manifest.display === 'standalone') return;
    } catch { }
    await pause(250);
  }
  throw new Error('DESKTOP_SERVER_UNAVAILABLE');
}

function validReminderMinutes(value) { return value === 30; }

module.exports = {
  APP_ORIGIN, STARTUP_URL, QUICK_URL, CLIPBOARD_LIMIT, SHORTCUT, USAGE_URL, IPC,
  isAllowedPageUrl, isTrustedSender, safeClipboardText, validateConfig, validateRemoteOrigin,
  createApplicationPolicy, prepareRuntime, configureSessionProxy,
  isAllowedExternalLink,
  isPublicLoadRequest, safeNetworkError,
  isAllowedMicrophoneCheck, isAllowedMicrophoneRequest,
  readConfiguration, validateNode, startLocalTraining, waitForTraining, validReminderMinutes,
};
