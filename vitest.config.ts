import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: [
      'apps/*/tests/**/*.test.{ts,tsx}',
      'packages/*/tests/**/*.test.{ts,tsx}',
    ],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: [
        'apps/*/src/**/*.{ts,tsx}',
        'apps/extension/**/*.{ts,tsx}',
        'packages/*/src/**/*.{ts,tsx}',
      ],
      exclude: [
        '**/*.d.ts',
        'apps/extension/.wxt/**',
        'apps/extension/.output/**',
        'apps/extension/node_modules/**',
        'apps/extension/tests/**',
        'apps/extension/wxt.config.ts',
        // Exact bootstrap paths only; business logic belongs in covered modules.
        'apps/cli/src/main.ts',
        'apps/cli/src/background.ts',
        'apps/daemon/src/main.ts',
        'apps/web/src/main.tsx',
      ],
      reporter: ['text', 'json-summary', 'lcov'],
      thresholds: {
        perFile: true,
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
  },
});
