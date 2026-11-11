-- Pipeline stages that match how Nordavo sells (feedback Julius, round 3).
--
-- The pipeline gets 9 stages in this order, plus two ways off it from any
-- stage:
--
--   1 contact               Two way contact, no clear interest yet
--   2 interested
--   3 meeting_planned
--   4 meeting_held
--   5 vacancy_drafted       The vacancy is written with the client, or they sent one
--   6 agreed_paid           Agreed and starter fee paid; profiles_due_on says when
--                           the profiles go out (three weeks by default)
--   7 profiles_sent
--   8 candidate_interviews
--   9 won                   A candidate is chosen; onboarding goes on in Placements
--
--   lost                    Needs a reason (as before)
--   parked                  Needs a date to get in touch again (parked_until)
--
-- Stages 5, 7, 8 and 9 still follow from the recruitment data by themselves:
-- a vacancy for the company, presented candidates, a client interview and a
-- placement. The old stage intake_done becomes vacancy_drafted: both meant
-- that a vacancy exists.

-- ---------------------------------------------------------------------------
-- 1. Columns and the new stage list
-- ---------------------------------------------------------------------------

alter table public.companies drop constraint if exists companies_pipeline_stage_check;

alter table public.companies
  add column parked_until date,
  add column profiles_due_on date;

-- Rename the old stage without touching the time a company entered it and
-- without an entry in the change log.
alter table public.companies disable trigger companies_track_stage;
do $$
begin
  perform set_config('sales.skip_log', 'on', true);
  update public.companies set pipeline_stage = 'vacancy_drafted' where pipeline_stage = 'intake_done';
  perform set_config('sales.skip_log', '', true);
end;
$$;
alter table public.companies enable trigger companies_track_stage;

alter table public.companies
  add constraint companies_pipeline_stage_check check (pipeline_stage in (
    'contact', 'interested', 'meeting_planned', 'meeting_held', 'vacancy_drafted', 'agreed_paid',
    'profiles_sent', 'candidate_interviews', 'won', 'lost', 'parked'
  )),
  add constraint companies_parked_needs_date check (pipeline_stage is distinct from 'parked' or parked_until is not null);

create index companies_parked_until_idx on public.companies (parked_until) where pipeline_stage = 'parked';

-- ---------------------------------------------------------------------------
-- 2. Stage timestamps, lost reason, parked date and the profiles deadline
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
  if new.pipeline_stage is distinct from 'parked' then
    new.parked_until := null;
  elsif tg_op = 'INSERT' or old.parked_until is distinct from new.parked_until
        or old.pipeline_stage is distinct from 'parked' then
    -- A parked company comes back as the next action on its date, so a
    -- client that says "not now" does not get lost.
    new.next_action_date := new.parked_until;
    new.next_action := coalesce(nullif(btrim(new.next_action), ''), 'Get in touch again (parked)');
  end if;
  -- Agreed and paid: the profiles go out within three weeks unless set otherwise.
  if new.pipeline_stage = 'agreed_paid' and new.profiles_due_on is null then
    new.profiles_due_on := current_date + 21;
  end if;
  if new.pipeline_stage is null then
    new.profiles_due_on := null;
  end if;
  -- Won makes the company a client.
  if new.pipeline_stage = 'won' and (tg_op = 'INSERT' or old.pipeline_stage is distinct from 'won') then
    new.status := 'klant';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Order of the stages; lost and parked come back in on something new
-- ---------------------------------------------------------------------------

create or replace function public.sales_stage_rank(p_stage text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_stage
    when 'contact' then 1 when 'interested' then 2 when 'meeting_planned' then 3
    when 'meeting_held' then 4 when 'vacancy_drafted' then 5 when 'agreed_paid' then 6
    when 'profiles_sent' then 7 when 'candidate_interviews' then 8 when 'won' then 9
    else 0 end;
$$;

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
  if v_current is not null and v_current not in ('lost', 'parked')
     and public.sales_stage_rank(v_current) >= public.sales_stage_rank(p_stage) then
    return false;
  end if;
  update public.companies set pipeline_stage = p_stage where id = p_company;
  return true;
end;
$$;

revoke execute on function public.sales_advance_stage(uuid, text) from public, anon, authenticated;

-- Stages from the recruitment data:
--   a vacancy for the company        Vacancy drafted
--   candidates presented             Profiles sent
--   a client interview               Candidate interviews
--   a placement                      Won, and the company becomes a client
-- Agreed and starter fee paid is set by hand: the portal does not see payments.
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
    v_stage := 'vacancy_drafted';
  end if;

  if v_stage is not null then
    perform set_config('sales.source', 'system', true);
    perform public.sales_advance_stage(p_company, v_stage);
  end if;
end;
$$;

revoke execute on function public.sales_sync_recruitment_stage(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The two new fields can be edited and land in the change log
-- ---------------------------------------------------------------------------

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
      'parked_until', 'profiles_due_on',
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
      'linkedin_url', 'general_phone', 'red_flags', 'opening_line', 'source_note', 'segment',
      'icp_decision', 'icp_reason', 'icp_score', 'lead_status', 'pipeline_stage', 'lost_reason',
      'parked_until', 'profiles_due_on',
      'owner_id', 'partner_id', 'next_action', 'next_action_date', 'pinned_at', 'manual_position',
      'legal_form', 'kvk_number'
    ];
    v_company := new.id;
  else
    v_fields := array[
      'first_name', 'last_name', 'title', 'tier', 'role', 'route', 'phone', 'phone_type', 'email',
      'email_status', 'linkedin_url', 'status', 'attempts', 'callback_at', 'referred_to', 'caller_note',
      'assigned_caller_id', 'assigned_until', 'pinned_at', 'manual_position', 'company_id', 'is_primary'
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
