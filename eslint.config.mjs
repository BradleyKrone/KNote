// Flat ESLint config: typescript-eslint recommended everywhere, React hooks
// rules in the webviews, and eslint-config-prettier last so formatting is
// Prettier's job alone.

import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist/', 'out/', 'release/', 'node_modules/', 'test-vault/', '*.config.*', '*.mjs'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // `catch {}` + intentionally-unused args are idiomatic in this codebase
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrors: 'none' }
      ]
    }
  },
  {
    files: ['src/webviews/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    // Just the two classic rules. The plugin's newer compiler-era rules
    // (refs-in-render, set-state-in-effect) flag patterns this codebase
    // uses deliberately (latest-value refs, reset-on-open effects).
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },
  prettier
)
