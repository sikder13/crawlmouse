/**
 * `/bot` names the identities the crawl worker really sends (RC-35, inbox 031). Its strings are held
 * to the worker's own constants, so the page cannot drift from the requests a site sees.
 */
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

  it('no longer names the v1 user agent', () => {
    expect(text()).not.toContain('CrawlmouseBot/1.0');
  });

  it('keeps its title, H1 and canonical', () => {
    expect(metadata.title).toBe('CrawlmouseBot — about our crawler');
    expect(metadata.alternates).toEqual({ canonical: '/bot' });
    expect(renderToStaticMarkup(<BotPage />)).toMatch(/<h1[^>]*>CrawlmouseBot<\/h1>/);
  });
});
