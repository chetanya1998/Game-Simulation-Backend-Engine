/** Architecture rules (ARCHITECTURE §2). Run with `pnpm depcruise`. */
const pure = '^packages/(model|engine)/src';

module.exports = {
  forbidden: [
    {
      name: 'not-to-unresolvable',
      comment:
        'Every import must resolve (catches imports of workspace packages that are not declared).',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-undeclared-dependencies',
      comment: 'Packages may only import dependencies declared in their own package.json.',
      severity: 'error',
      from: {},
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'pure-core-no-node-builtins',
      comment: 'model and engine run unchanged in Node and a Web Worker: no Node built-ins.',
      severity: 'error',
      from: { path: pure },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'pure-core-no-io-or-llm-packages',
      comment:
        'model and engine must not depend on ingestion, extraction, writers, drift, the CLI, or any LLM SDK.',
      severity: 'error',
      from: { path: pure },
      to: {
        path: ['^packages/(ingest|extract|specpack|drift|cli)/', 'node_modules/@anthropic-ai/'],
      },
    },
    {
      name: 'model-is-the-root',
      comment: 'model depends on no other workspace package.',
      severity: 'error',
      from: { path: '^packages/model/src' },
      to: { path: '^packages/(?!model/)' },
    },
    {
      name: 'specpack-no-llm',
      comment: 'Spec Pack content comes from deterministic code only.',
      severity: 'error',
      from: { path: '^packages/specpack/src' },
      to: { path: ['^packages/(extract|cli)/', 'node_modules/@anthropic-ai/'] },
    },
    {
      name: 'studio-browser-safe',
      comment: 'The studio talks to I/O and LLMs only through the local `gamex studio` server.',
      severity: 'error',
      from: { path: '^apps/studio/src' },
      to: { path: ['^packages/(ingest|extract|drift|cli)/', 'node_modules/@anthropic-ai/'] },
    },
    {
      name: 'no-cli-imports',
      comment: 'Nothing depends on the CLI.',
      severity: 'error',
      from: { pathNot: '^packages/cli/' },
      to: { path: '^packages/cli/src' },
    },
  ],
  options: {
    doNotFollow: { path: ['node_modules', '/dist/'] },
    exclude: { path: ['/coverage/', 'sample-repo/'] },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'types', 'default'],
    },
  },
};
