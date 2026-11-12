/**
 * A fix's packet from its builder: one body per framework the builder writes, the detected stack's
 * first (stack.ts), and the bounds every packet is held to.
 *
 * `frameworks` is computed from the bodies written, so it lists no framework without one. The context
 * and the verify block are written once and shared by every body; only the change and what to keep
 * differ by stack.
 *
 * Bounds (`PACKET_BOUNDS`). A line longer than `line_chars` code points is cut and says how long it
 * was. A section longer than `section_lines` lines keeps its first `section_lines` and a last line
 * counts the rest.
 *
 * `packet_chars` bounds a packet that holds more than one body: past that many characters as JSON, a
 * packet keeps the body for its own framework and its context says the others were left out. It is
 * not a bound on what is left. One body is as long as its three sections, its `expect` and its
 * command, and a command is not cut here: a cut command is a different command. Its length is bounded
 * where it is written: the structure builders name a fixed number of a record's URLs, which the
 * worker stores up to MAX_URL_LENGTH characters, and stop a list at a stated length, the `expect`
 * saying what was left out (html-checks.ts `COMMAND_BOUNDS`). compose.test.ts holds those builders' packets to
 * `one_body_chars` over records whose URLs are the worker's longest and whose lists are its largest;
 * that is a measured bound for those builders, and `compose` enforces none on a single body.
 */
import { PacketFrameworkSchema } from '@crawlmouse/types/v2';
import { commandOf } from './shell.js';
import { frameworkOf } from './stack.js';
import { textOf, type Line } from './text.js';
import type {
  Change,
  FixPacket,
  PacketBuilder,
  PacketFacts,
  PacketFramework,
  StackFramework,
} from './types.js';

export const PACKET_BOUNDS = {
  line_chars: 600,
  section_lines: 12,
  packet_chars: 40_000,
  one_body_chars: 64_000,
} as const;

type Body = FixPacket['packets'][number];

/** The frameworks a builder may write a stack body for, in the contract's order. */
const STACKS = PacketFrameworkSchema.options.filter((f): f is StackFramework => f !== 'generic');

function boundedLine(text: string): string {
  const points = [...text];
  if (points.length <= PACKET_BOUNDS.line_chars) return text;
  const kept = points.slice(0, PACKET_BOUNDS.line_chars).join('');
  // a cut inside a code span leaves it open; close it, so the note is not read as crawled text
  const open = (kept.match(/`/g) ?? []).length % 2 === 1;
  return `${kept}${open ? '`' : ''} (line cut from ${points.length} characters)`;
}

function boundedSection(lines: readonly Line[]): string[] {
  const texts = lines.map((l) => boundedLine(textOf(l)));
  const rest = texts.length - PACKET_BOUNDS.section_lines;
  if (rest <= 0) return texts;
  return [
    ...texts.slice(0, PACKET_BOUNDS.section_lines),
    `${rest} more line${rest === 1 ? ' is' : 's are'} not shown: a packet section holds ${PACKET_BOUNDS.section_lines}.`,
  ];
}

export function compose<R>(builder: PacketBuilder<R>, fix: R, facts: PacketFacts): FixPacket {
  const context = boundedSection(builder.context(fix, facts));
  const proof = builder.verify(fix, facts);
  const verify = {
    command: commandOf(proof.command),
    expect: boundedLine(textOf(proof.expect)),
    ua: proof.ua,
    see: {
      command: commandOf(proof.see.command),
      today: boundedLine(textOf(proof.see.today)),
      after: boundedLine(textOf(proof.see.after)),
    },
  };
  const body = (framework: PacketFramework, c: Change): Body => {
    const change = boundedSection(c.change);
    if (context.length === 0 || change.length === 0) {
      throw new Error(`packets: the ${framework} body has no context or no change`);
    }
    return { framework, context, change, keep: boundedSection(c.keep), verify };
  };
  const bodies: Body[] = STACKS.flatMap((framework) => {
    const change = builder.stacks[framework]?.write(fix, facts) ?? null;
    return change === null ? [] : [body(framework, change)];
  });
  bodies.push(body('generic', builder.generic(fix, facts)));

  const detected = frameworkOf(facts.stack);
  const own = bodies.find((b) => b.framework === detected) ?? bodies.at(-1)!;
  const others = bodies.filter((b) => b !== own);
  const packet: FixPacket = {
    ...own,
    frameworks: [own.framework, ...others.map((b) => b.framework)],
    packets: others,
  };
  const size = JSON.stringify(packet).length;
  if (size <= PACKET_BOUNDS.packet_chars || others.length === 0) return packet;
  return {
    ...own,
    context: [
      ...own.context,
      `This packet passed ${PACKET_BOUNDS.packet_chars} characters (${size}), so its ${others.length} rewrite${others.length === 1 ? '' : 's'} for other stacks ${others.length === 1 ? 'is' : 'are'} left out.`,
    ],
    frameworks: [own.framework],
    packets: [],
  };
}
