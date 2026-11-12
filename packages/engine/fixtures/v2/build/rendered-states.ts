/**
 * The recorded built-site check with one template's render outcome edited, for the three states of
 * the client-rendered template detector (detectors/rendered.ts). The recorded render has every
 * rendered page `readable`; nothing here is recorded from a browser.
 */
import type { BuildInput } from '../../../src/v2/build/types.js';
import type { RenderOutcome } from '../../../src/v2/render/run.js';
import { jsTextState } from '../../../src/v2/render/state.js';
import { recordedBuild } from './recorded.js';

export const PRODUCTS = '/products/{slug}';

/** Words in the HTML response of a product page served as a shell: its heading and a line of intro. */
export const SHELL_RAW_WORDS = 20;

type Edit = 'shell' | 'one_shell' | 'not_rendered';

/**
 * The recorded check with the rendered pages of `template` edited:
 *   `shell`         each keeps its rendered words and has SHELL_RAW_WORDS without JavaScript
 *   `one_shell`     the first of them only (the others stay readable)
 *   `not_rendered`  none of them was rendered (the render step did not reach them)
 */
export function recordedWith(edit: Edit, template: string = PRODUCTS): BuildInput {
  const input = recordedBuild();
  const render = structuredClone(input.render) as RenderOutcome;
  const mine = render.pages.filter((p) => p.template_key === template);
  if (mine.length < 2) throw new Error(`the recorded render holds under two pages of ${template}`);
  if (edit === 'not_rendered') {
    return {
      ...input,
      render: { ...render, pages: render.pages.filter((p) => !mine.includes(p)) },
    };
  }
  for (const p of edit === 'shell' ? mine : mine.slice(0, 1)) {
    if (!p.rendered) throw new Error(`${p.url} was not rendered in the recording`);
    const text_share = SHELL_RAW_WORDS / p.without_js.rendered_words;
    p.without_js = {
      ...p.without_js,
      raw_words: SHELL_RAW_WORDS,
      text_share,
      state: jsTextState(text_share, null),
    };
  }
  return { ...input, render };
}
