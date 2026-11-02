/**
 * The part of the map the stage shows: the whole map at scale 1, and at a larger scale a window
 * of the same shape centred on the selected page, kept inside the map. The SVG and the canvas both
 * draw through it, so a zoom shows the same pages whichever draws them.
 */
import { MAP_VIEWBOX } from '../../../../lib/v2/map-layout';

export interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const ZOOMS = [1, 1.5, 2, 3, 4, 6] as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function viewport(scale: number, centre: { x: number; y: number } | null): Viewport {
  const w = MAP_VIEWBOX.width / scale;
  const h = MAP_VIEWBOX.height / scale;
  if (scale === 1 || !centre) return { x: 0, y: 0, w: MAP_VIEWBOX.width, h: MAP_VIEWBOX.height };
  return {
    x: clamp(centre.x - w / 2, 0, MAP_VIEWBOX.width - w),
    y: clamp(centre.y - h / 2, 0, MAP_VIEWBOX.height - h),
    w,
    h,
  };
}
