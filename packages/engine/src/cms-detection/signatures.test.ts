import { describe, it, expect } from 'vitest';
import { detectCms } from './index.js';

describe('detectCms', () => {
  it('detects Shopify from CDN reference + script tag', () => {
    const html = `<html><head><script src="https://cdn.shopify.com/s/x.js"></script></head></html>`;
    const result = detectCms(html, {});
    expect(result.cms).toBe('shopify');
    expect(result.confidence).toBeGreaterThan(0.6);
  });

  it('detects WordPress from wp-content', () => {
    const html = `<html><head><link href="/wp-content/themes/x/style.css"></head></html>`;
    expect(detectCms(html, {}).cms).toBe('wordpress');
  });

  it('detects Webflow from data-wf-page', () => {
    const html = `<html data-wf-page="abc"><body></body></html>`;
    expect(detectCms(html, {}).cms).toBe('webflow');
  });

  it('detects Wix from wixstatic', () => {
    const html = `<html><body><img src="https://static.wixstatic.com/x.png"></body></html>`;
    expect(detectCms(html, {}).cms).toBe('wix');
  });

  it('falls back to custom when no signature exceeds threshold', () => {
    const html = `<html><head><title>Plain</title></head><body>Hello.</body></html>`;
    const result = detectCms(html, {});
    expect(result.cms).toBe('custom');
    expect(result.confidence).toBeLessThan(0.6);
  });

  it('returns higher confidence with multiple matches', () => {
    const single = detectCms(`<script src="cdn.shopify.com"></script>`, {}).confidence;
    const multi = detectCms(
      `<script src="cdn.shopify.com"></script><script>Shopify.theme={}</script><div class="shopify-section"></div>`,
      {},
    ).confidence;
    expect(multi).toBeGreaterThan(single);
  });
});
