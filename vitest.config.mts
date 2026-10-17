import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
const dir = import.meta.dirname;

export default defineConfig({
  test: {
    // The node:test suites (*.test.mts, from Archive Redirect and Hotlink
    // Media) run under `node --test`; see the test script.
    include: ['tests/**/*.test.ts'],
    // The annotation store is worth testing but imports `obsidian`, which only
    // exists inside the app. Point it at a stub with just the surface it touches.
    alias: {
      obsidian: resolve(dir, 'tests/attention/stubs/obsidian.ts'),
    },
  },
});
