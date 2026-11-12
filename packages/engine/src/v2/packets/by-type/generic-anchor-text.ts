/**
 * generic_anchor_text: a hub whose outbound links are mostly generic (detectors/generic-anchors.ts).
 * The record's evidence is the generic links; their texts and their targets' titles are the check's
 * rows for those links.
 *
 * Verify reads the text of each `<a>` on the hub and passes when none of it is one of the recorded
 * generic texts. Texts are compared without case, with runs of spaces collapsed and the tags inside
 * a link removed, which is how the crawl reads link text. It also needs the page to have link text
 * at all, so a page that was not served, or whose links were removed, does not pass.
 */
import { TOP_HUB_FRACTION } from '../../detectors/thresholds.js';
import { ANCHOR_TEXTS, command, fetchOf, noneOf } from '../html-checks.js';
import { crawledWord } from '../shell.js';
import { filedLinks, plural, subjectOf, titleOf } from '../structure.js';
import { clean, code, count, line, list, type Line } from '../text.js';
import type { PacketEntry, PacketFacts, RecordOf } from '../types.js';

/** The generic links a packet lists one by one, and the distinct texts its command names. */
const MAX_LINKS = 8;
const MAX_TEXTS = 20;
const MAX_TEXT_CHARS = 80;

interface GenericLink {
  to: string;
  /** The link's text as recorded; null when the check holds no such link. */
  text: string | null;
}

function linksOf(fix: RecordOf<'generic_anchor_text'>, facts: PacketFacts): GenericLink[] {
  const texts = new Map(
    filedLinks(facts).map((e) => [`${e.from_url}\u0000${e.to_url}`, e.anchor_text]),
  );
  return fix.evidence.edges.map((e) => ({
    to: e.to_url,
    text: texts.get(`${e.from_url}\u0000${e.to_url}`) ?? null,
  }));
}

/** The recorded texts, each once whatever its case, in the record's order. */
function distinctTexts(links: readonly GenericLink[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { text } of links) {
    const key = text === null ? '' : clean(text).toLowerCase();
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(text!);
  }
  return out;
}

export const genericAnchorText: PacketEntry<'generic_anchor_text'> = {
  kind: 'builder',
  context: (fix) => {
    const hub = subjectOf(fix);
    const generic = fix.evidence.edges.length;
    const share = count(Math.round(TOP_HUB_FRACTION * 100));
    // measured is the generic share of the recorded links, so the links recorded are generic / share
    const recorded = fix.measured === null ? null : Math.round(generic / fix.measured);
    return [
      recorded === null
        ? line`${code(hub)} is a hub, one of the top ${share}% of crawled pages by internal PageRank, and ${count(generic)} of its recorded links have generic text.`
        : line`${code(hub)} is a hub, one of the top ${share}% of crawled pages by internal PageRank, and ${count(generic)} of its ${count(recorded)} recorded links have generic text.`,
      line`The crawl records one link for each target, with the first link text it found.`,
    ];
  },
  generic: (fix, facts) => {
    const links = linksOf(fix, facts);
    const rest = links.length - Math.min(links.length, MAX_LINKS);
    const shown = links.slice(0, MAX_LINKS).map(({ to, text }): Line => {
      const title = titleOf(facts.pages.get(to));
      const said = text === null ? code('') : code(text, MAX_TEXT_CHARS);
      return title === null
        ? line`${said} to ${code(to)}.`
        : line`${said} to ${code(to)}, whose title is ${code(title, MAX_TEXT_CHARS)}.`;
    });
    return {
      change: [
        line`Replace the text of each of these links with words that name the page it leads to.`,
        ...shown,
        ...(rest === 0
          ? []
          : [
              line`${count(rest)} more generic ${plural(rest, 'link', 'links')} on this page ${plural(rest, 'is', 'are')} not listed here.`,
            ]),
        line`Another stock phrase ("read more" in place of "click here") is still generic: name the destination.`,
      ],
      keep: [line`Keep each link's target and its place on the page: only the text changes.`],
    };
  },
  stacks: {},
  verify: (fix, facts) => {
    const hub = subjectOf(fix);
    const texts = distinctTexts(linksOf(fix, facts));
    if (texts.length === 0) {
      throw new Error('packets: a generic_anchor_text record names no link text the check holds');
    }
    const named = texts.slice(0, MAX_TEXTS);
    const fetch = fetchOf(facts, [hub]);
    const generic = fix.evidence.edges.length;
    return {
      command: command(
        fetch.fragment,
        ANCHOR_TEXTS,
        noneOf(named.map((t) => crawledWord(t, MAX_TEXT_CHARS))),
      ),
      expect: line`Exit status 0 once ${code(hub)} has link text and none of it is ${list(
        texts.map((t) => code(t, MAX_TEXT_CHARS)),
        MAX_TEXTS,
        'text',
      )}, compared without case, with spaces collapsed and the tags inside a link removed. Today the crawl recorded ${count(generic)} such ${plural(generic, 'link', 'links')}.`,
      ua: fetch.ua,
    };
  },
};
