-- Incoming inbox, triage and occupancy (feedback Julius, round 4):
--
--   038aa8ea  Sales: inbox "Binnengekomen" per lijst met triage naar bestemming
--   264ce8e7  Sales: bezet door campagne of bellijst, filter "vrij"
--   4f7fd90a  Sequences: lopende campagnes in Instantly en Seleqt met leads en replies
--
-- One model for where a lead is:
--
--   companies.bucket   exactly one bucket or flow per company:
--     incoming           new, waits for a destination (grouped by source_list)
--     find_number        to Max for a number (lead status Enrich)
--     call               on a call list (bucket_view_id) or with a caller (bucket_caller_id)
--     mail_campaign      in a mail campaign in Instantly (bucket_campaign_id)
--     linkedin_campaign  in a LinkedIn campaign in Seleqt (bucket_campaign_id)
--     sequence           in a portal sequence
--     pipeline           warm, in the pipeline
--     parked             parked until bucket_until
--     no_go              no go, with bucket_reason
--     free               was in a flow without result, ready for a new destination
--
--   campaigns + campaign_members   the running campaigns in Instantly and
--     Seleqt with the leads in them and who replied. Claude registers them
--     through the MCP; the Instantly sync job fills them as a fallback.
--
--   sales_occupancy (view)   per company and contact: in which campaign,
--     call list or sequence, channel, since, until, replied or not.
--
-- Rules:
--   * a lead is in at most one running campaign (queued or active); a second
--     one is refused unless forced (sales_triage with force, the MCP with
--     force), and the refusal names the campaign it is in;
--   * a campaign or sequence that ends without a reply makes the lead free
--     again (bucket free);
--   * a reply on the channel of a running campaign marks the member replied;
--   * entering the pipeline moves the bucket to pipeline, parking to parked,
--     lost to free. Every bucket change is a 'change' row in Activities.

-- ---------------------------------------------------------------------------
-- 1. Columns on companies
-- ---------------------------------------------------------------------------

alter table public.companies
  add column if not exists source_list text check (char_length(source_list) <= 200),
  add column if not exists bucket text not null default 'incoming',
  add column if not exists bucket_changed_at timestamptz not null default now(),
  add column if not exists bucket_by uuid references public.profiles (id) on delete set null,
  add column if not exists bucket_until date,
  add column if not exists bucket_reason text check (char_length(bucket_reason) <= 2000),
  add column if not exists bucket_view_id uuid references public.sales_views (id) on delete set null,
  add column if not exists bucket_caller_id uuid references public.callers (id) on delete set null,
  add column if not exists bucket_campaign_id uuid references public.campaigns (id) on delete set null,
  -- Per company a short reason for the prio (3f93bd66).
  add column if not exists prio_reason text check (char_length(prio_reason) <= 500);

alter table public.companies drop constraint if exists companies_bucket_check;
alter table public.companies add constraint companies_bucket_check check (bucket in (
  'incoming', 'find_number', 'call', 'mail_campaign', 'linkedin_campaign', 'sequence',
  'pipeline', 'parked', 'no_go', 'free'
));
alter table public.companies drop constraint if exists companies_bucket_parked_needs_date;
alter table public.companies add constraint companies_bucket_parked_needs_date
  check (bucket <> 'parked' or bucket_until is not null);
alter table public.companies drop constraint if exists companies_bucket_no_go_needs_reason;
alter table public.companies add constraint companies_bucket_no_go_needs_reason
  check (bucket <> 'no_go' or bucket_reason is not null);

create index if not exists companies_bucket_idx on public.companies (bucket, source_list);

comment on column public.companies.bucket is 'Where the lead is now: exactly one bucket or flow (docs/sales.md, Binnengekomen en triage).';
comment on column public.companies.source_list is 'The list the lead came in with, such as "Scrape week 46" or "Partner X". Incoming is grouped by it.';

-- The list a new lead came in with: the partner, else the source and the week.
create or replace function public.sales_default_source_list(p_source text, p_partner uuid, p_at timestamptz)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select 'Partner ' || p.name from public.partners p where p.id = p_partner),
    initcap(replace(coalesce(nullif(btrim(p_source), ''), 'manual'), '_', ' '))
      || ' week ' || to_char(coalesce(p_at, now()) at time zone 'Europe/Amsterdam', 'IW')
  );
$$;

revoke execute on function public.sales_default_source_list(text, uuid, timestamptz) from public, anon;
grant execute on function public.sales_default_source_list(text, uuid, timestamptz) to authenticated, service_role;

create or replace function public.companies_default_source_list()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source_list is null or btrim(new.source_list) = '' then
    new.source_list := public.sales_default_source_list(new.source, new.partner_id, coalesce(new.created_at, now()));
  end if;
  return new;
end;
$$;

revoke execute on function public.companies_default_source_list() from public, anon, authenticated;

drop trigger if exists companies_default_source_list on public.companies;
create trigger companies_default_source_list before insert on public.companies
  for each row execute function public.companies_default_source_list();

-- ---------------------------------------------------------------------------
-- 2. Campaigns in Instantly and Seleqt, with their members
-- ---------------------------------------------------------------------------

alter table public.campaigns
  add column if not exists provider text not null default 'portal',
  add column if not exists status text not null default 'active',
  add column if not exists description text check (char_length(description) <= 2000),
  add column if not exists ended_at timestamptz,
  add column if not exists synced_at timestamptz,
  add column if not exists created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.campaigns drop constraint if exists campaigns_provider_check;
alter table public.campaigns add constraint campaigns_provider_check
  check (provider in ('instantly', 'seleqt', 'portal', 'other'));
alter table public.campaigns drop constraint if exists campaigns_status_check;
alter table public.campaigns add constraint campaigns_status_check
  check (status in ('draft', 'active', 'paused', 'finished'));

drop trigger if exists campaigns_set_updated_at on public.campaigns;
create trigger campaigns_set_updated_at before update on public.campaigns
  for each row execute function public.set_updated_at();

create table if not exists public.campaign_members (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  -- queued: chosen in the portal, still to be added in Instantly or Seleqt;
  -- active: in the campaign there. Both count as occupied.
  status text not null default 'queued' check (status in (
    'queued', 'active', 'replied', 'finished', 'stopped', 'bounced', 'unsubscribed'
  )),
  added_at timestamptz not null default now(),
  ended_at timestamptz,
  replied_at timestamptz,
  reply_outcome text check (char_length(reply_outcome) <= 50),
  external_id text check (char_length(external_id) <= 300),
  source text not null default 'handmatig' check (source in ('handmatig', 'claude', 'instantly', 'seleqt', 'import', 'system')),
  added_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create unique index if not exists campaign_members_contact_key
  on public.campaign_members (campaign_id, contact_id) where contact_id is not null;
create unique index if not exists campaign_members_company_key
  on public.campaign_members (campaign_id, company_id) where contact_id is null;
create index if not exists campaign_members_company_idx on public.campaign_members (company_id, status);
create index if not exists campaign_members_campaign_idx on public.campaign_members (campaign_id, status);

drop trigger if exists campaign_members_set_updated_at on public.campaign_members;
create trigger campaign_members_set_updated_at before update on public.campaign_members
  for each row execute function public.set_updated_at();

alter table public.campaign_members enable row level security;
drop policy if exists "Sales manage campaign members" on public.campaign_members;
create policy "Sales manage campaign members" on public.campaign_members
  for all to authenticated using (public.has_module('sales')) with check (public.has_module('sales'));

-- Campaigns were staff only; they are sales data now.
drop policy if exists "Staff manage campaigns" on public.campaigns;
drop policy if exists "Sales manage campaigns" on public.campaigns;
create policy "Sales manage campaigns" on public.campaigns
  for all to authenticated using (public.has_module('sales')) with check (public.has_module('sales'));

grant select on public.campaign_members to gtm_readonly;

-- ---------------------------------------------------------------------------
-- 3. Bucket changes, always logged
-- ---------------------------------------------------------------------------

-- Moves one company to a bucket and logs the change in Activities (actor and
-- source from sales_actor() earlier in the transaction). Internal.
create or replace function public.sales_set_bucket(
  p_company uuid,
  p_bucket text,
  p_until date default null,
  p_reason text default null,
  p_view uuid default null,
  p_caller uuid default null,
  p_campaign uuid default null,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.companies;
begin
  select * into v_old from public.companies where id = p_company;
  if not found then
    return false;
  end if;
  if v_old.bucket = p_bucket
     and v_old.bucket_until is not distinct from p_until
     and v_old.bucket_reason is not distinct from nullif(btrim(p_reason), '')
     and v_old.bucket_view_id is not distinct from p_view
     and v_old.bucket_caller_id is not distinct from p_caller
     and v_old.bucket_campaign_id is not distinct from p_campaign then
    return false;
  end if;

  update public.companies
  set bucket = p_bucket,
      bucket_changed_at = now(),
      bucket_by = public.sales_current_actor(),
      bucket_until = p_until,
      bucket_reason = nullif(btrim(p_reason), ''),
      bucket_view_id = p_view,
      bucket_caller_id = p_caller,
      bucket_campaign_id = p_campaign
  where id = p_company;

  insert into public.activities (
    company_id, channel, type, field, old_value, new_value, notes, source, created_by, caller_id
  ) values (
    p_company, 'system', 'change', 'bucket', to_jsonb(v_old.bucket), to_jsonb(p_bucket),
    left(nullif(btrim(p_note), ''), 2000),
    public.sales_current_source(), public.sales_current_actor(),
    public.caller_id_for(public.sales_current_actor())
  );
  return true;
end;
$$;

revoke execute on function public.sales_set_bucket(uuid, text, date, text, uuid, uuid, uuid, text) from public, anon, authenticated;

-- The running campaign (queued or active) a company is in, other than p_except.
create or replace function public.sales_running_campaign(p_company uuid, p_except uuid default null)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select c.name
  from public.campaign_members m
  join public.campaigns c on c.id = m.campaign_id
  where m.company_id = p_company
    and m.status in ('queued', 'active')
    and (p_except is null or m.campaign_id <> p_except)
  order by m.added_at desc
  limit 1;
$$;

revoke execute on function public.sales_running_campaign(uuid, uuid) from public, anon;
grant execute on function public.sales_running_campaign(uuid, uuid) to authenticated, service_role;

-- One running campaign per lead. sales.allow_double = on (set by a forced
-- triage) lets a second one through on purpose.
create or replace function public.campaign_members_one_running()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_other text;
begin
  if new.status not in ('queued', 'active') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status in ('queued', 'active') then
    return new;
  end if;
  if coalesce(current_setting('sales.allow_double', true), '') = 'on' then
    return new;
  end if;
  v_other := public.sales_running_campaign(new.company_id, new.campaign_id);
  if v_other is not null then
    raise exception 'This lead is already in the campaign "%"', v_other using errcode = '23P01';
  end if;
  return new;
end;
$$;

revoke execute on function public.campaign_members_one_running() from public, anon, authenticated;

drop trigger if exists campaign_members_one_running on public.campaign_members;
create trigger campaign_members_one_running before insert or update of status on public.campaign_members
  for each row execute function public.campaign_members_one_running();

-- A member that ends: timestamps, and the lead free again when nothing else
-- runs and nobody replied.
create or replace function public.campaign_members_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company public.companies;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  if new.status in ('finished', 'stopped', 'bounced', 'unsubscribed') and new.replied_at is null then
    select * into v_company from public.companies where id = new.company_id;
    if v_company.bucket in ('mail_campaign', 'linkedin_campaign')
       and (v_company.bucket_campaign_id is null or v_company.bucket_campaign_id = new.campaign_id)
       and public.sales_running_campaign(new.company_id) is null then
      perform public.sales_set_bucket(new.company_id, 'free', p_note => 'Campaign ended without a reply');
      -- Approached without result (the change log names it).
      update public.companies set lead_status = 'cooled_down'
      where id = new.company_id and lead_status = 'in_sequence'
        and not exists (select 1 from public.sequence_enrollments e where e.company_id = new.company_id and e.status in ('active', 'paused'));
    end if;
  end if;
  return null;
end;
$$;

revoke execute on function public.campaign_members_after_change() from public, anon, authenticated;

create or replace function public.campaign_members_track()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('finished', 'stopped', 'bounced', 'unsubscribed') and new.ended_at is null then
    new.ended_at := now();
  end if;
  if new.status = 'replied' and new.replied_at is null then
    new.replied_at := now();
  end if;
  if new.status in ('queued', 'active') then
    new.ended_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists campaign_members_track on public.campaign_members;
create trigger campaign_members_track before insert or update on public.campaign_members
  for each row execute function public.campaign_members_track();

drop trigger if exists campaign_members_after_change on public.campaign_members;
create trigger campaign_members_after_change after insert or update of status on public.campaign_members
  for each row execute function public.campaign_members_after_change();

-- A campaign that finishes ends its running members.
create or replace function public.campaigns_after_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'finished' and old.status is distinct from 'finished' then
    update public.campaigns set ended_at = coalesce(ended_at, now()) where id = new.id and ended_at is null;
    update public.campaign_members set status = 'finished'
    where campaign_id = new.id and status in ('queued', 'active');
  end if;
  return null;
end;
$$;

revoke execute on function public.campaigns_after_status() from public, anon, authenticated;

drop trigger if exists campaigns_after_status on public.campaigns;
create trigger campaigns_after_status after update of status on public.campaigns
  for each row execute function public.campaigns_after_status();

-- A reply marks the running membership on that channel replied.
create or replace function public.activities_mark_campaign_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.company_id is null then
    return null;
  end if;
  if not (new.type = 'reply' or new.outcome in ('reply_positief', 'reply_neutraal', 'reply_negatief')) then
    return null;
  end if;
  update public.campaign_members m
  set status = 'replied', replied_at = coalesce(m.replied_at, new.date), reply_outcome = coalesce(new.outcome, m.reply_outcome)
  from public.campaigns c
  where c.id = m.campaign_id
    and m.company_id = new.company_id
    and m.status in ('queued', 'active')
    and (new.campaign_id is null or m.campaign_id = new.campaign_id)
    and (new.contact_id is null or m.contact_id is null or m.contact_id = new.contact_id)
    and (c.channel = new.channel or new.campaign_id is not null);
  return null;
end;
$$;

revoke execute on function public.activities_mark_campaign_reply() from public, anon, authenticated;

drop trigger if exists activities_mark_campaign_reply on public.activities;
create trigger activities_mark_campaign_reply after insert on public.activities
  for each row execute function public.activities_mark_campaign_reply();

-- Pipeline, parking and lost follow into the bucket.
create or replace function public.companies_bucket_from_stage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.pipeline_stage is not distinct from old.pipeline_stage then
    return null;
  end if;
  if new.pipeline_stage = 'parked' then
    perform public.sales_set_bucket(new.id, 'parked', new.parked_until, p_note => 'Parked in the pipeline');
  elsif new.pipeline_stage = 'lost' then
    perform public.sales_set_bucket(new.id, 'free', p_note => coalesce('Lost: ' || new.lost_reason, 'Lost'));
  elsif new.pipeline_stage is not null then
    if new.bucket <> 'pipeline' then
      perform public.sales_set_bucket(new.id, 'pipeline', p_note => 'In the pipeline');
    end if;
  end if;
  return null;
end;
$$;

revoke execute on function public.companies_bucket_from_stage() from public, anon, authenticated;

drop trigger if exists companies_bucket_from_stage on public.companies;
create trigger companies_bucket_from_stage after update of pipeline_stage on public.companies
  for each row execute function public.companies_bucket_from_stage();

-- Sequences: starting one puts the lead in the sequence flow, ending without
-- a reply makes it free.
create or replace function public.sequence_enrollments_bucket()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bucket text;
begin
  select bucket into v_bucket from public.companies where id = new.company_id;
  if tg_op = 'INSERT' then
    if new.status in ('active', 'paused') and v_bucket not in ('pipeline', 'no_go') then
      perform public.sales_set_bucket(new.company_id, 'sequence', p_note => 'Sequence started');
    end if;
  elsif new.status is distinct from old.status and new.status in ('finished', 'stopped')
        and v_bucket = 'sequence'
        and not exists (
          select 1 from public.sequence_enrollments e
          where e.company_id = new.company_id and e.id <> new.id and e.status in ('active', 'paused')
        )
        and not exists (
          select 1 from public.activities a
          where a.company_id = new.company_id and a.date >= new.started_at
            and (a.type = 'reply' or a.outcome in ('reply_positief', 'reply_neutraal', 'reply_negatief'))
        ) then
    perform public.sales_set_bucket(new.company_id, 'free', p_note => 'Sequence ended without a reply');
  end if;
  return null;
end;
$$;

revoke execute on function public.sequence_enrollments_bucket() from public, anon, authenticated;

drop trigger if exists sequence_enrollments_bucket on public.sequence_enrollments;
create trigger sequence_enrollments_bucket after insert or update of status on public.sequence_enrollments
  for each row execute function public.sequence_enrollments_bucket();

-- ---------------------------------------------------------------------------
-- 4. Triage: one call for one or many leads
-- ---------------------------------------------------------------------------

-- p_options: { "view_id", "caller_id", "campaign_id", "until", "reason", "force", "note" }
-- Returns { "moved": n, "skipped": [{ "id", "name", "reason" }] }.
create or replace function public.sales_triage(
  p_companies uuid[],
  p_destination text,
  p_options jsonb default '{}',
  p_source text default 'handmatig',
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.sales_actor(p_actor, p_source);
  v_opt jsonb := coalesce(p_options, '{}');
  v_force boolean := coalesce((v_opt ->> 'force')::boolean, false);
  v_view uuid := nullif(v_opt ->> 'view_id', '')::uuid;
  v_caller uuid := nullif(v_opt ->> 'caller_id', '')::uuid;
  v_campaign uuid := nullif(v_opt ->> 'campaign_id', '')::uuid;
  v_until date := nullif(v_opt ->> 'until', '')::date;
  v_reason text := nullif(btrim(v_opt ->> 'reason'), '');
  v_note text := nullif(btrim(v_opt ->> 'note'), '');
  v_channel text;
  v_campaign_name text;
  v_company public.companies;
  v_other text;
  v_contact uuid;
  v_contacts uuid[];
  v_moved integer := 0;
  v_skipped jsonb := '[]';
begin
  if public.caller_id_for(v_uid) is not null then
    raise exception 'Callers cannot triage leads' using errcode = '42501';
  end if;
  if p_destination not in ('incoming', 'find_number', 'call', 'mail_campaign', 'linkedin_campaign', 'parked', 'no_go', 'free') then
    raise exception 'Unknown destination';
  end if;
  if p_companies is null or cardinality(p_companies) = 0 then
    return jsonb_build_object('moved', 0, 'skipped', v_skipped);
  end if;
  if cardinality(p_companies) > 2000 then
    raise exception 'Triage at most 2000 leads at once';
  end if;

  if p_destination = 'call' then
    if v_view is null and v_caller is null then
      raise exception 'Pick a call list or a caller';
    end if;
    if v_view is not null and not exists (select 1 from public.sales_views where id = v_view and is_call_list) then
      raise exception 'That call list does not exist';
    end if;
    if v_caller is not null and not exists (select 1 from public.callers where id = v_caller and status = 'active') then
      raise exception 'That caller is not active';
    end if;
  elsif p_destination in ('mail_campaign', 'linkedin_campaign') then
    select channel, name into v_channel, v_campaign_name from public.campaigns where id = v_campaign;
    if v_channel is null then
      raise exception 'Pick a campaign';
    end if;
    if v_channel <> (case p_destination when 'mail_campaign' then 'mail' else 'linkedin' end) then
      raise exception 'That campaign is on another channel';
    end if;
  elsif p_destination = 'parked' then
    if v_until is null or v_until < current_date then
      raise exception 'Parked needs a date in the future';
    end if;
  elsif p_destination = 'no_go' then
    if v_reason is null then
      raise exception 'No go needs a reason';
    end if;
  end if;

  if v_force then
    perform set_config('sales.allow_double', 'on', true);
  end if;

  for v_company in select * from public.companies where id = any (p_companies) order by name loop
    -- Occupied leads do not go into a second campaign or call flow unless forced.
    if p_destination in ('call', 'mail_campaign', 'linkedin_campaign') and not v_force then
      v_other := public.sales_running_campaign(v_company.id, v_campaign);
      if v_other is null and exists (
        select 1 from public.sequence_enrollments e
        where e.company_id = v_company.id and e.status in ('active', 'paused')
      ) then
        v_other := 'a sequence';
      end if;
      if v_other is null and v_company.bucket = 'call' and p_destination <> 'call' then
        v_other := 'a call list';
      end if;
      if v_other is not null then
        v_skipped := v_skipped || jsonb_build_object('id', v_company.id, 'name', v_company.name, 'reason', 'Already in ' || v_other);
        continue;
      end if;
    end if;
    if v_company.lead_status = 'do_not_contact' and p_destination not in ('no_go', 'parked') then
      v_skipped := v_skipped || jsonb_build_object('id', v_company.id, 'name', v_company.name, 'reason', 'Do not contact');
      continue;
    end if;

    -- Leaving the old flow: a caller gives the contacts back, running
    -- campaign memberships stop. Exactly one bucket or flow per lead.
    if v_company.bucket = 'call' and v_company.bucket_caller_id is not null
       and (p_destination <> 'call' or v_caller is distinct from v_company.bucket_caller_id) then
      select array_agg(id) into v_contacts from public.contacts
      where company_id = v_company.id and assigned_caller_id = v_company.bucket_caller_id;
      if v_contacts is not null then
        perform public.sales_update('contact', v_contacts,
          jsonb_build_object('assigned_caller_id', null, 'assigned_until', null), p_source, p_actor);
      end if;
    end if;
    if v_company.bucket in ('mail_campaign', 'linkedin_campaign')
       and (p_destination not in ('mail_campaign', 'linkedin_campaign') or v_campaign is distinct from v_company.bucket_campaign_id) then
      update public.campaign_members set status = 'stopped'
      where company_id = v_company.id and status = 'queued'
        and (v_company.bucket_campaign_id is null or campaign_id = v_company.bucket_campaign_id);
    end if;

    if p_destination = 'find_number' then
      if v_company.lead_status not in ('do_not_contact', 'enrich') then
        perform public.sales_update('company', array[v_company.id], jsonb_build_object('lead_status', 'enrich'), p_source, p_actor);
      end if;
      perform public.sales_set_bucket(v_company.id, 'find_number', p_note => coalesce(v_note, 'To Max for a number'));
    elsif p_destination = 'call' then
      if v_caller is not null then
        select array_agg(id) into v_contacts from public.contacts
        where company_id = v_company.id
          and status not in ('not_interested', 'do_not_contact', 'not_reached')
          and (assigned_caller_id is null or assigned_caller_id = v_caller or assigned_until < current_date);
        if v_contacts is not null then
          perform public.sales_update('contact', v_contacts,
            jsonb_build_object('assigned_caller_id', v_caller, 'assigned_until', v_until), p_source, p_actor);
        end if;
      end if;
      perform public.sales_set_bucket(v_company.id, 'call', v_until, null, v_view, v_caller, null, v_note);
      if v_company.lead_status in ('new', 'review', 'enrich', 'cooled_down', 'no_go') then
        perform public.sales_update('company', array[v_company.id], jsonb_build_object('lead_status', 'ready'), p_source, p_actor);
      end if;
    elsif p_destination in ('mail_campaign', 'linkedin_campaign') then
      select id into v_contact from public.contacts
      where company_id = v_company.id and status not in ('do_not_contact', 'not_interested')
      order by is_primary desc, coalesce(tier, 9), created_at
      limit 1;
      insert into public.campaign_members (campaign_id, company_id, contact_id, status, source, added_by)
      values (v_campaign, v_company.id, v_contact, 'queued',
        case when p_source in ('handmatig', 'claude', 'instantly', 'seleqt', 'import', 'system') then p_source else 'handmatig' end,
        v_uid)
      on conflict do nothing;
      update public.campaign_members set status = 'queued'
      where campaign_id = v_campaign and company_id = v_company.id
        and status in ('stopped', 'finished') and replied_at is null;
      perform public.sales_set_bucket(v_company.id, p_destination, null, null, null, null, v_campaign,
        coalesce(v_note, 'Campaign: ' || v_campaign_name));
      if v_company.lead_status in ('new', 'review', 'ready', 'enrich', 'cooled_down', 'no_go') then
        perform public.sales_update('company', array[v_company.id], jsonb_build_object('lead_status', 'in_sequence'), p_source, p_actor);
      end if;
    elsif p_destination = 'parked' then
      perform public.sales_set_bucket(v_company.id, 'parked', v_until, v_reason, p_note => coalesce(v_note, 'Parked until ' || v_until));
      perform public.sales_update('company', array[v_company.id],
        jsonb_build_object('next_action_date', v_until, 'next_action', coalesce(v_company.next_action, 'Get in touch again (parked)')),
        p_source, p_actor);
    elsif p_destination = 'no_go' then
      perform public.sales_set_bucket(v_company.id, 'no_go', null, v_reason, p_note => 'No go: ' || v_reason);
      if v_company.lead_status <> 'do_not_contact' then
        perform public.sales_update('company', array[v_company.id], jsonb_build_object('lead_status', 'no_go'), p_source, p_actor);
      end if;
    else
      perform public.sales_set_bucket(v_company.id, p_destination, p_note => v_note);
    end if;
    v_moved := v_moved + 1;
  end loop;

  return jsonb_build_object('moved', v_moved, 'skipped', v_skipped);
end;
$$;

revoke execute on function public.sales_triage(uuid[], text, jsonb, text, uuid) from public, anon;
grant execute on function public.sales_triage(uuid[], text, jsonb, text, uuid) to authenticated, service_role;

-- Claude (MCP) and the sync register who is in a campaign and who replied.
-- p_members: [{ "company_id"?, "contact_id"?, "email"?, "status"?, "replied_at"?, "reply_outcome"?, "external_id"? }]
-- A member is found by contact id, else company id, else the mail address of a contact.
create or replace function public.sales_register_campaign_members(
  p_campaign uuid,
  p_members jsonb,
  p_force boolean default false,
  p_source text default 'claude',
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.sales_actor(p_actor, p_source);
  v_campaign public.campaigns;
  v_item jsonb;
  v_contact uuid;
  v_company uuid;
  v_status text;
  v_existing public.campaign_members;
  v_added integer := 0;
  v_updated integer := 0;
  v_unknown jsonb := '[]';
  v_refused jsonb := '[]';
  v_other text;
begin
  if public.caller_id_for(v_uid) is not null then
    raise exception 'Callers cannot change campaigns' using errcode = '42501';
  end if;
  select * into v_campaign from public.campaigns where id = p_campaign;
  if v_campaign.id is null then
    raise exception 'Campaign not found';
  end if;
  if p_members is null or jsonb_typeof(p_members) <> 'array' then
    raise exception 'Members must be a list';
  end if;
  if jsonb_array_length(p_members) > 1000 then
    raise exception 'At most 1000 members at once';
  end if;
  if p_force then
    perform set_config('sales.allow_double', 'on', true);
  end if;

  for v_item in select * from jsonb_array_elements(p_members) loop
    v_contact := nullif(v_item ->> 'contact_id', '')::uuid;
    v_company := nullif(v_item ->> 'company_id', '')::uuid;
    if v_contact is null and nullif(btrim(v_item ->> 'email'), '') is not null then
      select id, company_id into v_contact, v_company from public.contacts
      where lower(email) = lower(btrim(v_item ->> 'email'))
      order by created_at limit 1;
    end if;
    if v_contact is not null and v_company is null then
      select company_id into v_company from public.contacts where id = v_contact;
    end if;
    if v_company is null or not exists (select 1 from public.companies where id = v_company) then
      v_unknown := v_unknown || jsonb_build_array(coalesce(v_item ->> 'email', v_item ->> 'contact_id', v_item ->> 'company_id', '?'));
      continue;
    end if;
    v_status := coalesce(nullif(v_item ->> 'status', ''), case when v_item ? 'replied_at' then 'replied' else 'active' end);
    if v_status not in ('queued', 'active', 'replied', 'finished', 'stopped', 'bounced', 'unsubscribed') then
      v_status := 'active';
    end if;

    select * into v_existing from public.campaign_members
    where campaign_id = p_campaign
      and ((v_contact is not null and contact_id = v_contact) or (v_contact is null and contact_id is null and company_id = v_company))
    limit 1;

    if v_existing.id is null and v_contact is not null then
      -- A queued membership without contact for the same company is the same lead.
      select * into v_existing from public.campaign_members
      where campaign_id = p_campaign and company_id = v_company and contact_id is null
      limit 1;
    end if;

    begin
      if v_existing.id is null then
        insert into public.campaign_members (campaign_id, company_id, contact_id, status, replied_at, reply_outcome, external_id, source, added_by)
        values (
          p_campaign, v_company, v_contact, v_status,
          nullif(v_item ->> 'replied_at', '')::timestamptz,
          nullif(v_item ->> 'reply_outcome', ''),
          nullif(v_item ->> 'external_id', ''),
          case when p_source in ('handmatig', 'claude', 'instantly', 'seleqt', 'import', 'system') then p_source else 'claude' end,
          v_uid
        );
        v_added := v_added + 1;
      else
        update public.campaign_members
        set status = case when status = 'replied' and v_status in ('active', 'queued') then status else v_status end,
            contact_id = coalesce(contact_id, v_contact),
            replied_at = coalesce(nullif(v_item ->> 'replied_at', '')::timestamptz, replied_at),
            reply_outcome = coalesce(nullif(v_item ->> 'reply_outcome', ''), reply_outcome),
            external_id = coalesce(nullif(v_item ->> 'external_id', ''), external_id)
        where id = v_existing.id;
        v_updated := v_updated + 1;
      end if;
    exception when exclusion_violation then
      v_other := public.sales_running_campaign(v_company, p_campaign);
      v_refused := v_refused || jsonb_build_object('company_id', v_company, 'reason', 'Already in ' || coalesce(v_other, 'another campaign'));
      continue;
    end;
    v_existing := null;

    -- The bucket follows a running membership (unless the lead is warm or out).
    if v_status in ('queued', 'active') then
      perform public.sales_set_bucket(v_company,
        case v_campaign.channel when 'linkedin' then 'linkedin_campaign' else 'mail_campaign' end,
        null, null, null, null, p_campaign, 'Campaign: ' || v_campaign.name)
      from public.companies where id = v_company and bucket not in ('pipeline', 'no_go', 'parked');
    end if;
  end loop;

  update public.campaigns set synced_at = now() where id = p_campaign;
  return jsonb_build_object('added', v_added, 'updated', v_updated, 'unknown', v_unknown, 'refused', v_refused);
end;
$$;

revoke execute on function public.sales_register_campaign_members(uuid, jsonb, boolean, text, uuid) from public, anon;
grant execute on function public.sales_register_campaign_members(uuid, jsonb, boolean, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Occupancy: per company and contact, where it is and since when
-- ---------------------------------------------------------------------------

create or replace view public.sales_occupancy
with (security_invoker = true) as
select
  m.company_id,
  m.contact_id,
  'campaign'::text as kind,
  c.channel,
  c.provider,
  c.name as label,
  m.campaign_id as ref_id,
  m.added_at as since,
  coalesce(m.ended_at, c.ended_at) as until,
  m.replied_at,
  m.status,
  m.status in ('queued', 'active') as active
from public.campaign_members m
join public.campaigns c on c.id = m.campaign_id
union all
select
  e.company_id,
  e.contact_id,
  'sequence',
  'sequence',
  'portal',
  s.name,
  e.sequence_id,
  e.started_at,
  case when e.status in ('finished', 'stopped') then e.updated_at end,
  (select min(a.date) from public.activities a
   where a.company_id = e.company_id and a.date >= e.started_at
     and (a.type = 'reply' or a.outcome in ('reply_positief', 'reply_neutraal', 'reply_negatief'))),
  e.status,
  e.status in ('active', 'paused')
from public.sequence_enrollments e
join public.sequences s on s.id = e.sequence_id
union all
select
  co.id,
  null::uuid,
  case when co.bucket_caller_id is not null then 'caller' else 'call_list' end,
  'bellen',
  'portal',
  coalesce(cl.name, v.name, 'Call list'),
  coalesce(co.bucket_caller_id, co.bucket_view_id),
  co.bucket_changed_at,
  co.bucket_until,
  null::timestamptz,
  'active',
  true
from public.companies co
left join public.callers cl on cl.id = co.bucket_caller_id
left join public.sales_views v on v.id = co.bucket_view_id
where co.bucket = 'call';

grant select on public.sales_occupancy to authenticated, service_role, gtm_readonly;

-- ---------------------------------------------------------------------------
-- 6. More editable columns, next to sales_update(): prio reason. Logged in
--    Activities like the rest. (sales_update() itself stays as it is, so the
--    two can grow without overwriting each other.)
-- ---------------------------------------------------------------------------

create or replace function public.sales_update_more(
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
  v_key text;
  v_count integer := 0;
  v_row record;
  v_old jsonb;
  v_new jsonb;
begin
  if public.caller_id_for(v_uid) is not null then
    raise exception 'Callers change contacts on the call screen only' using errcode = '42501';
  end if;
  if p_entity <> 'company' then
    raise exception 'Unknown record type';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' or p_fields = '{}'::jsonb then
    return 0;
  end if;
  for v_key in select jsonb_object_keys(p_fields) loop
    if v_key not in ('prio_reason', 'followed') then
      raise exception 'Field % cannot be changed here', v_key;
    end if;
  end loop;

  for v_row in select id, prio_reason, followed_at from public.companies where id = any (p_ids) loop
    if p_fields ? 'prio_reason' then
      v_old := to_jsonb(v_row.prio_reason);
      v_new := to_jsonb(nullif(btrim(p_fields ->> 'prio_reason'), ''));
      if v_old is distinct from v_new then
        update public.companies set prio_reason = nullif(btrim(p_fields ->> 'prio_reason'), '') where id = v_row.id;
        insert into public.activities (company_id, channel, type, field, old_value, new_value, source, created_by)
        values (v_row.id, 'system', 'change', 'prio_reason', v_old, v_new, public.sales_current_source(), v_uid);
      end if;
    end if;
    if p_fields ? 'followed' then
      perform public.sales_set_follow(v_row.id, coalesce((p_fields ->> 'followed')::boolean, false));
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- sales_set_follow comes with 20261123440000_follow_vacancies.sql; this
-- placeholder keeps the function above valid on its own.
create or replace function public.sales_set_follow(p_company uuid, p_follow boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Following companies is not installed yet';
end;
$$;

revoke execute on function public.sales_set_follow(uuid, boolean) from public, anon, authenticated;

revoke execute on function public.sales_update_more(text, uuid[], jsonb, text, uuid) from public, anon;
grant execute on function public.sales_update_more(text, uuid[], jsonb, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Where every lead is now
-- ---------------------------------------------------------------------------

do $$
begin
  perform set_config('sales.skip_log', 'on', true);

  update public.companies
  set source_list = public.sales_default_source_list(source, partner_id, created_at)
  where source_list is null;

  update public.companies co
  set bucket = case
        when co.pipeline_stage = 'parked' and co.parked_until is not null then 'parked'
        when co.pipeline_stage is not null and co.pipeline_stage not in ('lost', 'parked') then 'pipeline'
        when co.lead_status in ('no_go', 'do_not_contact') then 'no_go'
        when exists (select 1 from public.sequence_enrollments e where e.company_id = co.id and e.status in ('active', 'paused')) then 'sequence'
        when exists (select 1 from public.contacts c where c.company_id = co.id and c.assigned_caller_id is not null
                     and (c.assigned_until is null or c.assigned_until >= current_date)) then 'call'
        when co.lead_status = 'enrich' then 'find_number'
        when co.lead_status in ('ready', 'cooled_down', 'in_sequence') or co.pipeline_stage = 'lost' then 'free'
        else 'incoming'
      end,
      bucket_until = case when co.pipeline_stage = 'parked' then co.parked_until end,
      bucket_reason = case
        when co.lead_status in ('no_go', 'do_not_contact')
          and not (co.pipeline_stage is not null and co.pipeline_stage not in ('lost', 'parked'))
          and not (co.pipeline_stage = 'parked' and co.parked_until is not null)
        then coalesce(nullif(btrim(co.icp_reason), ''), case co.lead_status when 'do_not_contact' then 'Do not contact' else 'No go' end)
      end,
      bucket_caller_id = (
        select c.assigned_caller_id from public.contacts c
        where c.company_id = co.id and c.assigned_caller_id is not null
          and (c.assigned_until is null or c.assigned_until >= current_date)
        limit 1
      ),
      bucket_changed_at = coalesce(co.lead_status_changed_at, co.created_at)
  where co.bucket = 'incoming' and co.bucket_by is null;

  -- The caller only belongs to the call bucket.
  update public.companies set bucket_caller_id = null where bucket <> 'call' and bucket_caller_id is not null;

  perform set_config('sales.skip_log', '', true);
end;
$$;
