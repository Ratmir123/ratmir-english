import { spawn } from 'node:child_process';
import { startVoiceRelay } from './voice-relay.mjs';

const relay = startVoiceRelay();
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '0.0.0.0', '--port', '3000'], {
  cwd: process.cwd(), env: process.env, stdio: 'inherit', shell: false,
});
let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  relay.close();
  app.kill(signal);
  setTimeout(() => { app.kill('SIGKILL'); process.exit(1); }, 25000).unref();
}
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
app.on('error', () => { relay.close(); process.exit(1); });
app.on('exit', code => { relay.close(); process.exit(stopping ? 0 : code || 1); });
