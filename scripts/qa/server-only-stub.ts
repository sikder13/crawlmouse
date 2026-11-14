/**
 * `server-only` for the QA scripts: an empty module. The package keeps server code out of a Next
 * client bundle and is resolved by Next itself, so it is not installed where a plain Node process
 * can find it. The scripts are not a bundle; `--billing` takes the app's Stripe client and catalog
 * (`stripe-account.ts`, `stripe-catalog.ts`), which import it. Resolved here by
 * ./server-only-hook.mjs (the CLI) and by vitest.config.ts's alias (the tests), and nowhere else.
 */
export {};
