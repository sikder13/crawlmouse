/**
 * CC-40 D8: wording that public pages do not use. Two kinds: the stock phrases of machine-written
 * copy (the reason a reader stops trusting a page), and claims that are risky rather than stylistic
 * (a guarantee, a ranking, a superlative about ourselves, a 100% promise). Each entry is a
 * case-insensitive pattern with word boundaries and the reason it is here.
 *
 * Four entries are narrower than the bare word, and `banned-phrases.test.ts` pins each with a
 * sentence that matches and one that does not:
 * - `leverage` only as a verb ("leverage your links"), not the noun ("a high-leverage fix").
 * - `robust` only in prose, not inside an identifier (`robust_parser`, `is-robust`, `robust()`).
 * - "best … tool" only when the sentence says it of Crawlmouse, "we" or "our …".
 * - "100%" only as a promise ("100% accurate"), not as a measured share ("100% of pages").
 * "guaranteed" and "100%" also do not match after a negation in the same sentence ("it doesn't
 * guarantee rankings", "no method is 100% secure"): those sentences say the honest thing.
 *
 * The page test that applies the list is `__tests__/seo-banned-phrases.test.tsx`; what it excuses is
 * `banned-phrase-exceptions.ts`.
 */

export interface BannedPhrase {
  id: string;
  pattern: RegExp;
  reason: string;
}

const STYLE = 'stock phrase of machine-written copy';
// An apostrophe as typed or as the typographic one the posts render (&rsquo;).
const APOS = "['\u2019]";
// A hyphen, a non-breaking hyphen or a space between the parts of a compound.
const JOIN = '[-\u2010\u2011 ]?';
// A negation earlier in the same sentence (at most 50 characters back).
const NOT_NEGATED = `(?<!\\b(?:no|not|never|cannot|can${APOS}t|nobody|nothing|won${APOS}t|doesn${APOS}t|don${APOS}t|isn${APOS}t|aren${APOS}t)\\b[^.?!]{0,50})`;

const phrase = (id: string, source: string, reason = STYLE): BannedPhrase => ({
  id,
  pattern: new RegExp(source, 'i'),
  reason,
});

export const BANNED_PHRASES: readonly BannedPhrase[] = [
  phrase('delve', '\\bdelv(?:e|es|ed|ing)\\b'),
  phrase('tapestry', '\\btapestr(?:y|ies)\\b'),
  phrase('testament to', '\\btestament to\\b'),
  phrase('in today’s fast-paced/digital', `\\bin today${APOS}s (?:fast${JOIN}paced|digital)\\b`),
  phrase('ever-evolving', `\\bever${JOIN}evolving\\b`),
  phrase('the landscape of', '\\bthe landscape of\\b'),
  phrase(
    'navigate the complexities/world/landscape',
    '\\bnavigat(?:e|es|ed|ing) (?:the )?(?:complexit(?:y|ies)|world|landscape)\\b',
  ),
  phrase(
    'unlock the power/potential',
    '\\bunlock(?:s|ed|ing)? (?:the |your |its )?(?:full )?(?:power|potential)\\b',
  ),
  phrase('unleash', '\\bunleash(?:es|ed|ing)?\\b'),
  phrase('harness the power', '\\bharness(?:es|ed|ing)? the power\\b'),
  phrase('game-changer', `\\bgame${JOIN}chang(?:er|ers|ing)\\b`),
  phrase('revolutionize', '\\brevolution(?:is|iz)(?:e|es|ed|ing)\\b'),
  phrase('cutting-edge', `\\bcutting${JOIN}edge\\b`),
  phrase('seamless', '\\bseamless(?:ly)?\\b'),
  // In prose only: not part of an identifier joined by `_`, `-` or `.`, or called with `(`.
  phrase('robust', '(?<![\\w.-])robust(?:ly|ness)?(?![\\w(-]|\\.\\w)'),
  phrase('elevate', '\\belevat(?:e|es|ed|ing)\\b'),
  phrase('empower', '\\bempower(?:s|ed|ing|ment)?\\b'),
  // As a verb only: an inflected form, or the base form after a word that takes a verb ("to",
  // a modal, a subject) or before an object. Not the noun: "high-leverage", "the leverage", "more
  // leverage over".
  phrase(
    'leverage (verb)',
    '(?<![\\w-])leverag(?:es|ed|ing)\\b' +
      `|\\b(?:to|can|could|will|would|should|must|might|may|we|i|they|you${APOS}ll|let${APOS}s|helps?|and) leverage\\b` +
      '|(?<!\\b(?:the|a|of|more|less|some|no|any|much|your|our|their|its)[- ])(?<![\\w-])leverage (?:your|the|our|their|its|this|that|these|those|existing|it|them|every|each|all)\\b',
  ),
  // The compound adjective, which the verb entry above does not catch: CTO ruling 2 named both of
  // the site's uses of it for replacement.
  phrase(
    'high-leverage',
    '\\bhigh(?:est|er)?[- ]leverage\\b',
    'consultant jargon for "the most effective"; ruling 2 asked for the plain word',
  ),
  phrase('holistic', '\\bholistic(?:ally)?\\b'),
  phrase('synergy', '\\bsynerg(?:y|ies|istic)\\b'),
  phrase('paradigm', '\\bparadigms?\\b'),
  phrase('embark', '\\bembark(?:s|ed|ing)?\\b'),
  phrase('realm', '\\brealms?\\b'),
  phrase('bustling', '\\bbustling\\b'),
  phrase('vibrant', '\\bvibrant\\b'),
  phrase('treasure trove', '\\btreasure troves?\\b'),
  phrase(
    'it’s important/worth to note/noting',
    `\\bit(?:${APOS}s| is) (?:important|worth) (?:to note|noting)\\b`,
  ),
  phrase('in conclusion', '\\bin conclusion\\b'),
  phrase('in summary', '\\bin summary\\b'),
  phrase('furthermore', '\\bfurthermore\\b'),
  phrase('moreover', '\\bmoreover\\b'),
  phrase('look no further', '\\blook no further\\b'),
  phrase('whether you’re a', `\\bwhether you(?:${APOS}re| are) an?\\b`),
  phrase(
    'dive into / deep dive',
    `\\b(?:dive|dives|diving|dived|dove) into\\b|\\bdeep${JOIN}dives?\\b`,
  ),
  phrase('supercharge', '\\bsupercharg(?:e|es|ed|ing)\\b'),
  phrase('skyrocket', '\\bskyrocket(?:s|ed|ing)?\\b'),
  phrase('state-of-the-art', `\\bstate${JOIN}of${JOIN}the${JOIN}art\\b`),
  phrase('best-in-class', `\\bbest${JOIN}in${JOIN}class\\b`),
  phrase('world-class', `\\bworld${JOIN}class\\b`),
  phrase('next-level', `\\bnext${JOIN}level\\b`),
  // Risky claims.
  phrase(
    'guaranteed (rankings/citations)',
    `${NOT_NEGATED}\\bguarantee(?:s|d)?\\b[^.?!]{0,40}\\b(?:rank(?:s|ing|ings)?|citations?|cited|traffic|positions?|first page|page one|indexed|indexing)\\b` +
      `|${NOT_NEGATED}\\b(?:rank(?:s|ing|ings)?|citations?|traffic|positions?|indexing)\\b[^.?!]{0,20}\\bguaranteed\\b`,
    'a promise about search or AI results that nobody controls',
  ),
  phrase(
    '#1 / number one',
    `(?<![\\w&])#1\\b|\\bnumber${JOIN}one\\b|\\bno\\. ?1\\b`,
    'a ranking claim with no source',
  ),
  phrase(
    'best … tool (about ourselves)',
    `\\bcrawlmouse(?:${APOS}s| is| was)? (?:the |a |an )?(?:[\\w-]+ ){0,3}?best\\b[^.?!]{0,30}\\btools?\\b` +
      `|\\b(?:we|we${APOS}re|we${APOS}ve) (?:are |built |make |offer |have |made )?(?:the |a )?best\\b[^.?!]{0,30}\\btools?\\b` +
      '|\\b(?:crawlmouse|our [\\w-]+(?: [\\w-]+)?) (?:is|are) the best\\b' +
      '|\\bthe best\\b[^.?!]{0,30}\\btools?\\b[^.?!]{0,10}(?:\\bis\\b|:) crawlmouse\\b',
    'a superlative about our own product, with no source',
  ),
  phrase(
    '100% (as a promise)',
    `${NOT_NEGATED}(?<![\\d.,])100 ?%(?![\\w*])(?: (?:accurate|accuracy|free|guaranteed|safe|secure|reliable|uptime|success|satisfaction|visible|visibility|indexed|compliant|private|automatic|automated|correct|certain|sure|complete|coverage)\\b| of the time\\b)`,
    'a promise of certainty no measurement supports',
  ),
];

export interface PhraseMatch {
  id: string;
  /** The text that matched, as it stands in the source. */
  match: string;
}

/** Every banned phrase in `text`, in list order, each match once. */
export function bannedMatches(text: string): PhraseMatch[] {
  const flat = text.replace(/\s+/g, ' ');
  const out: PhraseMatch[] = [];
  for (const p of BANNED_PHRASES) {
    for (const m of flat.matchAll(new RegExp(p.pattern.source, 'gi'))) {
      out.push({ id: p.id, match: m[0] });
    }
  }
  return out;
}
