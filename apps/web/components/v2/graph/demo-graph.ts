/**
 * The example link map drawn on the locked Home stage and the Result map thumbnail: one hub, three
 * rings of pages, pages reachable only through JavaScript, and orphan pages. Extracted from
 * docs/design/v2/screens/Final-Home.dc.html; apps/web/__tests__/v2/demo-graph.test.ts re-extracts it
 * from that file and the two Result screens and fails if this data differs.
 *
 * Colours are not stored here: each role takes its colour from a --v2-graph-* token.
 */
export type GraphRole = 'hub' | 'page' | 'js' | 'orphan';

export interface GraphEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** A link that exists only after JavaScript runs. */
  js: boolean;
  /** The dash length the draw animation uses, as set in the locked screen (about the edge's length). */
  dash: number;
  /** Seconds before this edge draws, on the first view. */
  delay: number;
}

export type GraphNode =
  | { shape: 'circle'; role: GraphRole; cx: number; cy: number; r: number; delay: number }
  | { shape: 'polygon'; role: GraphRole; points: string; origin: [number, number]; delay: number }
  | {
      shape: 'rect';
      role: GraphRole;
      x: number;
      y: number;
      w: number;
      h: number;
      origin: [number, number];
      delay: number;
    };

export const DEMO_GRAPH_VIEWBOX = { width: 1160, height: 560 } as const;

export const DEMO_EDGES: GraphEdge[] = [
  { x1: 580, y1: 280, x2: 684, y2: 277, js: false, dash: 104, delay: 0.8 },
  { x1: 580, y1: 280, x2: 641, y2: 331, js: false, dash: 80, delay: 0.8 },
  { x1: 580, y1: 280, x2: 555, y2: 345, js: false, dash: 70, delay: 0.8 },
  { x1: 580, y1: 280, x2: 486, y2: 316, js: false, dash: 100, delay: 0.8 },
  { x1: 580, y1: 280, x2: 477, y2: 258, js: false, dash: 105, delay: 0.8 },
  { x1: 580, y1: 280, x2: 547, y2: 219, js: false, dash: 69, delay: 0.8 },
  { x1: 580, y1: 280, x2: 650, y2: 223, js: false, dash: 90, delay: 0.8 },
  { x1: 684, y1: 277, x2: 800, y2: 268, js: false, dash: 116, delay: 1.35 },
  { x1: 684, y1: 277, x2: 807, y2: 336, js: false, dash: 136, delay: 1.35 },
  { x1: 684, y1: 277, x2: 751, y2: 372, js: false, dash: 116, delay: 1.35 },
  { x1: 641, y1: 331, x2: 666, y2: 403, js: false, dash: 75, delay: 1.35 },
  { x1: 555, y1: 345, x2: 600, y2: 418, js: false, dash: 85, delay: 1.35 },
  { x1: 555, y1: 345, x2: 561, y2: 414, js: false, dash: 70, delay: 1.35 },
  { x1: 486, y1: 316, x2: 470, y2: 412, js: false, dash: 98, delay: 1.35 },
  { x1: 486, y1: 316, x2: 414, y2: 381, js: false, dash: 97, delay: 1.35 },
  { x1: 486, y1: 316, x2: 365, y2: 323, js: false, dash: 121, delay: 1.35 },
  { x1: 477, y1: 258, x2: 364, y2: 278, js: false, dash: 115, delay: 1.35 },
  { x1: 477, y1: 258, x2: 366, y2: 247, js: false, dash: 112, delay: 1.35 },
  { x1: 477, y1: 258, x2: 412, y2: 185, js: false, dash: 98, delay: 1.35 },
  { x1: 477, y1: 258, x2: 455, y2: 158, js: false, dash: 102, delay: 1.35 },
  { x1: 547, y1: 219, x2: 539, y2: 144, js: false, dash: 76, delay: 1.35 },
  { x1: 650, y1: 223, x2: 637, y2: 138, js: false, dash: 86, delay: 1.35 },
  { x1: 650, y1: 223, x2: 684, y2: 151, js: false, dash: 80, delay: 1.35 },
  { x1: 650, y1: 223, x2: 766, y2: 184, js: false, dash: 123, delay: 1.35 },
  { x1: 684, y1: 277, x2: 794, y2: 240, js: false, dash: 116, delay: 1.35 },
  { x1: 807, y1: 336, x2: 921, y2: 304, js: false, dash: 118, delay: 1.9 },
  { x1: 807, y1: 336, x2: 946, y2: 318, js: true, dash: 141, delay: 1.9 },
  { x1: 807, y1: 336, x2: 925, y2: 343, js: false, dash: 118, delay: 1.9 },
  { x1: 807, y1: 336, x2: 912, y2: 378, js: false, dash: 113, delay: 1.9 },
  { x1: 751, y1: 372, x2: 832, y2: 442, js: false, dash: 107, delay: 1.9 },
  { x1: 751, y1: 372, x2: 766, y2: 465, js: true, dash: 94, delay: 1.9 },
  { x1: 666, y1: 403, x2: 727, y2: 487, js: false, dash: 104, delay: 1.9 },
  { x1: 666, y1: 403, x2: 671, y2: 495, js: false, dash: 92, delay: 1.9 },
  { x1: 600, y1: 418, x2: 584, y2: 515, js: false, dash: 99, delay: 1.9 },
  { x1: 561, y1: 414, x2: 548, y2: 507, js: false, dash: 93, delay: 1.9 },
  { x1: 561, y1: 414, x2: 517, y2: 505, js: false, dash: 101, delay: 1.9 },
  { x1: 470, y1: 412, x2: 398, y2: 488, js: false, dash: 104, delay: 1.9 },
  { x1: 414, y1: 381, x2: 348, y2: 443, js: false, dash: 90, delay: 1.9 },
  { x1: 414, y1: 381, x2: 315, y2: 438, js: false, dash: 114, delay: 1.9 },
  { x1: 365, y1: 323, x2: 299, y2: 418, js: false, dash: 115, delay: 1.9 },
  { x1: 365, y1: 323, x2: 271, y2: 372, js: false, dash: 106, delay: 1.9 },
  { x1: 365, y1: 323, x2: 224, y2: 346, js: true, dash: 143, delay: 1.9 },
  { x1: 364, y1: 278, x2: 232, y2: 299, js: false, dash: 133, delay: 1.9 },
  { x1: 366, y1: 247, x2: 208, y2: 243, js: false, dash: 158, delay: 1.9 },
  { x1: 366, y1: 247, x2: 235, y2: 221, js: true, dash: 133, delay: 1.9 },
  { x1: 366, y1: 247, x2: 262, y2: 155, js: false, dash: 139, delay: 1.9 },
  { x1: 412, y1: 185, x2: 322, y2: 110, js: false, dash: 117, delay: 1.9 },
  { x1: 412, y1: 185, x2: 350, y2: 111, js: false, dash: 96, delay: 1.9 },
  { x1: 455, y1: 158, x2: 401, y2: 74, js: false, dash: 100, delay: 1.9 },
  { x1: 539, y1: 144, x2: 523, y2: 69, js: false, dash: 76, delay: 1.9 },
  { x1: 539, y1: 144, x2: 521, y2: 67, js: false, dash: 79, delay: 1.9 },
  { x1: 637, y1: 138, x2: 590, y2: 57, js: false, dash: 93, delay: 1.9 },
  { x1: 684, y1: 151, x2: 683, y2: 73, js: false, dash: 78, delay: 1.9 },
  { x1: 684, y1: 151, x2: 700, y2: 72, js: false, dash: 81, delay: 1.9 },
  { x1: 766, y1: 184, x2: 790, y2: 96, js: false, dash: 91, delay: 1.9 },
  { x1: 766, y1: 184, x2: 878, y2: 145, js: false, dash: 118, delay: 1.9 },
  { x1: 794, y1: 240, x2: 891, y2: 162, js: false, dash: 125, delay: 1.9 },
  { x1: 794, y1: 240, x2: 902, y2: 212, js: false, dash: 112, delay: 1.9 },
  { x1: 800, y1: 268, x2: 951, y2: 260, js: true, dash: 151, delay: 1.9 },
  { x1: 521, y1: 67, x2: 951, y2: 260, js: true, dash: 471, delay: 1.9 },
  { x1: 232, y1: 299, x2: 671, y2: 495, js: false, dash: 480, delay: 1.9 },
  { x1: 671, y1: 495, x2: 470, y2: 412, js: false, dash: 218, delay: 1.9 },
  { x1: 348, y1: 443, x2: 350, y2: 111, js: false, dash: 332, delay: 1.9 },
  { x1: 671, y1: 495, x2: 666, y2: 403, js: false, dash: 92, delay: 1.9 },
  { x1: 455, y1: 158, x2: 600, y2: 418, js: false, dash: 297, delay: 1.9 },
  { x1: 539, y1: 144, x2: 517, y2: 505, js: false, dash: 362, delay: 1.9 },
  { x1: 366, y1: 247, x2: 414, y2: 381, js: false, dash: 142, delay: 1.9 },
  { x1: 912, y1: 378, x2: 262, y2: 155, js: false, dash: 687, delay: 1.9 },
  { x1: 666, y1: 403, x2: 470, y2: 412, js: false, dash: 196, delay: 1.9 },
  { x1: 800, y1: 268, x2: 208, y2: 243, js: false, dash: 592, delay: 1.9 },
  { x1: 364, y1: 278, x2: 224, y2: 346, js: true, dash: 156, delay: 1.9 },
  { x1: 470, y1: 412, x2: 766, y2: 465, js: true, dash: 301, delay: 1.9 },
  { x1: 322, y1: 110, x2: 807, y2: 336, js: false, dash: 535, delay: 1.9 },
  { x1: 600, y1: 418, x2: 539, y2: 144, js: false, dash: 281, delay: 1.9 },
  { x1: 322, y1: 110, x2: 727, y2: 487, js: false, dash: 553, delay: 1.9 },
  { x1: 364, y1: 278, x2: 350, y2: 111, js: false, dash: 168, delay: 1.9 },
  { x1: 766, y1: 184, x2: 832, y2: 442, js: false, dash: 266, delay: 1.9 },
  { x1: 262, y1: 155, x2: 766, y2: 465, js: true, dash: 592, delay: 1.9 },
  { x1: 348, y1: 443, x2: 414, y2: 381, js: false, dash: 90, delay: 1.9 },
  { x1: 414, y1: 381, x2: 315, y2: 438, js: false, dash: 114, delay: 1.9 },
  { x1: 398, y1: 488, x2: 348, y2: 443, js: false, dash: 67, delay: 1.9 },
  { x1: 348, y1: 443, x2: 946, y2: 318, js: true, dash: 611, delay: 1.9 },
  { x1: 561, y1: 414, x2: 364, y2: 278, js: false, dash: 239, delay: 1.9 },
  { x1: 470, y1: 412, x2: 790, y2: 96, js: false, dash: 450, delay: 1.9 },
  { x1: 912, y1: 378, x2: 790, y2: 96, js: false, dash: 307, delay: 1.9 },
  { x1: 555, y1: 345, x2: 470, y2: 412, js: false, dash: 109, delay: 1.35 },
  { x1: 486, y1: 316, x2: 766, y2: 184, js: false, dash: 309, delay: 1.35 },
  { x1: 641, y1: 331, x2: 412, y2: 185, js: false, dash: 272, delay: 1.35 },
  { x1: 684, y1: 277, x2: 600, y2: 418, js: false, dash: 164, delay: 1.35 },
];

export const DEMO_NODES: GraphNode[] = [
  { shape: 'circle', role: 'hub', cx: 580, cy: 280, r: 10, delay: 0.17 },
  { shape: 'circle', role: 'page', cx: 684, cy: 277, r: 6.5, delay: 0.82 },
  { shape: 'circle', role: 'page', cx: 641, cy: 331, r: 6.5, delay: 0.91 },
  { shape: 'circle', role: 'page', cx: 555, cy: 345, r: 6.5, delay: 1 },
  { shape: 'circle', role: 'page', cx: 486, cy: 316, r: 6.5, delay: 0.93 },
  { shape: 'circle', role: 'page', cx: 477, cy: 258, r: 6.5, delay: 0.82 },
  { shape: 'circle', role: 'page', cx: 547, cy: 219, r: 6.5, delay: 0.72 },
  { shape: 'circle', role: 'page', cx: 650, cy: 223, r: 6.5, delay: 0.86 },
  { shape: 'circle', role: 'page', cx: 800, cy: 268, r: 5, delay: 1.32 },
  { shape: 'circle', role: 'page', cx: 807, cy: 336, r: 5, delay: 1.48 },
  { shape: 'circle', role: 'page', cx: 751, cy: 372, r: 5, delay: 1.45 },
  { shape: 'circle', role: 'page', cx: 666, cy: 403, r: 5, delay: 1.32 },
  { shape: 'circle', role: 'page', cx: 600, cy: 418, r: 5, delay: 1.54 },
  { shape: 'circle', role: 'page', cx: 561, cy: 414, r: 5, delay: 1.23 },
  { shape: 'circle', role: 'page', cx: 470, cy: 412, r: 5, delay: 1.24 },
  { shape: 'circle', role: 'page', cx: 414, cy: 381, r: 5, delay: 1.36 },
  { shape: 'circle', role: 'page', cx: 365, cy: 323, r: 5, delay: 1.32 },
  { shape: 'circle', role: 'page', cx: 364, cy: 278, r: 5, delay: 1.37 },
  { shape: 'circle', role: 'page', cx: 366, cy: 247, r: 5, delay: 1.54 },
  { shape: 'circle', role: 'page', cx: 412, cy: 185, r: 5, delay: 1.41 },
  { shape: 'circle', role: 'page', cx: 455, cy: 158, r: 5, delay: 1.2 },
  { shape: 'circle', role: 'page', cx: 539, cy: 144, r: 5, delay: 1.52 },
  { shape: 'circle', role: 'page', cx: 637, cy: 138, r: 5, delay: 1.32 },
  { shape: 'circle', role: 'page', cx: 684, cy: 151, r: 5, delay: 1.43 },
  { shape: 'circle', role: 'page', cx: 766, cy: 184, r: 5, delay: 1.49 },
  { shape: 'circle', role: 'page', cx: 794, cy: 240, r: 5, delay: 1.24 },
  { shape: 'circle', role: 'page', cx: 921, cy: 304, r: 4, delay: 1.89 },
  { shape: 'polygon', role: 'js', points: '946,313 951,322 941,322', origin: [946, 318], delay: 2 },
  { shape: 'circle', role: 'page', cx: 925, cy: 343, r: 4, delay: 1.82 },
  { shape: 'circle', role: 'page', cx: 912, cy: 378, r: 4, delay: 2.06 },
  { shape: 'circle', role: 'page', cx: 832, cy: 442, r: 4, delay: 1.9 },
  {
    shape: 'polygon',
    role: 'js',
    points: '766,460 771,469 761,469',
    origin: [766, 465],
    delay: 1.97,
  },
  { shape: 'circle', role: 'page', cx: 727, cy: 487, r: 4, delay: 1.78 },
  { shape: 'circle', role: 'page', cx: 671, cy: 495, r: 4, delay: 2.08 },
  { shape: 'circle', role: 'page', cx: 584, cy: 515, r: 4, delay: 2 },
  { shape: 'circle', role: 'page', cx: 548, cy: 507, r: 4, delay: 1.91 },
  { shape: 'circle', role: 'page', cx: 517, cy: 505, r: 4, delay: 2.01 },
  { shape: 'circle', role: 'page', cx: 398, cy: 488, r: 4, delay: 1.78 },
  { shape: 'circle', role: 'page', cx: 348, cy: 443, r: 4, delay: 1.81 },
  { shape: 'circle', role: 'page', cx: 315, cy: 438, r: 4, delay: 2.1 },
  { shape: 'circle', role: 'page', cx: 299, cy: 418, r: 4, delay: 1.76 },
  { shape: 'circle', role: 'page', cx: 271, cy: 372, r: 4, delay: 1.96 },
  {
    shape: 'polygon',
    role: 'js',
    points: '224,341 229,350 219,350',
    origin: [224, 346],
    delay: 1.91,
  },
  { shape: 'circle', role: 'page', cx: 232, cy: 299, r: 4, delay: 1.98 },
  { shape: 'circle', role: 'page', cx: 208, cy: 243, r: 4, delay: 1.96 },
  {
    shape: 'polygon',
    role: 'js',
    points: '235,216 240,225 230,225',
    origin: [235, 221],
    delay: 1.96,
  },
  { shape: 'circle', role: 'page', cx: 262, cy: 155, r: 4, delay: 1.92 },
  { shape: 'circle', role: 'page', cx: 322, cy: 110, r: 4, delay: 2.08 },
  { shape: 'circle', role: 'page', cx: 350, cy: 111, r: 4, delay: 1.8 },
  { shape: 'circle', role: 'page', cx: 401, cy: 74, r: 4, delay: 1.94 },
  { shape: 'circle', role: 'page', cx: 523, cy: 69, r: 4, delay: 1.76 },
  { shape: 'circle', role: 'page', cx: 521, cy: 67, r: 4, delay: 2.03 },
  { shape: 'circle', role: 'page', cx: 590, cy: 57, r: 4, delay: 2 },
  { shape: 'circle', role: 'page', cx: 683, cy: 73, r: 4, delay: 1.79 },
  { shape: 'circle', role: 'page', cx: 700, cy: 72, r: 4, delay: 2.01 },
  { shape: 'circle', role: 'page', cx: 790, cy: 96, r: 4, delay: 1.8 },
  { shape: 'circle', role: 'page', cx: 878, cy: 145, r: 4, delay: 2.1 },
  { shape: 'circle', role: 'page', cx: 891, cy: 162, r: 4, delay: 1.82 },
  { shape: 'circle', role: 'page', cx: 902, cy: 212, r: 4, delay: 2.06 },
  {
    shape: 'polygon',
    role: 'js',
    points: '951,255 956,264 946,264',
    origin: [951, 260],
    delay: 1.76,
  },
  { shape: 'rect', role: 'orphan', x: 67, y: 239, w: 9, h: 9, origin: [72, 243], delay: 2.37 },
  { shape: 'rect', role: 'orphan', x: 298, y: 495, w: 9, h: 9, origin: [303, 500], delay: 2.48 },
  { shape: 'rect', role: 'orphan', x: 116, y: 199, w: 9, h: 9, origin: [121, 204], delay: 2.57 },
  { shape: 'rect', role: 'orphan', x: 258, y: 48, w: 9, h: 9, origin: [262, 53], delay: 2.41 },
  { shape: 'rect', role: 'orphan', x: 695, y: 26, w: 9, h: 9, origin: [699, 30], delay: 2.49 },
  { shape: 'rect', role: 'orphan', x: 728, y: 526, w: 9, h: 9, origin: [733, 530], delay: 2.59 },
  { shape: 'rect', role: 'orphan', x: 168, y: 457, w: 9, h: 9, origin: [172, 462], delay: 2.32 },
];
