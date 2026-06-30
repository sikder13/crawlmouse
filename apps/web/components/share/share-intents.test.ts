import { describe, it, expect } from 'vitest';
import { PROUD_THRESHOLD, shareIntentUrl, shareMessage } from './share-intents';

describe('shareMessage (grade-adaptive)', () => {
  it('is a proud flex at/above the threshold and carries the grade+score', () => {
    const m = shareMessage('A-', 91);
    expect(m.proud).toBe(true);
    expect(m.text).toContain('A-');
    expect(m.text).toContain('91');
  });

  it('is a challenge below the threshold', () => {
    const m = shareMessage('C', 64);
    expect(m.proud).toBe(false);
    expect(m.text).toContain('C');
    expect(m.text).toContain("What's yours");
  });

  it('the threshold is tunable (default 70)', () => {
    expect(PROUD_THRESHOLD).toBe(70);
    expect(shareMessage('B', 75, 80).proud).toBe(false);
    expect(shareMessage('B', 75, 70).proud).toBe(true);
  });
});

describe('shareIntentUrl', () => {
  const url = 'https://crawlmouse.com/r/abc';
  const text = "I scored A-/91 💪 How's your site?";

  it('builds whitelisted intent URLs with encoded params (no injection)', () => {
    expect(shareIntentUrl('x', url, text)).toContain('https://twitter.com/intent/tweet');
    expect(shareIntentUrl('linkedin', url, text)).toContain('https://www.linkedin.com/sharing/share-offsite/');
    expect(shareIntentUrl('whatsapp', url, text)).toContain('https://wa.me/');
    expect(shareIntentUrl('telegram', url, text)).toContain('https://t.me/share/url');
    expect(shareIntentUrl('facebook', url, text)).toContain('https://www.facebook.com/sharer/sharer.php');
    const x = shareIntentUrl('x', url, text);
    expect(x).toContain(encodeURIComponent(url));
    expect(x).not.toContain(' '); // fully encoded — no raw spaces / injection
  });
});
