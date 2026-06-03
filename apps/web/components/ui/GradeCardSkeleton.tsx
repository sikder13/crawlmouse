import { Card } from './Card';

// Animated placeholder shown in the gap between status=completed and the `done` payload
// (carrying orphan/depth). Prevents a 0-orphans / 0.0-depth flash. Playful pulse, on-brand.
export function GradeCardSkeleton() {
  return (
    <Card className="!p-7 !rounded-3xl" aria-busy="true" aria-label="Computing your grade">
      <div className="animate-pulse">
        <div className="flex items-start justify-between mb-4">
          <div className="space-y-2">
            <div className="h-3 w-16 rounded bg-oat" />
            <div className="h-14 w-20 rounded-xl bg-oat" />
            <div className="h-3 w-24 rounded bg-oat" />
          </div>
          <div className="h-6 w-24 rounded-full bg-oat" />
        </div>
        <div className="border-t border-dashed border-oat pt-3 grid grid-cols-2 gap-3">
          <div className="space-y-2"><div className="h-7 w-10 rounded bg-oat" /><div className="h-3 w-20 rounded bg-oat" /></div>
          <div className="space-y-2"><div className="h-7 w-10 rounded bg-oat" /><div className="h-3 w-24 rounded bg-oat" /></div>
        </div>
      </div>
    </Card>
  );
}
