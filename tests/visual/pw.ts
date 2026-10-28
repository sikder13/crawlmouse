// pnpm installs @playwright/test for apps/web only, so this directory cannot resolve it by name.
// Importing it through apps/web gives the same single install the CLI runs from.
export * from '../../apps/web/node_modules/@playwright/test/index.mjs';
