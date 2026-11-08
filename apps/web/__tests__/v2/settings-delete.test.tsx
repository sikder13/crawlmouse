/**
 * Deleting the account, the step “Delete…” opens (owner ruling 12): the owner re-types the primary
 * site's hostname, and the form asks for a confirmation link to the sign-in address. It has no
 * artboard, so what is pinned is the guard, the route and that the page deletes nothing itself.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeleteScreen } from '../../components/v2/screens/settings/DeleteScreen';
import { ACCOUNT_VIEWERS, CLEAN_VIEWER } from '../../app/(v2-preview)/v2-preview/_preview/accounts';
import { fixture } from '../../lib/v2/fixtures';
import { deleteStepView } from '../../lib/v2/view/settings';

const bad = () => deleteStepView(fixture('bad-site'), ACCOUNT_VIEWERS.home());

describe('the delete step, as data', () => {
  it('asks for the primary site’s hostname and says what the link then does', () => {
    const v = bad();
    expect(v.field).toMatchObject({
      label: 'Type example-outfitter.com to confirm',
      name: 'hostname',
      expected: 'example-outfitter.com',
    });
    expect(v.steps).toBe(
      'Type the hostname below and we send a confirmation link to you@company.com. The link opens a page where you confirm the deletion; sign-in then stops at once, and for seven days a sign-in link from that address restores the account.',
    );
    expect(v.text).toMatch(/^Removes all five sites, their history and reports\. /);
  });

  it('posts the request to DELETE /api/account, which deletes nothing until the link is opened', () => {
    expect(bad().submit).toMatchObject({
      label: 'Send the confirmation link',
      href: '/api/account',
      method: 'post',
      fields: { _method: 'DELETE' },
      primary: false,
    });
    expect(bad().back).toMatchObject({ label: 'Keep the account', href: '/settings' });
  });
});

describe('the delete step, rendered', () => {
  const html = renderToStaticMarkup(<DeleteScreen data={bad()} />);

  it('has a required hostname field tied to its label and hint, and no orange element', () => {
    const input = html.match(/<input [^>]*id="delete-hostname"[^>]*>/)![0];
    expect(input).toContain('name="hostname"');
    expect(input).toContain('required=""');
    expect(input).toContain('aria-describedby="delete-hostname-hint"');
    expect(html).toMatch(
      /<label [^>]*for="delete-hostname"[^>]*>Type example-outfitter\.com to confirm</,
    );
    expect(html).not.toContain('data-v2-primary');
  });

  it('sits under Settings in the rail', () => {
    expect(html).toMatch(/aria-current="location"[^>]*>Settings[ <]/);
  });

  it('on an account with no site, asks for the sign-in address instead', () => {
    const d = fixture('clean-site');
    const v = deleteStepView(d, { ...CLEAN_VIEWER, adopt: [] });
    expect(v.field.expected).toBe('owner@trailhead.example');
  });
});

describe('the delete step, which site it asks for', () => {
  it('asks for the primary site, not the first one listed', () => {
    // The staging copy listed first: the primary site is still the oldest site that copies none.
    const d = fixture('bad-site');
    const staging = d.sites.find((s) => s.staging_of_site_id !== null)!;
    const reordered = { ...d, sites: [staging, ...d.sites.filter((s) => s.id !== staging.id)] };
    expect(deleteStepView(reordered, ACCOUNT_VIEWERS.home()).field.expected).toBe(
      'example-outfitter.com',
    );
  });

  it('with no site, names the sign-in address in its steps as well as its field', () => {
    const v = deleteStepView(fixture('clean-site'), { ...CLEAN_VIEWER, adopt: [] });
    expect(v.steps).toMatch(
      /^Type the sign-in address below and we send a confirmation link to owner@trailhead\.example\. /,
    );
  });
});
