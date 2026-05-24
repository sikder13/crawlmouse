/** @type {import('next').NextConfig} */
export default {
  experimental: {
    instrumentationHook: true,
    typedRoutes: true,
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
