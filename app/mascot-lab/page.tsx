import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { MascotLab } from '@/components/mascot/mascot-lab';

export const metadata: Metadata = { title: 'Mascot lab', robots: { index: false, follow: false } };

/** Dev-only mascot playground. Never shipped: production builds answer 404. */
export default function MascotLabPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <MascotLab />;
}
