import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ['miniprogram/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { App: 'readonly', Page: 'readonly', wx: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Utility scripts (Node CommonJS)
    'scripts/**',
  ]),
]);

export default eslintConfig;
