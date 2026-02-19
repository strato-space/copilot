import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/*.spec.ts', '**/*.spec.tsx'],
  testIgnore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
  reporter: [['list']],
});
