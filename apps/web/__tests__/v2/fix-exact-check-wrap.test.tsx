/**
 * CC-39 F4: the fix packet's "Exact check" command sat on one line in a strip that scrolled sideways
 * with no cue, so a long curl was cut at the box edge. It now wraps inside the packet box like the
 * text around it, and the copy and download actions still hand over the whole command.
 *
 * This reads the rule and the markup; it does not measure layout. No preview fixture carries a
 * body with both verify layers, so the geometry check is on a real fix page (CC-39 report-D3.md).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChosenPacket } from '../../components/v2/screens/fix/PacketChoice';
import { FIX_SOURCES, fixIdOf } from '../../app/(v2-preview)/v2-preview/_preview/fixes';
import { fixture } from '../../lib/v2/fixtures';
import { fixView } from '../../lib/v2/view/fix';
import { withBodies, withSee } from '../../lib/v2/view/test-support/multi-body';

const CSS = readFileSync(
  resolve(__dirname, '../../components/v2/screens/fix/FixScreen.module.css'),
  'utf8',
);

/** The declarations of the rule whose selector is exactly `selector`, outside any media query. */
function declarations(selector: string): string {
  const top = CSS.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*\s*\}/g, '');
  const at = top.indexOf(`\n${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return top.slice(at, top.indexOf('}', at));
}

const layered = (() => {
  const d = structuredClone(fixture('bad-site'));
  const f = d.fixes.find((x) => x.id === fixIdOf('bad-site'))!;
  f.packet = withSee(withBodies(f.packet!, ['generic']));
  const v = fixView(d, FIX_SOURCES['bad-site'].check, f.id, { asFirstSeen: true });
  if (v.kind !== 'open' || !v.packet) throw new Error('fix 2 opens with a packet');
  return v.packet;
})();

describe('the Exact check command in the packet (CC-39 F4)', () => {
  it('wraps inside the packet box instead of scrolling past its edge', () => {
    const rule = declarations('.exactLine');
    expect(rule).toMatch(/white-space: pre-wrap;/);
    expect(rule).toMatch(/overflow-wrap: anywhere;/);
    expect(rule).not.toMatch(/white-space: pre;/);
    expect(CSS).not.toMatch(/\n\.exact \{/);
  });

  it('draws the command whole in its own line of the packet, in no scroll region', () => {
    const body = layered.bodies[0]!;
    expect(body.exactLine).not.toBeNull();
    const command = body.block.split('\n')[body.exactLine!]!;
    const doc = new JSDOM(
      renderToStaticMarkup(
        <ChosenPacket bodies={layered.bodies} download={layered.download} ask={null} />,
      ),
    ).window.document;
    const packet = doc.querySelector('[data-v2-packet-layers]')!;
    expect(packet.querySelectorAll('[data-v2-scroll-region]')).toHaveLength(0);
    const pres = [...packet.querySelectorAll('pre')];
    expect(pres.map((p) => p.textContent).join('\n')).toBe(body.block);
    expect(packet.querySelectorAll('pre[data-v2-exact-check]')).toHaveLength(1);
    const exact = packet.querySelector('pre[data-v2-exact-check]')!;
    expect([...exact.classList].some((c) => /^_exactLine_/.test(c))).toBe(true);
    expect(exact.textContent).toBe(command);
    // What the copy and download buttons hand over carries the command whole.
    expect(body.prompt).toContain(command.trim());
  });
});
