/**
 * `server-only` for the app's tests: an empty module. The package keeps server code out of a Next
 * client bundle and is resolved by Next itself, so it is not installed where vitest can find it.
 * vitest.config.ts aliases it here, as scripts/vitest.config.ts does for the QA scripts; the Next
 * build still resolves the real package, so the guard on client bundles is unchanged.
 */
export {};
