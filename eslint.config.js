// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Non-deterministic or engine-dependent APIs banned in pure packages (ARCHITECTURE §4.2, ADR 0001). */
const determinismBans = {
  'no-restricted-properties': [
    'error',
    ...['random'].map((property) => ({
      object: 'Math',
      property,
      message: 'Use the seeded PRNG from @gamex/engine; results must be reproducible from a seed.',
    })),
    ...[
      'exp',
      'expm1',
      'log',
      'log1p',
      'log2',
      'log10',
      'pow',
      'sin',
      'cos',
      'tan',
      'atan',
      'atan2',
      'sinh',
      'cosh',
      'tanh',
      'cbrt',
      'hypot',
    ].map((property) => ({
      object: 'Math',
      property,
      message:
        'Math.' +
        property +
        ' is implementation-approximated and may differ across JS engines. Use the deterministic math module.',
    })),
    {
      object: 'Date',
      property: 'now',
      message: 'Pure packages must not read the clock; take time as an input.',
    },
    {
      object: 'performance',
      property: 'now',
      message: 'Pure packages must not read the clock; take time as an input.',
    },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: "NewExpression[callee.name='Date'][arguments.length=0]",
      message: 'Pure packages must not read the clock; take time as an input.',
    },
    {
      selector: "BinaryExpression[operator='**']",
      message: 'Use exact integer powering from the deterministic math module instead of **.',
    },
  ],
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          group: ['node:*', 'fs', 'path', 'os', 'child_process'],
          message: 'Pure packages (model, engine) must not do I/O.',
        },
      ],
    },
  ],
  'no-restricted-globals': [
    'error',
    { name: 'process', message: 'Pure packages must not read process state.' },
  ],
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/node_modules/**',
      'fixtures/swarm-rescue/sample-repo/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    files: ['packages/model/src/**/*.ts', 'packages/engine/src/**/*.ts'],
    rules: determinismBans,
  },
  {
    files: ['apps/studio/src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['**/*.js', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
);
