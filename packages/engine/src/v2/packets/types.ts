/**
 * What a packet builder reads and returns.
 *
 * A builder is a pure function of one fix's own record and `PacketFacts`: the check's stack, each
 * crawler's site verdict, and the check's rows for the pages, links and access tests the record names. The same
 * record and facts give the same packet (compose.test.ts).
 */
import type { AccessTest, Check, Fix, FixType, LinkEdge, PageResult } from '@crawlmouse/types/v2';
import type { AccessDetection, AccessFixType, CrawlerAccess } from '../access/types.js';
import type { ContentDetection, ContentFixType } from '../content/aggregate.js';
import type { RenderedDetection, RenderedFixType } from '../detectors/rendered.js';
import type { Detection } from '../detectors/types.js';
import type { Command } from './shell.js';
import type { Line } from './text.js';

/** A fix's packet, and the frameworks one is written for; the contract exports their schemas only. */
export type FixPacket = NonNullable<Fix['packet']>;
export type PacketFramework = FixPacket['framework'];

export interface PacketFacts {
  /** The URL the crawl started from, in the engine's canonical spelling. */
  homepage_url: string;
  /** The check's stack, as its Check record carries it (build/record.ts `stackOf`). */
  stack: NonNullable<Check['stack']>;
  /** Each crawler's verdict for the site, in registry order. */
  crawlers: readonly Pick<CrawlerAccess, 'ua' | 'verdict'>[];
  /** The check's pages, by URL, with their orphan verdict and suggested parent set. */
  pages: ReadonlyMap<string, PageResult>;
  /** The check's access test rows, which an access record names by id. */
  access_tests: readonly AccessTest[];
  /** The crawl's links, as recorded. */
  edges: readonly LinkEdge[];
}

/** The record a fix type's detector reports. */
export type RecordOf<T extends FixType> = T extends AccessFixType
  ? AccessDetection
  : T extends ContentFixType
    ? ContentDetection
    : T extends RenderedFixType
      ? RenderedDetection
      : Detection;

/** A framework a packet can be written for besides `generic`. */
export type StackFramework = Exclude<PacketFramework, 'generic'>;

/** The change to make and what to leave alone. */
export interface Change {
  change: Line[];
  keep: Line[];
}

/** The proof: a command that exits 0 once the fix has landed and not before, and what it shows. */
export interface Verify {
  command: Command;
  expect: Line;
  /** The registry token of the crawler the command requests as; null when it requests as none. */
  ua: string | null;
  /** The readable layer above the strict command. */
  see: See;
}

/**
 * A short command a developer reads in ten seconds, which prints the evidence, with what it prints
 * today and what it prints once the fix has landed. It proves nothing by its exit status: `command`
 * is the check.
 */
export interface See {
  command: Command;
  /** What it prints today, from the record. */
  today: Line;
  /** What it prints once the fix has landed. */
  after: Line;
}

/** A page of the platform's own documentation that a stack's steps rest on. */
export interface DocSource {
  title: string;
  url: string;
  /** The date the page was read (YYYY-MM-DD). */
  read: string;
  /** Which step it supports, in a few words. */
  supports: string;
}

export interface StackBody<R> {
  /** The change on this stack; null when the stack has no change of its own for this record. */
  write(fix: R, facts: PacketFacts): Change | null;
  sources: readonly DocSource[];
}

export interface PacketBuilder<R> {
  kind: 'builder';
  /** What is wrong, with the evidence. */
  context(fix: R, facts: PacketFacts): Line[];
  /** The change on any stack. */
  generic(fix: R, facts: PacketFacts): Change;
  /** The change on a named stack, where it differs and the platform's documentation supports it. */
  stacks: Partial<Record<StackFramework, StackBody<R>>>;
  verify(fix: R, facts: PacketFacts): Verify;
}

/** A fix type the engine writes no packet for, and why. */
export interface NoPacket {
  kind: 'none';
  reason: string;
}

export type PacketEntry<T extends FixType> = PacketBuilder<RecordOf<T>> | NoPacket;
