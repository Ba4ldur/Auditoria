import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  experimental: {
    // Parsers handle large SPED/ZIP payloads; keep the server action body
    // limit aligned with the upload cap enforced in src/lib/uploads.
    serverActions: { bodySizeLimit: '64mb' },
  },
};

export default nextConfig;
