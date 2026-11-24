/**
 * `/bot` names the identities the crawl worker really sends (RC-35, inbox 031). Its strings are held
 * to the worker's own constants, so the page cannot drift from the requests a site sees.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  CANARY,
  CONTROL,
  CRAWL,
  CRAWLERS,
  FROM,
  TAG,
} from '../../../../packages/worker/src/identities';
import { CRAWLER_TAG, CRAWL_USER_AGENT, FROM_ADDRESS } from '../../lib/v2/help/pinned';

vi.mock('@/components/layout/Header', () => ({ Header: () => null }));
vi.mock('@/components/layout/Footer', () => ({ Footer: () => null }));

import BotPage, { metadata } from './page';

const text = () =>
  renderToStaticMarkup(<BotPage />)
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'");

describe('/bot', () => {
  it('its constants are the worker’s', () => {
    expect(CRAWL_USER_AGENT).toBe(CRAWL.userAgent);
    expect(CRAWLER_TAG).toBe(TAG);
    expect(FROM_ADDRESS).toBe(FROM);
  });

  it('names the page requests’ user agent, the crawler tag and the From header', () => {
    const t = text();
    expect(t).toContain(CRAWL.userAgent);
    expect(t).toContain(TAG);
    expect(t).toContain(`From: ${FROM}`);
  });

  it('discloses the canary and the untagged control', () => {
    expect(CANARY.userAgent).toContain(TAG);
    expect(CONTROL.userAgent).not.toContain('Crawlmouse');
    const t = text();
    expect(t).toContain('Googlebot');
    expect(t).toContain('ordinary browser user agent, with no Crawlmouse tag');
  });

  it('says every crawler test carries the tag, which holds for each identity', () => {
    for (const c of CRAWLERS) expect(c.userAgent.endsWith(TAG)).toBe(true);
  });

  it('says a crawler with no published user agent is sent by name', () => {
    expect(CRAWLERS.some((c) => c.bareTokenOf !== null)).toBe(true);
    expect(text()).toContain('or just its name where its operator publishes none');
  });

  it('names the earlier crawler name that domain verification still sends', () => {
    const verification = readFileSync(join(process.cwd(), 'lib/verification.ts'), 'utf8');
    expect(verification).toContain("userAgent: 'CrawlmouseBot/");
    expect(text()).toContain('verifies ownership of a domain');
    expect(text()).toContain('under our earlier name, CrawlmouseBot');
  });

  it('says discovery sends no From header, as its fetcher does', () => {
    const discover = readFileSync(join(process.cwd(), 'lib/v2/pipeline/discover.ts'), 'utf8');
    expect(discover).not.toMatch(/\bFrom\b.*bot@|headers:/);
    expect(text()).toContain('read robots.txt and sitemap files with the User-Agent below');
  });

  it('does not claim robots.txt governs every request', () => {
    expect(text()).not.toContain('on every request');
    expect(text()).toContain('do not depend on it');
  });

  it('keeps the journey’s rule: no v1 version string', () => {
    expect(text()).not.toContain('CrawlmouseBot/1.0');
  });

  it('keeps its title, H1 and canonical', () => {
    expect(metadata.title).toBe('CrawlmouseBot — about our crawler');
    expect(metadata.alternates).toEqual({ canonical: '/bot' });
    expect(renderToStaticMarkup(<BotPage />)).toMatch(/<h1[^>]*>CrawlmouseBot<\/h1>/);
  });
});
