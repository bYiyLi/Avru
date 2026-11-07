import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';

const codeLimits = {
  'max-lines': [
    'error',
    { max: 500, skipBlankLines: true, skipComments: true },
  ],
  'max-lines-per-function': [
    'error',
    { max: 90, IIFEs: true, skipBlankLines: true, skipComments: true },
  ],
  'max-depth': ['error', 4],
  'max-params': ['error', 4],
  'max-statements': ['error', 40],
  'sonarjs/cognitive-complexity': ['error', 15],
};

export default tseslint.config(
  {
    ignores: [
      'artifacts/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/.wxt/**',
      '**/.output/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      '.gate-probes/**',
    ],
  },
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
    plugins: { sonarjs },
    rules: codeLimits,
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.quality.json', './apps/extension/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { sonarjs },
    rules: {
      ...codeLimits,
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/no-floating-promises': [
        'error',
        { ignoreVoid: false },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
  {
    files: ['**/*.{test,spec}.{ts,tsx}'],
    rules: {
      'max-lines-per-function': [
        'error',
        { max: 220, IIFEs: true, skipBlankLines: true, skipComments: true },
      ],
      'max-statements': ['error', 80],
    },
  },
);
