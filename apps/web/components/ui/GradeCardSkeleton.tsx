import { Card } from './Card';

// Animated placeholder shown in the gap between status=completed and the `done` payload
// (carrying orphan/depth). Prevents a 0-orphans / 0.0-depth flash. Reduced-motion safe.
export function GradeCardSkeleton() {
  return (
    <Card size="lg" aria-busy="true" aria-label="Computing your grade">
      <div className="animate-pulse motion-reduce:animate-none">
        <div className="mb-4 flex items-start justify-between">
          <div className="space-y-2">
            <div className="h-3 w-16 rounded bg-oat" />
            <div className="h-14 w-20 rounded-xl bg-oat" />
            <div className="h-3 w-24 rounded bg-oat" />
          </div>
          <div className="h-6 w-24 rounded-full bg-oat" />
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-dashed border-oat pt-3">
          <div className="space-y-2">
            <div className="h-7 w-10 rounded bg-oat" />
            <div className="h-3 w-20 rounded bg-oat" />
          </div>
          <div className="space-y-2">
            <div className="h-7 w-10 rounded bg-oat" />
            <div className="h-3 w-24 rounded bg-oat" />
          </div>
        </div>
      </div>
    </Card>
  );
}
