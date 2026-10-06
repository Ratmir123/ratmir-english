'use client';

import { useState } from 'react';
import { scenarioArtworkPath } from '@/lib/scenario-artwork';
import { CatalogIcon } from './catalog-icons';

/** Decorative artwork: the adjacent scenario title supplies the accessible name. */
export function ScenarioArtwork({ familyId, fallback }: { familyId: string; fallback: string }) {
  const source = scenarioArtworkPath(familyId);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  if (!source || failedSource === source) return <CatalogIcon name={fallback} size={24} />;
  // These small, already downsampled PNGs are also bundled verbatim on iPhone.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={source} alt="" width={44} height={44} loading="lazy" decoding="async" draggable={false}
    onError={() => setFailedSource(source)} />;
}
