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
      'packages/rust_engine/index.js',
      'packages/rust_engine/index.d.ts',
    ],
  },

  // ─── 基础规则（所有 TS/JS 文件） ───
  eslintJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      // import 排序
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',

      // 未使用变量或参数，忽略 _ 前缀
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],

      // TypeScript 质量规则
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'warn',
    },
  },

  // ─── Electron & Scripts（Node 环境） ───
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

  // ─── Frontend（React + Browser 环境） ───
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

  // ─── Prettier 冲突规则禁用（必须放最后） ───
  prettier,
]);
