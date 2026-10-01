import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/worker.ts', 'src/db/migrate-cli.ts', 'src/db/seed-admin-cli.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // .mjs: o package.json gerado pelo `pnpm deploy` não preserva "type": "module".
  outExtension: () => ({ js: '.mjs' }),
  // O pacote compartilhado é TypeScript puro do workspace: embutido no bundle.
  noExternal: ['@aimos/shared'],
});
