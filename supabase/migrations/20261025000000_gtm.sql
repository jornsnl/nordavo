-- GTM system: prospects, signals, outreach, suppression, exports, job runs,
-- and the talent side (vacancy requirements, Airtable matches, anonymous
-- profiles). See docs/gtm.md for the workflows these tables serve.
--
-- Hard rules enforced here (briefing section 8):
--   1/2  companies unique on normalised domain, contacts on LinkedIn URL
--   4    contactable(): not suppressed, not approached in the last 30 days
--   5    eenmanszaak and vof never on a call list (call_list_candidates)
--   9    client_contact_risk = true always means NO_GO
--   10   an 'afgemeld' activity goes straight to suppression
--   11   matches store only the Airtable id, score and status, no candidate PII

-- ---------------------------------------------------------------------------
-- Normalisation helpers
-- ---------------------------------------------------------------------------

-- "https://www.Example.nl/jobs?x=1" -> "example.nl"
create or replace function public.normalize_domain(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(trim(coalesce(p_value, ''))), '^[a-z]+://', ''),
        '^www\.', ''),
      '[/?#:].*$', ''),
    '');
$$;

-- "https://nl.linkedin.com/in/Jan-Jansen/?x" -> "linkedin.com/in/jan-jansen"
create or replace function public.normalize_linkedin(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(trim(coalesce(p_value, ''))), '^[a-z]+://', ''),
          '^([a-z]{2,3}\.|www\.)?linkedin\.com', 'linkedin.com'),
        '[?#].*$', ''),
      '/+$', ''),
    '');
$$;

-- ---------------------------------------------------------------------------
-- Sales
-- ---------------------------------------------------------------------------

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  domain text not null unique check (domain = public.normalize_domain(domain)),
  name text not null,
  website text,
  legal_form text,
  employees integer check (employees >= 0),
  sector text,
  segment text check (segment in ('saas', 'productie', 'agency_automation', 'agency_overig')),
  kvk_number text,
  linkedin_url text,
  city text,
  icp_decision text check (icp_decision in ('GO', 'NO_GO', 'REVIEW')),
  icp_score integer check (icp_score between 0 and 100),
  icp_reason text,
  red_flags text[] not null default '{}',
  opening_line text,
  client_contact_risk boolean not null default false,
  qualified_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  status text not null default 'nieuw'
    check (status in ('nieuw', 'actief', 'klant', 'verloren', 'uitgesloten')),
  source text,
  sources text[] not null default '{}',
  client_id uuid references public.clients (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  first_name text,
  last_name text,
  title text,
  tier integer check (tier in (1, 2, 3)),
  linkedin_url text unique check (linkedin_url = public.normalize_linkedin(linkedin_url)),
  email text,
  email_source text,
  email_status text check (email_status in ('valid', 'invalid', 'catch_all', 'unknown')),
  email_found_at timestamptz,
  phone text,
  phone_type text check (phone_type in ('mobiel', 'vast')),
  phone_source text,
  phone_found_at timestamptz,
  status text not null default 'nieuw' check (status in (
    'nieuw', 'gekwalificeerd', 'verrijkt', 'op_bellijst', 'in_mailcampagne',
    'bereikt', 'afspraak', 'kans', 'klant', 'verloren', 'uitgesloten'
  )),
  onepage_id text unique,
  last_contacted_at timestamptz,
  source text,
  sources text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.signals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  type text not null check (type in (
    'vacature', 'lang_open', 'meerdere_rollen', 'remote_extern', 'freelance',
    'funding', 'nieuwe_cto', 'overig'
  )),
  title text,
  source_url text,
  source text not null default 'overig' check (source in ('linkedin', 'indeed', 'overig')),
  -- Same vacancy seen again only updates last_seen_at.
  dedupe_key text not null unique,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  raw_json jsonb
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel text not null check (channel in ('bellen', 'mail', 'linkedin')),
  signal_type text,
  segment text,
  message_variant text,
  external_id text unique,
  started_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references public.contacts (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  channel text not null check (channel in ('bellen', 'mail', 'linkedin', 'meeting')),
  campaign_id uuid references public.campaigns (id) on delete set null,
  signal_id uuid references public.signals (id) on delete set null,
  date timestamptz not null default now(),
  outcome text not null check (outcome in (
    'verstuurd', 'geen_gehoor', 'bereikt', 'terugbellen', 'afspraak',
    'afspraak_goedgekeurd', 'afspraak_afgekeurd', 'niet_geinteresseerd',
    'reply_positief', 'reply_neutraal', 'reply_negatief', 'bounce', 'afgemeld',
    'gesprek_gehad', 'gewonnen', 'verloren', 'notitie'
  )),
  notes text,
  next_action text,
  next_action_date date,
  source text not null default 'handmatig'
    check (source in ('handmatig', 'instantly', 'webpartners', 'calcom', 'onepage', 'import')),
  -- Idempotent syncs: the id in the source system.
  external_id text unique,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (contact_id is not null or company_id is not null)
);

create table public.suppression (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete cascade,
  -- For unsubscribes that cannot be matched to a contact (yet).
  email text,
  reason text not null check (reason in ('afgemeld', 'bezwaar', 'klant', 'lopend_gesprek', 'niet_bellen')),
  scope text not null default 'alle_kanalen' check (scope in ('alle_kanalen', 'alleen_bellen', 'alleen_mail')),
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (company_id is not null or contact_id is not null or email is not null)
);

create table public.list_exports (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('bellijst', 'mailcampagne', 'max_verrijking')),
  filter_used jsonb not null default '{}',
  record_ids uuid[] not null default '{}',
  record_count integer not null default 0,
  destination text,
  campaign_id uuid references public.campaigns (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'failed')),
  records_in integer not null default 0,
  records_out integer not null default 0,
  error text,
  meta jsonb not null default '{}',
  triggered_by text not null default 'schedule'
);

-- ---------------------------------------------------------------------------
-- Talent: vacancies get the fixed requirements from T1 and the timeline (T6)
-- ---------------------------------------------------------------------------

alter table public.vacancies alter column client_id drop not null;
alter table public.vacancies
  add column company_id uuid references public.companies (id) on delete set null,
  add column onepage_deal_id text,
  add column source text check (source in ('klant_eigen', 'samen_opgesteld', 'gescrapet')),
  add column raw_text text,
  add column hours integer check (hours between 1 and 60),
  add column timezone_overlap text,
  add column budget_min numeric(10, 2),
  add column budget_max numeric(10, 2),
  add column client_contact_required boolean,
  add column must_haves text[] not null default '{}',
  add column nice_to_haves text[] not null default '{}',
  add column unclear text[] not null default '{}',
  add column search_brief jsonb,
  add column talent_stage text not null default 'intake' check (talent_stage in (
    'intake', 'zoeken', 'profielen_verstuurd', 'gesprekken', 'geplaatst', 'gesloten'
  )),
  add column intake_at timestamptz,
  add column profiles_sent_at timestamptz,
  add column first_interview_at timestamptz,
  add column start_at date,
  add constraint vacancies_owner_company_check check (client_id is not null or company_id is not null);

-- A pool candidate matched to a vacancy. Candidate data stays in Airtable.
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  vacancy_id uuid not null references public.vacancies (id) on delete cascade,
  airtable_candidate_id text not null,
  score integer check (score between 0 and 100),
  reason text,
  risks text[] not null default '{}',
  missing text[] not null default '{}',
  source text not null default 'eigen_pool' check (source in ('eigen_pool', 'linkedin', 'naukri')),
  status text not null default 'voorgesteld' check (status in (
    'voorgesteld', 'goedgekeurd', 'verstuurd', 'gesprek', 'aangenomen', 'afgewezen'
  )),
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vacancy_id, airtable_candidate_id)
);

create table public.anonymous_profiles (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  file_url text,
  content jsonb not null default '{}',
  consent_confirmed boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  sent_at timestamptz,
  -- Rule 13 and 14: only shared with consent and after human approval.
  check (sent_at is null or (approved_at is not null and consent_confirmed))
);

-- Tasks, notes and attachments can also hang on a lead (company).
alter table public.tasks drop constraint tasks_entity_type_check;
alter table public.tasks add constraint tasks_entity_type_check
  check (entity_type in ('client', 'vacancy', 'candidate', 'application', 'placement', 'company'));
alter table public.notes drop constraint notes_entity_type_check;
alter table public.notes add constraint notes_entity_type_check
  check (entity_type in ('client', 'vacancy', 'candidate', 'application', 'placement', 'company'));
alter table public.attachments drop constraint attachments_entity_type_check;
alter table public.attachments add constraint attachments_entity_type_check
  check (entity_type in ('client', 'vacancy', 'candidate', 'application', 'placement', 'company'));

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index on public.companies (icp_decision, segment);
create index on public.companies (status);
create index on public.contacts (company_id);
create index on public.contacts (status);
create index on public.contacts (lower(email));
create index on public.contacts (last_contacted_at);
create index on public.signals (company_id, last_seen_at desc);
create index on public.signals (type);
create index on public.activities (contact_id, date desc);
create index on public.activities (company_id, date desc);
create index on public.activities (campaign_id);
create index on public.activities (outcome, date desc);
create index on public.suppression (contact_id);
create index on public.suppression (company_id);
create index on public.suppression (lower(email));
create index on public.job_runs (job_name, started_at desc);
create index on public.matches (vacancy_id, score desc);
create index on public.anonymous_profiles (match_id);
create index on public.vacancies (company_id);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create trigger companies_set_updated_at before update on public.companies
  for each row execute function public.set_updated_at();
create trigger contacts_set_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();
create trigger matches_set_updated_at before update on public.matches
  for each row execute function public.set_updated_at();

-- Normalise keys on the way in, so callers cannot create near-duplicates.
create or replace function public.companies_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.domain := public.normalize_domain(new.domain);
  if new.client_contact_risk then
    new.icp_decision := 'NO_GO'; -- rule 9
  end if;
  return new;
end;
$$;

create trigger companies_normalize before insert or update on public.companies
  for each row execute function public.companies_normalize();

create or replace function public.contacts_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.linkedin_url := public.normalize_linkedin(new.linkedin_url);
  new.email := nullif(lower(trim(new.email)), '');
  return new;
end;
$$;

create trigger contacts_normalize before insert or update on public.contacts
  for each row execute function public.contacts_normalize();

-- Keep contacts.last_contacted_at current and send unsubscribes to
-- suppression straight away (rule 10).
create or replace function public.activities_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.contact_id is not null and new.outcome not in ('notitie', 'bounce') then
    update public.contacts
    set last_contacted_at = greatest(coalesce(last_contacted_at, new.date), new.date)
    where id = new.contact_id;
  end if;

  if new.outcome = 'afgemeld' then
    insert into public.suppression (contact_id, company_id, reason, scope, notes)
    values (
      new.contact_id,
      case when new.contact_id is null then new.company_id end,
      'afgemeld',
      'alle_kanalen',
      'Automatisch na afmelding via ' || new.source
    );
  end if;

  if new.outcome = 'bounce' and new.contact_id is not null then
    update public.contacts set email_status = 'invalid' where id = new.contact_id;
  end if;
  return null;
end;
$$;

create trigger activities_after_insert after insert on public.activities
  for each row execute function public.activities_after_insert();

-- ---------------------------------------------------------------------------
-- Contactability (rule 4): the single check every export goes through
-- ---------------------------------------------------------------------------

create or replace function public.is_suppressed(p_contact_id uuid, p_channel text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.suppression s
    join public.contacts c on c.id = p_contact_id
    where (s.contact_id = c.id
           or s.company_id = c.company_id
           or (s.email is not null and c.email is not null and lower(s.email) = c.email))
      and (s.scope = 'alle_kanalen'
           or (s.scope = 'alleen_bellen' and p_channel = 'bellen')
           or (s.scope = 'alleen_mail' and p_channel = 'mail'))
  );
$$;

create or replace function public.is_contactable(p_contact_id uuid, p_channel text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select not public.is_suppressed(p_contact_id, p_channel)
     and not exists (
       select 1 from public.activities a
       where a.contact_id = p_contact_id
         and a.outcome not in ('notitie', 'bounce')
         and a.date > now() - interval '30 days'
     );
$$;

-- Call list filter (S6): GO, mobile number, no eenmanszaak/vof,
-- not suppressed for calls, not approached in 30 days.
create view public.call_list_candidates
with (security_invoker = true) as
select
  c.id as contact_id,
  c.company_id,
  co.name as company_name,
  co.domain,
  co.segment,
  co.icp_score,
  co.opening_line,
  c.first_name,
  c.last_name,
  c.title,
  c.tier,
  c.phone,
  c.linkedin_url,
  (select s.id from public.signals s where s.company_id = co.id order by s.last_seen_at desc limit 1) as signal_id,
  (select s.title from public.signals s where s.company_id = co.id order by s.last_seen_at desc limit 1) as signal_title,
  (select s.type from public.signals s where s.company_id = co.id order by s.last_seen_at desc limit 1) as signal_type
from public.contacts c
join public.companies co on co.id = c.company_id
where co.icp_decision = 'GO'
  and c.phone is not null
  and c.phone_type = 'mobiel'
  and coalesce(lower(co.legal_form), '') not similar to '%(eenmanszaak|vof|v\.o\.f\.|vennootschap onder firma)%'
  and c.status not in ('klant', 'verloren', 'uitgesloten', 'kans', 'afspraak')
  and public.is_contactable(c.id, 'bellen');

-- Mail campaign filter (S7): GO, verified email, not suppressed for mail,
-- not approached in 30 days.
create view public.mail_list_candidates
with (security_invoker = true) as
select
  c.id as contact_id,
  c.company_id,
  co.name as company_name,
  co.domain,
  co.segment,
  co.icp_score,
  co.opening_line,
  c.first_name,
  c.last_name,
  c.title,
  c.tier,
  c.email,
  (select s.id from public.signals s where s.company_id = co.id order by s.last_seen_at desc limit 1) as signal_id,
  (select s.title from public.signals s where s.company_id = co.id order by s.last_seen_at desc limit 1) as signal_title,
  (select s.type from public.signals s where s.company_id = co.id order by s.last_seen_at desc limit 1) as signal_type
from public.contacts c
join public.companies co on co.id = c.company_id
where co.icp_decision = 'GO'
  and c.email is not null
  and c.email_status = 'valid'
  and c.status not in ('klant', 'verloren', 'uitgesloten', 'kans', 'afspraak')
  and public.is_contactable(c.id, 'mail');

-- Attribution (goal 4): every meeting with the signal, segment and channel
-- that produced it.
create view public.appointment_attribution
with (security_invoker = true) as
select
  a.id as activity_id,
  a.date,
  a.outcome,
  a.contact_id,
  a.company_id,
  co.name as company_name,
  co.segment,
  coalesce(
    (select prev.channel from public.activities prev
     where prev.contact_id = a.contact_id and prev.channel <> 'meeting' and prev.date <= a.date
     order by prev.date desc limit 1),
    a.channel
  ) as channel,
  coalesce(
    s.type,
    ca.signal_type,
    (select s2.type from public.signals s2 where s2.company_id = a.company_id and s2.first_seen_at <= a.date
     order by s2.last_seen_at desc limit 1)
  ) as signal_type,
  ca.name as campaign_name
from public.activities a
left join public.companies co on co.id = a.company_id
left join public.signals s on s.id = a.signal_id
left join public.campaigns ca on ca.id = a.campaign_id
where a.outcome in ('afspraak', 'afspraak_goedgekeurd');

-- ---------------------------------------------------------------------------
-- Row Level Security: GTM data is for the Nordavo team only. Scheduled jobs
-- write with the service role, which bypasses RLS.
-- ---------------------------------------------------------------------------

alter table public.companies enable row level security;
alter table public.contacts enable row level security;
alter table public.signals enable row level security;
alter table public.campaigns enable row level security;
alter table public.activities enable row level security;
alter table public.suppression enable row level security;
alter table public.list_exports enable row level security;
alter table public.job_runs enable row level security;
alter table public.matches enable row level security;
alter table public.anonymous_profiles enable row level security;

create policy "Staff manage companies" on public.companies
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "Staff manage contacts" on public.contacts
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "Staff manage signals" on public.signals
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "Staff manage campaigns" on public.campaigns
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "Staff manage activities" on public.activities
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "Staff manage suppression" on public.suppression
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "Staff manage list exports" on public.list_exports
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "Staff read job runs" on public.job_runs
  for select to authenticated using (public.is_staff());
create policy "Staff manage matches" on public.matches
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "Staff manage anonymous profiles" on public.anonymous_profiles
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Clients only ever see anonymous profiles through Nordavo, never these rows.

-- ---------------------------------------------------------------------------
-- Read-only role for the Supabase MCP ("praten met AI", section 12).
-- Connect the MCP with read_only=true; this role documents the intent for a
-- direct Postgres connection as well.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select from pg_roles where rolname = 'gtm_readonly') then
    create role gtm_readonly nologin;
  end if;
end;
$$;

grant usage on schema public to gtm_readonly;
grant select on
  public.companies, public.contacts, public.signals, public.campaigns,
  public.activities, public.suppression, public.list_exports, public.job_runs,
  public.vacancies, public.matches, public.anonymous_profiles,
  public.call_list_candidates, public.mail_list_candidates, public.appointment_attribution
to gtm_readonly;
