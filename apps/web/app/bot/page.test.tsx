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

  it('says a crawler with no published user agent is sent by name', () => {
    expect(CRAWLERS.some((c) => c.bareTokenOf !== null)).toBe(true);
    expect(text()).toContain('or just its name where its operator publishes none');
  });

  it('the crawl identity carries the From header the list gives it', () => {
    expect(CRAWL.headers).toContainEqual(['From', FROM]);
    expect(CONTROL.headers.some(([name]) => name === 'From')).toBe(false);
  });

  it('renders the opener with its spaces', () => {
    expect(text()).toContain('Crawlmouse/2.0 or CrawlmouseBot in your access logs.');
  });

  it.each([
    ['Finding pages', 'No From header.', 'Does not depend on robots.txt.'],
    ['Reading robots.txt', `From: ${FROM}`, 'Does not depend on robots.txt.'],
    ['Page requests, and checks for site files', `From: ${FROM}`, 'Obeys robots.txt.'],
    ['AI crawler tests', `From: ${FROM}`, 'Obeys robots.txt.'],
    ['A comparison request', 'No From header.', 'Obeys robots.txt.'],
    ['When a crawler test is refused', `From: ${FROM}`, 'Obeys robots.txt.'],
    ['When someone verifies ownership', 'No From header.', 'Does not depend on robots.txt.'],
  ])('%s: %s %s', (what, from, robots) => {
    const items = renderToStaticMarkup(<BotPage />)
      .split('<li>')
      .map((li) => li.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
    const item = items.find((li) => li.trim().startsWith(what));
    expect(item).toBeDefined();
    expect(item).toContain(from);
    expect(item).toContain(robots);
  });

  it('does not claim robots.txt governs every request', () => {
    expect(text()).not.toContain('on every request');
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
