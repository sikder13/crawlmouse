# Crawlmouse

Free, no-install, share-driven internal-linking grader for any website. **Live at
[crawlmouse.com](https://crawlmouse.com).**

- **📖 Full product + technical overview (read this first): [`PROJECT_OVERVIEW.md`](./PROJECT_OVERVIEW.md)**
- **Spec:** `docs/superpowers/specs/2026-05-24-crawlmouse-v1.0-design.md`
- **Deploy runbook:** `docs/deploy/launch-runbook.md`

## Quickstart

```bash
nvm use 22          # system default is Node 20
pnpm install
pnpm test
pnpm smoke -- --url=https://example.com
```

See [`PROJECT_OVERVIEW.md`](./PROJECT_OVERVIEW.md) for the complete picture (architecture, services, the build
journey, hard-won prod lessons, current state, and roadmap).
