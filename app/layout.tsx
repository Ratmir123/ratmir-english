import type { Metadata, Viewport } from 'next';
// Nunito Variable (OFL, Cyrillic) is bundled locally: no font request leaves the app.
import '@fontsource-variable/nunito/wght.css';
import './globals.css';
import { APP_NAME } from '@/lib/app-info';
import { THEME_BOOT_SCRIPT } from '@/lib/client/theme';

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'Личный тренинг общения: разговоры, созвоны и английский',
  manifest: '/manifest.webmanifest',
  // 0.5.3: the transparent chubrik (PASS-0.5.3 §7) as the favicon; the Home Screen icon stays the opaque v051 (iOS fills
  // transparency with black), like the PWA manifest.
  icons: {
    icon: [16, 32, 64, 192, 512].map((size) => ({ url: `/icon-smooth-v053-${size}.png`, type: 'image/png', sizes: `${size}x${size}` })),
    apple: '/icon-smooth-v051-192.png',
  },
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

/** `?entry=quick` (the «Запомнить» window, PASS-0.5.3 §7) is marked before the first paint, so the transparent overlay never
 *  flashes an opaque frame (components/capture/capture-overlay.module.css); a plain browser gets the opaque panel at once. */
const QUICK_ENTRY_SCRIPT = `try{if(/[?&]entry=quick(&|$)/.test(location.search)){var r=document.documentElement;r.dataset.entry='quick';if(!window.ratmirDesktop)r.dataset.quickStyle='panel'}}catch(e){}`;

/** The UI display face (Cyrillic + Latin files) starts downloading as soon as the stylesheets are parsed — an inline script
 *  in <head> runs after them — in parallel with the app's scripts; the launch preloader awaits the same load before the
 *  greeting (PASS-0.5.3 §6). Same face and sample as UI_FONT / UI_FONT_SAMPLE in components/app/preload-assets.ts. */
const FONT_BOOT_SCRIPT = `try{document.fonts&&document.fonts.load('800 1em "Nunito Variable"','Привет, Smooth Talk')}catch(e){}`;

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The boot script sets data-theme before hydration, hence the warning suppression on <html> only.
  return <html lang="ru" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} /><script dangerouslySetInnerHTML={{ __html: QUICK_ENTRY_SCRIPT }} /><script dangerouslySetInnerHTML={{ __html: FONT_BOOT_SCRIPT }} /></head><body>{children}</body></html>;
}
