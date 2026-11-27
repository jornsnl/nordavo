-- Running routes (opdracht Julius, 27 november 2026, deel B): one page in
-- sales with a hand kept table of the outreach that runs now (call lists,
-- mail and LinkedIn campaigns, anything else). Every field is filled by hand.
--
-- The table stands on its own: it links to no campaign, bucket or company and
-- changes nothing there. No automatic filling, no rules, no notifications.
-- Who changed a row last and how (in the portal or through Claude) is kept on
-- the row itself: updated_by and updated_source.

create table if not exists public.sales_routes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  channel text check (channel in ('call', 'mail', 'linkedin', 'other')),
  status text check (status in ('planned', 'running', 'paused', 'done')),
  started_on date,
  ends_on date,
  company_count integer check (company_count between 0 and 1000000),
  owner_text text check (char_length(owner_text) <= 200),
  note text check (char_length(note) <= 4000),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_source text not null default 'handmatig' check (created_source in ('handmatig', 'claude')),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null default auth.uid(),
  updated_source text not null default 'handmatig' check (updated_source in ('handmatig', 'claude'))
);

comment on table public.sales_routes is
  'Running routes: a hand kept overview of outreach (docs/sales.md, Running routes). Not linked to campaigns, buckets or companies.';

alter table public.sales_routes enable row level security;

drop policy if exists "Sales manage routes" on public.sales_routes;
create policy "Sales manage routes" on public.sales_routes
  for all to authenticated
  using ((select public.has_module('sales')))
  with check ((select public.has_module('sales')));

revoke all on public.sales_routes from anon;
grant select, insert, update, delete on public.sales_routes to authenticated;
grant all on public.sales_routes to service_role;

drop trigger if exists sales_routes_set_updated_at on public.sales_routes;
create trigger sales_routes_set_updated_at before update on public.sales_routes
  for each row execute function public.set_updated_at();

create index if not exists sales_routes_status_idx on public.sales_routes (status, ends_on);
