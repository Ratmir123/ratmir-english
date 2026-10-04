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
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'microphone=(self), camera=()' },
    ] }];
  },
};
export default config;
