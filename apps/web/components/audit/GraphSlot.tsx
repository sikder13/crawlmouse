import { Card } from '../ui/Card';

// Reserved layout slot for the live link graph (D2). The graph is a coordinated next step — it needs
// node/edge data that isn't in the contract yet — so this is only a placeholder. Do NOT build the
// graph here; the owner will send the contract amendment + graph spec.
export function GraphSlot() {
  return (
    <Card className="border-dashed text-center">
      <div className="text-overline uppercase text-ink-muted">Live link graph</div>
      <div className="mt-3 flex h-40 items-center justify-center rounded-card bg-cream">
        <span className="text-caption text-ink-muted">Your interactive link graph will appear here.</span>
      </div>
    </Card>
  );
}
