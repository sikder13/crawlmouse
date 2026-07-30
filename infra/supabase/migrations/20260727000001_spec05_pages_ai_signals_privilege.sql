-- SPEC 05 §11/§12 — subtract `pages.ai_signals` from the client-role column grants. Additive, OWNER-RUN.
--
-- WHY. `pages.ai_signals` holds the per-page `PageAiSignals` payload INCLUDING the bounded main-content
-- excerpt. That excerpt is a PRO-OWNER artifact: the "What AI Sees" whole-site simulator is gated in the
-- projection (`apps/web/lib/audit-stream-projection.ts` — `isOwner && entitlement.canUseActionPackets`),
-- pinned by A11 ("a FREE OWNER … NO whatAiSees"). But that gate is only in OUR serialization path.
--
-- The gap: `20260707000003_spec04_column_privilege_hardening` converted `audits` and `public_reports` to
-- explicit column-grant lists, so `audits.ai_readiness` correctly inherited NO client grant when SPEC 05
-- added it (verified live: has_column_privilege('authenticated','public.audits','ai_readiness','SELECT')
-- = false). `pages` was never converted, so it still carries Supabase's default TABLE-level SELECT grant
-- to anon+authenticated — and the new column inherited it (verified live:
-- has_column_privilege('authenticated','public.pages','ai_signals','SELECT') = true).
--
-- Effect today: a signed-in FREE owner can bypass the Pro gate entirely with a direct PostgREST read —
--   GET /rest/v1/pages?audit_id=eq.<their own audit>&select=url,ai_signals
-- returning every page's excerpt. RLS (`pages_via_audit`) still scopes rows to that user's own audits, so
-- this is NOT cross-tenant exposure — the data is the owner's own site's public text. It is a PAYWALL
-- INTEGRITY defect, not a confidentiality breach. Scope stated honestly so the fix is not over-sold.
--
-- HOW (and why the naive form is a no-op): Postgres computes effective column access as the UNION of
-- table- and column-level grants, so a bare `REVOKE SELECT (ai_signals)` does nothing while the table
-- grant stands. The only correct form — and the idiom this repo already uses in
-- 20260707000003 — is: REVOKE the table-level SELECT, then GRANT it back on an explicit column list
-- that EXCLUDES the sensitive column. The list is generated from information_schema AT APPLY TIME so no
-- column can be missed.
--
-- DENY-BY-DEFAULT NOTE: after this runs, a FUTURE column on `pages` is NOT auto-granted to
-- anon/authenticated. A later migration that needs one client-readable must GRANT SELECT (newcol)
-- explicitly. That is the intended posture, and it is what made `audits.ai_readiness` safe by default.
--
-- service_role is untouched (it has BYPASSRLS and its own grants), so the app's admin reads — the SSE
-- projection, the mint snapshot, persistence — are unaffected. No RLS policy is added, changed or widened.

do $$
declare
  cols text;
begin
  -- Every currently-granted-worthy column EXCEPT the gated one.
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'pages'
    and column_name <> 'ai_signals';

  if cols is null then
    raise exception 'public.pages not found — refusing to apply';
  end if;

  -- 1) Drop the table-level SELECT that currently unions over every column (including ai_signals).
  execute 'revoke select on public.pages from anon, authenticated';

  -- 2) Grant it back on the explicit list, which excludes ai_signals.
  execute format('grant select (%s) on public.pages to anon, authenticated', cols);
end $$;

-- Verification (run after apply; both must be false, and the third must be true):
--   select has_column_privilege('authenticated','public.pages','ai_signals','SELECT');  -- false
--   select has_column_privilege('anon','public.pages','ai_signals','SELECT');           -- false
--   select has_column_privilege('authenticated','public.pages','url','SELECT');         -- true
--
-- Rollback (restores the prior, more permissive state):
--   grant select on public.pages to anon, authenticated;
