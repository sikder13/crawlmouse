import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FAILURE_COPY } from '@/lib/failure-classification';
import { ResultError } from './ResultError';

describe('ResultError', () => {
  it('shows the classified failure copy + a retry, never a raw reason (U10)', () => {
    const html = renderToStaticMarkup(<ResultError failureCategory="timeout" />);
    expect(html).toContain(FAILURE_COPY.timeout.title);
    expect(html).toContain(FAILURE_COPY.timeout.body);
    expect(html).toContain('Try another audit');
    expect(html).not.toContain('stack');
    expect(html).not.toContain('Error:');
  });
});
