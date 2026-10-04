/**
 * Call transcript parsing shared by the server and the clients (preview before upload). Pure: no server imports.
 * Supported: Whisper "[mm:ss.xx-mm:ss.xx] text" lines, SRT / WebVTT cues, YouTube .sbv cues, "Name: text" captions
 * (Meet, Zoom, Teams exports, with optional timestamps or timestamp-only marker lines) and plain text.
 */
export type TranscriptFormat = 'whisper' | 'subtitles' | 'labeled' | 'plain';
export interface TranscriptLine { speaker: string | null; start: number | null; end: number | null; text: string }
export interface ParsedTranscript {
  format: TranscriptFormat;
  lines: TranscriptLine[];
  /** Distinct speaker labels in order of first appearance (empty when the transcript has none). */
  speakers: string[];
  /** True when every line has a start time. */
  timed: boolean;
}

export const MAX_TRANSCRIPT_LINES = 6000;
const MAX_PLAIN_LINE_CHARS = 500;
const MAX_LABELS = 10;

const TIME = String.raw`(?:\d{1,2}:)?\d{1,3}:\d{2}(?:[.,]\d{1,3})?`;
const WHISPER_LINE = new RegExp(String.raw`^\[\s*(${TIME})\s*(?:-->|->|-|–|—)\s*(${TIME})\s*\]\s*(.*)$`);
const CUE_LINE = new RegExp(String.raw`^(${TIME})\s*-->\s*(${TIME})(?:\s.*)?$`);
const SBV_LINE = new RegExp(String.raw`^(${TIME}),(${TIME})$`);
const TIME_ONLY = new RegExp(String.raw`^[\[(]?(${TIME})[\])]?$`);
const LEADING_TIME = new RegExp(String.raw`^[\[(]?(${TIME})[\])]?\s+(.*)$`);
/** "Name: text" or ">> NAME: text". The label starts with a letter, has no colon and at most five words. */
const LABEL_PREFIX = /^(?:>>\s*)?(\p{L}[\p{L}\p{N} .'’&()-]{0,39}?)\s*:\s+(\S.*)$/u;
const NOT_LABELS = new Set(['http', 'https', 'note', 'notes', 'p.s', 'ps', 'nb', 'итог', 'вывод', 'важно', 'примечание', 'upd']);

/** "mm:ss", "mm:ss.xx", "h:mm:ss,mmm" → seconds (null when malformed). */
export function parseTimestamp(value: string): number | null {
  const match = /^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (seconds >= 60 || (match[1] !== undefined && minutes >= 60)) return null;
  const fraction = match[4] ? Number('0.' + match[4]) : 0;
  return Math.round((hours * 3600 + minutes * 60 + seconds + fraction) * 1000) / 1000;
}

function clean(text: string): string {
  return text.replace(/<[^>]{1,80}>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function labelOf(line: string): { label: string; text: string } | null {
  const match = LABEL_PREFIX.exec(line.trim());
  if (!match) return null;
  const label = match[1].trim().replace(/\s+/g, ' ');
  if (!label || label.split(' ').length > 5 || NOT_LABELS.has(label.toLowerCase())) return null;
  if (parseTimestamp(label) !== null) return null;
  return { label, text: match[2].trim() };
}

function isNoise(line: string): boolean {
  return !line || /^WEBVTT\b/i.test(line) || /^(NOTE|STYLE|REGION)\b/.test(line) || /^\d{1,6}$/.test(line) || /^Kind:|^Language:/i.test(line);
}

/** Split a long untimed paragraph into sentence groups so quotes and ids stay usable. */
function splitLong(text: string): string[] {
  if (text.length <= MAX_PLAIN_LINE_CHARS) return [text];
  const sentences = text.split(/(?<=[.!?…])\s+/u);
  const parts: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    const pieces = sentence.length > MAX_PLAIN_LINE_CHARS ? hardSplit(sentence) : [sentence];
    for (const piece of pieces) {
      if (current && current.length + 1 + piece.length > MAX_PLAIN_LINE_CHARS) { parts.push(current); current = piece; }
      else current = current ? `${current} ${piece}` : piece;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function hardSplit(text: string): string[] {
  const words = text.split(' ');
  const parts: string[] = [];
  let current = '';
  for (const word of words) {
    if (current && current.length + 1 + word.length > MAX_PLAIN_LINE_CHARS) { parts.push(current); current = word; }
    else current = current ? `${current} ${word}` : word;
  }
  if (current) parts.push(current);
  return parts;
}

/** Use "Name: text" prefixes inside timed lines only when most lines carry one and there are few distinct names. */
function applyLabels(lines: TranscriptLine[]): TranscriptLine[] {
  const labelled = lines.map(line => labelOf(line.text));
  const count = labelled.filter(Boolean).length;
  const distinct = new Set(labelled.filter(Boolean).map(item => item!.label.toLowerCase()));
  if (count < 2 || count < lines.length * 0.5 || distinct.size > MAX_LABELS) return lines;
  return lines.map((line, index) => labelled[index] ? { ...line, speaker: labelled[index]!.label, text: labelled[index]!.text } : line);
}

function parseWhisper(rows: string[]): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  for (const row of rows) {
    const match = WHISPER_LINE.exec(row);
    if (match) {
      const text = clean(match[3]);
      if (text) lines.push({ speaker: null, start: parseTimestamp(match[1]), end: parseTimestamp(match[2]), text });
    } else if (!isNoise(row) && lines.length) {
      lines[lines.length - 1].text = clean(`${lines[lines.length - 1].text} ${row}`);
    }
  }
  return applyLabels(lines);
}

function parseSubtitles(rows: string[]): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  let current: { start: number | null; end: number | null; parts: string[]; voice: string | null } | null = null;
  const flush = () => {
    if (current) {
      const text = clean(current.parts.join(' ').replace(/^>>\s*/, ''));
      if (text) lines.push({ speaker: current.voice, start: current.start, end: current.end, text });
    }
    current = null;
  };
  for (const row of rows) {
    const cue = CUE_LINE.exec(row) ?? SBV_LINE.exec(row);
    if (cue) { flush(); current = { start: parseTimestamp(cue[1]), end: parseTimestamp(cue[2]), parts: [], voice: null }; continue; }
    if (!row) { flush(); continue; }
    if (!current || isNoise(row)) continue;
    const voice = /<v(?:\.[^\s>]+)?\s+([^>]{1,40})>/.exec(row);
    if (voice && !current.voice) current.voice = voice[1].trim();
    current.parts.push(row);
  }
  flush();
  return lines.some(line => line.speaker) ? lines : applyLabels(lines);
}

function parseLabeled(rows: string[]): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  let marker: number | null = null;
  for (const raw of rows) {
    if (isNoise(raw)) continue;
    const timeOnly = TIME_ONLY.exec(raw);
    if (timeOnly) { marker = parseTimestamp(timeOnly[1]); continue; }
    let row = raw;
    let start: number | null = null;
    const leading = LEADING_TIME.exec(row);
    if (leading && parseTimestamp(leading[1]) !== null) { start = parseTimestamp(leading[1]); row = leading[2]; }
    const labelled = labelOf(row);
    if (labelled) {
      lines.push({ speaker: labelled.label, start: start ?? marker, end: null, text: clean(labelled.text) });
      marker = null;
    } else if (lines.length) {
      lines[lines.length - 1].text = clean(`${lines[lines.length - 1].text} ${row}`);
    } else {
      const text = clean(row);
      if (text) lines.push({ speaker: null, start: start ?? marker, end: null, text });
      marker = null;
    }
  }
  // Caption exports give only starts: when every line has one, the next start closes the previous line.
  if (lines.length && lines.every(line => line.start !== null)) {
    for (let index = 0; index < lines.length - 1; index++) {
      const next = lines[index + 1].start!;
      if (next >= lines[index].start!) lines[index].end = next;
    }
  }
  return lines.filter(line => line.text);
}

function parsePlain(rows: string[]): TranscriptLine[] {
  return rows.filter(row => !isNoise(row)).map(clean).filter(Boolean)
    .flatMap(text => splitLong(text).map(part => ({ speaker: null, start: null, end: null, text: part })));
}

/** Parse transcript text into lines with optional speaker labels and timestamps. Never throws. */
export function parseTranscript(input: string): ParsedTranscript {
  const rows = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/\t/g, ' ').split('\n').map(row => row.trim());
  const content = rows.filter(row => !isNoise(row) && !TIME_ONLY.test(row));
  const whisper = rows.filter(row => WHISPER_LINE.test(row)).length;
  const cues = rows.filter(row => CUE_LINE.test(row) || SBV_LINE.test(row)).length;
  let format: TranscriptFormat;
  let lines: TranscriptLine[];
  if (whisper >= 2 && whisper >= content.length * 0.5) { format = 'whisper'; lines = parseWhisper(rows); }
  else if (cues >= 2) { format = 'subtitles'; lines = parseSubtitles(rows); }
  else {
    const labelled = content.map(row => labelOf(LEADING_TIME.exec(row)?.[2] ?? row)).filter(Boolean);
    const distinct = new Set(labelled.map(item => item!.label.toLowerCase()));
    if (labelled.length >= 2 && labelled.length >= content.length * 0.5 && distinct.size <= MAX_LABELS) { format = 'labeled'; lines = parseLabeled(rows); }
    else { format = 'plain'; lines = parsePlain(rows); }
  }
  for (const line of lines) {
    if (line.start !== null && line.end !== null && line.end < line.start) line.end = line.start;
  }
  const speakers: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (!line.speaker) continue;
    const key = line.speaker.toLowerCase();
    if (!seen.has(key)) { seen.add(key); speakers.push(line.speaker); }
  }
  // One spelling per speaker (captions can vary in case).
  const canonical = new Map(speakers.map(name => [name.toLowerCase(), name]));
  for (const line of lines) if (line.speaker) line.speaker = canonical.get(line.speaker.toLowerCase()) ?? line.speaker;
  return { format, lines, speakers, timed: lines.length > 0 && lines.every(line => line.start !== null) };
}
