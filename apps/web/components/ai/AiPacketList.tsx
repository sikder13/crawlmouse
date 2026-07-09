import type { ActionPacket } from '@crawlmouse/types';
import { Card } from '../ui/Card';
import { AiPacketCopy } from './AiPacketCopy';

// PRO — the deterministic AI-fix packets, server-populated only for the entitled owner (`aiPackets` is null
// for everyone else, so the controller never mounts this). Each packet body embeds crawled content that the
// engine already escaped for markdown structure; it is STILL rendered as escaped JSX text in a <pre>
// (defense-in-depth, A14/§12) — never dangerouslySetInnerHTML.
export function AiPacketList({ packets }: { packets: ActionPacket[] }) {
  return (
    <Card variant="raised">
      <div className="text-overline uppercase text-ink-muted">AI fix packets</div>
      <p className="mt-2 text-body text-ink-muted">
        Paste any packet into ChatGPT, Claude, or any AI assistant to apply that fix — your tool, your
        account.
      </p>
      <ul className="mt-4 space-y-6">
        {packets.map((packet, i) => (
          <li key={`${packet.fixId}:${i}`}>
            <div className="mb-1 flex items-center justify-between gap-3">
              <div className="text-overline uppercase text-ink-muted">Action packet</div>
              <AiPacketCopy packet={packet} />
            </div>
            <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-card bg-oat p-3 text-caption leading-relaxed text-ink">
              {packet.body}
            </pre>
          </li>
        ))}
      </ul>
    </Card>
  );
}
