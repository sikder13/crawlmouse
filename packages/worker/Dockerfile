# The crawl worker image. It holds two files, dist/main.mjs and dist/reader.mjs, the bundles built by
# `pnpm --filter @crawlmouse/worker build`, which carries every dependency inside it.
# Build context: packages/worker (see .dockerignore). Deployed by .github/workflows/worker-staging.yml.
FROM node:22.23.4-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da

ENV NODE_ENV=production
WORKDIR /app
COPY dist/main.mjs ./main.mjs
COPY dist/reader.mjs ./reader.mjs

USER node
EXPOSE 8080
CMD ["node", "main.mjs"]
