import { describe, expect, it } from 'vitest';
import { FRAMEWORK_OF_CMS, frameworkOf } from './stack.js';
import { NO_STACK } from './test-support/facts.js';

const frontend = (framework: 'nextjs' | 'generic') => ({
  name: 'x',
  framework,
  version: null,
  router: null,
  detected_from: 'a test',
});
const backend = (cms: 'wordpress' | 'webflow' | 'shopify' | 'ghost') => ({
  cms,
  detected_from: 'a test',
});

describe('frameworkOf', () => {
  it('is null when the check detected neither a front end nor a CMS', () => {
    expect(frameworkOf(NO_STACK)).toBe(null);
  });

  it('is the detected front end’s, also on a CMS that is itself a framework: a headless WordPress', () => {
    const stack = { ...NO_STACK, frontend: frontend('nextjs'), backend: backend('wordpress') };
    expect(frameworkOf(stack)).toBe('nextjs');
  });

  it('is the CMS’s own framework when no front end was detected', () => {
    expect(frameworkOf({ ...NO_STACK, backend: backend('wordpress') })).toBe('wordpress');
    expect(frameworkOf({ ...NO_STACK, backend: backend('webflow') })).toBe('webflow');
  });

  it('is null for a CMS whose name does not say what renders its pages', () => {
    expect(frameworkOf({ ...NO_STACK, backend: backend('shopify') })).toBe(null);
    expect(frameworkOf({ ...NO_STACK, backend: backend('ghost') })).toBe(null);
    expect(Object.keys(FRAMEWORK_OF_CMS).sort()).toEqual(['webflow', 'wordpress']);
  });
});
