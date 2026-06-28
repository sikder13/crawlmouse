import Link from 'next/link';
import { FAILURE_COPY, type FailureCategory } from '@/lib/failure-classification';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

// A failed audit (§8): the coarse, classified failureCategory only — never the raw reason
// (security) or a stack trace. Calm copy + a clear retry.
export function ResultError({ failureCategory }: { failureCategory: FailureCategory }) {
  const copy = FAILURE_COPY[failureCategory];
  return (
    <Card variant="raised" className="text-center">
      <div className="text-overline uppercase text-ink-muted">Audit didn&rsquo;t finish</div>
      <h3 className="mt-2 font-display text-h3">{copy.title}</h3>
      <p className="mx-auto mt-2 max-w-prose text-body text-ink-muted">{copy.body}</p>
      <Link href={{ pathname: '/' }} className="mt-4 inline-block">
        <Button variant="primary">Try another audit</Button>
      </Link>
    </Card>
  );
}
