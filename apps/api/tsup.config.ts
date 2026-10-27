import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/scripts/create-admin.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Bundle the workspace package (TypeScript source); keep npm deps external.
  noExternal: ['@wellthyfy/shared'],
  // Everything else in node_modules (including the shared package's own dependencies) stays external.
  skipNodeModulesBundle: true,
});
