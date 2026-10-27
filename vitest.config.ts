import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/shared', 'apps/api', 'apps/worker', 'apps/web'],
    // Each test file starts an in-process Postgres (PGlite); cap parallelism to keep memory in check.
    pool: 'forks',
    poolOptions: { forks: { maxForks: 3, minForks: 1 } },
  },
});
