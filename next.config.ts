import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  serverExternalPackages: ['better-sqlite3'],
  poweredByHeader: false,
};

export default nextConfig;
