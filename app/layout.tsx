import type { Metadata, Viewport } from 'next';
// Nunito Variable (OFL, Cyrillic) is bundled locally: no font request leaves the app.
import '@fontsource-variable/nunito/wght.css';
import './globals.css';
import { APP_NAME } from '@/lib/app-info';

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'Личный тренинг общения: разговоры, созвоны и английский',
  manifest: '/manifest.webmanifest',
  icons: { icon: [{ url: '/icon-smooth-v042-64.png', type: 'image/png', sizes: '64x64' }], apple: '/icon-smooth-v042-192.png' },
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: APP_NAME },
};

export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eeeef3' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0b10' },
  ],
  colorScheme: 'light dark',
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
