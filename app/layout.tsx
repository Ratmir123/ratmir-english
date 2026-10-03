import type { Metadata, Viewport } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';
const interfaceFont = Geist({ subsets: ['latin', 'cyrillic'], variable: '--font-interface', display: 'swap' });
export const metadata: Metadata = { title: 'Smooth English', description: 'Личный тренинг английского и общения', manifest: '/manifest.webmanifest', icons: { icon: [{ url: '/icon-smooth-v042-64.png', type: 'image/png', sizes: '64x64' }], apple: '/icon-smooth-v042-192.png' }, robots: { index: false, follow: false }, appleWebApp: { capable: true, statusBarStyle: 'default', title: 'English' } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#e1e1e1' };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="ru" className={interfaceFont.variable}><body>{children}</body></html>; }
