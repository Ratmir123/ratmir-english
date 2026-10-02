import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { startVoiceRelay } from './voice-relay.mjs';

/** The relay must own its port before a child application can be started. */
export async function startHostedServer(relay = startVoiceRelay(), spawnApp = () => spawn(process.execPath,
  ['node_modules/next/dist/bin/next', 'start', '--hostname', '0.0.0.0', '--port', '3000'],
  { cwd: process.cwd(), env: process.env, stdio: 'inherit', shell: false })) {
  try { await relay.ready; }
  catch (error) { relay.close(); throw error; }
  let app;
  try { app = spawnApp(); }
  catch (error) { relay.close(); throw error; }
  let stopping = false;
  let exitCode = null;
  let timer;
  function finish(code) {
    if (timer) clearTimeout(timer);
    relay.close();
    process.exit(code);
  }
  function stop(signal, code = 0) {
    if (stopping) return;
    stopping = true; exitCode = code;
    relay.close(); app.kill(signal);
    timer = setTimeout(() => { app.kill('SIGKILL'); finish(1); }, 25000).unref();
  }
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  app.on('error', () => finish(1));
  app.on('exit', code => finish(exitCode ?? (code || 1)));
  // Do not print provider payloads, credentials, or listener diagnostic details.
  void relay.failed.then(() => stop('SIGTERM', 1));
  return { stop };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await startHostedServer(); }
  catch {
    process.stderr.write('Training server could not start. Check server ports and restart the service.\n');
    process.exitCode = 1;
  }
}
