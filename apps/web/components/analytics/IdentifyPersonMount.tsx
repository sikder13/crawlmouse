import 'server-only';
import { signedInPersonTraits } from '@/lib/analytics/person-read';
import { IdentifyPerson } from './IdentifyPerson';

/**
 * What a signed-in layout renders to identify the browser (CC-41 D1): the request's person traits,
 * read on the server, handed to IdentifyPerson. Nothing when the request has no single signed-in
 * account. A read that fails is logged without its detail and renders nothing, so the page still
 * renders.
 */
export async function IdentifyPersonMount() {
  let traits;
  try {
    traits = await signedInPersonTraits();
  } catch {
    console.error('analytics: person traits read failed');
    return null;
  }
  return traits === null ? null : <IdentifyPerson traits={traits} />;
}
