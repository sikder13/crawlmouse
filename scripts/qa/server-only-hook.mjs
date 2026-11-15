// Resolves `server-only` to ./server-only-stub.ts for the QA CLI's process (see that file). Loaded by
// `tsx --import ./qa/server-only-hook.mjs qa/cli.ts`; every other specifier resolves as before.
import { register } from 'node:module';

const stub = new URL('./server-only-stub.ts', import.meta.url).href;
const hooks = `
export async function resolve(specifier, context, next) {
  if (specifier === 'server-only') return { url: ${JSON.stringify(stub)}, shortCircuit: true };
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);
