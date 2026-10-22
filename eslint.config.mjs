import eslintJs from '@eslint/js';
import eslintReact from '@eslint-react/eslint-plugin';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Node-side sources: the Electron app, the helper scripts and the two configs
 * at the root. The `.mjs` ones are not part of any program the type checker
 * builds, so they get globals but no typed rules.
 */
const NODE_FILES = [
  'packages/main/**/*.{ts,cts,mts,js,cjs,mjs}',
  'scripts/**/*.{ts,mts,mjs}',
  'vitest.config.ts',
  'eslint.config.mjs',
];
/** The subset of `NODE_FILES` a tsconfig covers, i.e. where types exist. */
const TYPED_NODE_FILES = [
  'packages/main/**/*.{ts,cts,mts}',
  'scripts/**/*.{ts,mts}',
  // The root project only exists to give these two a program of their own.
  'vitest.config.ts',
];
/** Renderer sources, all of which the frontend tsconfig covers. */
const REACT_FILES = ['packages/frontend/**/*.{ts,tsx}'];

/** The rules that need a type checker. They only work where one is wired up. */
const typeChecked = tseslint.configs.recommendedTypeChecked.find(
  (config) => config.name === 'typescript-eslint/recommended-type-checked',
);
const typeCheckedRules = typeChecked?.rules ?? {};

const reactConfig = eslintReact.configs['recommended-typescript'];

export default defineConfig([
  globalIgnores([
    '**/dist/**',
    '**/node_modules/**',
    '**/build/**',
    '**/target/**',
    '**/*.tsbuildinfo',
    'coverage/**',
    'tmp/**',
    'packages/rust_engine/native/index.js',
    'packages/rust_engine/native/index.d.ts',
  ]),

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
      // `verbatimModuleSyntax` keeps every import it is handed, so a type that
      // is not spelled `import type` stays a real runtime import.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'separate-type-imports' },
      ],
      // `preload.cts` is CommonJS and must load Electron with `require`; the
      // typed spelling is `import x = require(...)`. Everywhere else
      // `verbatimModuleSyntax` already rejects that syntax.
      '@typescript-eslint/no-require-imports': ['error', { allowAsImport: true }],
    },
  },

  // ─── Node-side globals, typed or not ───
  {
    files: NODE_FILES,
    languageOptions: {
      ecmaVersion: 'latest',
      globals: { ...globals.node },
    },
  },

  // ─── Type checker, for the Node files a tsconfig actually covers ───
  {
    files: TYPED_NODE_FILES,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: typeCheckedRules,
  },

  // ─── Frontend (React, browser), type-aware ───
  {
    files: REACT_FILES,
    ...reactConfig,
    languageOptions: {
      ...reactConfig.languageOptions,
      ecmaVersion: 'latest',
      globals: { ...globals.browser },
      parserOptions: {
        ...reactConfig.languageOptions?.parserOptions,
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: { ...reactConfig.rules, ...typeCheckedRules },
  },

  // ─── Tests build partial fixtures: an `async` stub with nothing to await, a
  // method asserted without being called, a decoded JSON blob read field by
  // field. These rules only report the shape of the fixture, not a bug. ───
  {
    files: ['**/test/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },

  // ─── Turns off what Prettier owns; must stay last ───
  prettier,
]);
