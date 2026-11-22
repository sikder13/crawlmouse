// @vitest-environment jsdom
/**
 * A /pricing tab loaded before v1 purchases closed still shows Upgrade (CC-45 hotfix). Its click now
 * gets the route's 403 purchases_closed; the card says so instead of "Could not start checkout".
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PricingCards } from './PricingCards';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const answer = (status: number, body: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );

async function clickUpgrade() {
  act(() => root.render(<PricingCards monthlyPriceId="m" yearlyPriceId="y" />));
  const button = [...host.querySelectorAll('button')].find((b) =>
    b.textContent?.startsWith('Upgrade'),
  )!;
  await act(async () => button.click());
}

describe('PricingCards Upgrade click', () => {
  it('shows the route’s message when v1 purchases are closed', async () => {
    answer(403, {
      error: 'purchases_closed',
      message: 'Paid plans open shortly. Nothing was charged.',
    });
    await clickUpgrade();
    expect(host.textContent).toContain('Paid plans open shortly. Nothing was charged.');
    expect(host.textContent).not.toContain('Could not start checkout');
  });

  it('keeps the generic error for any other refusal', async () => {
    answer(400, { error: 'bad_price' });
    await clickUpgrade();
    expect(host.textContent).toContain('Could not start checkout. Please try again.');
  });
});
