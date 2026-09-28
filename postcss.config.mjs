import path from 'node:path';

const config = {
  plugins: {
    '@tailwindcss/postcss': { optimize: false },
    [path.resolve('scripts/postcss-webview.cjs')]: {
      // NW.js 0.54.1（微信开发者工具）使用 Chromium 91。
      // Lightning CSS 的版本编码为 major << 16 | minor << 8 | patch。
      targets: { chrome: 91 << 16, safari: (16 << 16) | (4 << 8) },
    },
  },
};

export default config;
