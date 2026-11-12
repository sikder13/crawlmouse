'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { Heading } from '../../Heading';
import { ScrollRegion } from '../../ScrollRegion';
import type { PacketBodyView, PacketFramework } from '../../../../lib/v2/view/fix';
import { PacketActions } from '../segment/PacketActions';
import { DownloadText } from './DownloadText';
import styles from './FixScreen.module.css';

interface Choice {
  /** The framework the reader chose in the switch; null until they choose one. */
  chosen: PacketFramework | null;
  choose(framework: PacketFramework): void;
}

const ChoiceContext = createContext<Choice | null>(null);

/**
 * Which framework's body the fix page shows. The switch and the packet sit in different cards, so
 * the choice is held here, around both. Nothing is fetched on a choice: an open fix's bodies are
 * in the page (an audit nobody has kept cannot call the packet route).
 */
export function PacketChoice({ children }: { children: ReactNode }) {
  const [chosen, choose] = useState<PacketFramework | null>(null);
  return <ChoiceContext.Provider value={{ chosen, choose }}>{children}</ChoiceContext.Provider>;
}

/** The choice, for the switch; a switch outside `PacketChoice` would choose nothing. */
export function usePacketChoice(): Choice {
  const choice = useContext(ChoiceContext);
  if (choice === null) throw new Error('The framework switch is rendered outside PacketChoice');
  return choice;
}

/**
 * A body's block. Where it has both verify layers, its strict command (`exactLine`) is one line in
 * a strip that scrolls sideways (`ScrollRegion`: a tab stop while it overflows), between the text
 * above and below it: the command is whole in the page, for find-in-page and for selecting, and
 * takes one line of it however long it is.
 */
function PacketBlock({ body }: { body: PacketBodyView }) {
  const at = body.exactLine;
  if (at === null) return <pre className={styles.packet}>{body.block}</pre>;
  const lines = body.block.split('\n');
  const part = (from: number, to: number) => lines.filter((_, i) => i >= from && i < to).join('\n');
  return (
    <div className={styles.packet} data-v2-packet-layers="">
      <pre className={styles.packetPart}>{part(0, at)}</pre>
      <ScrollRegion label="Exact check command" className={styles.exact}>
        <pre className={styles.exactLine}>{lines[at]}</pre>
      </ScrollRegion>
      <pre className={styles.packetPart}>{part(at + 1, lines.length)}</pre>
    </div>
  );
}

/**
 * The packet as written for the chosen framework: which stack it is for, the block, and the copy
 * and download buttons, which hand over that body's prompt. Before a choice, and outside
 * `PacketChoice`, it is the first body, the packet's own.
 */
export function ChosenPacket({
  bodies,
  download,
  ask,
}: {
  bodies: PacketBodyView[];
  download: string;
  /** Where the email ask leads; null where there is no keep bar to open. */
  ask: string | null;
}) {
  const chosen = useContext(ChoiceContext)?.chosen ?? null;
  const body = bodies.find((b) => b.key === chosen) ?? bodies[0]!;
  return (
    <>
      <div className={styles.hd}>
        <Heading level={2} size="s">
          The packet
        </Heading>
        <div className={styles.hdSub}>{body.stack}</div>
      </div>
      <PacketBlock body={body} />
      <PacketActions prompt={body.prompt} primary ask={ask} className={styles.actions}>
        <DownloadText text={body.prompt} filename={download}>
          Download as .md
        </DownloadText>
      </PacketActions>
    </>
  );
}
