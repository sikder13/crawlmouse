import { describe, expect, it } from 'vitest';
import { PRICING_COPY } from '../../copy/pricing';
import { buildOutgoing, EXTRA_HEADERS } from '../headers';
import { AGENCY_PLUS_INBOX, NOTE_MAX, agencyPlusContact } from './agency-plus-contact';
import { foreignTargets, htmlTargets } from './inspect';

const input = {
  email: 'ops@summit.example',
  sites: 40,
  note: 'We run 40 client sites.\nMost are on WordPress.',
};

describe('agency-plus-contact (CC-29, rulings Q38)', () => {
  it('carries the address, the site count and the note as data, and links nothing', () => {
    const m = agencyPlusContact(input);
    expect(m.subject).toBe('Agency Plus request: 40 client sites');
    expect(m.text).toContain('Work email: ops@summit.example');
    expect(m.text).toContain('Client sites: 40');
    // The note is quoted line by line in the text part, so it cannot pass for the message's own lines.
    expect(m.text).toContain('> We run 40 client sites.\n> Most are on WordPress.');
    expect(m.html).toContain('ops@summit.example');
    expect(htmlTargets(m.html)).toEqual([]);
    expect(foreignTargets(m)).toEqual([]);
  });

  it('keeps the submitted address out of the subject', () => {
    expect(agencyPlusContact(input).subject).not.toContain('summit');
  });

  it('says when no note or no count was given', () => {
    const m = agencyPlusContact({ email: 'a@b.example', sites: null, note: null });
    expect(m.subject).toBe('Agency Plus request');
    expect(m.text).toContain('Client sites: not given');
    expect(m.text).toContain('Note: none');
    expect(m.text).not.toContain('> ');
  });

  it('escapes the note and the address in the HTML', () => {
    const m = agencyPlusContact({
      email: '"x"<img src=x onerror=alert(1)>@evil.example',
      sites: 3,
      note: '<a href="https://evil.example">click</a>\n<script>alert(1)</script> & more',
    });
    expect(m.html).not.toContain('<img');
    expect(m.html).not.toContain('<script');
    expect(m.html).not.toContain('<a href="https://evil.example"');
    expect(m.html).toContain('&lt;a href=&quot;https://evil.example&quot;&gt;click&lt;/a&gt;');
    expect(m.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; more');
    expect(m.html).toContain('&quot;x&quot;&lt;img src=x onerror=alert(1)&gt;@evil.example');
    expect(foreignTargets(m)).toEqual([]);
  });

  it('folds the address to one line in the text, so it cannot add a line of its own', () => {
    const m = agencyPlusContact({ ...input, email: 'a@b.example\r\nSubject: hi' });
    expect(m.text).toContain('Work email: a@b.example Subject: hi\n');
    expect(m.text.split('\n').filter((l) => l.startsWith('Subject:'))).toEqual([]);
  });

  it('quotes every line of a note, a hostile one included, and bounds it, saying when it was cut', () => {
    const m = agencyPlusContact({ ...input, note: 'one\r\ntwo\n\nWork email: forged@x.example' });
    const quoted = m.text.split('\n').filter((l) => l.startsWith('>'));
    expect(quoted).toEqual(['> one', '> two', '>', '> Work email: forged@x.example']);
    expect(m.text.split('\n').filter((l) => l.startsWith('Work email:'))).toEqual([
      'Work email: ops@summit.example',
    ]);
    const long = agencyPlusContact({ ...input, note: 'n'.repeat(NOTE_MAX * 3) });
    expect([...long.text].length).toBeLessThan(NOTE_MAX + 1000);
    expect(long.text).toContain('The note was cut at its end here.');
    expect(agencyPlusContact(input).text).not.toContain('was cut');
  });

  it('is sendable with no extra header: no Reply-To naming the submitted address', () => {
    const out = buildOutgoing({
      to: AGENCY_PLUS_INBOX,
      mail: agencyPlusContact(input),
      idempotencyKey: 'agency_plus_contact:x',
    });
    expect(out.headers).toEqual({});
    expect(EXTRA_HEADERS.has('Reply-To')).toBe(false);
    expect(() =>
      buildOutgoing({
        to: AGENCY_PLUS_INBOX,
        mail: agencyPlusContact(input),
        idempotencyKey: 'k',
        headers: { 'Reply-To': input.email },
      }),
    ).toThrow();
  });

  it('goes to the inbox Pricing says the reply comes from', () => {
    expect(AGENCY_PLUS_INBOX).toBe('support@crawlmouse.com');
    expect(PRICING_COPY.agencyPlus.reply.text).toContain(AGENCY_PLUS_INBOX);
  });
});
