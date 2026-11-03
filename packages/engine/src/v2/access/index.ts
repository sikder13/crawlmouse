/**
 * The crawler-access detectors (CC-15): from the worker's access rows and robots.txt readings, the
 * matrix (one verdict per crawler, with the pages behind it), whether the access score can be given,
 * and a record per crawler for each access fix type. CC-17 turns the records into the diff's
 * `DetectorOutcome`s; the declaration signals are in declarations.ts.
 */
import { scoredCrawlersMeasured } from '@crawlmouse/types/v2';
import { CRAWLER_REGISTRY_V2 } from '../crawler-registry.js';
import { cellsOf } from './cells.js';
import { detectEdge } from './edge.js';
import { crawlerAccess } from './matrix.js';
import { byKey } from './record.js';
import { detectRobots } from './robots.js';
import { MIN_SCORED_MEASURED } from './thresholds.js';
import type { AccessInput, AccessResult } from './types.js';

export function detectAccess(input: AccessInput): AccessResult {
  const registry = input.registry ?? CRAWLER_REGISTRY_V2;
  const keys = registry.map((e) => e.token.toLowerCase());
  const clash = keys.find((k, i) => keys.indexOf(k) !== i);
  if (clash !== undefined)
    throw new Error(`access detectors: two registry tokens spell ${clash} in lower case`);
  const cells = cellsOf(input, registry);
  const crawlers = registry.map((e) => crawlerAccess(e, cells.get(e.token)!));
  const detections = [
    ...registry.filter((e) => e.testable).map((e) => detectEdge(e, cells.get(e.token)!)),
    ...registry.map((e) => detectRobots(e, cells.get(e.token)!)),
  ].sort(byKey);
  const scored = scoredCrawlersMeasured(crawlers);
  return {
    crawlers,
    scored_measured: scored,
    access_withheld: scored < MIN_SCORED_MEASURED,
    detections,
  };
}

export { declarationSignal, DECLARATIONS, SIGNAL_TABLE } from './declarations.js';
export type { DeclarationKind, DeclarationProbe } from './declarations.js';
export type {
  AccessDetection,
  AccessFixType,
  AccessIndeterminateReason,
  AccessInput,
  AccessResult,
  CrawlerAccess,
} from './types.js';
