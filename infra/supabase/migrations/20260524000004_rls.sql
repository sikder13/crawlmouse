alter table users enable row level security;
alter table sessions enable row level security;
alter table audits enable row level security;
alter table pages enable row level security;
alter table links enable row level security;
alter table findings enable row level security;

-- users: each user can read/update only their own row
create policy users_self_read on users for select using (id = auth.uid());
create policy users_self_update on users for update using (id = auth.uid());

-- sessions: managed server-side via service role; deny client access
create policy sessions_deny_client on sessions for all using (false);

-- audits: owner can read; anonymous audits readable when anonymous_session_id matches header
create policy audits_owner_read on audits for select using (user_id = auth.uid());
create policy audits_owner_insert on audits for insert with check (user_id = auth.uid() or user_id is null);
create policy audits_owner_update on audits for update using (user_id = auth.uid());

-- pages: readable via parent audit ownership
create policy pages_via_audit on pages for select using (
  exists (select 1 from audits a where a.id = pages.audit_id and a.user_id = auth.uid())
);

-- links: ditto
create policy links_via_audit on links for select using (
  exists (select 1 from audits a where a.id = links.audit_id and a.user_id = auth.uid())
);

-- findings: ditto
create policy findings_via_audit on findings for select using (
  exists (select 1 from audits a where a.id = findings.audit_id and a.user_id = auth.uid())
);
