-- Cost control #3: free-tier audits expire after 30 days; Pro audits keep null (no expiry).
alter table audits add column expires_at timestamptz;
create index on audits (expires_at) where expires_at is not null;
