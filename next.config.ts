import type { NextConfig } from 'next';

const config: NextConfig = {
  // Parallel local previews can isolate their build output (e.g. NEXT_DIST_DIR=.next-preview-a).
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  poweredByHeader: false,
  devIndicators: false,
  agentRules: false,
  serverExternalPackages: ['@echogarden/fvad-wasm'],
  outputFileTracingExcludes: { '*': ['./.data/**', './.runtime/**', './.env*'] },
  async headers() {
    // Art and icons under versioned paths never change in place (a new look gets a new folder or file name), so the
    // browser keeps them for a year instead of revalidating every medal on each launch (PASS-0.5.3 §6). Next serves
    // public/ with max-age=0 otherwise. Production only: in development regenerated art must show at once.
    const immutable = [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }];
    const versioned = process.env.NODE_ENV === 'production'
      ? ['/rewards-v041/:path*', '/situations-v1/:path*', '/icon-smooth-v051:suffix(.*)', '/icon-smooth-v053:suffix(.*)']
        .map(source => ({ source, headers: immutable }))
      : [];
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'microphone=(self), camera=()' },
    ] }, ...versioned];
  },
};
export default config;
