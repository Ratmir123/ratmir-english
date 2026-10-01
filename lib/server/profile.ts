import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Profile } from '../types';

const seedSchema = z.object({
  name: z.string().min(1).max(80), goals: z.string().min(1).max(3000),
  interests: z.array(z.string().max(80)).max(20), professionalContext: z.string().max(2000),
  relocation: z.string().max(1000), dailyMinutes: z.number().min(5).max(60),
  feedback: z.string().max(1000), audioRetentionDays: z.number().int().min(7).max(180),
  budgetUsd: z.number().min(1).max(50),
}).strict();

export function initialProfile(dataDirectory: string): Profile {
  const seed = resolve(dataDirectory, 'profile.seed.json');
  if (existsSync(seed)) {
    try { return seedSchema.parse(JSON.parse(readFileSync(seed, 'utf8'))); }
    catch { throw new Error('Личный файл profile.seed.json повреждён или содержит неподходящие настройки.'); }
  }
  // Distributable code contains no learner identity or personal circumstances.
  // An existing database always retains its own profile, independent of defaults.
  return {
    name: 'Ты', goals: 'Уверенно говорить по-английски, ясно выражать мысли и учитывать собеседника.',
    interests: [], professionalContext: '', relocation: '', dailyMinutes: 15,
    feedback: 'Подробный разбор с объяснением и собственной улучшенной попыткой.',
    audioRetentionDays: 180, budgetUsd: 50,
  };
}
