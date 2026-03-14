import js from '@eslint/js';
import ts from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

/**
 * @type {import('eslint').Linter.Config[]}
 */
export default [
  // 忽略文件
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/bundle/**',
      '**/.pnpm-store/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/.cache/**',
      '**/.worktrees/**',
      '**/.opencode/**',
      '**/.claude/**',
      '**/.my-claudia/**',
      // Tauri 生成的文件
      '**/src-tauri/target/**',
      '**/src-tauri/gen/**',
    ],
  },

  // 基础 JS/TS 规则 (适用于所有项目)
  js.configs.recommended,
  ...ts.configs.recommended,

  // 通用配置
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.es2022,
        ...globals.node,
      },
    },
    rules: {
      // 通用最佳实践
      'no-console': 'off', // 允许 console，因为是 CLI 工具
      'no-debugger': 'warn',
      'no-unused-vars': 'off', // 使用 TypeScript 的 no-unused-vars
      'prefer-const': 'warn',
      'no-var': 'error',

      // TypeScript 特定规则
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        {
          prefer: 'type-imports',
          fixStyle: 'inline-type-imports',
        },
      ],
    },
  },

  // React 项目特定配置 (desktop)
  {
    files: ['apps/desktop/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },

  // 测试文件宽松规则
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
];
