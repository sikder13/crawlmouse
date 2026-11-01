import { describe, expect, it } from 'vitest';
import { findCheck, fixture, templateOf } from '../fixtures';
import { clock, duration } from '../format';
import { stateAt } from '../progress';
import { CHECKS, recording } from '../recordings';
import { HOME_CRAWLERS, homeView } from './home';
import { mapDrawing } from './map';

const d = fixture('bad-site');
const check = findCheck(d, CHECKS.badFirstAudit);
const end = stateAt(recording('bad-site').events, Infinity);
const view = homeView(d, CHECKS.badFirstAudit, { map: mapDrawing('bad-site'), end });

describe('Home’s example of words lost without JavaScript', () => {
  const page = d.page_results.find((p) => new URL(p.url).pathname === view.withoutJs.path)!;
  const key = templateOf(
    check.coverage!.templates.map((t) => t.template_key),
    page.url,
  );
  const template = check.coverage!.templates.find((t) => t.template_key === key)!;

  it('names a crawler the page has already shown, one that reads that template thin', () => {
    expect(HOME_CRAWLERS as readonly string[]).toContain(view.withoutJs.bot);
    const bot = check.crawlers.find((c) => c.ua === view.withoutJs.bot)!;
    expect(bot.by_template.find((t) => t.template_key === key)?.verdict).toBe('allowed_thin');
  });

  it('counts and names the example page’s own template, even when another template is larger', () => {
    // Make a template other than the page's the largest, so "the largest" and "the page's" differ.
    const variant = structuredClone(d);
    const other = findCheck(variant, CHECKS.badFirstAudit)
      .coverage!.templates.filter((t) => t.template_key !== key && t.template_key !== '/')
      .at(0)!;
    other.pages = template.pages + 100;
    const v = homeView(variant, CHECKS.badFirstAudit, { map: mapDrawing('bad-site'), end });
    expect(v.withoutJs.templatePages).toBe(template.pages);
    expect(template.label.toLowerCase()).toContain(v.withoutJs.templateNoun.toLowerCase());
    expect(other.label.toLowerCase()).not.toContain(v.withoutJs.templateNoun.toLowerCase());
  });
});

describe('Home’s example audit', () => {
  it('gives the same time, to the second, as the crawl screen’s clock, at any moment', () => {
    for (let ms = 0; ms < 200_000; ms += 250) {
      const [m, sec] = clock(ms).split(':').map(Number);
      expect(duration(ms), `${ms} ms`).toBe(m ? `${m} min ${sec} s` : `${sec} s`);
    }
    expect(view.example.duration).toBe(duration(end.elapsed_ms));
  });
});
