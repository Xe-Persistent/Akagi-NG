import eslintJs from '@eslint/js';
import eslintReact from '@eslint-react/eslint-plugin';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/build/**',
      '**/target/**',
      '**/*.tsbuildinfo',
      'coverage/**',
      'tmp/**',
      'packages/rust_engine/native/index.js',
      'packages/rust_engine/native/index.d.ts',
    ],
  },

  // ─── Base rules, every TS/JS file ───
  eslintJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',

      // `_`-prefixed names may stay unused.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],

      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'warn',
      // `preload.cts` is CommonJS and must load Electron with `require`; the
      // typed spelling is `import x = require(...)`. Everywhere else
      // `verbatimModuleSyntax` already rejects that syntax.
      '@typescript-eslint/no-require-imports': ['error', { allowAsImport: true }],
    },
  },

  // ─── Electron and scripts (Node) ───
  {
    files: ['packages/main/**/*.{ts,js}', 'scripts/**/*.{ts,mjs,js}'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // ─── Frontend (React, browser) ───
  {
    files: ['packages/frontend/**/*.{ts,tsx}'],
    ...eslintReact.configs['recommended-typescript'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: { ...globals.browser },
      parserOptions: {
        ecmaFeatures: { jsx: true },
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // ─── Turns off what Prettier owns; must stay last ───
  prettier,
]);
