-- Sales CRM (feedback Julius, "leads, outreach en pipeline", parts 1 to 4).
--
-- The company is the unit: mail, calls and LinkedIn hang on the same company.
-- Everything that happens is a row in public.activities (the timeline, the
-- queues, the boards, the meetings and the report all read from it).
--
--   1  Roles: admin, internal user (member) and external caller (caller)
--   2  Companies: fields from the call list, lead status, pipeline stage, owner
--   3  Contacts: fields from the call list, role, cleaned statuses, caller
--   4  Signals: role group and date online
--   5  Activities: the central log (type, direction, old and new value, source)
--   6  Partners, callers, meetings, sequences, saved views and call lists
--   7  sales_update(): every edit from the table, the MCP and the import
--   8  Rules: pipeline on interest, stages 4 to 7 from recruitment, calls
--   9  Contactability without the 30 day rule
--  10  Row level security

-- ---------------------------------------------------------------------------
-- 1. Roles
-- ---------------------------------------------------------------------------

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'member', 'client', 'external', 'caller'));

-- has_module() for an actor that is not auth.uid() (the MCP and the jobs).
create or replace function public.has_module_for(p_user uuid, p_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.role = 'admin' or (p.role = 'member' and p_module = any (p.modules))
     from public.profiles p where p.id = p_user),
    false
  );
$$;

revoke execute on function public.has_module_for(uuid, text) from public, anon, authenticated;
grant execute on function public.has_module_for(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 6a. Partners (people who bring in leads) and callers, needed by companies
-- ---------------------------------------------------------------------------

create table public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  company_name text check (char_length(company_name) <= 200),
  email text check (char_length(email) <= 320),
  phone text check (char_length(phone) <= 50),
  linkedin_url text check (char_length(linkedin_url) <= 500),
  notes text check (char_length(notes) <= 5000),
  status text not null default 'active' check (status in ('active', 'inactive')),
  owner_id uuid references public.profiles (id) on delete set null,
  last_contact_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger partners_set_updated_at before update on public.partners
  for each row execute function public.set_updated_at();

-- External callers. A caller signs in with their own account (role caller),
-- sees only their call list, the call screen and their own overview.
create table public.callers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles (id) on delete set null,
  name text not null check (char_length(name) between 1 and 200),
  email text not null check (char_length(email) between 3 and 320),
  phone text check (char_length(phone) <= 50),
  party text check (char_length(party) <= 200),
  fee_per_meeting numeric(10, 2) not null default 0 check (fee_per_meeting >= 0),
  status text not null default 'active' check (status in ('active', 'paused', 'stopped')),
  invited_at timestamptz,
  paused_at timestamptz,
  stopped_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index callers_email_key on public.callers (lower(email));

create trigger callers_set_updated_at before update on public.callers
  for each row execute function public.set_updated_at();

-- The active caller row of a user; null when paused, stopped or not a caller.
create or replace function public.caller_id_for(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from public.callers c
  join public.profiles p on p.id = c.profile_id
  where c.profile_id = p_user and c.status = 'active' and p.role = 'caller';
$$;

create or replace function public.current_caller_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select public.caller_id_for((select auth.uid()));
$$;

revoke execute on function public.caller_id_for(uuid) from public, anon, authenticated;
grant execute on function public.caller_id_for(uuid) to service_role;
revoke execute on function public.current_caller_id() from public, anon;
grant execute on function public.current_caller_id() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Companies
-- ---------------------------------------------------------------------------

alter table public.companies
  add column prio smallint check (prio between 1 and 5),
  add column category text check (category in ('development', 'data_bi', 'both')),
  add column description text check (char_length(description) <= 5000),
  add column general_phone text check (char_length(general_phone) <= 50),
  add column source_note text check (char_length(source_note) <= 2000),
  add column lead_status text not null default 'new' check (lead_status in (
    'new', 'review', 'ready', 'enrich', 'in_sequence', 'cooled_down', 'no_go', 'do_not_contact'
  )),
  add column lead_status_changed_at timestamptz not null default now(),
  add column pipeline_stage text check (pipeline_stage in (
    'interested', 'meeting_planned', 'meeting_held', 'intake_done', 'profiles_sent',
    'candidate_interviews', 'won', 'lost'
  )),
  add column pipeline_stage_changed_at timestamptz,
  add column pipeline_entered_at timestamptz,
  add column lost_reason text check (char_length(lost_reason) <= 2000),
  add column owner_id uuid references public.profiles (id) on delete set null,
  add column partner_id uuid references public.partners (id) on delete set null,
  add column next_action text check (char_length(next_action) <= 500),
  add column next_action_date date,
  add column pinned_at timestamptz,
  add column manual_position double precision,
  add column sequence_paused_at timestamptz,
  add constraint companies_lost_needs_reason check (pipeline_stage is distinct from 'lost' or lost_reason is not null);

-- The domain stays the unique key, but a company from the call list may come
-- without a website. Those get a placeholder key on their name.
alter table public.companies drop constraint if exists companies_domain_check;
alter table public.companies add constraint companies_domain_check
  check (domain = public.normalize_domain(domain) or domain like 'nodomain:%');

create or replace function public.companies_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.domain is null or new.domain not like 'nodomain:%' then
    new.domain := public.normalize_domain(new.domain);
  end if;
  if new.client_contact_risk then
    new.icp_decision := 'NO_GO'; -- rule 9
  end if;
  return new;
end;
$$;

-- Lead status from what we knew so far.
update public.companies set lead_status = case
  when status = 'uitgesloten' then 'do_not_contact'
  when icp_decision = 'NO_GO' then 'no_go'
  when icp_decision = 'REVIEW' then 'review'
  when icp_decision = 'GO' and exists (
    select 1 from public.contacts c where c.company_id = companies.id
      and c.status in ('op_bellijst', 'in_mailcampagne', 'bereikt')) then 'in_sequence'
  when icp_decision = 'GO' then 'ready'
  else 'new'
end;

-- ---------------------------------------------------------------------------
-- 3. Contacts
-- ---------------------------------------------------------------------------

alter table public.contacts
  add column role text not null default 'main' check (role in ('main', 'extra', 'reserve')),
  add column route text check (char_length(route) <= 100),
  add column attempts integer not null default 0 check (attempts >= 0),
  add column last_attempt_at timestamptz,
  add column referred_to text check (char_length(referred_to) <= 300),
  add column caller_note text check (char_length(caller_note) <= 5000),
  add column callback_at date,
  add column assigned_caller_id uuid references public.callers (id) on delete set null,
  add column assigned_until date,
  -- Open on someone's call screen: hidden from other callers for 30 minutes.
  add column claimed_by uuid references public.profiles (id) on delete set null,
  add column claimed_at timestamptz,
  add column status_changed_at timestamptz not null default now(),
  add column pinned_at timestamptz,
  add column manual_position double precision;

-- The primary contact of a lead (as clients have one). A flag on the contact
-- rather than a column on the company: a second foreign key between the two
-- tables would make every companies <-> contacts embed ambiguous.
alter table public.contacts add column is_primary boolean not null default false;
create unique index contacts_one_primary_per_company on public.contacts (company_id) where is_primary;

create or replace function public.contacts_single_primary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_primary and (tg_op = 'INSERT' or not old.is_primary or old.company_id <> new.company_id) then
    update public.contacts set is_primary = false
    where company_id = new.company_id and id <> new.id and is_primary;
  end if;
  return new;
end;
$$;

create trigger contacts_single_primary before insert or update of is_primary, company_id on public.contacts
  for each row execute function public.contacts_single_primary();

-- Contacts from the call list come without LinkedIn, mail or full name split.
alter table public.contacts add column full_name text generated always as (
  nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
) stored;

-- 3a. Contact statuses Meeting, Opportunity, Client and Lost become pipeline
-- stages on the company (section 2.8): Opportunity is Interested, Meeting is
-- Meeting planned or held, Client is Won, Lost stays Lost.
with stage_per_contact as (
  select
    c.company_id,
    case c.status
      when 'klant' then 7
      when 'afspraak' then case when exists (
        select 1 from public.activities a
        where a.company_id = c.company_id and a.outcome in ('gesprek_gehad', 'afspraak_goedgekeurd')
      ) or exists (
        select 1 from public.activities a
        where a.company_id = c.company_id and a.outcome = 'afspraak' and a.date < now()
      ) then 3 else 2 end
      when 'kans' then 1
      when 'verloren' then 0
    end as rank
  from public.contacts c
  where c.status in ('klant', 'afspraak', 'kans', 'verloren')
),
best as (
  select company_id, max(rank) as rank from stage_per_contact group by company_id
)
update public.companies co
set pipeline_stage = case b.rank
      when 7 then 'won' when 3 then 'meeting_held' when 2 then 'meeting_planned'
      when 1 then 'interested' else 'lost' end,
    lost_reason = case when b.rank = 0 then 'Lost before the move to the new pipeline' end,
    pipeline_entered_at = now(),
    pipeline_stage_changed_at = now()
from best b
where b.company_id = co.id;

-- Companies already marked as client are Won.
update public.companies
set pipeline_stage = 'won', pipeline_entered_at = coalesce(pipeline_entered_at, now()),
    pipeline_stage_changed_at = coalesce(pipeline_stage_changed_at, now()), lost_reason = null
where status = 'klant' and pipeline_stage is distinct from 'won';

-- 3b. The cleaned contact statuses (section 2.6). On call list and In mail
-- campaign are gone; both mean the contact is being approached.
alter table public.contacts drop constraint if exists contacts_status_check;
update public.contacts set status = case status
  when 'nieuw' then 'new'
  when 'gekwalificeerd' then 'qualified'
  when 'verrijkt' then 'enriched'
  when 'op_bellijst' then 'in_outreach'
  when 'in_mailcampagne' then 'in_outreach'
  when 'bereikt' then 'reached'
  when 'afspraak' then 'reached'
  when 'kans' then 'reached'
  when 'klant' then 'reached'
  when 'verloren' then 'not_interested'
  when 'uitgesloten' then 'do_not_contact'
  else status
end;
alter table public.contacts alter column status set default 'new';
alter table public.contacts add constraint contacts_status_check check (status in (
  'new', 'qualified', 'enrich', 'enriched', 'in_outreach', 'reached', 'not_reached',
  'not_interested', 'do_not_contact'
));

-- The first tier 1 or 2 contact with a number is the primary contact for now.
update public.contacts c
set is_primary = true
where c.id in (
  select distinct on (company_id) id from public.contacts
  order by company_id, (phone is null), coalesce(tier, 9), created_at
);

-- ---------------------------------------------------------------------------
-- 4. Signals
-- ---------------------------------------------------------------------------

alter table public.signals
  add column role_group text check (char_length(role_group) <= 200),
  add column posted_at date;

alter table public.signals drop constraint if exists signals_source_check;
alter table public.signals add constraint signals_source_check
  check (source in ('linkedin', 'indeed', 'overig', 'import', 'apify', 'prospeo'));

-- ---------------------------------------------------------------------------
-- 5. Activities: the central log
-- ---------------------------------------------------------------------------

alter table public.activities
  add column type text not null default 'contact' check (type in (
    'contact', 'change', 'note', 'view', 'meeting', 'reply', 'system'
  )),
  add column direction text check (direction in ('inbound', 'outbound')),
  add column field text check (char_length(field) <= 100),
  add column old_value jsonb,
  add column new_value jsonb,
  add column partner_id uuid references public.partners (id) on delete cascade,
  add column caller_id uuid references public.callers (id) on delete set null,
  add column meeting_id uuid,
  -- Replies to review (section 2.7): Claude's proposal, Julius decides.
  add column review_status text check (review_status in ('pending', 'accepted', 'rejected')),
  add column suggestion jsonb,
  add column reviewed_by uuid references public.profiles (id) on delete set null,
  add column reviewed_at timestamptz;

alter table public.activities drop constraint if exists activities_check;
alter table public.activities add constraint activities_target_check
  check (contact_id is not null or company_id is not null or partner_id is not null);

alter table public.activities drop constraint if exists activities_channel_check;
alter table public.activities add constraint activities_channel_check
  check (channel in ('bellen', 'mail', 'linkedin', 'meeting', 'system'));

alter table public.activities alter column outcome drop not null;
alter table public.activities drop constraint if exists activities_outcome_check;
alter table public.activities add constraint activities_outcome_check check (outcome in (
  'verstuurd', 'geen_gehoor', 'bereikt', 'terugbellen', 'afspraak',
  'afspraak_goedgekeurd', 'afspraak_afgekeurd', 'niet_geinteresseerd',
  'reply_positief', 'reply_neutraal', 'reply_negatief', 'bounce', 'afgemeld',
  'gesprek_gehad', 'gewonnen', 'verloren', 'notitie',
  -- Call screen outcomes (section 2.9), the same buttons as the Excel.
  'no_answer', 'call_back', 'reached_interested', 'meeting_planned',
  'reached_not_interested', 'referred', 'wrong_person', 'wrong_number',
  -- Meetings register (section 2.11).
  'meeting_held', 'meeting_no_show', 'meeting_cancelled'
));

alter table public.activities drop constraint if exists activities_source_check;
alter table public.activities add constraint activities_source_check check (source in (
  'handmatig', 'instantly', 'webpartners', 'calcom', 'onepage', 'import',
  'seleqt', 'system', 'claude', 'apify', 'prospeo'
));

create index activities_review_idx on public.activities (review_status) where review_status = 'pending';
create index activities_partner_idx on public.activities (partner_id, date desc) where partner_id is not null;
create index activities_caller_idx on public.activities (caller_id, date desc) where caller_id is not null;
create index activities_type_idx on public.activities (type, date desc);

-- The person a change is done for and its source, set by sales_update() and
-- the other sales functions for the rest of the transaction.
create or replace function public.sales_current_actor()
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(nullif(current_setting('sales.actor', true), '')::uuid, (select auth.uid()));
$$;

create or replace function public.sales_current_source()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(nullif(current_setting('sales.source', true), ''), 'handmatig');
$$;

-- ---------------------------------------------------------------------------
-- 6b. Meetings register (replaces the meetings sheet)
-- ---------------------------------------------------------------------------

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  caller_id uuid references public.callers (id) on delete set null,
  booked_by uuid references public.profiles (id) on delete set null,
  reason text check (char_length(reason) <= 2000),
  scheduled_at timestamptz,
  status text not null default 'planned'
    check (status in ('planned', 'held', 'approved', 'rejected', 'no_show', 'cancelled')),
  -- What the caller earns once approved. Defaults to the caller's fee and can
  -- be changed per meeting.
  fee numeric(10, 2) not null default 0 check (fee >= 0),
  notes text check (char_length(notes) <= 5000),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  source text not null default 'handmatig' check (source in ('handmatig', 'calcom', 'claude', 'system')),
  -- The Cal.com booking uid: fetching the same booking twice is a no-op.
  external_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index meetings_company_idx on public.meetings (company_id);
create index meetings_caller_idx on public.meetings (caller_id, scheduled_at desc);
create index meetings_status_idx on public.meetings (status, scheduled_at desc);

create trigger meetings_set_updated_at before update on public.meetings
  for each row execute function public.set_updated_at();

alter table public.activities add constraint activities_meeting_fkey
  foreign key (meeting_id) references public.meetings (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 6c. Sequences (replace Campaigns): steps over mail, LinkedIn and calls
-- ---------------------------------------------------------------------------

create table public.sequences (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  description text check (char_length(description) <= 5000),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sequence_steps (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.sequences (id) on delete cascade,
  position integer not null default 0,
  -- Days after the start of the sequence.
  day_offset integer not null default 0 check (day_offset between 0 and 365),
  channel text not null check (channel in ('mail', 'linkedin', 'call')),
  subject text check (char_length(subject) <= 500),
  body text check (char_length(body) <= 20000),
  -- A concept (by Claude or a person) is only used after approval.
  draft_subject text check (char_length(draft_subject) <= 500),
  draft_body text check (char_length(draft_body) <= 20000),
  draft_source text check (draft_source in ('claude', 'handmatig')),
  draft_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sequence_steps_sequence_idx on public.sequence_steps (sequence_id, position);

create table public.sequence_enrollments (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.sequences (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'paused', 'finished', 'stopped')),
  started_at timestamptz not null default now(),
  paused_at timestamptz,
  pause_reason text check (char_length(pause_reason) <= 500),
  started_by uuid references public.profiles (id) on delete set null,
  source text not null default 'handmatig' check (source in ('handmatig', 'claude', 'system')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index sequence_enrollments_active_key
  on public.sequence_enrollments (sequence_id, company_id) where status in ('active', 'paused');
create index sequence_enrollments_company_idx on public.sequence_enrollments (company_id);

-- One row per step per enrollment, on the day it is due. Mail and LinkedIn
-- steps are prepared in Instantly and Seleqt by Claude; call steps show up in
-- the call queue on their day.
create table public.sequence_tasks (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.sequence_enrollments (id) on delete cascade,
  step_id uuid not null references public.sequence_steps (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  channel text not null check (channel in ('mail', 'linkedin', 'call')),
  due_date date not null,
  status text not null default 'open' check (status in ('open', 'done', 'skipped', 'cancelled')),
  done_at timestamptz,
  external_id text unique,
  created_at timestamptz not null default now(),
  unique (enrollment_id, step_id)
);

create index sequence_tasks_due_idx on public.sequence_tasks (channel, due_date) where status = 'open';
create index sequence_tasks_company_idx on public.sequence_tasks (company_id);

create trigger sequences_set_updated_at before update on public.sequences
  for each row execute function public.set_updated_at();
create trigger sequence_steps_set_updated_at before update on public.sequence_steps
  for each row execute function public.set_updated_at();
create trigger sequence_enrollments_set_updated_at before update on public.sequence_enrollments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6d. Saved views of the sales tables; a call list is a saved view
-- ---------------------------------------------------------------------------

create table public.sales_views (
  id uuid primary key default gen_random_uuid(),
  entity text not null check (entity in ('companies', 'contacts', 'pipeline')),
  name text not null check (char_length(name) between 1 and 120),
  -- { filters, sort, columns, widths, manualOrder }, read by src/lib/sales/grid.ts
  config jsonb not null default '{}',
  is_call_list boolean not null default false,
  is_shared boolean not null default true,
  position double precision not null default 0,
  owner_id uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not is_call_list or entity = 'contacts')
);

create index sales_views_entity_idx on public.sales_views (entity, position);

create trigger sales_views_set_updated_at before update on public.sales_views
  for each row execute function public.set_updated_at();

-- A call list opened for a caller until a date. position: which list a
-- caller works through first.
create table public.call_list_callers (
  view_id uuid not null references public.sales_views (id) on delete cascade,
  caller_id uuid not null references public.callers (id) on delete cascade,
  position integer not null default 0,
  open_until date,
  opened_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (view_id, caller_id)
);

create index call_list_callers_caller_idx on public.call_list_callers (caller_id, position);

-- ---------------------------------------------------------------------------
-- Status timestamps, lost reason and the change log
-- ---------------------------------------------------------------------------

create or replace function public.companies_track_stage()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.lead_status is distinct from old.lead_status then
    new.lead_status_changed_at := now();
  end if;
  if tg_op = 'INSERT' or new.pipeline_stage is distinct from old.pipeline_stage then
    if new.pipeline_stage is not null then
      new.pipeline_stage_changed_at := now();
      if tg_op = 'INSERT' or old.pipeline_stage is null then
        new.pipeline_entered_at := now();
      end if;
    else
      new.pipeline_stage_changed_at := null;
      new.pipeline_entered_at := null;
    end if;
  end if;
  if new.pipeline_stage is distinct from 'lost' then
    new.lost_reason := null;
  end if;
  -- Won makes the company a client.
  if new.pipeline_stage = 'won' and (tg_op = 'INSERT' or old.pipeline_stage is distinct from 'won') then
    new.status := 'klant';
  end if;
  return new;
end;
$$;

create trigger companies_track_stage before insert or update on public.companies
  for each row execute function public.companies_track_stage();

create or replace function public.contacts_track_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

create trigger contacts_track_status before insert or update on public.contacts
  for each row execute function public.contacts_track_status();

-- Every change of a tracked field is a 'change' row in activities, with the
-- old and new value, who did it and from where (section 2.3 point 9).
create or replace function public.sales_log_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := to_jsonb(old);
  v_key text;
  v_fields text[];
  v_company uuid;
  v_contact uuid;
begin
  if coalesce(current_setting('sales.skip_log', true), '') = 'on' then
    return null;
  end if;
  if tg_table_name = 'companies' then
    v_fields := array[
      'name', 'website', 'prio', 'category', 'description', 'sector', 'employees', 'city',
      'linkedin_url', 'general_phone', 'red_flags', 'opening_line', 'source_note',
      'icp_decision', 'lead_status', 'pipeline_stage', 'lost_reason', 'owner_id', 'partner_id',
      'next_action', 'next_action_date', 'pinned_at'
    ];
    v_company := new.id;
  else
    v_fields := array[
      'first_name', 'last_name', 'title', 'tier', 'role', 'route', 'phone', 'email',
      'linkedin_url', 'status', 'attempts', 'callback_at', 'referred_to', 'caller_note',
      'assigned_caller_id', 'assigned_until', 'pinned_at', 'company_id', 'is_primary'
    ];
    v_company := new.company_id;
    v_contact := new.id;
  end if;

  foreach v_key in array v_fields loop
    if (v_new -> v_key) is distinct from (v_old -> v_key) then
      insert into public.activities (
        company_id, contact_id, channel, type, field, old_value, new_value, source, created_by, caller_id
      ) values (
        v_company, v_contact, 'system', 'change', v_key, v_old -> v_key, v_new -> v_key,
        public.sales_current_source(), public.sales_current_actor(),
        public.caller_id_for(public.sales_current_actor())
      );
    end if;
  end loop;
  return null;
end;
$$;

revoke execute on function public.sales_log_changes() from public, anon, authenticated;

create trigger companies_log_changes after update on public.companies
  for each row execute function public.sales_log_changes();
create trigger contacts_log_changes after update on public.contacts
  for each row execute function public.sales_log_changes();

-- ---------------------------------------------------------------------------
-- 7. sales_update(): one write path for the table, the board, the MCP and the
--    import. Only whitelisted columns; the change log names actor and source.
-- ---------------------------------------------------------------------------

create or replace function public.sales_actor(p_actor uuid, p_source text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
begin
  if (select auth.role()) = 'service_role' then
    v_uid := p_actor;
    if v_uid is not null and not public.has_module_for(v_uid, 'sales')
       and public.caller_id_for(v_uid) is null then
      raise exception 'No access to sales' using errcode = '42501';
    end if;
  else
    v_uid := (select auth.uid());
    if v_uid is null or not public.has_module('sales') then
      raise exception 'No access to sales' using errcode = '42501';
    end if;
  end if;
  if p_source is not null and p_source not in (
    'handmatig', 'instantly', 'webpartners', 'calcom', 'onepage', 'import', 'seleqt', 'system', 'claude', 'apify', 'prospeo'
  ) then
    raise exception 'Unknown source';
  end if;
  perform set_config('sales.actor', coalesce(v_uid::text, ''), true);
  perform set_config('sales.source', coalesce(p_source, 'handmatig'), true);
  return v_uid;
end;
$$;

revoke execute on function public.sales_actor(uuid, text) from public, anon;
grant execute on function public.sales_actor(uuid, text) to authenticated, service_role;

create or replace function public.sales_update(
  p_entity text,
  p_ids uuid[],
  p_fields jsonb,
  p_source text default 'handmatig',
  p_actor uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.sales_actor(p_actor, p_source);
  v_allowed text[];
  v_cols text[];
  v_table text;
  v_count integer;
  v_key text;
begin
  if public.caller_id_for(v_uid) is not null then
    raise exception 'Callers change contacts on the call screen only' using errcode = '42501';
  end if;
  if p_entity = 'company' then
    v_table := 'companies';
    v_allowed := array[
      'name', 'website', 'prio', 'category', 'description', 'sector', 'employees', 'city',
      'linkedin_url', 'general_phone', 'red_flags', 'opening_line', 'source_note', 'segment',
      'icp_decision', 'icp_reason', 'icp_score', 'lead_status', 'pipeline_stage', 'lost_reason',
      'owner_id', 'partner_id', 'next_action', 'next_action_date',
      'pinned_at', 'manual_position', 'legal_form', 'kvk_number'
    ];
  elsif p_entity = 'contact' then
    v_table := 'contacts';
    v_allowed := array[
      'first_name', 'last_name', 'title', 'tier', 'role', 'route', 'phone', 'phone_type',
      'email', 'email_status', 'linkedin_url', 'status', 'attempts', 'last_attempt_at',
      'callback_at', 'referred_to', 'caller_note', 'assigned_caller_id', 'assigned_until',
      'pinned_at', 'manual_position', 'is_primary'
    ];
  else
    raise exception 'Unknown record type';
  end if;

  if p_fields is null or jsonb_typeof(p_fields) <> 'object' or p_fields = '{}'::jsonb then
    return 0;
  end if;
  for v_key in select jsonb_object_keys(p_fields) loop
    if not v_key = any (v_allowed) then
      raise exception 'Field % cannot be changed here', v_key;
    end if;
  end loop;

  -- One contact is assigned to at most one caller; assigning is for the team.
  if p_entity = 'contact' and p_fields ? 'assigned_caller_id'
     and nullif(p_fields ->> 'assigned_caller_id', '') is not null
     and not exists (select 1 from public.callers where id = (p_fields ->> 'assigned_caller_id')::uuid and status = 'active') then
    raise exception 'That caller is not active';
  end if;

  select array_agg(k order by k) into v_cols from jsonb_object_keys(p_fields) k;

  execute format(
    'update public.%I t set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1) r) where t.id = any ($2)',
    v_table,
    (select string_agg(format('%I', c), ', ') from unnest(v_cols) c),
    (select string_agg(format('r.%I', c), ', ') from unnest(v_cols) c),
    v_table
  ) using p_fields, p_ids;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.sales_update(text, uuid[], jsonb, text, uuid) from public, anon;
grant execute on function public.sales_update(text, uuid[], jsonb, text, uuid) to authenticated, service_role;

-- A free activity (a call made elsewhere, a LinkedIn message, a reply that
-- Claude fetched). external_id makes a second fetch a no-op. Returns the id,
-- or null when the external id was already there.
create or replace function public.sales_log_activity(
  p_company uuid,
  p_contact uuid,
  p_channel text,
  p_type text,
  p_outcome text default null,
  p_notes text default null,
  p_direction text default null,
  p_date timestamptz default null,
  p_source text default 'handmatig',
  p_external_id text default null,
  p_partner uuid default null,
  p_review boolean default false,
  p_suggestion jsonb default null,
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.sales_actor(p_actor, p_source);
  v_company uuid := p_company;
  v_id uuid;
begin
  if public.caller_id_for(v_uid) is not null then
    raise exception 'Callers log calls on the call screen only' using errcode = '42501';
  end if;
  if v_company is null and p_contact is not null then
    select company_id into v_company from public.contacts where id = p_contact;
  end if;
  if p_external_id is not null and exists (select 1 from public.activities where external_id = p_external_id) then
    return null;
  end if;
  insert into public.activities (
    company_id, contact_id, partner_id, channel, type, outcome, notes, direction, date, source,
    external_id, created_by, review_status, suggestion
  ) values (
    v_company, p_contact, p_partner, p_channel, coalesce(p_type, 'contact'), p_outcome,
    nullif(trim(p_notes), ''), p_direction, coalesce(p_date, now()), coalesce(p_source, 'handmatig'),
    p_external_id, v_uid, case when p_review then 'pending' end, p_suggestion
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.sales_log_activity(uuid, uuid, text, text, text, text, text, timestamptz, text, text, uuid, boolean, jsonb, uuid) from public, anon;
grant execute on function public.sales_log_activity(uuid, uuid, text, text, text, text, text, timestamptz, text, text, uuid, boolean, jsonb, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Rules
-- ---------------------------------------------------------------------------

create or replace function public.sales_stage_rank(p_stage text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_stage
    when 'interested' then 1 when 'meeting_planned' then 2 when 'meeting_held' then 3
    when 'intake_done' then 4 when 'profiles_sent' then 5 when 'candidate_interviews' then 6
    when 'won' then 7 else 0 end;
$$;

-- Moves a company forward in the pipeline, never back. A lost company comes
-- back in when something new happens.
create or replace function public.sales_advance_stage(p_company uuid, p_stage text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current text;
begin
  select pipeline_stage into v_current from public.companies where id = p_company;
  if not found then
    return false;
  end if;
  if v_current is not null and v_current <> 'lost'
     and public.sales_stage_rank(v_current) >= public.sales_stage_rank(p_stage) then
    return false;
  end if;
  update public.companies set pipeline_stage = p_stage where id = p_company;
  return true;
end;
$$;

revoke execute on function public.sales_advance_stage(uuid, text) from public, anon, authenticated;

-- Pauses a company everywhere after a reply on any channel (section 2.12
-- point 5): its sequences pause and its open call steps go away. Claude
-- pauses the company in Instantly and Seleqt.
create or replace function public.sales_pause_company(p_company uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.sequence_enrollments
  set status = 'paused', paused_at = now(), pause_reason = left(coalesce(p_reason, 'Reply received'), 500)
  where company_id = p_company and status = 'active';

  update public.sequence_tasks
  set status = 'cancelled'
  where company_id = p_company and status = 'open' and channel = 'call';

  update public.companies set sequence_paused_at = now() where id = p_company;
end;
$$;

revoke execute on function public.sales_pause_company(uuid, text) from public, anon, authenticated;

-- What one activity means for the rest (replaces the earlier trigger).
create or replace function public.activities_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.contact_id is not null and new.type in ('contact', 'reply', 'meeting')
     and coalesce(new.outcome, '') not in ('notitie', 'bounce') then
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
      'Automatically after unsubscribe via ' || new.source
    );
    if new.contact_id is not null then
      update public.contacts set status = 'do_not_contact' where id = new.contact_id;
    end if;
  end if;

  if new.outcome = 'bounce' and new.contact_id is not null then
    update public.contacts set email_status = 'invalid' where id = new.contact_id;
  end if;

  if new.company_id is not null then
    -- A reply on any channel pauses the company (2.12 point 5).
    if new.type = 'reply' or new.outcome in ('reply_positief', 'reply_neutraal', 'reply_negatief') then
      perform public.sales_pause_company(new.company_id, 'Reply via ' || new.channel);
    end if;
    -- Interest moves the company into the pipeline (2.7). A reply that waits
    -- for review only counts once it is accepted.
    if new.review_status is distinct from 'pending' then
      if new.outcome in ('reached_interested', 'reply_positief') then
        perform public.sales_advance_stage(new.company_id, 'interested');
      elsif new.outcome in ('afspraak', 'meeting_planned') then
        perform public.sales_advance_stage(new.company_id, 'meeting_planned');
      elsif new.outcome in ('gesprek_gehad', 'meeting_held') then
        perform public.sales_advance_stage(new.company_id, 'meeting_held');
      end if;
    end if;
  end if;

  if new.partner_id is not null and new.type in ('contact', 'reply', 'meeting') then
    update public.partners
    set last_contact_at = greatest(coalesce(last_contact_at, new.date), new.date)
    where id = new.partner_id;
  end if;
  return null;
end;
$$;

-- Julius decides on a reply to review with one click (2.7, 2.14).
-- p_apply: { "outcome": "reply_positief", "lead_status": "...", "pipeline_stage": "...", "lost_reason": "..." }
create or replace function public.sales_decide_reply(
  p_activity uuid,
  p_accept boolean,
  p_apply jsonb default '{}',
  p_actor uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.sales_actor(p_actor, 'handmatig');
  v_row public.activities;
  v_apply jsonb := coalesce(p_apply, '{}');
  v_fields jsonb := '{}';
begin
  select * into v_row from public.activities where id = p_activity;
  if v_row.id is null or v_row.review_status is distinct from 'pending' then
    raise exception 'This reply is not waiting for review';
  end if;

  update public.activities
  set review_status = case when p_accept then 'accepted' else 'rejected' end,
      reviewed_by = v_uid,
      reviewed_at = now(),
      outcome = case when p_accept and v_apply ? 'outcome' then v_apply ->> 'outcome' else outcome end
  where id = p_activity;

  if not p_accept or v_row.company_id is null then
    return;
  end if;

  if (case when v_apply ? 'outcome' then v_apply ->> 'outcome' else v_row.outcome end) = 'reply_positief' then
    perform public.sales_advance_stage(v_row.company_id, 'interested');
  end if;
  if v_apply ? 'lead_status' then
    v_fields := v_fields || jsonb_build_object('lead_status', v_apply ->> 'lead_status');
  end if;
  if v_apply ? 'pipeline_stage' then
    v_fields := v_fields || jsonb_build_object('pipeline_stage', v_apply ->> 'pipeline_stage');
    if v_apply ? 'lost_reason' then
      v_fields := v_fields || jsonb_build_object('lost_reason', v_apply ->> 'lost_reason');
    end if;
  end if;
  if v_fields <> '{}'::jsonb then
    perform public.sales_update('company', array[v_row.company_id], v_fields, 'handmatig', p_actor);
  end if;
  if v_apply ? 'contact_status' and v_row.contact_id is not null then
    perform public.sales_update('contact', array[v_row.contact_id],
      jsonb_build_object('status', v_apply ->> 'contact_status'), 'handmatig', p_actor);
  end if;
end;
$$;

revoke execute on function public.sales_decide_reply(uuid, boolean, jsonb, uuid) from public, anon;
grant execute on function public.sales_decide_reply(uuid, boolean, jsonb, uuid) to authenticated, service_role;

-- 8a. Stages 4 to 7 from the recruitment data (section 2.8):
--   a vacancy for the company        Intake done
--   candidates presented             Profiles sent
--   a client interview               Candidate interviews
--   a placement                      Won, and the company becomes a client
create or replace function public.sales_sync_recruitment_stage(p_company uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client uuid;
  v_stage text;
begin
  select client_id into v_client from public.companies where id = p_company;
  if not found then
    return;
  end if;

  if exists (
    select 1 from public.placements pl
    left join public.vacancies v on v.id = pl.vacancy_id
    where (v_client is not null and pl.client_id = v_client) or v.company_id = p_company
  ) then
    v_stage := 'won';
  elsif exists (
    select 1 from public.interviews i
    join public.applications a on a.id = i.application_id
    join public.vacancies v on v.id = a.vacancy_id
    where i.kind = 'client_interview' and i.status <> 'cancelled'
      and (v.company_id = p_company or (v_client is not null and v.client_id = v_client))
  ) or exists (
    select 1 from public.applications a
    join public.vacancies v on v.id = a.vacancy_id
    where a.stage in ('client_interview', 'final_screening', 'placed')
      and (v.company_id = p_company or (v_client is not null and v.client_id = v_client))
  ) then
    v_stage := 'candidate_interviews';
  elsif exists (
    select 1 from public.applications a
    join public.vacancies v on v.id = a.vacancy_id
    where public.is_presented_stage(a.stage)
      and (v.company_id = p_company or (v_client is not null and v.client_id = v_client))
  ) then
    v_stage := 'profiles_sent';
  elsif exists (
    select 1 from public.vacancies v
    where v.company_id = p_company or (v_client is not null and v.client_id = v_client)
  ) then
    v_stage := 'intake_done';
  end if;

  if v_stage is not null then
    perform set_config('sales.source', 'system', true);
    perform public.sales_advance_stage(p_company, v_stage);
  end if;
end;
$$;

revoke execute on function public.sales_sync_recruitment_stage(uuid) from public, anon, authenticated;

create or replace function public.sales_recruitment_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vacancy uuid;
  v_client uuid;
  v_company uuid;
begin
  if tg_table_name = 'vacancies' then
    v_vacancy := new.id;
  elsif tg_table_name = 'applications' then
    v_vacancy := new.vacancy_id;
  elsif tg_table_name = 'interviews' then
    select vacancy_id into v_vacancy from public.applications where id = new.application_id;
  elsif tg_table_name = 'placements' then
    v_vacancy := new.vacancy_id;
    v_client := new.client_id;
  end if;

  if v_vacancy is not null then
    select coalesce(v_client, client_id), company_id into v_client, v_company
    from public.vacancies where id = v_vacancy;
  end if;

  for v_company in
    select id from public.companies
    where id = v_company or (v_client is not null and client_id = v_client)
  loop
    perform public.sales_sync_recruitment_stage(v_company);
  end loop;
  return null;
end;
$$;

revoke execute on function public.sales_recruitment_changed() from public, anon, authenticated;

create trigger vacancies_sales_stage after insert or update of company_id, client_id on public.vacancies
  for each row execute function public.sales_recruitment_changed();
create trigger applications_sales_stage after insert or update of stage on public.applications
  for each row execute function public.sales_recruitment_changed();
create trigger interviews_sales_stage after insert or update of status on public.interviews
  for each row execute function public.sales_recruitment_changed();
create trigger placements_sales_stage after insert on public.placements
  for each row execute function public.sales_recruitment_changed();

-- 8b. Meetings move the pipeline too, and land in the timeline.
create or replace function public.meetings_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outcome text;
begin
  if tg_op = 'INSERT' then
    v_outcome := 'meeting_planned';
  elsif new.status is distinct from old.status then
    v_outcome := case new.status
      when 'held' then 'meeting_held'
      when 'approved' then 'afspraak_goedgekeurd'
      when 'rejected' then 'afspraak_afgekeurd'
      when 'no_show' then 'meeting_no_show'
      when 'cancelled' then 'meeting_cancelled'
    end;
  end if;
  if v_outcome is null then
    return null;
  end if;

  insert into public.activities (
    company_id, contact_id, channel, type, outcome, notes, date, source, created_by, caller_id, meeting_id
  ) values (
    new.company_id, new.contact_id, 'meeting', 'meeting', v_outcome,
    case when tg_op = 'INSERT' then new.reason end,
    case when tg_op = 'INSERT' then coalesce(least(new.scheduled_at, now()), now()) else now() end,
    case when public.sales_current_source() = 'handmatig' then new.source else public.sales_current_source() end,
    public.sales_current_actor(), new.caller_id, new.id
  );

  if new.status = 'approved' or new.status = 'held' then
    perform public.sales_advance_stage(new.company_id, 'meeting_held');
  end if;
  return null;
end;
$$;

revoke execute on function public.meetings_after_change() from public, anon, authenticated;

create trigger meetings_after_change after insert or update of status on public.meetings
  for each row execute function public.meetings_after_change();

-- Fee defaults to the caller's fee.
create or replace function public.meetings_default_fee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.caller_id is not null and coalesce(new.fee, 0) = 0
     and (tg_op = 'INSERT' or old.caller_id is distinct from new.caller_id) then
    select fee_per_meeting into new.fee from public.callers where id = new.caller_id;
    new.fee := coalesce(new.fee, 0);
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status
     and new.status in ('approved', 'rejected') then
    new.decided_at := now();
    new.decided_by := coalesce(new.decided_by, public.sales_current_actor());
  end if;
  return new;
end;
$$;

create trigger meetings_default_fee before insert or update on public.meetings
  for each row execute function public.meetings_default_fee();

-- A meeting from the call screen, the meetings page, the Cal.com webhook or
-- Claude. A booking with a known external id is a no-op; a booking without
-- one fills in the planned meeting of the same contact from the last 14 days.
create or replace function public.sales_save_meeting(
  p_company uuid,
  p_contact uuid default null,
  p_caller uuid default null,
  p_scheduled_at timestamptz default null,
  p_reason text default null,
  p_external_id text default null,
  p_source text default 'handmatig',
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.sales_actor(p_actor, p_source);
  v_id uuid;
  v_company uuid := p_company;
begin
  if p_external_id is not null then
    select id into v_id from public.meetings where external_id = p_external_id;
    if v_id is not null then
      update public.meetings
      set scheduled_at = coalesce(p_scheduled_at, scheduled_at)
      where id = v_id;
      return v_id;
    end if;
  end if;
  if v_company is null and p_contact is not null then
    select company_id into v_company from public.contacts where id = p_contact;
  end if;
  if v_company is null then
    raise exception 'A meeting needs a company';
  end if;

  if p_external_id is not null then
    select id into v_id from public.meetings
    where company_id = v_company and external_id is null and status = 'planned'
      and (p_contact is null or contact_id is null or contact_id = p_contact)
      and created_at > now() - interval '14 days'
    order by created_at desc
    limit 1;
    if v_id is not null then
      update public.meetings
      set external_id = p_external_id,
          scheduled_at = coalesce(p_scheduled_at, scheduled_at),
          contact_id = coalesce(contact_id, p_contact),
          reason = coalesce(reason, nullif(trim(p_reason), ''))
      where id = v_id;
      return v_id;
    end if;
  end if;

  insert into public.meetings (
    company_id, contact_id, caller_id, booked_by, scheduled_at, reason, external_id, source
  ) values (
    v_company, p_contact, p_caller, v_uid, p_scheduled_at, nullif(trim(p_reason), ''), p_external_id,
    case when p_source in ('handmatig', 'calcom', 'claude', 'system') then p_source else 'handmatig' end
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.sales_save_meeting(uuid, uuid, uuid, timestamptz, text, text, text, uuid) from public, anon;
grant execute on function public.sales_save_meeting(uuid, uuid, uuid, timestamptz, text, text, text, uuid) to authenticated, service_role;

-- 8c. Calls (section 2.9). A caller holds a contact while it is open on the
-- call screen; others do not see it for 30 minutes.
create or replace function public.sales_claim_contact(p_contact uuid, p_actor uuid default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.sales_actor(p_actor, 'handmatig');
  v_caller uuid := public.caller_id_for(v_uid);
  v_row public.contacts;
begin
  select * into v_row from public.contacts where id = p_contact for update;
  if v_row.id is null then
    return false;
  end if;
  -- Assigned to another caller: not for anyone else.
  if v_row.assigned_caller_id is not null and v_row.assigned_caller_id is distinct from v_caller
     and (v_row.assigned_until is null or v_row.assigned_until >= current_date)
     and v_caller is not null then
    return false;
  end if;
  if v_row.claimed_by is not null and v_row.claimed_by <> v_uid
     and v_row.claimed_at > now() - interval '30 minutes' then
    return false;
  end if;
  update public.contacts set claimed_by = v_uid, claimed_at = now() where id = p_contact;
  if v_caller is not null then
    -- Everything a caller does is in Activities (2.10).
    insert into public.activities (company_id, contact_id, channel, type, source, created_by, caller_id)
    values (v_row.company_id, v_row.id, 'system', 'view', 'handmatig', v_uid, v_caller);
  end if;
  return true;
end;
$$;

create or replace function public.sales_release_contact(p_contact uuid, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.sales_actor(p_actor, 'handmatig');
begin
  update public.contacts set claimed_by = null, claimed_at = null
  where id = p_contact and claimed_by = v_uid;
end;
$$;

-- One call outcome. Updates attempts and the date of the last attempt, logs
-- the outcome, and applies what the outcome means:
--   no_answer           after 3 attempts: Not reached, other contacts to Enrich
--   call_back           callback date
--   reached_interested  Reached, company to the pipeline (Interested)
--   meeting_planned     Reached, company to Meeting planned, a planned meeting
--   reached_not_interested  Not interested
--   referred            a new contact at the same company
--   wrong_person        Reached, role Reserve
--   wrong_number        Enrich
-- Callers may only call contacts they hold (sales_claim_contact) and only
-- change outcome, callback date, referred to and the note (2.10).
create or replace function public.sales_log_call(
  p_contact uuid,
  p_outcome text,
  p_callback_at date default null,
  p_referred_name text default null,
  p_referred_title text default null,
  p_referred_phone text default null,
  p_note text default null,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.sales_actor(p_actor, 'handmatig');
  v_caller uuid := public.caller_id_for(v_uid);
  v_row public.contacts;
  v_attempts integer;
  v_status text;
  v_role text;
  v_new_contact uuid;
  v_meeting uuid;
  v_first text;
  v_last text;
begin
  if p_outcome not in (
    'no_answer', 'call_back', 'reached_interested', 'meeting_planned',
    'reached_not_interested', 'referred', 'wrong_person', 'wrong_number'
  ) then
    raise exception 'Unknown call outcome';
  end if;
  select * into v_row from public.contacts where id = p_contact for update;
  if v_row.id is null then
    raise exception 'Contact not found' using errcode = 'P0002';
  end if;
  if v_caller is not null and v_row.claimed_by is distinct from v_uid then
    raise exception 'Open this contact on the call screen first' using errcode = '42501';
  end if;
  if p_outcome = 'call_back' and p_callback_at is null then
    raise exception 'Pick a date to call back';
  end if;
  if p_outcome = 'referred' and coalesce(trim(p_referred_name), '') = '' then
    raise exception 'Who were you referred to?';
  end if;

  v_attempts := v_row.attempts + 1;
  v_status := v_row.status;
  v_role := v_row.role;

  case p_outcome
    when 'no_answer' then
      v_status := case when v_attempts >= 3 then 'not_reached' else 'in_outreach' end;
    when 'call_back' then
      v_status := 'in_outreach';
    when 'reached_interested', 'meeting_planned' then
      v_status := 'reached';
    when 'reached_not_interested' then
      v_status := 'not_interested';
    when 'referred' then
      v_status := 'reached';
    when 'wrong_person' then
      v_status := 'reached';
      v_role := 'reserve';
    when 'wrong_number' then
      v_status := 'enrich';
  end case;

  -- Callers change only what 2.10 allows; the rest follows from the outcome.
  perform set_config('sales.source', 'handmatig', true);
  update public.contacts
  set attempts = v_attempts,
      last_attempt_at = now(),
      status = v_status,
      role = v_role,
      callback_at = case when p_outcome = 'call_back' then p_callback_at else null end,
      referred_to = case when p_outcome = 'referred'
        then left(trim(concat_ws(', ', trim(p_referred_name), nullif(trim(p_referred_title), ''))), 300)
        else referred_to end,
      caller_note = coalesce(nullif(trim(p_note), ''), caller_note),
      claimed_by = null,
      claimed_at = null
  where id = p_contact;

  insert into public.activities (
    company_id, contact_id, channel, type, direction, outcome, notes, source, created_by, caller_id,
    next_action, next_action_date
  ) values (
    v_row.company_id, v_row.id, 'bellen', 'contact', 'outbound', p_outcome, nullif(trim(p_note), ''),
    'handmatig', v_uid, v_caller,
    case when p_outcome = 'call_back' then 'Call back' end,
    case when p_outcome = 'call_back' then p_callback_at end
  );

  -- Three attempts without result: the other contacts go to Enrich (2.9).
  if p_outcome = 'no_answer' and v_attempts >= 3 then
    update public.contacts
    set status = 'enrich'
    where company_id = v_row.company_id and id <> v_row.id
      and status not in ('reached', 'not_interested', 'do_not_contact', 'not_reached');
    if not exists (
      select 1 from public.contacts
      where company_id = v_row.company_id and phone is not null
        and status not in ('not_reached', 'not_interested', 'do_not_contact', 'enrich')
    ) then
      update public.companies set lead_status = 'enrich'
      where id = v_row.company_id and lead_status in ('new', 'review', 'ready', 'in_sequence');
    end if;
  end if;

  if p_outcome = 'referred' then
    v_first := split_part(trim(p_referred_name), ' ', 1);
    v_last := nullif(trim(substr(trim(p_referred_name), length(v_first) + 1)), '');
    insert into public.contacts (company_id, first_name, last_name, title, phone, phone_type, role, status, source, sources)
    values (
      v_row.company_id, v_first, v_last, nullif(trim(p_referred_title), ''), nullif(trim(p_referred_phone), ''),
      case when nullif(trim(p_referred_phone), '') is not null then 'mobiel' end,
      'main', case when nullif(trim(p_referred_phone), '') is null then 'enrich' else 'new' end,
      'referred', array['referred']
    )
    returning id into v_new_contact;
    -- A referral from a caller stays with that caller.
    if v_caller is not null then
      update public.contacts set assigned_caller_id = v_caller, assigned_until = v_row.assigned_until
      where id = v_new_contact;
    end if;
  end if;

  if p_outcome = 'meeting_planned' then
    v_meeting := public.sales_save_meeting(v_row.company_id, v_row.id, v_caller, null,
      nullif(trim(p_note), ''), null, 'handmatig', p_actor);
  end if;

  if p_outcome = 'reached_interested' or p_outcome = 'meeting_planned' then
    update public.companies set lead_status = 'in_sequence'
    where id = v_row.company_id and lead_status in ('new', 'review', 'ready', 'enrich', 'cooled_down');
  end if;

  -- The call step of a sequence for this company is done.
  update public.sequence_tasks set status = 'done', done_at = now()
  where company_id = v_row.company_id and channel = 'call' and status = 'open' and due_date <= current_date;

  return jsonb_build_object(
    'attempts', v_attempts, 'status', v_status, 'new_contact_id', v_new_contact, 'meeting_id', v_meeting
  );
end;
$$;

revoke execute on function public.sales_claim_contact(uuid, uuid) from public, anon;
grant execute on function public.sales_claim_contact(uuid, uuid) to authenticated, service_role;
revoke execute on function public.sales_release_contact(uuid, uuid) from public, anon;
grant execute on function public.sales_release_contact(uuid, uuid) to authenticated, service_role;
revoke execute on function public.sales_log_call(uuid, text, date, text, text, text, text, uuid) from public, anon;
grant execute on function public.sales_log_call(uuid, text, date, text, text, text, text, uuid) to authenticated, service_role;

-- 8d. Sequences: start one for a company. Every step gets a task on its day.
create or replace function public.sales_start_sequence(
  p_sequence uuid,
  p_company uuid,
  p_contact uuid default null,
  p_start date default null,
  p_source text default 'handmatig',
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.sales_actor(p_actor, p_source);
  v_seq public.sequences;
  v_id uuid;
  v_contact uuid := p_contact;
  v_start date := coalesce(p_start, current_date);
begin
  select * into v_seq from public.sequences where id = p_sequence;
  if v_seq.id is null then
    raise exception 'Sequence not found' using errcode = 'P0002';
  end if;
  if v_seq.status <> 'active' then
    raise exception 'Only an active sequence can be started';
  end if;
  if exists (select 1 from public.sequence_steps where sequence_id = p_sequence
             and channel in ('mail', 'linkedin') and approved_at is null) then
    raise exception 'Approve the texts of every mail and LinkedIn step first';
  end if;
  if exists (select 1 from public.companies where id = p_company and lead_status in ('no_go', 'do_not_contact')) then
    raise exception 'This company may not be contacted';
  end if;
  if v_contact is null then
    select id into v_contact from public.contacts where company_id = p_company and is_primary;
  end if;

  insert into public.sequence_enrollments (sequence_id, company_id, contact_id, started_at, started_by, source)
  values (p_sequence, p_company, v_contact, v_start, v_uid,
          case when p_source in ('handmatig', 'claude', 'system') then p_source else 'handmatig' end)
  returning id into v_id;

  insert into public.sequence_tasks (enrollment_id, step_id, company_id, contact_id, channel, due_date)
  select v_id, s.id, p_company, v_contact, s.channel, v_start + s.day_offset
  from public.sequence_steps s
  where s.sequence_id = p_sequence;

  update public.companies set lead_status = 'in_sequence', sequence_paused_at = null
  where id = p_company and lead_status in ('new', 'review', 'ready', 'enrich', 'cooled_down');
  update public.contacts set status = 'in_outreach'
  where id = v_contact and status in ('new', 'qualified', 'enriched');
  return v_id;
end;
$$;

revoke execute on function public.sales_start_sequence(uuid, uuid, uuid, date, text, uuid) from public, anon;
grant execute on function public.sales_start_sequence(uuid, uuid, uuid, date, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Contactability: the "not approached in 30 days" rule is gone (it blocked
--    contact over several channels within a week). Suppression still counts.
-- ---------------------------------------------------------------------------

create or replace function public.is_contactable(p_contact_id uuid, p_channel text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select not public.is_suppressed(p_contact_id, p_channel);
$$;

create or replace view public.call_list_candidates
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
  and co.lead_status not in ('no_go', 'do_not_contact')
  and c.phone is not null
  and c.phone_type = 'mobiel'
  and coalesce(lower(co.legal_form), '') not similar to '%(eenmanszaak|vof|v\.o\.f\.|vennootschap onder firma)%'
  and c.status not in ('not_interested', 'do_not_contact', 'not_reached')
  and (co.pipeline_stage is null or co.pipeline_stage = 'lost')
  and public.is_contactable(c.id, 'bellen');

create or replace view public.mail_list_candidates
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
  and co.lead_status not in ('no_go', 'do_not_contact')
  and c.email is not null
  and c.email_status = 'valid'
  and c.status not in ('not_interested', 'do_not_contact')
  and (co.pipeline_stage is null or co.pipeline_stage = 'lost')
  and public.is_contactable(c.id, 'mail');

-- Attribution also counts meetings from the register.
create or replace view public.appointment_attribution
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
     where prev.contact_id = a.contact_id and prev.channel not in ('meeting', 'system') and prev.date <= a.date
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
where a.outcome in ('afspraak', 'afspraak_goedgekeurd')
   or (a.outcome = 'meeting_planned' and a.channel = 'meeting');

-- ---------------------------------------------------------------------------
-- 10. Row level security. The sales module manages all of it; callers have no
--     direct access to any table (the app serves them through the functions
--     above after checking their queue), admins manage callers.
-- ---------------------------------------------------------------------------

alter table public.partners enable row level security;
alter table public.callers enable row level security;
alter table public.meetings enable row level security;
alter table public.sequences enable row level security;
alter table public.sequence_steps enable row level security;
alter table public.sequence_enrollments enable row level security;
alter table public.sequence_tasks enable row level security;
alter table public.sales_views enable row level security;
alter table public.call_list_callers enable row level security;

create policy "Sales manage partners" on public.partners
  for all to authenticated using (public.has_module('sales')) with check (public.has_module('sales'));
create policy "Sales read callers" on public.callers
  for select to authenticated using (public.has_module('sales'));
create policy "Admins manage callers" on public.callers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Sales manage meetings" on public.meetings
  for all to authenticated using (public.has_module('sales')) with check (public.has_module('sales'));
create policy "Sales manage sequences" on public.sequences
  for all to authenticated using (public.has_module('sales')) with check (public.has_module('sales'));
create policy "Sales manage sequence steps" on public.sequence_steps
  for all to authenticated using (public.has_module('sales')) with check (public.has_module('sales'));
create policy "Sales manage enrollments" on public.sequence_enrollments
  for all to authenticated using (public.has_module('sales')) with check (public.has_module('sales'));
create policy "Sales manage sequence tasks" on public.sequence_tasks
  for all to authenticated using (public.has_module('sales')) with check (public.has_module('sales'));
create policy "Sales read views" on public.sales_views
  for select to authenticated using (public.has_module('sales') and (is_shared or owner_id = (select auth.uid())));
create policy "Sales add views" on public.sales_views
  for insert to authenticated with check (public.has_module('sales'));
create policy "Sales change shared or own views" on public.sales_views
  for update to authenticated
  using (public.has_module('sales') and (is_shared or owner_id = (select auth.uid())))
  with check (public.has_module('sales'));
create policy "Sales remove shared or own views" on public.sales_views
  for delete to authenticated
  using (public.has_module('sales') and (is_shared or owner_id = (select auth.uid())));
create policy "Sales read call list callers" on public.call_list_callers
  for select to authenticated using (public.has_module('sales'));
create policy "Admins open call lists for callers" on public.call_list_callers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Read-only role for the Supabase MCP.
grant select on
  public.partners, public.meetings, public.sequences, public.sequence_steps,
  public.sequence_enrollments, public.sequence_tasks, public.sales_views
to gtm_readonly;
