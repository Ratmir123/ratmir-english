import { z } from 'zod';
import type { Support } from '../types';

export const messageInputSchema = z.object({
  id: z.string().uuid(), text: z.string().trim().min(1).max(7000), source: z.enum(['text', 'audio']),
  audioFile: z.string().max(100).optional(), textVisible: z.boolean().default(false),
  originalTranscript: z.string().max(7000).optional(),
});
export const retryInputSchema = z.object({
  id: z.string().uuid().optional(), text: z.string().trim().min(1).max(7000), audioFile: z.string().max(100).optional(),
  originalTranscript: z.string().max(7000).optional(),
});

/** Preserve ASR, but never equate a manually revised transcript with an unaided spoken attempt. */
export function transcriptIntegrity(text: string, originalTranscript: string | undefined, source: 'text' | 'audio', support: Support = 0): {
  originalTranscript?: string; transcriptEdited?: boolean; support: Support;
} {
  if (source !== 'audio' || originalTranscript === undefined) return { support };
  const transcriptEdited = originalTranscript.trim() !== text.trim();
  return { originalTranscript, transcriptEdited, support: transcriptEdited ? Math.max(1, support) as Support : support };
}
