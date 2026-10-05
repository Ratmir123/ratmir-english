import type { MetadataRoute } from 'next';
import { APP_NAME } from '@/lib/app-info';

// The desktop shell's readiness check accepts this name (desktop/runtime.cjs APP_MANIFEST_NAMES).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/', name: APP_NAME, short_name: APP_NAME, description: 'Личный тренинг общения: разговоры, созвоны и английский',
    start_url: '/?entry=startup', scope: '/', display: 'standalone', background_color: '#eeeef3', theme_color: '#eeeef3',
    icons: [
      { src: '/icon-smooth-v051-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-smooth-v051-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
