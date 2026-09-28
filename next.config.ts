import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  devIndicators: false,
  serverExternalPackages: ['ali-oss'],
  async rewrites() {
    return {
      // Resolve even old saved image paths through the database before public files.
      beforeFiles: [
        { source: '/cards/:path*', destination: '/api/assets/cards/:path*' },
        { source: '/avatars/default.svg', destination: '/api/assets/avatars/default.svg' },
        { source: '/textures/:path*', destination: '/api/assets/textures/:path*' },
        { source: '/favicon.ico', destination: '/api/assets/favicon.ico' },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  outputFileTracingIncludes: {
    '/api/**': ['./model.config.json'],
  },
};

export default nextConfig;
