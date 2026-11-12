import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MailFrame } from './MailFrame';

describe('MailFrame (security review r1, N4)', () => {
  it('sandboxes the message: same origin for the height fit, and no script, form or navigation', () => {
    const out = renderToStaticMarkup(<MailFrame html="<p>x</p>" title="t" />);
    const sandbox = /<iframe[^>]*\ssandbox="([^"]*)"/.exec(out);
    expect(sandbox?.[1]).toBe('allow-same-origin');
  });
});
