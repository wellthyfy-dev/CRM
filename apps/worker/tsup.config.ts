import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: ['@wellthyfy/shared'],
  // Everything else in node_modules (including the shared package's own dependencies) stays external.
  skipNodeModulesBundle: true,
});
