import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { MascotLab } from '@/components/mascot/mascot-lab';
import { isLabPalette } from '@/lib/mascot/palette-lab';

export const metadata: Metadata = { title: 'Mascot lab', robots: { index: false, follow: false } };

/** Dev-only mascot playground (?palette=aurora|opal|ink|pearl|graphite|classic compares looks; aurora ships). Production answers 404. */
export default async function MascotLabPage({ searchParams }: { searchParams: Promise<{ palette?: string | string[] }> }) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { palette } = await searchParams;
  return <MascotLab palette={isLabPalette(palette) ? palette : 'aurora'} />;
}
