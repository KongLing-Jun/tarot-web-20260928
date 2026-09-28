import { spawnSync } from 'node:child_process';

const result = spawnSync(
  process.execPath,
  [
    'node_modules/vitest/vitest.mjs',
    'run',
    'tests/database.integration.test.ts',
    'tests/payments.integration.test.ts',
    'tests/plans.integration.test.ts',
    'tests/guest-auth.integration.test.ts',
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, TAROT_DB_TEST: '1' },
  },
);
process.exitCode = result.status ?? 1;
