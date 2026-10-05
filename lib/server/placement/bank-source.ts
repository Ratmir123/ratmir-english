import { LISTENING_CASTS, PLACEMENT_ITEMS, type ListeningCast } from '../../placement/bank';
import { ROLEPLAY_MOVES, ROLEPLAY_SCRIPTS, SPEAKING_PROMPTS } from '../../placement/prompts';
import type { PlacementItem, PlacementRoleplayScript, PlacementSpeakingPrompt } from '../../placement/types';
import type { StrategyMoveId } from '../../strategy-moves';

export interface PlacementBank {
  items: readonly PlacementItem[];
  prompts: readonly PlacementSpeakingPrompt[];
  scripts: readonly PlacementRoleplayScript[];
  /** Voice casting per listening clip (groupId); voices[1] reads speaker B of a dialogue. */
  casts?: Readonly<Record<string, ListeningCast>>;
  /** Strategy moves each roleplay line gives an opportunity for; moves outside a script are scored N/A. */
  roleplayMoves?: Readonly<Record<string, StrategyMoveId[][]>>;
}

const defaultBank: PlacementBank = { items: PLACEMENT_ITEMS, prompts: SPEAKING_PROMPTS, scripts: ROLEPLAY_SCRIPTS,
  casts: LISTENING_CASTS, roleplayMoves: ROLEPLAY_MOVES };

const globals = globalThis as typeof globalThis & { trainingPlacementBank?: PlacementBank };

/** The server-side item bank (answer keys never leave the server before an answer). */
export function placementBank(): PlacementBank { return globals.trainingPlacementBank ?? defaultBank; }

/** Test hook: replace the bank with a fixture, or pass null to restore the shipped bank. */
export function setPlacementBank(bank: PlacementBank | null): void { globals.trainingPlacementBank = bank ?? undefined; }

export function bankItem(bank: PlacementBank, id: string): PlacementItem | undefined { return bank.items.find(item => item.id === id); }
export function bankPrompt(bank: PlacementBank, id: string): PlacementSpeakingPrompt | undefined { return bank.prompts.find(prompt => prompt.id === id); }
export function bankScript(bank: PlacementBank, id: string): PlacementRoleplayScript | undefined { return bank.scripts.find(script => script.id === id); }

/** Moves the chosen script gives an opportunity for (all eight when the bank does not say). */
export function scriptMoveOpportunities(bank: PlacementBank, scriptId: string): Set<StrategyMoveId> | null {
  const lines = bank.roleplayMoves?.[scriptId];
  return lines ? new Set(lines.flat()) : null;
}
