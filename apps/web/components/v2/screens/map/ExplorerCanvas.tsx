'use client';

import { useCallback, useEffect, useRef } from 'react';
import { CANVAS_MARKER } from './canvas-marker';
import type { StageProps } from './ExplorerSvg';
import styles from './Explorer.module.css';

/** The token each kind is drawn in, as the SVG map's classes draw it (MapSvg.module.css). */
const TOKENS = {
  edge: '--v2-graph-edge',
  page: '--v2-graph-node',
  hub: '--v2-graph-hub',
  js: '--v2-graph-js',
  orphan: '--v2-graph-orphan',
  ring: '--v2-fg',
  gap: '--v2-s1',
} as const;

type Colours = Record<keyof typeof TOKENS, string>;

function coloursOf(el: Element): Colours {
  const cs = getComputedStyle(el);
  return Object.fromEntries(
    Object.entries(TOKENS).map(([k, v]) => [k, cs.getPropertyValue(v).trim()]),
  ) as Colours;
}

/**
 * The explorer's map on a canvas, for maps above EXPLORER_SVG_MAX pages, where an SVG element per
 * page would cost frames. It draws once per change (selection, filter, zoom, size or colour
 * scheme) in one animation frame. Like the SVG it is a picture for the pointer; the keyboard and
 * screen readers walk the list beside it.
 */
export default function ExplorerCanvas({ nodes, selected, highlight, view, onSelect }: StageProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef(0);

  const draw = useCallback(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
    }
    const c = coloursOf(el);
    // Fit the viewport into the canvas as `meet` does for the SVG: one scale, centred.
    const k = Math.min(w / view.w, h / view.h);
    const ox = (w - view.w * k) / 2 - view.x * k;
    const oy = (h - view.h * k) / 2 - view.y * k;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const X = (x: number) => ox + x * k;
    const Y = (y: number) => oy + y * k;
    const at = new Map(nodes.map((n) => [n.path, n]));
    ctx.lineWidth = 1;
    ctx.strokeStyle = c.edge;
    for (const dashed of [false, true]) {
      ctx.setLineDash(dashed ? [3, 3] : []);
      ctx.beginPath();
      for (const n of nodes) {
        const from = n.parent ? at.get(n.parent) : undefined;
        if (!from || n.js !== dashed) continue;
        ctx.moveTo(X(from.x), Y(from.y));
        ctx.lineTo(X(n.x), Y(n.y));
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const s = Math.max(1, k);
    for (const n of nodes) {
      ctx.globalAlpha = highlight && !highlight.has(n.path) ? 0.25 : 1;
      const x = X(n.x);
      const y = Y(n.y);
      if (n.kind === 'orphan') {
        ctx.fillStyle = c.orphan;
        ctx.fillRect(x - 4.5 * s, y - 4.5 * s, 9 * s, 9 * s);
      } else if (n.kind === 'js_only') {
        ctx.fillStyle = c.js;
        ctx.beginPath();
        ctx.moveTo(x, y - 5 * s);
        ctx.lineTo(x + 5 * s, y + 4 * s);
        ctx.lineTo(x - 5 * s, y + 4 * s);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = n.depth === 0 ? c.hub : c.page;
        ctx.beginPath();
        ctx.arc(x, y, n.r * s, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    const sel = at.get(selected);
    if (sel) {
      ctx.lineWidth = 2;
      for (const [r, colour] of [
        [13, c.ring],
        [19, c.gap],
      ] as const) {
        ctx.strokeStyle = colour;
        ctx.beginPath();
        ctx.arc(X(sel.x), Y(sel.y), r * s, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }, [nodes, selected, highlight, view]);

  const schedule = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(() => {
    schedule();
    const el = canvas.current;
    const resize = new ResizeObserver(schedule);
    if (el) resize.observe(el);
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', schedule);
    return () => {
      cancelAnimationFrame(frame.current);
      resize.disconnect();
      scheme.removeEventListener('change', schedule);
    };
  }, [schedule]);

  const pick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const el = e.currentTarget;
    const box = el.getBoundingClientRect();
    const k = Math.min(box.width / view.w, box.height / view.h);
    const ox = (box.width - view.w * k) / 2 - view.x * k;
    const oy = (box.height - view.h * k) / 2 - view.y * k;
    const mx = (e.clientX - box.left - ox) / k;
    const my = (e.clientY - box.top - oy) / k;
    let best: { path: string; d: number } | null = null;
    for (const n of nodes) {
      const d = Math.hypot(n.x - mx, n.y - my);
      if (d <= n.r + 6 / k && (!best || d < best.d)) best = { path: n.path, d };
    }
    if (best) onSelect(best.path);
  };

  return (
    <canvas
      ref={canvas}
      className={styles.canvas}
      aria-hidden="true"
      data-v2-map=""
      data-v2-renderer={CANVAS_MARKER}
      onClick={pick}
    />
  );
}
