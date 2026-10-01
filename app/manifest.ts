import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return { id: '/', name: 'Ratmir English', short_name: 'English', description: 'Личный тренинг английского и общения', start_url: '/?entry=startup', scope: '/', display: 'standalone', background_color: '#e1e1e1', theme_color: '#e1e1e1', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }, { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }] };
}
