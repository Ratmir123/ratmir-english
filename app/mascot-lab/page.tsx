import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { MascotIcon, isIconVariant } from '@/components/mascot/mascot-icon';
import { MascotLab } from '@/components/mascot/mascot-lab';
import { MASCOT_EMOTIONS, type MascotEmotion } from '@/lib/mascot/emotions';
import { isLabPalette } from '@/lib/mascot/palette-lab';

export const metadata: Metadata = { title: 'Mascot lab', robots: { index: false, follow: false } };

type Params = { palette?: string | string[]; icon?: string | string[]; t?: string | string[]; emotion?: string | string[] };

/**
 * Dev-only mascot playground (?palette=aurora|opal|ink|pearl|graphite|classic compares looks; aurora ships).
 * ?icon=pearl|graphite|aurora-glow&t=<flow seconds>&emotion=<emotion> renders a 1024 px app-icon candidate.
 * Production answers 404.
 */
export default async function MascotLabPage({ searchParams }: { searchParams: Promise<Params> }) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { palette, icon, t, emotion } = await searchParams;
  if (isIconVariant(icon)) {
    const time = Number(typeof t === 'string' ? t : 0);
    const pose = MASCOT_EMOTIONS.includes(emotion as MascotEmotion) ? emotion as MascotEmotion : 'calm';
    return <MascotIcon variant={icon} time={Number.isFinite(time) ? time : 0} emotion={pose} />;
  }
  return <MascotLab palette={isLabPalette(palette) ? palette : 'aurora'} />;
}
