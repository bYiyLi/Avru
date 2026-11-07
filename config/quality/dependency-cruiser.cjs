/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-unresolved',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    ...['cli', 'daemon', 'web', 'extension'].map((app) => ({
      name: `${app}-does-not-import-other-apps`,
      severity: 'error',
      from: { path: `^apps/${app}/` },
      to: { path: '^apps/', pathNot: `^apps/${app}/` },
    })),
    {
      name: 'protocol-is-independent',
      severity: 'error',
      from: { path: '^packages/protocol/' },
      to: { path: '^(apps/|packages/runner/)' },
    },
    {
      name: 'runner-does-not-import-apps',
      severity: 'error',
      from: { path: '^packages/runner/' },
      to: { path: '^apps/' },
    },
    {
      name: 'ui-does-not-import-runner',
      severity: 'error',
      from: { path: '^apps/(web|extension)/' },
      to: { path: '^packages/runner/' },
    },
    {
      name: 'no-test-imports-in-production',
      severity: 'error',
      from: {
        path: '^(apps|packages)/',
        pathNot: '(/tests/|\\.(test|spec)\\.)',
      },
      to: { path: '(/tests/|\\.(test|spec)\\.)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: '(^|/)(node_modules|dist|\\.wxt|\\.output)/',
    },
    enhancedResolveOptions: {
      conditionNames: ['import', 'node', 'default', 'types'],
      exportsFields: ['exports'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'],
    },
    tsConfig: { fileName: 'tsconfig.quality.json' },
    tsPreCompilationDeps: 'specify',
  },
};
