import { createServer } from 'node:http';
import { basename } from 'node:path';
import { SiwcClient } from '../lib/server/siwc';
import { SiwcStore, prepareVm } from '../lib/server/siwc-store';
import { SIWC_ISSUER, SiwcError, authorizationUrl, safeSiwcError, signInAttempt } from '../lib/server/siwc-protocol';

export const CONNECT_HELP = [
  'Подключение ChatGPT plan usage для личного OSS тренажёра.',
  '  npx --no-install tsx scripts/connect-chatgpt.ts --status [--dir DIRECTORY]',
  '  npx --no-install tsx scripts/connect-chatgpt.ts --login [--dir DIRECTORY] [--port 1455]',
  '  npx --no-install tsx scripts/connect-chatgpt.ts --probe [--dir DIRECTORY]',
  '  npx --no-install tsx scripts/connect-chatgpt.ts --prepare-vm DIRECTORY',
  '',
  '--login запускает только локальный callback на 127.0.0.1 и показывает ссылку.',
  'Вход открывает пользователь. --status не делает OAuth или inference.',
  '--probe делает один явный запрос строго к GPT-6.1 Sol через подписку.',
  '--prepare-vm создаёт отдельный host ID в новом staging-каталоге без credentials.',
  'Для VM: подготовь staging, выполни --login и --probe с --dir этого каталога.',
  'Затем самостоятельно передай host.json и credentials.json по SSH в защищённый',
  'TRAINING_SIWC_DIR сервера (каталог 0700, credentials 0600, владелец процесса).',
  'Не копируй session-lock.sqlite и не заменяй host ID другим существующим host ID.',
  'После передачи VM владеет обновлением токенов; staging больше не используй.',
  'Секреты не отправляй в чат, git или логи. Реальный доступ Sol подтвердит --probe.',
].join('\n');
export interface ConnectOptions { command: 'help' | 'status' | 'login' | 'probe' | 'prepare-vm'; directory?: string; port: number }
export function parseConnectArgs(args: string[]): ConnectOptions {
  const result: ConnectOptions = { command: 'help', port: 1455 }; let command = false; let explicitPort = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help') {
      if (args.length !== 1) throw new SiwcError('protocol');
      return result;
    }
    if (['--status', '--login', '--probe', '--prepare-vm'].includes(arg)) {
      if (command) throw new SiwcError('protocol');
      command = true; result.command = arg.slice(2) as ConnectOptions['command'];
      if (arg === '--prepare-vm') {
        const directory = args[++i]; if (!directory || directory.startsWith('--') || result.directory) throw new SiwcError('protocol');
        result.directory = directory;
      }
    } else if (arg === '--dir') {
      const directory = args[++i]; if (!directory || directory.startsWith('--') || result.directory) throw new SiwcError('protocol');
      result.directory = directory;
    } else if (arg === '--port') {
      if (explicitPort) throw new SiwcError('protocol');
      explicitPort = true;
      const port = args[++i]; if (!port || !/^\d{1,5}$/.test(port) || Number(port) > 65535) throw new SiwcError('protocol');
      result.port = Number(port);
    } else throw new SiwcError('protocol');
  }
  if ((!command && args.length) || (result.command !== 'login' && explicitPort)) throw new SiwcError('protocol');
  return result;
}
export async function login(client: SiwcClient, requestedPort: number, output: (line: string) => void = console.log): Promise<void> {
  const host = await client.store.ensureHost();
  const selected = await client.store.registration();
  let attempt: ReturnType<typeof signInAttempt>; let processing = false; let retries = 0;
  let succeed!: () => void; let fail!: (error: unknown) => void;
  const complete = new Promise<void>((resolveResult, rejectResult) => { succeed = resolveResult; fail = rejectResult; });
  // No server is created until the user explicitly executes --login.
  const server = createServer((request, response) => {
    const headers = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff' };
    const local = new URL(attempt.redirectUri);
    if (request.method !== 'GET' || request.headers.host !== local.host
      || (request.headers.origin !== undefined && request.headers.origin !== local.origin)) {
      response.writeHead(403, headers).end('Вход разрешён только через локальную ссылку.'); return;
    }
    let callback: URL;
    try { callback = new URL(request.url || '/', local.origin); } catch { response.writeHead(400, headers).end('Некорректный callback.'); return; }
    if (callback.pathname === '/start' && !callback.search && !attempt.consumed && !processing) {
      response.writeHead(302, { ...headers, location: authorizationUrl(attempt).toString() }).end(); return;
    }
    if (callback.pathname !== '/auth/callback') { response.writeHead(404, headers).end('Страница не найдена.'); return; }
    if (processing || attempt.consumed) { response.writeHead(409, headers).end('Эта попытка входа уже обработана.'); return; }
    processing = true;
    void client.finishLogin(attempt, callback).then(() => {
      response.writeHead(200, headers).end('Подключение сохранено. Закрой страницу и запусти --probe в терминале.', succeed);
    }, error => {
      if (error instanceof SiwcError && error.code === 'code_expired' && attempt.clientId && retries < 1) {
        retries++;
        attempt = signInAttempt(attempt.redirectUri, host.host_id, { client_id: attempt.clientId, subject: attempt.subject });
        processing = false;
        const start = local.origin + '/start';
        response.writeHead(400, headers).end('Код входа истёк. Новая попытка готова; снова открой локальную ссылку из терминала.');
        output('Повтори вход через локальную ссылку: ' + start);
        return;
      }
      response.writeHead(400, headers).end(safeSiwcError(error), () => fail(error));
    });
  });
  server.requestTimeout = 30_000; server.headersTimeout = 10_000;
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', () => rejectListen(new SiwcError('network')));
    server.listen(requestedPort, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw new SiwcError('protocol'); }
  attempt = signInAttempt('http://127.0.0.1:' + address.port + '/auth/callback', host.host_id, selected);
  const timeout = setTimeout(() => fail(new SiwcError('state')), 10 * 60_000);
  const interrupt = () => fail(new SiwcError('state')); process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  output('Continue with ChatGPT — официальный вход: ' + SIWC_ISSUER);
  output('Открой локальную ссылку: http://127.0.0.1:' + address.port + '/start');
  try { await complete; }
  finally { clearTimeout(timeout); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); server.closeAllConnections(); server.close(); }
}
export async function runConnect(args: string[]): Promise<void> {
  const options = parseConnectArgs(args);
  if (options.command === 'help') { console.log(CONNECT_HELP); return; }
  if (options.command === 'prepare-vm') {
    await prepareVm(options.directory!);
    console.log('Новый host ID создан без credentials. Следующий шаг: --login --dir staging-каталог, затем --probe.');
    return;
  }
  const client = new SiwcClient({ store: new SiwcStore(options.directory) });
  if (options.command === 'status') { console.log(JSON.stringify(await client.status(), null, 2)); return; }
  if (options.command === 'probe') { console.log(JSON.stringify(await client.probe(), null, 2)); return; }
  await login(client, options.port);
  console.log('Вход сохранён. Доступ к модели ещё нужно подтвердить отдельной командой --probe.');
}
if (process.argv[1] && basename(process.argv[1]) === 'connect-chatgpt.ts') {
  void runConnect(process.argv.slice(2)).catch(error => { console.error(safeSiwcError(error)); process.exitCode = 1; });
}
