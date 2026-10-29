# v2 visual harness

Playwright checks over the v2 design-system preview pages (`apps/web/app/(v2-preview)`, listed in
`_preview/registry.ts`). A screen that plays a recording is checked once at each moment the
registry lists, opened paused there (`?at=<ms>` or `?at=end`):

| File                | Checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `visual.spec.ts`    | A screenshot of each whole preview page at 1280 and 390 px, light and dark, against `__snapshots__/`, and of the footer on its own (`footer-<width>-<scheme>.png`). A diff above 0.2% of the pixels fails. The footer's year is pinned in screenshots, so a baseline does not move on 1 January.                                                                                                                                                                                                                                                                                                                      |
| `layout.spec.ts`    | No horizontal page scroll; text that sticks out of its container, or is cut off by it, by an ancestor that hides overflow, or by a clip-path; orange paint (any painted property, any opacity) on exactly one element of a screen, the primary action (rule 3); no text heavier than 600 (rule 5).                                                                                                                                                                                                                                                                                                                    |
| `a11y.spec.ts`      | axe, run twice (as rendered, then with the decorative map hidden and tables scrolled to their end): a violation at any impact fails, as does a serious or critical finding axe could not decide in either pass. Each tab stop's focus ring must be at least 2px, opaque, 3:1 against what it is drawn on and not cut off by an ancestor, light and dark. The same, over the header, with the Learn menu open. Under reduced motion nothing in any preview page carries a CSS animation, and the crawl screen, playing, starts no Web Animation and no CSS transition; a control shows it does without the preference. |
| `copy.spec.ts`      | Each rebuilt screen's visible text, rendered, against the locked HTML's at 1280 and 390 px, with whitespace collapsed rather than removed. The primary nav and the footer are left out on both sides (they changed from the lock on purpose) and checked against `apps/web/components/v2/footer-links.ts` instead.                                                                                                                                                                                                                                                                                                    |
| `parity.spec.ts`    | Each table on the two screens, against the locked HTML at the same width: a table that fits its container in the lock must fit it in the rebuild.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `shell.spec.ts`     | The Learn menu by keyboard and mouse (Enter, Tab order, Escape, a press outside), where its panel opens and how it is drawn; the footer's column layout either side of each breakpoint; a visible hover; no `#` or empty link in the header or footer.                                                                                                                                                                                                                                                                                                                                                                |
| `motion.spec.ts`    | Each crawl recording played to its end on Playwright's fake clock, with and without reduced motion: both final DOMs must equal each other and the frame the server draws at the end. Layout shift summed over whole replays at the widths and scroll positions listed in the spec, with a budget before the reveal, one for it, and one for the footer alone at it from 1024px; the same replays fail on any motion started on the map after the grades are announced. A page whose fonts arrive late must not move. Each map page's element is built once as the map grows.                                          |
| `perf.spec.ts`      | A budget over three of the crawl screen's busiest stretches, 12 seconds each in real time: no long task and no layout shift, read from a Chromium trace; frame intervals at the 95th percentile at most 17.5 ms, at most 1% over 34 ms and none over 100 ms, from an untraced pass. Its header gives the reasons and what the windows leave out. It runs only with `VISUAL_PERF=1`, alone, on one worker (its own CI step).                                                                                                                                                                                           |
| `frames.spec.ts`    | Off by default. Draws the crawl stage at moments through the bad-site replay into `frames/`, for review.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `reference.spec.ts` | Off by default. Renders the locked design HTML into `reference/` for before-and-after review.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

The preview pages return a 404 when `NODE_ENV` is `production`, so the harness starts `next dev`
itself (port 3130, or `VISUAL_PORT`). Locally it reuses a server already on that port.

## Run it

```bash
pnpm --filter @crawlmouse/web exec playwright test -c ../../tests/visual/playwright.config.ts
```

Add a file name (`layout.spec.ts`) or `-g "<test name>"` to run part of it.

## Why the baselines come from CI

Text rendering depends on the machine: the fonts installed for fallback, FreeType, and the
Chromium build. A baseline drawn on a laptop can differ from one drawn on the CI runner by more
than the 0.2% threshold, so the committed baselines are drawn by the CI job `visual`, which runs in
the Playwright image pinned by digest in `.github/workflows/ci.yml`. A run on another machine is useful for the
layout, accessibility and motion checks; its screenshot comparisons are not authoritative.

To draw baselines locally in the same environment, run the harness inside that image with Docker
(the tag and digest are in the workflow).

## Update a baseline on purpose

1. Make the change and push the branch. The `visual` job fails on each screenshot that moved.
2. The job then re-draws the screenshots and uploads an artifact named
   `visual-<run id>-<attempt>`, holding the proposed `tests/visual/__snapshots__/`, and the
   `-actual`, `-expected` and `-diff` images of each failure under `apps/web/test-results/visual/`.
3. Download it (`gh run download <run id> -n visual-<run id>-<attempt> -D /tmp/visual`), open
   each diff, and confirm that every change is one you meant.
4. Copy the accepted files from the artifact's `tests/visual/__snapshots__/` into this folder's
   `__snapshots__/`, commit them in their own commit that names what changed, and push. The job
   passes when the committed baselines match.

The comparison step in CI runs with `updateSnapshots: 'none'` (set in `playwright.config.ts` when
`CI` is set), so a missing or changed screenshot fails the job. The images the job re-draws after a
failure go into the artifact only; CI commits nothing, and a baseline changes only when someone
commits a reviewed image.

## Before-and-after renders

```bash
VISUAL_REFERENCE=1 pnpm --filter @crawlmouse/web exec playwright test -c ../../tests/visual/playwright.config.ts reference.spec.ts
```

writes `reference/<screen>-<width>-<scheme>.png` from `docs/design/v2/screens`. Those pages load
IBM Plex from Google Fonts, the typeface the brand fonts replace, so the renders show the design as
locked rather than as built.
