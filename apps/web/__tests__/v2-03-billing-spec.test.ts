import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WEBHOOK_CASES } from '../lib/billing/webhook-cases.fixture';
import { SPEC_03_PATH, buildBillingSpec, renderEventStateTable } from './helpers/billing-spec';

describe('docs/specs/v2/03-billing.md', () => {
  it('carries the event × state table the webhook cases render, and is formatted', async () => {
    expect(readFileSync(SPEC_03_PATH, 'utf8')).toBe(await buildBillingSpec());
  });

  it('renders a row for each event and Stripe state, with every case in it', () => {
    const table = renderEventStateTable();
    const cells = table
      .split('\n')
      .filter((l) => l.startsWith('| `'))
      .flatMap((l) => l.split(' | ').slice(1))
      .flatMap((cell) => cell.replace(/ \|$/, '').split('; '))
      .filter((cell) => cell !== '—');
    expect(cells).toHaveLength(WEBHOOK_CASES.length);
  });
});
