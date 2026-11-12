/**
 * The packet builder of every fix type. The mapped type has a key for each `FixType`, so a fix type
 * with no entry does not compile; an entry is a builder for that type's record, or the reason the
 * engine writes no packet for it.
 */
import type { FixType } from '@crawlmouse/types/v2';
import { canonicalMismatch } from './by-type/canonical-mismatch.js';
import { clientRenderedTemplate } from './by-type/client-rendered-template.js';
import { deepPages } from './by-type/deep-pages.js';
import { duplicatePagination } from './by-type/duplicate-pagination.js';
import { edgeRuleBlocksCrawler } from './by-type/edge-rule-blocks-crawler.js';
import { genericAnchorText } from './by-type/generic-anchor-text.js';
import { hreflangGap } from './by-type/hreflang-gap.js';
import { jsOnlyNavigation } from './by-type/js-only-navigation.js';
import { missingAuthorDate } from './by-type/missing-author-date.js';
import { missingSchemaDescription } from './by-type/missing-schema-description.js';
import { noQuestionHeadings } from './by-type/no-question-headings.js';
import { orphanPages } from './by-type/orphan-pages.js';
import { quotableOpening } from './by-type/quotable-opening.js';
import { redirectChain } from './by-type/redirect-chain.js';
import { robotsTxtBlocksCrawler } from './by-type/robots-txt-blocks-crawler.js';
import { specsAsImages } from './by-type/specs-as-images.js';
import { compose } from './compose.js';
import type { FixPacket, PacketBuilder, PacketEntry, PacketFacts, RecordOf } from './types.js';

export const PACKETS: { readonly [T in FixType]: PacketEntry<T> } = {
  robots_txt_blocks_crawler: robotsTxtBlocksCrawler,
  edge_rule_blocks_crawler: edgeRuleBlocksCrawler,
  client_rendered_template: clientRenderedTemplate,
  orphan_pages: orphanPages,
  quotable_opening: quotableOpening,
  generic_anchor_text: genericAnchorText,
  deep_pages: deepPages,
  specs_as_images: specsAsImages,
  missing_schema_description: missingSchemaDescription,
  no_question_headings: noQuestionHeadings,
  missing_author_date: missingAuthorDate,
  js_only_navigation: jsOnlyNavigation,
  redirect_chain: redirectChain,
  duplicate_pagination: duplicatePagination,
  canonical_mismatch: canonicalMismatch,
  hreflang_gap: hreflangGap,
};

/** The packet of one fix, from its type's builder; null when the type has none (`NoPacket`). */
export function writePacket<T extends FixType>(
  type: T,
  record: RecordOf<T>,
  facts: PacketFacts,
): FixPacket | null {
  // PACKETS[type] is the entry for T, which the mapped type cannot say of an indexed access.
  const entry = PACKETS[type] as PacketEntry<T>;
  if (entry.kind === 'none') return null;
  return compose(entry as PacketBuilder<RecordOf<T>>, record, facts);
}
