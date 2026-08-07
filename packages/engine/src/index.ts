export { validateUrlOrThrow, isPrivateOrReservedIp } from './ssrf-guard.js';
export type { DnsResolver, ValidateUrlOptions } from './ssrf-guard.js';
export { safeFetch } from './safe-fetch.js';
export type { SafeFetchOptions, SafeFetchResult } from './safe-fetch.js';
export { canonicalizeUrl, hashUrl } from './url-canonical.js';
export { parseRobotsTxt, isAllowedByRobots } from './robots.js';
export type { ParsedRobots, RobotsRules } from './robots.js';
export { discoverSitemaps, parseSitemapUrls } from './sitemap.js';
export type { Fetcher, FetchedResource, DiscoverResult } from './sitemap.js';
export { detectCms, SIGNATURES } from './cms-detection/index.js';
export type { DetectionResult } from './cms-detection/index.js';
export { extractPage } from './extract.js';
export type { ExtractedPage, ExtractedLink } from './extract.js';
export { runCrawl } from './crawler.js';
export type { CrawlInput, CrawlOutput, CrawledPage, CrawledLink } from './crawler.js';
export { buildGraph } from './graph.js';
export type { SiteGraph, PageNodeAttrs, LinkEdgeAttrs } from './graph.js';
export { computeGrade, scoreToLetter } from './grade.js';
export type { GradeInputs, GradeResult } from './grade.js';
export { getAdjustments } from './cms-adjustments/index.js';
export type { CmsAdjustments } from './cms-adjustments/index.js';
export { runAudit, crawlForAudit, analyzeCrawl } from './audit.js';
export type { InternalAuditFlags, AnalysisContext } from './audit.js';
export { classifyFetchOutcome, classifyConfidence, computeCrawlHealth, formatCrawlHealth } from './crawl-health.js';
export type { FetchOutcome } from './crawl-health.js';
export { computeConfidenceBand, estimateSiteTotal } from './confidence-band.js';
export type { SiteTotalEstimate } from './confidence-band.js';
export { deriveGradeInputs } from './grade-inputs.js';
export type { GraphAnalysis, DeriveGradeInputsOpts } from './grade-inputs.js';
export { buildCorpus } from './projection/relevance.js';
export type { Corpus, BuildCorpusOptions } from './projection/relevance.js';
export { enumerateFixes } from './projection/ledger.js';
export type { PrescribableFix, SuggestedLink, EnumerateFixesOptions } from './projection/ledger.js';
// The single sanctioned way to cut or persist crawled text — see text-safety.ts for why nothing else
// may do it locally. Exported so apps/web and inngest share ONE implementation rather than a copy.
//
// `toPersistableText` is the ONLY cutter on the public surface, deliberately. The code-unit helpers it
// replaced were removed from this barrel: leaving a code-unit cutter in the public API of the package
// whose whole point is that code-unit budgets are the bug is an invitation to reintroduce the class,
// and the cut-guard would have waved it through as "the shared helper itself".
export { toPersistableText, hasLoneSurrogate } from './text-safety.js';
export { buildActionPacket, sanitizeText, sanitizeUrl, COPY_LABEL as ACTION_PACKET_COPY_LABEL } from './projection/action-packet.js';
export type { ActionPacketInput } from './projection/action-packet.js';
export { buildConversionCore, DISCLAIMER as PROJECTION_DISCLAIMER } from './projection/projection.js';
export type { ConversionCore, BuildConversionCoreArgs } from './projection/projection.js';
export { computeCoverageAccounting, sitemapDeltaSeverity, sitemapUnreachedFinding } from './coverage.js';
export type { CoverageInput } from './coverage.js';
// SPEC 5.1a §8 — `analysis/frontier-checkpoint.ts` is DELIBERATELY NOT EXPORTED. It is unwired
// groundwork for SPEC 06 (see evidence/2026-08-06-spec06-frontier-carry-forward.md). Exporting it
// would publish a resume model the shipped crawler does not implement — an invitation for the v1.2
// CLI to adopt the wrong one. SPEC 06 exports it when it wires it.
