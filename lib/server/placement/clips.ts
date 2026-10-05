import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDirectory } from '../db';
import { locked } from '../http';
import { SUGGESTED_TTS_VOICES, scriptTurns, type ListeningVoice } from '../../placement/bank';
import { stableHash } from '../../placement/engine';
import { countWords } from '../../placement/scoring';
import type { CEFRLevel, PlacementItem, PlacementRoleplayScript } from '../../placement/types';
import { bankItem, bankScript, type PlacementBank } from './bank-source';
import type { AttemptRecord } from './model';
import type { PlacementRuntime } from './runtime';

/** Fallback voices when the bank gives no cast; a roleplay partner keeps one voice per script. */
export const PLACEMENT_VOICES = ['marin', 'cedar', 'coral', 'ash', 'sage', 'verse'] as const;
/** Listening pace bands in words per minute (audit §2.3 TTS acceptance). */
export const LISTENING_PACE: Record<CEFRLevel, { min: number; max: number; target: number }> = {
  A1: { min: 80, max: 110, target: 95 }, A2: { min: 95, max: 125, target: 110 }, B1: { min: 125, max: 150, target: 138 },
  B2: { min: 150, max: 175, target: 162 }, C1: { min: 170, max: 205, target: 188 }, C2: { min: 175, max: 215, target: 195 },
};
/** Natural silence between dialogue turns (seconds). */
const TURN_GAP_SECONDS = 0.35;

export interface ClipTurn { speaker: 'A' | 'B'; text: string; voice: string }
export interface ClipSpec {
  clipId: string; kind: 'listening' | 'roleplay'; turns: ClipTurn[]; instructions: string; overlapSeconds: number;
  pace: { min: number; max: number; target: number } | null; words: number;
}

function realVoice(voice: string): string { return SUGGESTED_TTS_VOICES[voice as ListeningVoice] ?? voice; }

export function listeningClip(item: PlacementItem, bank: PlacementBank): ClipSpec | null {
  if (!item.passage?.trim()) return null;
  const cast = item.groupId ? bank.casts?.[item.groupId] : undefined;
  const fallback = stableHash(item.groupId ?? item.id) % PLACEMENT_VOICES.length;
  const voices = cast?.voices.length ? cast.voices.map(realVoice)
    : [PLACEMENT_VOICES[fallback], PLACEMENT_VOICES[(fallback + 1) % PLACEMENT_VOICES.length]];
  const turns = scriptTurns(item.passage).map(turn => ({ ...turn, voice: turn.speaker === 'B' ? voices[1] ?? voices[0] : voices[0] }));
  const pace = item.targetWpm && Number.isFinite(item.targetWpm)
    ? { min: LISTENING_PACE[item.level].min, max: LISTENING_PACE[item.level].max, target: item.targetWpm } : LISTENING_PACE[item.level];
  const delivery = item.delivery?.trim().replace(/[.\s]+$/, '');
  const dialogue = turns.length > 1 ? ' This is one turn of a dialogue: read only this turn, in character.' : '';
  return { clipId: item.id, kind: 'listening', turns, overlapSeconds: Math.max(0, Math.min(1, cast?.overlapSeconds ?? 0)), pace,
    words: item.wordCount ?? countWords(turns.map(turn => turn.text).join(' ')),
    instructions: `Read the text aloud exactly as written: do not add, skip or change any words.${dialogue} ${delivery ? `Delivery: ${delivery}.` : 'Natural, clear delivery.'} Pace: about ${pace.target} words per minute.` };
}

export function roleplayClip(script: PlacementRoleplayScript, lineIndex: number, clipId: string): ClipSpec | null {
  const text = script.lines[lineIndex];
  if (!text?.trim()) return null;
  return { clipId, kind: 'roleplay', turns: [{ speaker: 'A', text, voice: PLACEMENT_VOICES[stableHash(script.id) % PLACEMENT_VOICES.length] }],
    overlapSeconds: 0, pace: null, words: countWords(text),
    instructions: `You are ${script.partnerRole}, speaking on a work video call. Say the line exactly as written, naturally and conversationally, at about 150 words per minute. Do not add words.` };
}

/**
 * Only the current task's clip or clips of already answered tasks of the unfinished attempt are served.
 * A listening clip is addressed by question id (or its clip/group id); a roleplay line by '<scriptId>-<lineIndex>'.
 */
export function resolveClip(attempt: AttemptRecord, bank: PlacementBank, clipId: string): ClipSpec | null {
  const visible = (taskId: string, answeredAt: string | null) => !!answeredAt || (attempt.status === 'in-progress' && attempt.current?.taskId === taskId);
  const listening = attempt.objective.find(record => record.section === 'listening' && !record.voided && visible(record.taskId, record.answeredAt)
    && (record.taskId === clipId || bankItem(bank, record.itemId)?.groupId === clipId));
  if (listening) { const item = bankItem(bank, listening.itemId); return item ? listeningClip(item, bank) : null; }
  const line = attempt.spoken.find(record => record.taskId === clipId && record.section === 'interaction' && !record.voided
    && visible(record.taskId, record.answeredAt));
  if (line?.scriptId && line.lineIndex !== null) {
    const script = bankScript(bank, line.scriptId);
    return script ? roleplayClip(script, line.lineIndex, clipId) : null;
  }
  return null;
}

export function clipDirectory(): string { return join(dataDirectory(), 'placement-audio'); }
/** Content address: voices, texts, delivery instructions and overlap (the accepted take is cached under it). */
export function clipHash(spec: Pick<ClipSpec, 'turns' | 'instructions' | 'overlapSeconds'>): string {
  return createHash('sha256').update(JSON.stringify([spec.instructions, spec.overlapSeconds, spec.turns.map(turn => [turn.voice, turn.text])])).digest('hex');
}

function temporaryFile(extension = 'mp3'): string { return join(clipDirectory(), `work-${randomUUID()}.${extension}`); }
function removeQuietly(path: string) { try { if (existsSync(path)) unlinkSync(path); } catch { /* best effort */ } }

async function seconds(bytes: Uint8Array, runtime: PlacementRuntime): Promise<number | null> {
  const probe = temporaryFile();
  try { writeFileSync(probe, bytes); const value = await runtime.clipSeconds(probe); return value && value > 0.2 ? value : null; }
  catch { return null; }
  finally { removeQuietly(probe); }
}

/** Turns are synthesized separately; a dialogue is mixed with natural gaps (and the cast's overlap) or concatenated. */
async function render(spec: ClipSpec, instructions: string, runtime: PlacementRuntime): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for (const turn of spec.turns) parts.push(await runtime.synthesizeSpeech(turn.text, { voice: turn.voice, instructions }));
  if (parts.length === 1) return parts[0];
  const files = parts.map(() => temporaryFile());
  const output = temporaryFile();
  try {
    parts.forEach((part, index) => writeFileSync(files[index], part));
    const durations: number[] = [];
    for (const file of files) { const value = await runtime.clipSeconds(file); if (value === null) throw new Error('duration unavailable'); durations.push(value); }
    const offsets: number[] = [];
    let end = 0;
    spec.turns.forEach((turn, index) => {
      const previous = spec.turns[index - 1];
      const overlap = previous && previous.speaker !== turn.speaker && turn.speaker === 'B' ? spec.overlapSeconds : 0;
      const start = index === 0 ? 0 : Math.max(0, end + (overlap ? -overlap : TURN_GAP_SECONDS));
      offsets.push(start);
      end = start + durations[index];
    });
    if (await runtime.mixClips(files, offsets, output)) return readFileSync(output);
    throw new Error('mix unavailable');
  } catch {
    // Without ffmpeg the MP3 frames are concatenated: still one playable clip, without overlap.
    return Buffer.concat(parts.map(part => Buffer.from(part)));
  } finally { for (const file of [...files, output]) removeQuietly(file); }
}

/** One corrective take when the measured pace misses the level band; the take closer to the target is kept. */
async function renderAccepted(spec: ClipSpec, runtime: PlacementRuntime): Promise<Uint8Array> {
  const first = await render(spec, spec.instructions, runtime);
  if (!spec.pace || spec.words < 8) return first;
  const firstSeconds = await seconds(first, runtime);
  const firstWpm = firstSeconds ? spec.words * 60 / firstSeconds : null;
  if (firstWpm === null || (firstWpm >= spec.pace.min && firstWpm <= spec.pace.max)) return first;
  const slow = firstWpm < spec.pace.min;
  const retry = await render(spec, `${spec.instructions} The previous take was too ${slow ? 'slow' : 'fast'}: speak noticeably ${slow ? 'faster' : 'slower'}, about ${spec.pace.target} words per minute.`, runtime);
  const retrySeconds = await seconds(retry, runtime);
  const retryWpm = retrySeconds ? spec.words * 60 / retrySeconds : null;
  return retryWpm !== null && Math.abs(retryWpm - spec.pace.target) < Math.abs(firstWpm - spec.pace.target) ? retry : first;
}

/** Content-addressed cache under <data>/placement-audio/<sha256>.mp3; synthesis is serialised per clip. */
export async function ensureClip(spec: ClipSpec, runtime: PlacementRuntime): Promise<Buffer> {
  const directory = clipDirectory();
  const file = join(directory, `${clipHash(spec)}.mp3`);
  if (existsSync(file)) return readFileSync(file);
  return locked(`placement-audio:${file}`, async () => {
    if (existsSync(file)) return readFileSync(file);
    mkdirSync(directory, { recursive: true });
    const bytes = await renderAccepted(spec, runtime);
    const temporary = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, bytes, { mode: 0o600 });
    renameSync(temporary, file);
    return Buffer.from(bytes);
  });
}
