# Spike worker image. Build context is the repository root:
#   flyctl deploy --config scripts/spike/worker/fly.toml --dockerfile scripts/spike/worker/Dockerfile --remote-only
# Only the three engine modules the worker imports are copied (safe-fetch, ssrf-guard, robots); none of them has a
# dependency beyond node: built-ins, so the image needs no package install other than the TypeScript runner.
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

RUN npm install --global --no-audit --no-fund tsx@4.22.3

COPY packages/engine/src/safe-fetch.ts packages/engine/src/ssrf-guard.ts packages/engine/src/robots.ts ./packages/engine/src/
COPY scripts/spike/worker ./scripts/spike/worker
COPY scripts/spike/fixtures ./scripts/spike/fixtures
COPY scripts/spike/harness-lib.ts scripts/spike/results.ts scripts/spike/parity-probe.ts ./scripts/spike/

# Tests, the Dockerfile and fly.toml are not needed at runtime.
RUN find scripts/spike -name '*.test.ts' -delete && rm -f scripts/spike/worker/Dockerfile scripts/spike/worker/fly.toml

USER node
EXPOSE 8080
CMD ["tsx", "scripts/spike/worker/main.ts"]
