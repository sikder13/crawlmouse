/**
 * Hand-made packets with more than one body, for the tests of the framework switch, the packet
 * route and the Pro wall: the contract fixtures hold one body per packet.
 */
import { FixSchema, type Fix } from '@crawlmouse/types/v2';
import type { FixPacket, PacketBody, PacketFramework } from '../segment/fixes';

/** A body for `framework` whose every string names it, so a test can tell whose text it met. */
export const bodyFor = (framework: PacketFramework): PacketBody => ({
  framework,
  context: [`The ${framework} context line of this hand-made body, long enough to search for.`],
  change: [
    `Open the ${framework} template named in the first step of this body.`,
    `Render the ${framework} description on the server in its second step.`,
  ],
  keep: [`Keep the ${framework} "price" block where it is, as this body's keep line says.`],
  verify: {
    command: `curl -s https://example.test/${framework}/page | grep -c "${framework}-marker"`,
    expect: `1 or more for the ${framework} body (today: 0)`,
    ua: null,
  },
});

/** `packet` with a body added for each of `others`, listed as the contract requires. */
export function withBodies(packet: FixPacket, others: readonly PacketFramework[]): FixPacket {
  if (others.includes(packet.framework)) {
    throw new Error(`the packet's own body is already written for ${packet.framework}`);
  }
  return {
    ...packet,
    frameworks: [packet.framework, ...others],
    packets: others.map(bodyFor),
  };
}

/** Each string of each body of a packet: its own framework's, and those in `packets`. */
export const everyPacketString = (p: FixPacket): string[] =>
  [p, ...p.packets].flatMap((b) => [
    ...b.context,
    ...b.change,
    ...b.keep,
    b.verify.command,
    b.verify.expect,
  ]);

/** `fix` as the contract parses it, so a hand-made packet is one the contract accepts. */
export const parsed = (fix: Fix): Fix => FixSchema.parse(fix);
