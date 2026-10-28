/** LinkEdge: one internal link in one check. Identified by (check_id, from_url, to_url). */
import { z } from 'zod';
import { crawledText, HttpUrlSchema, IdSchema } from './common.js';

export const LinkEdgeSchema = z.strictObject({
  check_id: IdSchema,
  from_url: HttpUrlSchema,
  to_url: HttpUrlSchema,
  /** Quoted from the site, so bounded like all crawled text. */
  anchor_text: crawledText(2000),
  is_generic_anchor: z.boolean(),
  /** Created by JavaScript, so crawlers that do not run scripts cannot follow it (dashed on the map). */
  js_only: z.boolean(),
});

export type LinkEdge = z.infer<typeof LinkEdgeSchema>;
