-- The anon-audit claim flow updates audits by anonymous_session_id (and the column is
-- otherwise only ever written), so index it to avoid a seq-scan on every /api/auth/claim.
-- Partial: only anonymous audits carry the id.
create index if not exists audits_anon_session_idx
  on audits (anonymous_session_id)
  where anonymous_session_id is not null;
