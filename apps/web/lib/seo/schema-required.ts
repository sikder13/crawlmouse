/**
 * The properties this site requires of each schema.org type it emits. schema.org itself makes no
 * property required; these are our own bar, so a node that omits one is a defect we report (D1) and
 * fail on (D3). A type with no entry here fails too ("no required set"): emitting a new type means
 * deciding what it must carry, here, first.
 */
import { typedNodes, typesOf } from './page-facts';

export const REQUIRED: Readonly<Record<string, readonly string[]>> = {
  Organization: ['name'],
  WebSite: ['name', 'url'],
  WebPage: ['name', 'url'],
  SoftwareApplication: ['name', 'applicationCategory', 'operatingSystem', 'offers'],
  Offer: ['price', 'priceCurrency'],
  UnitPriceSpecification: ['price', 'priceCurrency', 'billingDuration'],
  PostalAddress: ['addressLocality', 'addressRegion', 'addressCountry'],
  FAQPage: ['mainEntity'],
  Question: ['name', 'acceptedAnswer'],
  Answer: ['text'],
  Article: ['headline', 'author', 'datePublished', 'dateModified', 'image', 'publisher'],
  Person: ['name'],
  ImageObject: ['url'],
  BreadcrumbList: ['itemListElement'],
  ListItem: ['position', 'name', 'item'],
  Dataset: ['name', 'description', 'temporalCoverage', 'size'],
};

const present = (v: unknown) =>
  v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

export interface SchemaProblem {
  type: string;
  /** The missing property, or `@type` for a type with no required set. */
  missing: string;
}

/** What each typed node in a JSON-LD value lacks. Empty when every node carries its required set. */
export function schemaProblems(value: unknown): SchemaProblem[] {
  const out: SchemaProblem[] = [];
  for (const node of typedNodes(value)) {
    for (const type of typesOf(node)) {
      const required = Object.hasOwn(REQUIRED, type) ? REQUIRED[type] : undefined;
      if (!required) {
        out.push({ type, missing: '@type' });
        continue;
      }
      for (const prop of required) if (!present(node[prop])) out.push({ type, missing: prop });
    }
  }
  return out;
}
