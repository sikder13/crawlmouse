import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// Pin this directory as the test root so discovery is CWD-independent: the
// `test:templates` script invokes vitest from apps/web (where the binary and
// the `vitest` package live), but the templates and their test live here under
// infra/, which is NOT a workspace package and has no node_modules.
//
// We export a plain config object rather than calling defineConfig() on
// purpose: this file is compiled to a temp .mjs in *this* directory and Node's
// ESM loader resolves bare imports relative to it. Since `vitest` is only
// installed under apps/web/node_modules, importing `vitest/config` from here
// would fail with ERR_MODULE_NOT_FOUND. A plain object needs no import and
// loads cleanly. Vitest accepts a default-exported config object.
const root = dirname(fileURLToPath(import.meta.url));

export default {
  test: {
    root,
    include: ['*.test.ts'],
    environment: 'node',
  },
};
