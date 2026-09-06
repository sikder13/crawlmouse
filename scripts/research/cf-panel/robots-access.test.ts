import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseRobotsTxt, isAllowedByRobots } from '@crawlmouse/engine';
import { accessForToken, accessMatrix, extractContentSignals, selectGroup } from './robots-access.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

describe('user-agent group selection — longest prefix wins, * is the fallback', () => {
  const robots = parseRobotsTxt(fixture('longest-match.txt'));

  it('picks the longest group that prefixes the token', () => {
    expect(selectGroup(robots, 'Googlebot-News').key).toBe('googlebot-news');
    expect(selectGroup(robots, 'Googlebot').key).toBe('googlebot');
    expect(selectGroup(robots, 'Google-Extended').key).toBe('google');
  });

  it('falls back to * only when no group prefixes the token', () => {
    expect(selectGroup(robots, 'GPTBot').key).toBe('*');
  });

  it('returns no group at all when the file has neither a match nor a *', () => {
    expect(selectGroup(parseRobotsTxt(fixture('empty-groups.txt')), 'GPTBot').key).toBeNull();
  });

  it('matching is case-insensitive on both sides', () => {
    const r = parseRobotsTxt('User-agent: GPTBOT\nDisallow: /\n');
    expect(selectGroup(r, 'gptbot').key).toBe('gptbot');
    expect(accessForToken(r, 'GPTBot').status).toBe('disallowed_root');
  });

  // Independently computed truth, and the case where this rule and the engine's differ. Read the
  // fixture by hand: `User-agent: Applebot / Disallow: /`. "applebot" is a prefix of
  // "applebot-extended", so RFC 9309 selects that group and the token is blocked at the root.
  it('a shorter group blocks a longer token — where the engine, matching exact keys, does not', () => {
    const r = parseRobotsTxt(fixture('content-signals.txt'));
    expect(accessForToken(r, 'Applebot-Extended').status).toBe('disallowed_root');
    expect(accessForToken(r, 'Applebot-Extended').matchedGroup).toBe('applebot');
    // The divergence is the reason group selection is not delegated. Pinned so it cannot drift
    // unnoticed: if the engine ever adopts prefix matching, this line is what says so.
    expect(isAllowedByRobots(r, 'Applebot-Extended', '/')).toBe(true);
  });
});

describe('access classification', () => {
  it('names the four states', () => {
    const r = parseRobotsTxt(fixture('longest-match.txt'));
    // Googlebot-News: its own group, Disallow: / → the whole site.
    expect(accessForToken(r, 'Googlebot-News').status).toBe('disallowed_root');
    // Googlebot: its own group, one path blocked, root reachable.
    expect(accessForToken(r, 'Googlebot').status).toBe('partially_disallowed');
    // GPTBot: no group of its own, falls to * which blocks /admin/ only.
    const gpt = accessForToken(r, 'GPTBot');
    expect(gpt.status).toBe('partially_disallowed');
    expect(gpt.mentioned).toBe(false);
    // Nothing in the file applies at all.
    expect(accessForToken(parseRobotsTxt(fixture('empty-groups.txt')), 'GPTBot').status).toBe('unmentioned');
  });

  it('a bare group with no rules is allowed', () => {
    const r = parseRobotsTxt('User-agent: GPTBot\nAllow: /\n');
    expect(accessForToken(r, 'GPTBot').status).toBe('allowed');
  });

  // The state that matters most for the study: `*` blocking everything is a real block, and must
  // never be reported as "unmentioned" just because the bot was not named.
  it('a * that blocks the site blocks a bot that is never named', () => {
    const r = parseRobotsTxt(fixture('star-only.txt'));
    const a = accessForToken(r, 'ClaudeBot');
    expect(a.status).toBe('disallowed_root');
    expect(a.mentioned).toBe(false);
    expect(a.matchedGroup).toBe('*');
  });

  it('honours wildcard and $ path rules through the engine matcher', () => {
    const r = parseRobotsTxt('User-agent: GPTBot\nDisallow: /*.pdf$\n');
    expect(accessForToken(r, 'GPTBot').status).toBe('partially_disallowed');
  });

  it('returns one row per requested token, in order', () => {
    const rows = accessMatrix(fixture('star-only.txt'), ['GPTBot', 'Googlebot']);
    expect(rows.map((r) => r.token)).toEqual(['GPTBot', 'Googlebot']);
  });
});

describe('Content Signals extraction', () => {
  it('captures the signal line and the convention link verbatim, in file order', () => {
    const lines = extractContentSignals(fixture('content-signals.txt'));
    expect(lines).toEqual([
      '# Learn more at https://contentsignals.org',
      '# Content-Signal: search=yes, ai-input=yes, ai-train=no',
    ]);
  });

  it('captures a bare directive form as well as the comment form', () => {
    expect(extractContentSignals('Content-Signal: ai-train=no\n')).toEqual(['Content-Signal: ai-train=no']);
  });

  it('finds nothing in a file that has none', () => {
    expect(extractContentSignals(fixture('star-only.txt'))).toEqual([]);
  });

  it('does not mistake a mention of the words for a signal line', () => {
    expect(extractContentSignals('# we thought about content signals but did not add any\n')).toEqual([]);
  });
});
