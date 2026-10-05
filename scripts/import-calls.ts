import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { CallContext, CreateCallRequest } from '../lib/calls/types';
import { MAX_DEBRIEF_BYTES, MAX_NOTES_CHARS, MAX_TRANSCRIPT_BYTES, createCall } from '../lib/server/calls/service';
import { processCallQueue } from '../lib/server/calls/pipeline';
import { readCall } from '../lib/server/calls/repository';
import { connection } from '../lib/server/db';
import { getAppState } from '../lib/server/store';

/**
 * Import a real call into the trainer from the command line (locally or inside the server container), then wait for
 * the review. Uses the same internal functions as POST /api/calls and the same leased job queue, so it is safe while
 * the server is running. Prints status lines only: never transcript, debrief or review content.
 */
export const IMPORT_HELP = [
  'Импорт созвона в тренажёр (созвон обрабатывается так же, как при загрузке в приложении).',
  '  node node_modules/tsx/dist/cli.mjs scripts/import-calls.ts --debrief FILE.md [опции]',
  '  node node_modules/tsx/dist/cli.mjs scripts/import-calls.ts --transcript FILE.txt [--reference DEBRIEF.md] [--notes NOTES.md] [опции]',
  '  node node_modules/tsx/dist/cli.mjs scripts/import-calls.ts --memory FILE.txt [опции]',
  'Опции: --title "Название" --date ГГГГ-ММ-ДД --counterpart "Имя, компания" --context work|life|relocation|other',
  '       --no-wait (только поставить в очередь) --timeout-minutes 30',
  '--debrief: готовый письменный разбор (Markdown). --transcript: расшифровка (Whisper, «Имя: текст», .vtt/.srt/.sbv).',
  '--reference: ручной разбор этого же созвона для сверки. --notes: цель или заметки к звонку.',
].join('\n');

export interface ImportOptions {
  kind: 'debrief' | 'transcript' | 'memory';
  file: string;
  reference: string | null;
  notes: string | null;
  title: string | null;
  date: string | null;
  counterpart: string | null;
  context: CallContext;
  wait: boolean;
  timeoutMinutes: number;
}

export class ImportArgsError extends Error {
  constructor(message: string) { super(message); this.name = 'ImportArgsError'; }
}

const VALUE_OPTIONS = ['--debrief', '--transcript', '--memory', '--reference', '--reference-debrief', '--notes', '--title', '--date',
  '--counterpart', '--context', '--timeout-minutes'];
const CONTEXTS: CallContext[] = ['work', 'life', 'relocation', 'other'];

export function parseImportArgs(args: string[]): ImportOptions | 'help' {
  if (!args.length || (args.length === 1 && (args[0] === '--help' || args[0] === '-h'))) return 'help';
  const values = new Map<string, string>();
  let wait = true;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--no-wait') {
      if (!wait) throw new ImportArgsError('Параметр --no-wait указан дважды.');
      wait = false;
      continue;
    }
    if (!VALUE_OPTIONS.includes(arg)) throw new ImportArgsError(`Неизвестный параметр: ${arg.slice(0, 40)}`);
    const key = arg === '--reference-debrief' ? '--reference' : arg;
    if (values.has(key)) throw new ImportArgsError(`Параметр ${arg} указан дважды.`);
    const value = args[++index];
    if (value === undefined || value.startsWith('--') || !value.trim()) throw new ImportArgsError(`Для ${arg} нужно значение.`);
    values.set(key, value);
  }
  const sources = (['--debrief', '--transcript', '--memory'] as const).filter(key => values.has(key));
  if (sources.length !== 1) throw new ImportArgsError('Укажи ровно один источник: --debrief, --transcript или --memory.');
  const kind = sources[0].slice(2) as ImportOptions['kind'];
  if (values.has('--reference') && kind !== 'transcript') throw new ImportArgsError('--reference используется только с --transcript.');
  const date = values.get('--date') ?? null;
  if (date !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`))
    || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date)) {
    throw new ImportArgsError('Дата должна быть в формате ГГГГ-ММ-ДД.');
  }
  const context = (values.get('--context') ?? 'work') as CallContext;
  if (!CONTEXTS.includes(context)) throw new ImportArgsError('--context: work, life, relocation или other.');
  const timeout = values.get('--timeout-minutes') ?? '30';
  if (!/^\d{1,3}$/.test(timeout) || Number(timeout) < 1 || Number(timeout) > 240) throw new ImportArgsError('--timeout-minutes: целое число от 1 до 240.');
  for (const key of ['--title', '--counterpart']) {
    if ((values.get(key)?.length ?? 0) > 160) throw new ImportArgsError(`${key}: не длиннее 160 символов.`);
  }
  return { kind, file: values.get(`--${kind}`)!, reference: values.get('--reference') ?? null, notes: values.get('--notes') ?? null,
    title: values.get('--title') ?? null, date, counterpart: values.get('--counterpart') ?? null, context, wait, timeoutMinutes: Number(timeout) };
}

export function readImportText(path: string, maxBytes: number): string {
  const absolute = resolve(path);
  const label = basename(absolute);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) throw new ImportArgsError(`Файл не найден: ${label}.`);
  if (statSync(absolute).size > maxBytes) throw new ImportArgsError(`Файл ${label} больше ${Math.round(maxBytes / 1000)} КБ.`);
  const text = readFileSync(absolute, 'utf8');
  if (text.includes('\u0000') || !text.trim()) throw new ImportArgsError(`Файл ${label} пустой или не похож на текст.`);
  return text;
}

const STATUS: Record<string, string> = {
  'awaiting-upload': 'ждёт загрузки', queued: 'в очереди', processing: 'обработка', 'needs-speaker': 'нужно отметить свой голос',
  analysing: 'разбор', ready: 'готово', error: 'ошибка',
};

export async function runImport(args: string[], output: (line: string) => void = line => console.log(line),
  options: { pollMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> } = {}): Promise<number> {
  let parsed: ImportOptions | 'help';
  let request: CreateCallRequest;
  try {
    parsed = parseImportArgs(args);
    if (parsed === 'help') { output(IMPORT_HELP); return 0; }
    const text = readImportText(parsed.file, parsed.kind === 'transcript' ? MAX_TRANSCRIPT_BYTES : MAX_DEBRIEF_BYTES);
    const reference = parsed.reference ? readImportText(parsed.reference, MAX_DEBRIEF_BYTES) : undefined;
    const notes = parsed.notes ? readImportText(parsed.notes, MAX_NOTES_CHARS * 4) : undefined;
    if (notes && notes.length > MAX_NOTES_CHARS) throw new ImportArgsError(`Заметки длиннее ${MAX_NOTES_CHARS} символов.`);
    request = { title: parsed.title ?? undefined, counterpart: parsed.counterpart ?? undefined, context: parsed.context,
      occurredAt: parsed.date ?? undefined, notes,
      source: parsed.kind === 'transcript' ? { type: 'transcript', fileName: basename(parsed.file), text, referenceDebrief: reference }
        : { type: parsed.kind, text } };
  } catch (error) {
    output(error instanceof Error ? error.message : 'Некорректные параметры.');
    output('Справка: --help');
    return 2;
  }
  let id: string;
  try {
    const record = createCall(request, getAppState().profile.name);
    id = record.id;
    output(`Созвон создан: ${id} (${STATUS[record.status] ?? record.status})`);
    if (record.status === 'needs-speaker') { output('Отметь, какой голос твой, в приложении: раздел «Созвоны».'); return 0; }
  } catch (error) {
    output(`Не удалось создать созвон: ${error instanceof Error ? error.message : 'ошибка'}`);
    return 1;
  }
  if (!parsed.wait) { output('Поставлен в очередь: сервер обработает его сам.'); return 0; }
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const deadline = now() + parsed.timeoutMinutes * 60_000;
  let last = '';
  for (;;) {
    await processCallQueue();
    const current = readCall(connection().db, id);
    if (!current) { output('Созвон удалён во время обработки.'); return 1; }
    const line = `${STATUS[current.status] ?? current.status}${current.progress ? ` · ${current.progress.stage} · ${current.progress.percent}%` : ''}`;
    if (line !== last) { output(`[${new Date(now()).toISOString().slice(11, 19)}] ${line}`); last = line; }
    if (current.status === 'ready') {
      const review = current.review!;
      output(`Готово: ${review.costs.length} дорогих моментов, ${review.patterns.filter(item => item.status !== 'no-opportunity').length} паттернов, `
        + `отброшено проверкой: ${review.dropped}.`);
      return 0;
    }
    if (current.status === 'error') { output(`Ошибка: ${current.error ?? 'не удалось обработать созвон'}`); return 1; }
    if (current.status === 'needs-speaker') { output('Отметь, какой голос твой, в приложении: раздел «Созвоны».'); return 0; }
    if (now() > deadline) { output('Время ожидания вышло. Обработка продолжится на сервере.'); return 1; }
    await sleep(options.pollMs ?? 2000);
  }
}

if (process.argv[1] && basename(process.argv[1]) === 'import-calls.ts') {
  // Exit explicitly: a local Codex bridge child process would otherwise keep the CLI alive.
  void runImport(process.argv.slice(2)).then(code => process.exit(code), () => {
    console.error('Импорт прервался. Проверь параметры и повтори.');
    process.exit(1);
  });
}
