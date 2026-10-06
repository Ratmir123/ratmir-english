/** Bundled scenario artwork, shared by the web catalog and the iPhone asset catalog. */
export const SCENARIO_ARTWORK_IDS = [
  'strategy-pitch-30', 'strategy-agency-screening', 'strategy-price', 'strategy-recap-close',
  'strategy-follow-up', 'strategy-confidential', 'strategy-say-no', 'strategy-scope-creep', 'strategy-rights',
  'work-call-opening', 'work-brief-call', 'work-project', 'work-interview', 'work-revisions',
  'life-new-city', 'life-friends', 'life-debate', 'life-games', 'life-sport', 'life-group', 'life-travel',
  'relocation-arrival', 'relocation-housing', 'relocation-errands', 'relocation-interview',
  'ielts-speaking', 'ielts-listening', 'ielts-reading', 'ielts-writing',
] as const;

const knownFamilies = new Set<string>(SCENARIO_ARTWORK_IDS);

export function scenarioArtworkPath(familyId: string): string | null {
  return knownFamilies.has(familyId) ? `/situations-v1/${familyId}.png` : null;
}
