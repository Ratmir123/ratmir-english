import { spawn, fork } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const delay = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));

function locations(project, port = 3000) {
  project = resolve(project);
  const runtime = resolve(project, '.runtime');
  const identity = createHash('sha256').update(`${project.toLowerCase()}:${port}`).digest('hex').slice(0, 20);
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\RatmirEnglish-${identity}` : resolve(runtime, `control-${identity}.sock`);
  return { project, runtime, pipe, registry: resolve(runtime, 'supervisor.json'), url: `http://127.0.0.1:${port}` };
}

export function checkPrerequisites(project = PROJECT) {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Нужен Node.js 24 или новее.');
  if (!existsSync(resolve(project, '.next', 'BUILD_ID'))) throw new Error('Нет production-сборки. Выполни npm run build в папке training.');
  if (!existsSync(resolve(project, 'node_modules', 'next', 'dist', 'bin', 'next'))) throw new Error('Не установлены зависимости. Выполни npm ci, затем npm run build.');
  if (!existsSync(resolve(project, 'scripts', 'server.mjs'))) throw new Error('Не найден scripts/server.mjs.');
}

function appendLog(runtime, name, message) {
  mkdirSync(runtime, { recursive: true });
  const filename = resolve(runtime, name);
  const original = Buffer.isBuffer(message) ? message : Buffer.from(String(message));
  const data = original.length > MAX_LOG_BYTES ? original.subarray(-MAX_LOG_BYTES) : original;
  if (existsSync(filename) && statSync(filename).size + data.length > MAX_LOG_BYTES) {
    rmSync(`${filename}.1`, { force: true });
    renameSync(filename, `${filename}.1`);
  }
  appendFileSync(filename, data);
}

function readRegistry(paths) {
  try {
    const record = JSON.parse(readFileSync(paths.registry, 'utf8'));
    return record.version === 1 && record.project === paths.project && record.pipe === paths.pipe
      && typeof record.token === 'string' && /^[a-f0-9]{64}$/.test(record.token) ? record : null;
  } catch { return null; }
}

function equalToken(a, b) {
  return typeof a === 'string' && typeof b === 'string' && /^[a-f0-9]{64}$/.test(a)
    && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function requestControl(project = PROJECT, port = 3000, operation = 'status') {
  const paths = locations(project, port);
  const record = readRegistry(paths);
  if (!record) return null;
  return new Promise((done) => {
    let settled = false;
    let data = '';
    const socket = createConnection(paths.pipe);
    const finish = (value) => { if (!settled) { settled = true; socket.destroy(); done(value); } };
    socket.setTimeout(2000, () => finish(null));
    socket.on('error', () => finish(null));
    socket.on('connect', () => socket.write(JSON.stringify({ operation, token: record.token }) + '\n'));
    socket.on('data', (chunk) => {
      data += chunk.toString();
      if (data.length > 4096) return finish(null);
      if (data.includes('\n')) {
        try { const result = JSON.parse(data.split('\n')[0]); finish(result.ok ? result : null); }
        catch { finish(null); }
      }
    });
    socket.on('end', () => finish(null));
  });
}

/** A connected but slow/non-HTTP port is occupied. Only ECONNREFUSED means free. */
export async function probeEndpoint(port = 3000, timeout = 1800) {
  const tcp = await new Promise((done) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; socket.destroy(); done(value); } };
    socket.setTimeout(timeout, () => finish('occupied'));
    socket.on('connect', () => finish('connected'));
    socket.on('error', (error) => finish(error.code === 'ECONNREFUSED' ? 'free' : 'occupied'));
  });
  if (tcp !== 'connected') return tcp;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/manifest.webmanifest`, { signal: AbortSignal.timeout(timeout), redirect: 'error' });
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) return 'occupied';
    const manifest = await response.json();
    return ['Smooth English', 'Ratmir English'].includes(manifest.name) ? 'training' : 'occupied';
  } catch { return 'occupied'; }
}

export async function supervise(options = {}) {
  const { project = PROJECT, port = 3000, pollMs = 5000, retryMinMs = 2000, retryMaxMs = 60_000,
    startupGraceMs = 45_000, stableMs = 60_000 } = options;
  const paths = locations(project, port);
  checkPrerequisites(paths.project);
  mkdirSync(paths.runtime, { recursive: true });
  const token = randomBytes(32).toString('hex');
  let status = 'starting';
  let child = null;
  let childStarted = 0;
  let failures = 0;
  let unhealthy = 0;
  let nextStart = 0;
  let stopping = false;
  let wake = () => {};
  const log = (text) => appendLog(paths.runtime, 'supervisor.log', `${new Date().toISOString()} ${text}\n`);
  const pause = (ms) => new Promise((done) => {
    const timer = setTimeout(() => { wake = () => {}; done(); }, ms);
    wake = () => { clearTimeout(timer); wake = () => {}; done(); };
  });
  const publish = (nextStatus) => {
    if (status !== nextStatus) log(`State: ${nextStatus}`);
    status = nextStatus;
    const record = { version: 1, project: paths.project, pipe: paths.pipe, token, pid: process.pid,
      node: process.execPath, serverPid: child?.pid ?? null, status, url: paths.url, updatedAt: new Date().toISOString() };
    const temporary = `${paths.registry}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(record, null, 2));
    renameSync(temporary, paths.registry);
  };
  const stop = () => { stopping = true; wake(); };
  const server = createServer((socket) => {
    let data = '';
    socket.setTimeout(2000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      data += chunk.toString();
      if (data.length > 4096) return socket.destroy();
      if (!data.includes('\n')) return;
      try {
        const request = JSON.parse(data.split('\n')[0]);
        if (!equalToken(request.token, token) || !['status', 'stop'].includes(request.operation)) return socket.destroy();
        socket.end(JSON.stringify({ ok: true, pid: process.pid, serverPid: child?.pid ?? null, status, url: paths.url }) + '\n');
        if (request.operation === 'stop') stop();
      } catch { socket.destroy(); }
    });
  });
  try {
    await new Promise((done, fail) => { server.once('error', fail); server.listen(paths.pipe, done); });
  } catch (error) {
    if (error.code === 'EADDRINUSE' && await requestControl(paths.project, port)) return;
    throw new Error('Канал контроллера занят или недоступен. Чужой процесс не остановлен.');
  }
  const onSignal = () => stop();
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
  try {
    publish('starting');
    log(`Supervisor started; Node ${process.versions.node}; localhost port ${port}.`);
    while (!stopping) {
      const endpoint = await probeEndpoint(port);
      if (stopping) break;
      if (child) {
        if (endpoint === 'training') { unhealthy = 0; publish('running'); }
        else if (Date.now() - childStarted > startupGraceMs && ++unhealthy >= 3) {
          log('Owned server failed three health checks; restarting its process handle.');
          child.kill(); unhealthy = 0;
        }
        await pause(pollMs);
        continue;
      }
      if (endpoint === 'training') {
        publish('external-training'); // An older/manual instance is observed, never killed through a saved PID.
        await pause(pollMs); continue;
      }
      if (endpoint === 'occupied') { publish('waiting-for-port'); await pause(retryMaxMs); continue; }
      if (Date.now() < nextStart) { await pause(Math.min(pollMs, nextStart - Date.now())); continue; }
      checkPrerequisites(paths.project);
      childStarted = Date.now(); unhealthy = 0;
      const owned = fork(resolve(paths.project, 'scripts', 'server.mjs'), [], {
        cwd: paths.project, execPath: process.execPath, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env, TRAINING_MANAGED_SERVER: '1', TRAINING_SERVER_PROJECT: paths.project, TRAINING_SERVER_PORT: String(port) },
      });
      child = owned;
      writeFileSync(resolve(paths.runtime, 'server.pid'), String(owned.pid));
      owned.stdout.on('data', (chunk) => appendLog(paths.runtime, 'server.log', chunk));
      owned.stderr.on('data', (chunk) => appendLog(paths.runtime, 'server-errors.log', chunk));
      owned.on('error', (error) => log(`Owned server could not start: ${error.message.slice(0, 300)}`));
      owned.once('exit', (code, signal) => {
        if (child !== owned) return;
        child = null;
        if (stopping) return wake();
        if (Date.now() - childStarted >= stableMs) failures = 0;
        failures += 1;
        const backoff = Math.min(retryMaxMs, retryMinMs * 2 ** Math.min(failures - 1, 8));
        nextStart = Date.now() + backoff;
        log(`Owned server exited (${code ?? signal}); retry in ${backoff}ms.`);
        publish('recovering'); wake();
      });
      publish('starting-server');
      await pause(pollMs);
    }
  } finally {
    stopping = true;
    if (child) {
      const owned = child;
      const exited = new Promise((done) => owned.once('exit', done));
      owned.kill(); // Live ChildProcess handle only; server.pid is never an authority to kill.
      await Promise.race([exited, delay(2000)]);
      if (owned.connected) owned.disconnect();
    }
    await new Promise((done) => server.close(done));
    process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
    if (readRegistry(paths)?.token === token) {
      rmSync(paths.registry, { force: true });
      rmSync(resolve(paths.runtime, 'server.pid'), { force: true });
    }
    log('Supervisor stopped.');
  }
}

export async function stopManaged(project = PROJECT, port = 3000) {
  if (!await requestControl(project, port, 'stop')) return false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await delay(100);
    if (!await requestControl(project, port)) return true;
  }
  throw new Error('Контроллер ещё завершает работу. Повтори остановку перед удалением автозагрузки.');
}

async function startDetached() {
  checkPrerequisites();
  const paths = locations(PROJECT);
  const existing = await requestControl();
  if (!existing && await probeEndpoint() === 'occupied') throw new Error('Порт 3000 занят другим приложением. Чужой процесс не остановлен.');
  if (!existing) {
    mkdirSync(paths.runtime, { recursive: true });
    const controller = spawn(process.execPath, [fileURLToPath(import.meta.url), '--supervise'], {
      cwd: PROJECT, detached: true, windowsHide: true, stdio: 'ignore', shell: false,
    });
    controller.unref();
  }
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const control = await requestControl();
    if (control?.status === 'waiting-for-port') throw new Error('Порт 3000 занят другим приложением. Контроллер ждёт его освобождения.');
    if (control && ['running', 'external-training'].includes(control.status)) {
      console.log(`Тренинг работает: ${paths.url}`); return;
    }
    await delay(250);
  }
  throw new Error('Сервер ещё не готов. Проверь .runtime/supervisor.log и .runtime/server-errors.log.');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1) throw new Error('Используй start.mjs, --supervise, --status, --check или --stop.');
  switch (args[0]) {
    case undefined: await startDetached(); break;
    case '--supervise': await supervise(); break;
    case '--check': checkPrerequisites(); console.log('Готово: Node.js 24+, зависимости и production-сборка найдены.'); break;
    case '--status': console.log(JSON.stringify(await requestControl() ?? { managed: false, endpoint: await probeEndpoint() }, null, 2)); break;
    case '--stop': console.log(await stopManaged() ? 'Управляемый тренинг остановлен.' : 'Активного контроллера нет. Чужие и старые процессы не остановлены.'); break;
    default: throw new Error('Неизвестный параметр запуска.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    try { appendLog(locations(PROJECT).runtime, 'supervisor.log', `${new Date().toISOString()} Error: ${error.message}\n`); } catch { /* Preserve the original error if the log directory is unavailable. */ }
    console.error(error.message); process.exitCode = 1;
  });
}
