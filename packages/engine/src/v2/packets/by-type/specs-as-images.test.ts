import { afterEach, describe, expect, it } from 'vitest';
import { MIN_SPEC_LINES, SPEC_IMAGE } from '../../content/thresholds.js';
import {
  closeSites,
  commandOn,
  contentFacts,
  contentCommandOnSites,
  contentPacketProperties,
  contentRecord,
  engineVerdict,
  statusesOn,
} from '../test-support/content.js';
import { ld, page } from '../test-support/content-pages.js';
import { writePacket } from '../registry.js';

const TYPE = 'specs_as_images';

const IMAGE = '<img src="/img/ridge-tent-specifications.png" alt="Specifications">';
const product = (body: string) =>
  page(
    ld({ '@type': 'Product', name: 'Ridge tent' }),
    `<h1>Ridge tent</h1><p>A three-season tent.</p>${body}`,
  );
const TABLE =
  '<table><tr><th>Weight</th><td>2.4 kg</td></tr><tr><th>Poles</th><td>2</td></tr></table>';
const BROKEN = product(IMAGE);
const FIXED = product(`${IMAGE}${TABLE}`);

afterEach(closeSites);

describe('specs_as_images: what the packet says', () => {
  const packet = writePacket(TYPE, contentRecord(TYPE), contentFacts())!;

  it('states the rule with the check’s own pattern and number', () => {
    const text = packet.context.join(' ');
    expect(text).toContain(`\`${SPEC_IMAGE.source}\``);
    expect(text).toContain(`fewer than ${MIN_SPEC_LINES} `);
  });

  it('does not name the image: the record does not hold it', () => {
    expect(packet.context.join(' ')).toMatch(/does not record which image/);
  });

  it('keeps the image, and adds no specification the image does not show', () => {
    expect(packet.keep.join(' ')).toMatch(/Keep the image/);
    expect(packet.change.join(' ')).toMatch(/the image shows/);
  });

  it('writes the generic body alone', () => {
    expect(packet.frameworks).toEqual(['generic']);
  });
});

describe('specs_as_images: the command and the engine’s check', () => {
  it('fails on the broken page and passes on the fixed one, as the check does', async () => {
    expect(engineVerdict(TYPE, BROKEN)).toBe('fail');
    expect(engineVerdict(TYPE, FIXED)).toBe('pass');
    const run = await commandOn(TYPE, { broken: BROKEN, fixed: FIXED });
    expect(run.broken.status).not.toBe(0);
    expect(run.fixed.status).toBe(0);
  });

  it('fails on a page that still gives no specification as text', async () => {
    const lazy: Record<string, string> = {
      '/one-labelled-line': product(`${IMAGE}<p>Weight: 2.4 kg</p>`),
      '/word-in-text': product(`${IMAGE}<p>See the table: &lt;table&gt;&lt;td&gt;2.4 kg</p>`),
      '/table-in-the-footer': product(IMAGE).replace('<footer>', `<footer>${TABLE}`),
      '/alt-text-only': product(IMAGE.replace('Specifications', 'Specifications: weight 2.4 kg')),
    };
    for (const [path, html] of Object.entries(lazy)) {
      expect(engineVerdict(TYPE, html), path).toBe('fail');
    }
    const statuses = await statusesOn(TYPE, lazy);
    for (const [path, status] of Object.entries(statuses)) expect(status, path).not.toBe(0);
  });

  it('fails on a table or list with no value in it, which the check itself would pass', async () => {
    const hollow: Record<string, string> = {
      '/empty-table': product(`${IMAGE}<table></table>`),
      '/empty-cells': product(`${IMAGE}<table><tr><td> </td><td></td></tr></table>`),
      '/terms-only': product(`${IMAGE}<dl><dt>Weight</dt></dl>`),
      '/cell-outside-a-table': product(`${IMAGE}<td>2.4 kg</td>`),
    };
    expect(engineVerdict(TYPE, hollow['/empty-table']!)).toBe('pass');
    const statuses = await statusesOn(TYPE, hollow);
    for (const [path, status] of Object.entries(statuses)) expect(status, path).not.toBe(0);
  });

  it('passes on a table or a description list with values', async () => {
    const fixed: Record<string, string> = {
      '/description-list': product(`${IMAGE}<dl><dt>Weight</dt><dd>2.4 kg</dd></dl>`),
      '/inline-tags': product(
        `${IMAGE}<table class="specs"><tr><td><strong>2.4</strong> kg</td></tr></table>`,
      ),
      '/upper-case-tags': product(`${IMAGE}<TABLE><TR><TD>2.4 kg</TD></TR></TABLE>`),
      '/across-lines': product(
        `${IMAGE}<table>\n<tr>\n<td\n class="v">\n2.4 kg\n</td>\n</tr>\n</table>`,
      ),
    };
    for (const [path, html] of Object.entries(fixed)) {
      expect(engineVerdict(TYPE, html), path).toBe('pass');
    }
    const statuses = await statusesOn(TYPE, fixed);
    for (const [path, status] of Object.entries(statuses)) expect(status, path).toBe(0);
  });

  it('does not count labelled lines, which the check accepts, and its packet says so', async () => {
    const html = product(`${IMAGE}<p>Weight: 2.4 kg</p><p>Packed length: 45 cm</p>`);
    expect(engineVerdict(TYPE, html)).toBe('pass');
    expect((await statusesOn(TYPE, { '/lines': html }))['/lines']).not.toBe(0);
    expect(writePacket(TYPE, contentRecord(TYPE), contentFacts())!.verify.expect).toMatch(
      /labelled lines .* not this command/,
    );
  });
});

contentPacketProperties(TYPE);
contentCommandOnSites(TYPE, { broken: BROKEN, fixed: FIXED });
