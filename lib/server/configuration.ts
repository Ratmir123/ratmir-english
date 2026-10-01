import { isAbsolute } from 'node:path';

export function brainAuthenticationMode(): 'codex' | 'siwc' {
  const mode = process.env.TRAINING_BRAIN_AUTH || 'codex';
  if (mode !== 'codex' && mode !== 'siwc') throw new Error('TRAINING_BRAIN_AUTH должен быть codex или siwc.');
  return mode;
}

export function publicApplicationOrigin(): string | null {
  const value = process.env.TRAINING_PUBLIC_ORIGIN?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
    return url.origin;
  } catch {
    throw new Error('TRAINING_PUBLIC_ORIGIN должен быть HTTPS-адресом приложения без пути, параметров и учётных данных.');
  }
}

export function assertServerConfiguration(): void {
  const deployment = process.env.TRAINING_DEPLOYMENT || 'local';
  if (deployment !== 'local' && deployment !== 'server') throw new Error('TRAINING_DEPLOYMENT должен быть local или server.');
  brainAuthenticationMode();
  const origin = publicApplicationOrigin();
  if (deployment !== 'server') return;
  if (brainAuthenticationMode() !== 'siwc') throw new Error('Серверная версия требует входа через Sign in with ChatGPT. Локальный вход Codex не переносится на VPS.');
  if (!origin) throw new Error('Для серверной версии нужен TRAINING_PUBLIC_ORIGIN с доверенным HTTPS.');
  const code = process.env.TRAINING_ACCESS_CODE;
  if (!code || code.length < 32 || code.trim() !== code || /[\r\n\0]/.test(code)) throw new Error('Для серверной версии нужен личный случайный TRAINING_ACCESS_CODE длиной не менее 32 символов.');
  const credentialsDirectory = process.env.TRAINING_SIWC_DIR;
  if (!credentialsDirectory || !isAbsolute(credentialsDirectory) || /[\r\n\0]/.test(credentialsDirectory)) throw new Error('Для серверной версии укажи абсолютный TRAINING_SIWC_DIR на приватном постоянном диске.');
}
