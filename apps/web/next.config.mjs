/** @type {import('next').NextConfig} */
export default {
  experimental: {
    instrumentationHook: true,
    typedRoutes: true,
  },
  transpilePackages: ['@crawlmouse/engine', '@crawlmouse/types'],
};
