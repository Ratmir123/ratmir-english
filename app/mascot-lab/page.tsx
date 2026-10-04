import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { MascotLab } from '@/components/mascot/mascot-lab';
import { isLabPalette } from '@/lib/mascot/palette-lab';

export const metadata: Metadata = { title: 'Mascot lab', robots: { index: false, follow: false } };

/** Dev-only mascot playground (?palette=a|b|c|classic compares looks; a ships). Never shipped: production builds answer 404. */
export default async function MascotLabPage({ searchParams }: { searchParams: Promise<{ palette?: string | string[] }> }) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { palette } = await searchParams;
  return <MascotLab palette={isLabPalette(palette) ? palette : 'a'} />;
}
