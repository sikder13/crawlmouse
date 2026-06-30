-- SPEC 02 `fixes` table — the persisted projection ledger + the GATED cure (prescriptions / action
-- packets). SERVICE-ROLE-ONLY by design: RLS is enabled with ZERO policies AND every grant is revoked
-- from anon/authenticated, so NO client role can read it directly via PostgREST. The gated cure
-- (suggested_links / action_packet_body) is served EXCLUSIVELY through the API's owner+Pro projection
-- (projectAuditForClient). An owner-read RLS policy is DELIBERATELY ABSENT: it would let a FREE owner
-- read their own cure directly, bypassing the paywall. The worker's service role bypasses RLS to write.

create table if not exists public.fixes (
  id                 uuid primary key default gen_random_uuid(),
  audit_id           uuid not null references public.audits(id) on delete cascade,  -- fixes die with their audit
  fix_id             text not null,                  -- FixDiagnosis.id (stable across re-audits → monitoring diff)
  category           text not null,
  target_url         text not null,
  target_title       text,
  marginal_delta     numeric not null default 0,     -- relative impact (never summed)
  effort             text,
  rationale          text,                            -- FREE diagnosis text
  rank               integer not null default 0,
  is_free_fix        boolean not null default false,  -- the one free cure (rank 1)
  suggested_links    jsonb,                           -- GATED cure: source pages + anchors
  action_packet_body text,                            -- GATED cure: the paste-into-AI artifact
  created_at         timestamptz not null default now()
);

-- Index the FK — perf advisor + the per-audit fix lookup at projection time.
create index if not exists idx_fixes_audit_id on public.fixes(audit_id);

-- Deny-by-default, service-role-only: enable RLS with NO policies (every client role is denied) and
-- revoke the table-level grants for belt-and-suspenders. The service_role bypasses RLS and is the only
-- accessor. Intentionally NO owner-read policy (see header — it would leak the gated cure via PostgREST).
alter table public.fixes enable row level security;
revoke all on public.fixes from anon, authenticated;
