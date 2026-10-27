import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'worker',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 60000,
    env: { EMAIL_MODE: 'dry_run', NODE_ENV: 'test' },
  },
});
