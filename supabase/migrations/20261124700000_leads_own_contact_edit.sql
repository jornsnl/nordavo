-- Leads: "own contact" protection and editing contacts like in Excel
-- (feedback Julius, November 2026).
--
--   1  Own contact: a company we have contact with ourselves (pipeline,
--      partner, network, client). Separate from Do not contact (someone who
--      does not want contact). Never goes into a cold mail campaign
--      (Instantly, Seleqt), on a call list or in a list Claude makes. Set by
--      hand, and automatically when a company enters the pipeline.
--   2  Per contact: may we mail, call or approach on LinkedIn, and a flag
--      for "left the company", "wrong person" or "wrong number".
--
-- Run after 20261123500000_mail_bcc_logging.sql. See docs/sales.md,
-- "Own contact" and "Contacten bewerken".

-- ---------------------------------------------------------------------------
-- 1. Own contact on companies
-- ---------------------------------------------------------------------------

alter table public.companies
  add column if not exists own_contact boolean not null default false,
  add column if not exists own_contact_reason text,
  add column if not exists own_contact_since timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'companies_own_contact_reason_check') then
    alter table public.companies
      add constraint companies_own_contact_reason_check check (char_length(own_contact_reason) <= 500);
  end if;
end $$;

create index if not exists companies_own_contact_idx on public.companies (id) where own_contact;

-- Entering the pipeline makes a company an own contact (also when it is
-- inserted with a stage). Leaving it (Lost, or taken out of the pipeline)
-- switches that automatic protection off again, so a lost lead can be
-- approached again as before; protection set by hand (a reason other than
-- "In the pipeline") stays. Switching it off by hand sticks: only a new move
-- into the pipeline switches it on again.
create or replace function public.companies_own_contact_from_stage()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.pipeline_stage is distinct from old.pipeline_stage then
    if new.pipeline_stage is not null and new.pipeline_stage <> 'lost' then
      if not new.own_contact then
        new.own_contact := true;
        new.own_contact_reason := coalesce(new.own_contact_reason, 'In the pipeline');
        new.own_contact_since := coalesce(new.own_contact_since, now());
      end if;
    elsif new.own_contact and new.own_contact_reason = 'In the pipeline' then
      new.own_contact := false;
      new.own_contact_reason := null;
      new.own_contact_since := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists companies_own_contact_from_stage on public.companies;
create trigger companies_own_contact_from_stage
  before insert or update of pipeline_stage on public.companies
  for each row execute function public.companies_own_contact_from_stage();

-- Everything that is in the pipeline today.
update public.companies
set own_contact = true,
    own_contact_reason = coalesce(own_contact_reason, 'In the pipeline'),
    own_contact_since = coalesce(own_contact_since, now())
where pipeline_stage is not null and pipeline_stage <> 'lost' and not own_contact;

-- Cold outreach stops when a company becomes an own contact: waiting campaign
-- members stop, a call, find-number or campaign bucket goes back to the
-- pipeline (or Free), sequences pause. The change is in Activities.
create or replace function public.companies_own_contact_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.activities (company_id, channel, type, field, old_value, new_value, notes, source, created_by)
  values (
    new.id, 'system', 'change', 'own_contact', to_jsonb(old.own_contact), to_jsonb(new.own_contact),
    left(nullif(btrim(new.own_contact_reason), ''), 2000),
    coalesce(public.sales_current_source(), 'system'), public.sales_current_actor()
  );
  if new.own_contact then
    update public.campaign_members set status = 'stopped'
    where company_id = new.id and status = 'queued';
    if new.bucket in ('find_number', 'call', 'mail_campaign', 'linkedin_campaign') then
      perform public.sales_set_bucket(
        new.id,
        case when new.pipeline_stage is not null and new.pipeline_stage <> 'lost' then 'pipeline' else 'free' end,
        p_note => 'Own contact: out of cold outreach'
      );
    end if;
    if exists (select 1 from public.sequence_enrollments where company_id = new.id and status = 'active') then
      perform public.sales_pause_company(new.id, 'Own contact');
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists companies_own_contact_changed on public.companies;
create trigger companies_own_contact_changed
  after update of own_contact on public.companies
  for each row when (old.own_contact is distinct from new.own_contact)
  execute function public.companies_own_contact_changed();

-- Hard stop for anything that slips through (an import, Claude, a script):
-- an own contact does not enter a cold campaign or a call, find-number or
-- campaign bucket. The portal and the MCP check first and skip these leads
-- with a message; this is the safety net.
create or replace function public.campaign_members_own_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if new.status in ('queued', 'active') then
    select name into v_name from public.companies where id = new.company_id and own_contact;
    if v_name is not null then
      raise exception 'Own contact: % has contact with us and does not go into a cold campaign', v_name
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists campaign_members_own_contact on public.campaign_members;
create trigger campaign_members_own_contact
  before insert or update of status on public.campaign_members
  for each row execute function public.campaign_members_own_contact();

create or replace function public.companies_own_contact_bucket()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.own_contact and new.bucket in ('find_number', 'call', 'mail_campaign', 'linkedin_campaign') then
    raise exception 'Own contact: % has contact with us and does not go on a call list or into a cold campaign', new.name
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists companies_own_contact_bucket on public.companies;
create trigger companies_own_contact_bucket
  before update of bucket on public.companies
  for each row when (old.bucket is distinct from new.bucket)
  execute function public.companies_own_contact_bucket();

-- Switch it on or off by hand (partners, network, clients). The owner is the
-- owner of the company (owner_id). Callers cannot.
create or replace function public.sales_set_own_contact(
  p_company uuid,
  p_value boolean,
  p_reason text default null,
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
  v_row public.companies;
begin
  if public.caller_id_for(v_uid) is not null then
    raise exception 'Callers cannot change this' using errcode = '42501';
  end if;
  update public.companies c
  set own_contact = coalesce(p_value, false),
      own_contact_reason = case when coalesce(p_value, false) then coalesce(left(nullif(btrim(p_reason), ''), 500), c.own_contact_reason, 'Own contact') else null end,
      own_contact_since = case when coalesce(p_value, false) then coalesce(c.own_contact_since, now()) else null end
  where c.id = p_company
  returning * into v_row;
  if v_row.id is null then
    raise exception 'Company not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', v_row.id, 'own_contact', v_row.own_contact, 'reason', v_row.own_contact_reason, 'owner_id', v_row.owner_id);
end;
$$;

revoke execute on function public.sales_set_own_contact(uuid, boolean, text, text, uuid) from public, anon;
grant execute on function public.sales_set_own_contact(uuid, boolean, text, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Per contact: channels and flags
-- ---------------------------------------------------------------------------

alter table public.contacts
  add column if not exists no_mail boolean not null default false,
  add column if not exists no_call boolean not null default false,
  add column if not exists no_linkedin boolean not null default false,
  add column if not exists contact_flag text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contacts_contact_flag_check') then
    alter table public.contacts
      add constraint contacts_contact_flag_check check (contact_flag in ('left_company', 'wrong_person', 'wrong_number'));
  end if;
end $$;

-- Rule 4 in one place: suppression rows, an own contact, a channel that is
-- switched off and a flag. The call and mail candidate views, the queue and
-- the portal all go through here. Channels: bellen, mail, linkedin.
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
  ) or exists (
    select 1
    from public.contacts c
    join public.companies co on co.id = c.company_id
    where c.id = p_contact_id
      and (co.own_contact
           or c.contact_flag in ('left_company', 'wrong_person')
           or (c.contact_flag = 'wrong_number' and p_channel = 'bellen')
           or (c.no_mail and p_channel = 'mail')
           or (c.no_call and p_channel = 'bellen')
           or (c.no_linkedin and p_channel = 'linkedin'))
  );
$$;

-- Change a contact's channels and flag. p_fields may hold no_mail, no_call,
-- no_linkedin (booleans) and contact_flag (left_company, wrong_person,
-- wrong_number or null). Every change is logged in Activities.
create or replace function public.sales_set_contact_flags(
  p_contact uuid,
  p_fields jsonb,
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
  v_old public.contacts;
  v_new public.contacts;
  v_key text;
  v_flag text;
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' or p_fields = '{}'::jsonb then
    raise exception 'Nothing to change';
  end if;
  for v_key in select jsonb_object_keys(p_fields) loop
    if v_key not in ('no_mail', 'no_call', 'no_linkedin', 'contact_flag') then
      raise exception 'Field % cannot be changed here', v_key;
    end if;
  end loop;
  select * into v_old from public.contacts where id = p_contact;
  if v_old.id is null then
    raise exception 'Contact not found' using errcode = 'P0002';
  end if;
  if p_fields ? 'contact_flag' then
    v_flag := nullif(btrim(p_fields ->> 'contact_flag'), '');
    if v_flag is not null and v_flag not in ('left_company', 'wrong_person', 'wrong_number') then
      raise exception 'Unknown flag';
    end if;
  end if;

  update public.contacts c
  set no_mail = case when p_fields ? 'no_mail' then coalesce((p_fields ->> 'no_mail')::boolean, false) else c.no_mail end,
      no_call = case when p_fields ? 'no_call' then coalesce((p_fields ->> 'no_call')::boolean, false) else c.no_call end,
      no_linkedin = case when p_fields ? 'no_linkedin' then coalesce((p_fields ->> 'no_linkedin')::boolean, false) else c.no_linkedin end,
      contact_flag = case when p_fields ? 'contact_flag' then v_flag else c.contact_flag end
  where c.id = p_contact
  returning * into v_new;

  for v_key in select unnest(array['no_mail', 'no_call', 'no_linkedin', 'contact_flag']) loop
    if to_jsonb(v_new) -> v_key is distinct from to_jsonb(v_old) -> v_key then
      insert into public.activities (company_id, contact_id, channel, type, field, old_value, new_value, source, created_by, caller_id)
      values (v_new.company_id, v_new.id, 'system', 'change', v_key, to_jsonb(v_old) -> v_key, to_jsonb(v_new) -> v_key,
              coalesce(p_source, 'handmatig'), v_uid, public.caller_id_for(v_uid));
    end if;
  end loop;

  -- A contact that is switched off for mail leaves a queued mail campaign.
  if v_new.contact_flag in ('left_company', 'wrong_person') or v_new.no_mail then
    update public.campaign_members set status = 'stopped'
    where contact_id = v_new.id and status = 'queued';
  end if;

  return jsonb_build_object('id', v_new.id, 'no_mail', v_new.no_mail, 'no_call', v_new.no_call,
                            'no_linkedin', v_new.no_linkedin, 'contact_flag', v_new.contact_flag);
end;
$$;

revoke execute on function public.sales_set_contact_flags(uuid, jsonb, text, uuid) from public, anon;
grant execute on function public.sales_set_contact_flags(uuid, jsonb, text, uuid) to authenticated, service_role;
