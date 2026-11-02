/**
 * Set on the canvas the explorer draws large maps on. Only ExplorerCanvas.tsx imports it, so the
 * string ships in that lazily loaded chunk alone: the production test (tests/visual/production.spec.ts)
 * looks for it in the scripts each preview loads, to prove the canvas code stays off every page
 * that does not draw a large map.
 */
export const CANVAS_MARKER = 'v2-explorer-canvas-2d';
