import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// This process belongs to the live supervisor's IPC channel, never to a PID file.
if (typeof process.send !== 'function') throw new Error('Запускай сервер через scripts/start.mjs.');
process.on('disconnect', () => process.exit(0));
const project = process.env.TRAINING_SERVER_PROJECT;
const port = Number(process.env.TRAINING_SERVER_PORT);
if (!project || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Некорректные параметры управляемого сервера.');
process.chdir(project);
const binary = resolve(project, 'node_modules', 'next', 'dist', 'bin', 'next');
process.argv = [process.execPath, binary, 'start', '--hostname', '127.0.0.1', '--port', String(port)];
createRequire(import.meta.url)(binary);
