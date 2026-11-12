-- Leads and Contacts: speed and vacancies (feedback Julius, November 2026).
--
--   1  Row level security evaluated once per query instead of once per row
--   2  Indexes for the queries of the Leads, Contacts and lead pages
--   3  Signals (vacancies): text, closed date, a clean link per vacancy
--   4  sales_company_facts(): every count and summary the tables show,
--      computed in the database in one round trip
--
-- See docs/sales.md, "Snelheid" and "Vacatures".

-- ---------------------------------------------------------------------------
-- 1. RLS: has_module() once per statement
-- ---------------------------------------------------------------------------

-- `using (public.has_module('sales'))` runs the function (a lookup in
-- profiles) for every row: 2,000 contacts joined with their companies is
-- 4,000 lookups. Wrapped in a sub select Postgres evaluates it once (an
-- init plan). Same rule, same result.
drop policy if exists "Sales manage companies" on public.companies;
create policy "Sales manage companies" on public.companies
  for all to authenticated
  using ((select public.has_module('sales'))) with check ((select public.has_module('sales')));

drop policy if exists "Sales manage contacts" on public.contacts;
create policy "Sales manage contacts" on public.contacts
  for all to authenticated
  using ((select public.has_module('sales'))) with check ((select public.has_module('sales')));

drop policy if exists "Sales manage signals" on public.signals;
create policy "Sales manage signals" on public.signals
  for all to authenticated
  using ((select public.has_module('sales'))) with check ((select public.has_module('sales')));

drop policy if exists "Sales manage activities" on public.activities;
create policy "Sales manage activities" on public.activities
  for all to authenticated
  using ((select public.has_module('sales'))) with check ((select public.has_module('sales')));

drop policy if exists "Sales manage suppression" on public.suppression;
create policy "Sales manage suppression" on public.suppression
  for all to authenticated
  using ((select public.has_module('sales'))) with check ((select public.has_module('sales')));

drop policy if exists "Sales manage partners" on public.partners;
create policy "Sales manage partners" on public.partners
  for all to authenticated
  using ((select public.has_module('sales'))) with check ((select public.has_module('sales')));

-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------

-- The last contact moment per company (calls, mails, LinkedIn, meetings).
create index if not exists activities_company_contact_moments_idx
  on public.activities (company_id, date desc)
  where type in ('contact', 'reply', 'meeting') and company_id is not null;

-- The tables load in the order they were added.
create index if not exists companies_created_at_idx on public.companies (created_at, id);
create index if not exists contacts_created_at_idx on public.contacts (created_at, id);

-- ---------------------------------------------------------------------------
-- 3. Signals: vacancy text, closed date, clean link
-- ---------------------------------------------------------------------------

alter table public.signals
  add column if not exists description text,
  add column if not exists closed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'signals_description_check') then
    alter table public.signals add constraint signals_description_check check (char_length(description) <= 20000);
  end if;
end;
$$;

create index if not exists signals_open_vacancies_idx
  on public.signals (company_id)
  where type = 'vacature' and closed_at is null;

-- "nl.indeed.com/viewjob?jk=abc" was stored as typed, without https://, so it
-- did not open. Every link gets a scheme.
update public.signals
set source_url = 'https://' || regexp_replace(trim(source_url), '^/+', '')
where source_url is not null
  and trim(source_url) <> ''
  and trim(source_url) !~* '^[a-z][a-z0-9+.-]*://';

-- Before this migration the dedupe key dropped the whole query string, so
-- every Indeed vacancy (viewjob?jk=...) of one source had the same key and
-- only the first was ever saved. Give the saved ones the key the app now
-- uses (the job id kept), so they are found again on the next import.
update public.signals s
set dedupe_key = k.key
from (
  select id,
         split_part(dedupe_key, ':', 1) || ':' ||
           regexp_replace(lower(regexp_replace(source_url, '^[a-z]+://', '', 'i')), '[?#].*$', '') ||
           '?jk=' || lower(substring(source_url from '(?i)[?&]v?jk=([a-z0-9]+)')) as key
  from public.signals
  where source_url ~* 'indeed\.' and source_url ~* '[?&]v?jk=[a-z0-9]+'
) k
where s.id = k.id
  and s.dedupe_key <> k.key
  and not exists (select 1 from public.signals o where o.dedupe_key = k.key);

-- ---------------------------------------------------------------------------
-- 4. sales_company_facts(): the counts and summaries of the tables
-- ---------------------------------------------------------------------------

-- One row per company: contacts, primary contact, the last contact moment,
-- signals and the open vacancies (type vacature, not closed) with the day
-- they went online (posted_at, else the day we first saw them). The Leads
-- and Contacts tables used to page through every activity and every contact
-- in the app; this does it in the database, with the indexes above, so the
-- load time does not grow with the number of activities.
create or replace function public.sales_company_facts()
returns table (
  company_id uuid,
  contacts_count integer,
  primary_contact jsonb,
  last_activity_at timestamptz,
  last_activity text,
  signals_count integer,
  open_vacancies jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with contact_counts as (
    select c.company_id, count(*)::integer as n
    from public.contacts c
    group by c.company_id
  ),
  primaries as (
    select distinct on (c.company_id)
      c.company_id,
      jsonb_build_object(
        'id', c.id, 'name', c.full_name, 'title', c.title, 'phone', c.phone,
        'email', c.email, 'linkedinUrl', c.linkedin_url
      ) as contact
    from public.contacts c
    order by c.company_id, c.is_primary desc, (c.role = 'main') desc, c.created_at, c.id
  ),
  signal_facts as (
    select
      s.company_id,
      count(*)::integer as n,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', s.id,
            'title', coalesce(s.title, 'Untitled vacancy'),
            'url', s.source_url,
            'source', s.source,
            'onlineSince', coalesce(s.posted_at, (s.first_seen_at at time zone 'Europe/Amsterdam')::date),
            'postedAt', s.posted_at
          )
          order by coalesce(s.posted_at, (s.first_seen_at at time zone 'Europe/Amsterdam')::date), s.id
        ) filter (where s.type = 'vacature' and s.closed_at is null),
        '[]'::jsonb
      ) as open_vacancies
    from public.signals s
    group by s.company_id
  )
  select
    co.id,
    coalesce(cc.n, 0),
    p.contact,
    a.date,
    a.summary,
    coalesce(sf.n, 0),
    coalesce(sf.open_vacancies, '[]'::jsonb)
  from public.companies co
  left join contact_counts cc on cc.company_id = co.id
  left join primaries p on p.company_id = co.id
  left join signal_facts sf on sf.company_id = co.id
  left join lateral (
    select act.date, concat_ws(': ', act.channel, act.outcome) as summary
    from public.activities act
    where act.company_id = co.id and act.type in ('contact', 'reply', 'meeting')
    order by act.date desc
    limit 1
  ) a on true
  order by co.created_at, co.id;
$$;

revoke execute on function public.sales_company_facts() from public, anon;
grant execute on function public.sales_company_facts() to authenticated, service_role;
