import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // typedRoutes graduated from `experimental` to a top-level key in Next 15.5; the app relies on it.
  typedRoutes: true,
  // PostHog reverse proxy: route /ingest/* to PostHog's US hosts so events survive ad-blockers.
  // skipTrailingSlashRedirect keeps PostHog's trailing-slash paths from 308-redirecting.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: '/ingest/static/:path*', destination: 'https://us-assets.i.posthog.com/static/:path*' },
      { source: '/ingest/array/:path*', destination: 'https://us-assets.i.posthog.com/array/:path*' },
      { source: '/ingest/:path*', destination: 'https://us.i.posthog.com/:path*' },
    ];
  },
  transpilePackages: ['@crawlmouse/engine', '@crawlmouse/types'],
  serverExternalPackages: [
    'crawlee',
    '@crawlee/basic',
    '@crawlee/cheerio',
    '@crawlee/browser',
    '@crawlee/browser-pool',
    '@crawlee/puppeteer',
    '@crawlee/playwright',
    '@crawlee/core',
    '@crawlee/http',
    'puppeteer',
    'puppeteer-core',
    'playwright',
  ],
  webpack(config) {
    // Allow webpack to resolve TypeScript source files imported with .js extensions
    // (ESM convention used by workspace packages like @crawlmouse/engine and inngest/).
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };

    // Mark heavy browser-automation packages as externals so webpack does not attempt
    // to bundle them (or their optional peer puppeteer/playwright). These are only used
    // at run-time inside the Inngest worker process, not in the Next.js server bundle.
    const browserExternals = [
      'crawlee',
      '@crawlee/basic',
      '@crawlee/cheerio',
      '@crawlee/browser',
      '@crawlee/browser-pool',
      '@crawlee/puppeteer',
      '@crawlee/playwright',
      '@crawlee/core',
      '@crawlee/http',
      'puppeteer',
      'puppeteer-core',
      'playwright',
      '@playwright/test',
    ];
    const existingExternals = config.externals ?? [];
    config.externals = [
      ...(Array.isArray(existingExternals) ? existingExternals : [existingExternals]),
      ({ request }, callback) => {
        if (browserExternals.some((pkg) => request === pkg || request?.startsWith(pkg + '/'))) {
          return callback(null, 'commonjs ' + request);
        }
        callback();
      },
    ];

    return config;
  },
};

// Wrap with withSentryConfig so the Sentry build plugin uploads source maps + creates a release
// at build time (using SENTRY_AUTH_TOKEN). Without this wrapper the runtime Sentry.init() still
// captures prod errors, but their stack traces stay minified and un-actionable. The token is only
// present in CI/Vercel builds; local builds without it skip upload gracefully (a logged warning).
// Sentry build-plugin options — exported as a named object so the guard test can assert the REAL
// resolved values (robust against source-text spellings like quoted keys or truthy non-literals,
// and against comment-blindness).
export const sentryBuildOptions = {
  org: 'nahl-technologies-inc',
  project: 'crawlmouse',
  // Source-map upload auth — env only, never a committed literal.
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Quiet during CI/Vercel builds; verbose locally so a misconfig is visible.
  silent: !process.env.CI,
  // Upload the fuller client map set for readable client-side traces.
  widenClientFileUpload: true,
  // Strip the generated .map files from the build output after upload so they are never served
  // publicly (keeps source off the CDN while Sentry still has them for symbolication).
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  // Don't phone home plugin telemetry to Sentry from our builds.
  telemetry: false,
  // Best-effort upload: a Sentry/CI hiccup or a missing/expired token must NEVER block a production
  // deploy. Log and continue instead of re-throwing; the first deploy's build log is checked to
  // confirm maps actually uploaded.
  errorHandler: (err) => {
    console.warn('[sentry] non-fatal build/sourcemap error:', err);
  },
};

export default withSentryConfig(nextConfig, sentryBuildOptions);
