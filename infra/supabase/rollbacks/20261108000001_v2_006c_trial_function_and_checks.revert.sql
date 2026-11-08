-- Revert of infra/supabase/migrations/20261108000001_v2_006c_trial_function_and_checks.sql.
--
-- ⚠ Turn V2_ACCOUNT_DOOR off in production first: the first-login hook calls
-- start_trial_with_ledger, and without it every first login is reported as failed and stays Free.
--
-- Drops the three functions and the two effect CHECKs, and puts back the 14-value type CHECK 003
-- wrote, under the name Postgres gave it. That CHECK refuses while a fix holds one of the two content
-- fix types (missing_schema_description, no_question_headings): the revert then fails and changes
-- nothing. trial_ledger rows the function wrote stay.
--
-- Every statement is re-runnable (v2-006c-trial-function.test.ts runs it twice).

drop function if exists public.start_trial_with_ledger(uuid, jsonb, jsonb);
drop function if exists public.trial_ledger_lock(jsonb);
drop function if exists public.trial_ledger_refusals(jsonb, timestamptz);

alter table public.site_fixes drop constraint if exists site_fixes_effect_absorbed;
alter table public.site_fixes drop constraint if exists site_fixes_effect_seo_pending;

alter table public.site_fixes drop constraint if exists site_fixes_type_check;
alter table public.site_fixes add constraint site_fixes_type_check check (type in (
  'robots_txt_blocks_crawler', 'edge_rule_blocks_crawler', 'client_rendered_template', 'orphan_pages',
  'quotable_opening', 'generic_anchor_text', 'deep_pages', 'specs_as_images', 'missing_author_date',
  'js_only_navigation', 'redirect_chain', 'duplicate_pagination', 'canonical_mismatch', 'hreflang_gap'));
