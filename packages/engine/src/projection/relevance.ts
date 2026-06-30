import type { SiteGraph } from '../graph.js';

/**
 * §3 deterministic content-relevance over the corpus we actually have today: each gradeable node's
 * `title` ∪ inbound-edge anchor text ∪ outbound-edge anchor text ∪ URL-slug tokens. No LLM, no
 * embeddings service, no outbound fetch (D2/D3) — pure TF-IDF + cosine over the already-crawled
 * graph. `extraTextFor` is the seam for adding headings later (extract → Page → graph) without an
 * API change: per the owner decision, v1 ships title+anchors+slug and headings are the first upgrade.
 */

/** Frozen English stopword set. Common function words carry no topical signal and would otherwise
 *  manufacture relevance between unrelated pages (a token shared by SOME pages still gets idf>0). */
export const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'as',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its', 'this', 'that', 'these', 'those',
  'from', 'into', 'about', 'over', 'under', 'out', 'up', 'down', 'off', 'no', 'not', 'so', 'if',
  'then', 'than', 'too', 'very', 'can', 'will', 'just', 'has', 'have', 'had', 'do', 'does', 'did',
  'you', 'your', 'we', 'our', 'us', 'they', 'their', 'he', 'she', 'his', 'her', 'i', 'my', 'me',
]);

const TOKEN_RE = /[\p{L}\p{N}]+/gu;

/** lowercase → unicode word tokens → drop single chars + stopwords. Deterministic. */
function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const m of text.toLowerCase().matchAll(TOKEN_RE)) {
    const t = m[0];
    if (t.length >= 2 && !STOPWORDS.has(t)) out.push(t);
  }
  return out;
}

/** URL path → space-separated tokens (e.g. /internal-linking-basics → "internal linking basics"). */
function slugText(url: string): string {
  try {
    return new URL(url).pathname.replace(/[/_-]+/g, ' ');
  } catch {
    return '';
  }
}

export interface Corpus {
  /** 0..1 cosine similarity (rounded to 4dp for stable ties/display); 0 when either doc is empty. */
  relevance(a: string, b: string): number;
  /** Up to `k` tokens present in BOTH docs, ranked (idf desc, token asc) — the action-packet "why". */
  sharedTopics(a: string, b: string, k: number): string[];
  has(url: string): boolean;
}

export interface BuildCorpusOptions {
  /** Headings seam (future): extra text per node folded into its document. Default: none. */
  extraTextFor?: (url: string) => string[];
}

export function buildCorpus(graph: SiteGraph, opts: BuildCorpusOptions = {}): Corpus {
  const { extraTextFor } = opts;
  const nodes = graph.nodes();
  const N = nodes.length;

  // Per-node term frequencies over title ∪ in/out anchors ∪ slug ∪ extraText.
  const tf = new Map<string, Map<string, number>>();
  for (const node of nodes) {
    const texts: string[] = [];
    const title = graph.getNodeAttribute(node, 'title');
    if (title) texts.push(title);
    texts.push(slugText(node));
    graph.forEachInEdge(node, (_e, attrs) => { if (attrs.anchorText) texts.push(attrs.anchorText); });
    graph.forEachOutEdge(node, (_e, attrs) => { if (attrs.anchorText) texts.push(attrs.anchorText); });
    if (extraTextFor) for (const x of extraTextFor(node)) texts.push(x);
    const counts = new Map<string, number>();
    for (const text of texts) for (const tok of tokenize(text)) counts.set(tok, (counts.get(tok) ?? 0) + 1);
    tf.set(node, counts);
  }

  // Document frequency + idf. A token in EVERY doc gets idf=0 (no discriminating signal).
  const df = new Map<string, number>();
  for (const counts of tf.values()) for (const tok of counts.keys()) df.set(tok, (df.get(tok) ?? 0) + 1);
  const idf = (tok: string) => Math.log(N / (df.get(tok) ?? N));

  // Weight vectors (tf·idf) + L2 norms. idf=0 tokens drop out (weight 0).
  const weights = new Map<string, Map<string, number>>();
  const norms = new Map<string, number>();
  for (const [node, counts] of tf) {
    const w = new Map<string, number>();
    let sumSq = 0;
    for (const [tok, c] of counts) {
      const wt = c * idf(tok);
      if (wt !== 0) {
        w.set(tok, wt);
        sumSq += wt * wt;
      }
    }
    weights.set(node, w);
    norms.set(node, Math.sqrt(sumSq));
  }

  function relevance(a: string, b: string): number {
    const wa = weights.get(a);
    const wb = weights.get(b);
    const na = norms.get(a) ?? 0;
    const nb = norms.get(b) ?? 0;
    if (!wa || !wb || na === 0 || nb === 0) return 0;
    // Iterate the smaller vector's tokens in sorted order — deterministic summation order.
    const [small, big] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
    let dot = 0;
    for (const tok of [...small.keys()].sort()) {
      const other = big.get(tok);
      if (other !== undefined) dot += small.get(tok)! * other;
    }
    return Math.round((dot / (na * nb)) * 10000) / 10000;
  }

  function sharedTopics(a: string, b: string, k: number): string[] {
    const wa = weights.get(a);
    const wb = weights.get(b);
    if (!wa || !wb) return [];
    const shared: string[] = [];
    for (const tok of wa.keys()) if (wb.has(tok)) shared.push(tok);
    shared.sort((x, y) => {
      const d = idf(y) - idf(x); // idf desc (rarer/more-specific first)
      if (d !== 0) return d;
      return x < y ? -1 : x > y ? 1 : 0; // token asc tie-break (stable)
    });
    return shared.slice(0, k);
  }

  return { relevance, sharedTopics, has: (u: string) => weights.has(u) };
}
