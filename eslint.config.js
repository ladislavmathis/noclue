import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '**/dist/**',
      '**/dist-test/**',
      'release/**',
      'test-results/**',
      'playwright-report/**',
      'docs/**',
      'store/**',
      'tests/fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
        },
      ],
      // Existing effects reset UI state on dependency changes; revisit when touching those files.
      'react-hooks/set-state-in-effect': 'warn',
      'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: true }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // Serialized into the meeting page by chrome.scripting; `chrome` is the only global there.
    files: [
      'apps/extension/src/background/overlay.ts',
      'apps/extension/src/background/share-hook.ts',
    ],
    languageOptions: { globals: { ...globals.browser, chrome: 'readonly' } },
  },
);
