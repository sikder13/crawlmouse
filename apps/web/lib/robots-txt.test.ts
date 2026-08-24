import { describe, it, expect } from 'vitest';
import { AI_CRAWLERS, robotsTxt } from './robots-txt';

const txt = robotsTxt();
const lines = txt.split('\n');

// The BYTES the metadata route (app/robots.ts) served in production before this file existed,
// captured from https://crawlmouse.com/robots.txt. The move to a route handler had to be invisible
// to every consumer already reading it, so the whole pre-existing document is pinned here — not a
// property of it. If any line below changes, that is a behaviour change, not a refactor.
const PRE_EXISTING_GROUP = [
  'User-Agent: *',
  'Allow: /',
  'Disallow: /embed/',
  'Disallow: /audit/',
  'Disallow: /dashboard',
  'Disallow: /verify/',
].join('\n');

const PRE_EXISTING_TRAILER = ['Host: crawlmouse.com', 'Sitemap: https://crawlmouse.com/sitemap.xml'].join('\n');

describe('robots.txt — the pre-existing document is preserved exactly', () => {
  it('reproduces the old wildcard group character-for-character, as one contiguous block', () => {
    // Contiguous matters: asserting the six lines individually would still pass if a new
    // directive were spliced INTO the group, which is exactly the regression an additive
    // change must not make.
    expect(txt).toContain(PRE_EXISTING_GROUP);
  });

  it('reproduces the old Host + Sitemap trailer character-for-character', () => {
    expect(txt).toContain(PRE_EXISTING_TRAILER);
  });

  it('keeps the wildcard group ahead of the trailer, as before', () => {
    // The two blocks above are pinned separately rather than as one span BECAUSE the new
    // named groups sit between them. That placement is correct robots.txt — Host and
    // Sitemap are non-group records and belong at the end — and pinning the old file as a
    // single contiguous span would have forced the additions after `Sitemap:`, which is
    // where no crawler expects a group. Order is what actually has to hold.
    expect(txt.indexOf(PRE_EXISTING_GROUP)).toBeLessThan(txt.indexOf(PRE_EXISTING_TRAILER));
  });

  it('keeps all four private disallows inside the wildcard group', () => {
    const star = txt.slice(txt.indexOf('User-Agent: *'));
    const group = star.slice(0, star.indexOf('\n\n'));
    for (const p of ['/embed/', '/audit/', '/dashboard', '/verify/']) {
      expect(group, `wildcard group must disallow ${p}`).toContain(`Disallow: ${p}`);
    }
  });

  it('still does NOT block /r/ — report indexing is page-controlled', () => {
    expect(txt).not.toContain('Disallow: /r/');
  });

  it('emits exactly one wildcard group', () => {
    expect(txt.match(/^User-Agent: \*$/gm) ?? []).toHaveLength(1);
  });
});

describe('robots.txt — the AI access declaration', () => {
  it('opens with the Content Signals comment', () => {
    // The spec places it at the top of the file, before any group. This is also why the
    // metadata route could not be kept: MetadataRoute.Robots has no way to emit a comment.
    expect(lines[0]).toBe('# Content-Signal: search=yes, ai-input=yes, ai-train=yes');
  });

  it('names all twelve crawlers, each with its own Allow: /', () => {
    expect(AI_CRAWLERS).toHaveLength(12);
    for (const agent of AI_CRAWLERS) {
      expect(txt, agent).toContain(`User-Agent: ${agent}\nAllow: /`);
    }
  });

  it('covers search, agent and training for both assistants we care about', () => {
    // Not a style check: these do different jobs and allowing one does not allow the others.
    // Missing the -SearchBot keeps us out of the index an assistant answers from even while
    // its training crawler is welcome.
    for (const a of ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User']) {
      expect(AI_CRAWLERS, a).toContain(a);
    }
  });

  it('allows Bingbot by name', () => {
    // ChatGPT and Copilot retrieval runs through Bing's index — this line is the difference
    // between being quotable by both and invisible to both, whatever else the file says.
    expect(AI_CRAWLERS).toContain('Bingbot');
  });

  it('gives the named agents NO disallows — they are allow-only groups', () => {
    // A named group does not inherit the wildcard's disallows, so a stray Disallow here would
    // silently narrow access for exactly the crawlers this change is meant to invite.
    for (const agent of AI_CRAWLERS) {
      const at = txt.indexOf(`User-Agent: ${agent}\n`);
      const group = txt.slice(at, txt.indexOf('\n\n', at));
      expect(group, `${agent} group must be allow-only`).not.toContain('Disallow');
    }
  });

  it('ends with a newline and has no blank-line runs', () => {
    expect(txt.endsWith('\n')).toBe(true);
    expect(txt).not.toContain('\n\n\n');
  });
});
