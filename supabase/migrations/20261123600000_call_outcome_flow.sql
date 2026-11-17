-- Call screen outcomes, round 5 (feedback Julius, five tasks):
--
--   813e214d  per outcome a small follow-up window; only after Save the next contact
--   c6b258e3  person versus company outcomes (the queue side is in src/lib/sales/queue.ts)
--   6e9d4854  Not interested puts the company on lost or parked, and out of mailing and LinkedIn
--   66065265  Undo for ten seconds after saving
--   1018684b  Required reasons from a list that admins manage, a lost reason on the company,
--             and the data for the rejection block on Call results
--
-- What changes in the database:
--   1. sales_choice_options gets a sixth list, reject_reason (the reasons for a
--      "no"). Built in reasons can be renamed, explained, reordered and hidden;
--      extra reasons can be added and deleted, like prio and category.
--      wrong_moment is special: it parks the company until a date.
--   2. call_rejections: one row per "not interested" with the chosen reasons,
--      the open text and the date it was parked until. Admins read it for the
--      block "Rejections per reason" on Call results.
--   3. call_undo: what a call changed, kept for a minute so sales_undo_call can
--      put everything back. Only the two functions touch it (RLS, no policies).
--   4. sales_log_call gets the extra details of the follow-up windows and
--      applies the Not interested rules. The old signature is replaced.
--   5. sales_undo_call reverses one call.
--
-- Not interested: the company goes to lost (pipeline stage lost, with the
-- reasons as lost reason, bucket no_go) or, with a date, to parked until that
-- date (pipeline stage parked, bucket parked). Both stop the sequences of the
-- company, stop its running campaign memberships and keep it out of the call
-- queue. A company that is already in the pipeline (a stage other than lost
-- or parked) is left alone: the "no" is logged on the contact only.

-- ---------------------------------------------------------------------------
-- 1. The choice list of rejection reasons
-- ---------------------------------------------------------------------------

alter table public.sales_choice_options drop constraint if exists sales_choice_options_list_key_check;
alter table public.sales_choice_options add constraint sales_choice_options_list_key_check
  check (list_key in ('prio', 'category', 'lead_status', 'contact_status', 'call_outcome', 'reject_reason'));

create or replace function public.sales_choice_builtin(p_list text, p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_list
    when 'prio' then p_value in ('1', '2', '3', '4', '5')
    when 'category' then p_value in ('development', 'data_bi', 'both')
    when 'lead_status' then p_value in ('new', 'review', 'ready', 'enrich', 'in_sequence', 'cooled_down', 'no_go', 'do_not_contact')
    when 'contact_status' then p_value in ('new', 'qualified', 'enrich', 'enriched', 'in_outreach', 'reached', 'not_reached', 'not_interested', 'do_not_contact')
    when 'call_outcome' then p_value in ('no_answer', 'call_back', 'reached_interested', 'meeting_planned', 'reached_not_interested', 'referred', 'wrong_person', 'wrong_number')
    when 'reject_reason' then p_value in ('no_vacancies', 'has_agency', 'offshore_no', 'too_small', 'too_expensive', 'no_time', 'bad_experience', 'wrong_moment')
    else false
  end;
$$;

create or replace function public.sales_choice_options_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.builtin then
      raise exception 'A built in option cannot be deleted. Hide it instead.' using errcode = '22023';
    end if;
    return old;
  end if;
  new.label := btrim(new.label);
  new.description := nullif(btrim(new.description), '');
  new.builtin := public.sales_choice_builtin(new.list_key, new.value);
  if not new.builtin then
    if new.list_key not in ('prio', 'category', 'reject_reason') then
      raise exception 'This list has fixed options: rename, explain, reorder or hide them' using errcode = '22023';
    end if;
    if new.list_key = 'prio' and (new.value !~ '^[0-9]{1,2}$' or new.value::integer not between 1 and 20) then
      raise exception 'A prio level is a number from 1 to 20' using errcode = '22023';
    end if;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Rejections
-- ---------------------------------------------------------------------------

create table if not exists public.call_rejections (
  id uuid primary key default gen_random_uuid(),
  -- The call it belongs to; gone when that call is undone.
  activity_id uuid references public.activities (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  caller_id uuid references public.callers (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  -- Values of the reject_reason list; a value that was deleted later keeps showing as its value.
  reasons text[] not null default '{}',
  -- What the caller typed in the open box.
  reason_text text check (char_length(reason_text) <= 2000),
  -- Set when the company was parked ("wrong moment" or "may call later").
  parked_until date,
  created_at timestamptz not null default now(),
  constraint call_rejections_has_reason check (cardinality(reasons) > 0 or nullif(btrim(reason_text), '') is not null)
);

comment on table public.call_rejections is 'One row per Not interested on the call screen: reasons, open text and park date (docs/calls.md, Afwijzingen).';

create index if not exists call_rejections_created_idx on public.call_rejections (created_at desc);
create index if not exists call_rejections_company_idx on public.call_rejections (company_id);
create index if not exists call_rejections_caller_idx on public.call_rejections (caller_id, created_at desc) where caller_id is not null;

alter table public.call_rejections enable row level security;

-- Written by sales_log_call only. Callers have no table access; the team reads.
drop policy if exists "Sales read call rejections" on public.call_rejections;
create policy "Sales read call rejections" on public.call_rejections
  for select to authenticated using (public.has_module('sales'));

grant select on public.call_rejections to authenticated;
grant select on public.call_rejections to gtm_readonly;

-- ---------------------------------------------------------------------------
-- 3. Undo
-- ---------------------------------------------------------------------------

create table if not exists public.call_undo (
  activity_id uuid primary key references public.activities (id) on delete cascade,
  actor uuid not null references public.profiles (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  -- The contact, the company and what the call touched, as they were before the call.
  snapshot jsonb not null,
  new_contact_id uuid,
  meeting_id uuid,
  -- The Activities rows this call wrote (the call itself and the change log rows).
  activity_ids uuid[] not null default '{}',
  -- now() of the call: contacts.last_attempt_at carries it.
  logged_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.call_undo enable row level security;

-- ---------------------------------------------------------------------------
-- 4. sales_log_call with the details of the follow-up windows
-- ---------------------------------------------------------------------------

drop function if exists public.sales_log_call(uuid, text, date, text, text, text, text, uuid);

-- One call outcome. Updates attempts and the date of the last attempt, logs
-- the outcome, and applies what the outcome means:
--   no_answer           after 3 attempts: Not reached, other contacts to Enrich
--   call_back           callback date (and time and person in the next action)
--   reached_interested  Reached, company to the pipeline (Interested), next step and owner
--   meeting_planned     Reached, company to Meeting planned, a planned meeting
--   reached_not_interested  Not interested with reasons; the company to lost, or parked
--                       when p_until is set (required for the reason wrong_moment)
--   referred            a new contact at the same company (name, title, phone, mail)
--   wrong_person        Reached, role Reserve; the right person (if known) becomes a contact
--   wrong_number        Enrich, or the right number when known
-- Callers may only call contacts they hold (sales_claim_contact) and only
-- change outcome, callback date, referred to and the note (2.10).
-- The result carries activity_id: what sales_undo_call takes.
create or replace function public.sales_log_call(
  p_contact uuid,
  p_outcome text,
  p_callback_at date default null,
  p_referred_name text default null,
  p_referred_title text default null,
  p_referred_phone text default null,
  p_note text default null,
  p_actor uuid default null,
  p_callback_time text default null,
  p_callback_with text default null,
  p_referred_email text default null,
  p_reasons text[] default null,
  p_reason_text text default null,
  p_reason_label text default null,
  p_until date default null,
  p_next_step text default null,
  p_next_step_at date default null,
  p_next_owner uuid default null,
  p_new_phone text default null
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
  v_company public.companies;
  v_attempts integer;
  v_status text;
  v_role text;
  v_new_contact uuid;
  v_meeting uuid;
  v_activity uuid;
  v_first text;
  v_last text;
  v_at timestamptz := now();
  v_today date := (now() at time zone 'Europe/Amsterdam')::date;
  v_time text := nullif(btrim(p_callback_time), '');
  v_with text := nullif(btrim(p_callback_with), '');
  v_next_action text;
  v_next_date date;
  v_reasons text[] := '{}';
  v_text text := nullif(btrim(p_reason_text), '');
  v_label text;
  v_lost text;
  v_park boolean := false;
  v_new_phone text := nullif(btrim(p_new_phone), '');
  v_email text := nullif(btrim(p_referred_email), '');
  v_snapshot jsonb;
  v_known uuid[];
  v_written uuid[];
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
  if p_outcome = 'call_back' and v_time is not null and v_time !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Pick a time to call back';
  end if;
  if p_outcome = 'referred' and coalesce(trim(p_referred_name), '') = '' then
    raise exception 'Who were you referred to?';
  end if;

  if p_outcome = 'reached_not_interested' then
    select coalesce(array_agg(distinct btrim(r)), '{}') into v_reasons
    from unnest(coalesce(p_reasons, '{}')) as r
    where btrim(r) <> '';
    if exists (select 1 from unnest(v_reasons) as r where r !~ '^[a-z0-9_]{1,40}$') then
      raise exception 'Unknown reason';
    end if;
    if cardinality(v_reasons) = 0 and v_text is null then
      raise exception 'Pick a reason or write one';
    end if;
    if 'wrong_moment' = any (v_reasons) and p_until is null then
      raise exception 'Pick a date to get back in touch';
    end if;
    if p_until is not null and p_until <= v_today then
      raise exception 'Pick a date in the future';
    end if;
    v_park := p_until is not null;
    v_label := coalesce(nullif(btrim(p_reason_label), ''), array_to_string(v_reasons, ', '));
    v_lost := left(nullif(concat_ws('. ', nullif(v_label, ''), v_text), ''), 2000);
  end if;

  if p_outcome = 'reached_interested' and p_next_owner is not null
     and not public.has_module_for(p_next_owner, 'sales') then
    raise exception 'Pick someone from the team as owner';
  end if;

  -- What the call is about to change, for sales_undo_call.
  select coalesce(array_agg(id), '{}') into v_known
  from public.activities where company_id = v_row.company_id and created_at = v_at;
  select * into v_company from public.companies where id = v_row.company_id for update;
  v_snapshot := jsonb_build_object(
    'contact', to_jsonb(v_row),
    'company', to_jsonb(v_company),
    'others', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'status', c.status))
      from public.contacts c where c.company_id = v_row.company_id and c.id <> v_row.id
    ), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(t.id) from public.sequence_tasks t
      where t.company_id = v_row.company_id and t.channel = 'call' and t.status = 'open'
    ), '[]'::jsonb),
    'enrollments', coalesce((
      select jsonb_agg(e.id) from public.sequence_enrollments e
      where e.company_id = v_row.company_id and e.status = 'active'
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'status', m.status))
      from public.campaign_members m
      where m.company_id = v_row.company_id and m.status in ('queued', 'active')
    ), '[]'::jsonb)
  );

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
      -- Parked: the person waits for the date like any call back; else closed.
      v_status := case when v_park then 'in_outreach' else 'not_interested' end;
    when 'referred' then
      v_status := 'reached';
    when 'wrong_person' then
      v_status := 'reached';
      v_role := 'reserve';
    when 'wrong_number' then
      -- The right number, when known, keeps the contact in the game.
      v_status := case when v_new_phone is not null then 'in_outreach' else 'enrich' end;
  end case;

  -- Callers change only what 2.10 allows; the rest follows from the outcome.
  perform set_config('sales.source', 'handmatig', true);
  update public.contacts
  set attempts = v_attempts,
      last_attempt_at = v_at,
      status = v_status,
      role = v_role,
      phone = case when p_outcome = 'wrong_number' and v_new_phone is not null then left(v_new_phone, 50) else phone end,
      callback_at = case
        when p_outcome = 'call_back' then p_callback_at
        when p_outcome = 'reached_not_interested' and v_park then p_until
        else null end,
      referred_to = case when p_outcome = 'referred'
        then left(trim(concat_ws(', ', trim(p_referred_name), nullif(trim(p_referred_title), ''))), 300)
        else referred_to end,
      caller_note = coalesce(nullif(trim(p_note), ''), caller_note),
      claimed_by = null,
      claimed_at = null
  where id = p_contact;

  v_next_action := case p_outcome
    when 'call_back' then concat('Call back', case when v_time is not null then ' at ' || v_time end, case when v_with is not null then ' with ' || v_with end)
    when 'reached_interested' then nullif(btrim(p_next_step), '')
    else null end;
  v_next_date := case p_outcome
    when 'call_back' then p_callback_at
    when 'reached_interested' then p_next_step_at
    else null end;

  insert into public.activities (
    company_id, contact_id, channel, type, direction, outcome, notes, source, created_by, caller_id,
    next_action, next_action_date
  ) values (
    v_row.company_id, v_row.id, 'bellen', 'contact', 'outbound', p_outcome, nullif(trim(p_note), ''),
    'handmatig', v_uid, v_caller,
    v_next_action, v_next_date
  )
  returning id into v_activity;

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

  -- A referral, or the right person after "wrong person", becomes a contact at the same company.
  if p_outcome = 'referred'
     or (p_outcome = 'wrong_person' and coalesce(trim(p_referred_name), '') <> '') then
    v_first := split_part(trim(p_referred_name), ' ', 1);
    v_last := nullif(trim(substr(trim(p_referred_name), length(v_first) + 1)), '');
    -- A mail address that another contact already has is not copied.
    if v_email is not null and exists (select 1 from public.contacts where lower(email) = lower(v_email)) then
      v_email := null;
    end if;
    insert into public.contacts (company_id, first_name, last_name, title, phone, phone_type, email, role, status, source, sources)
    values (
      v_row.company_id, v_first, v_last, nullif(trim(p_referred_title), ''), nullif(trim(p_referred_phone), ''),
      case when nullif(trim(p_referred_phone), '') is not null then 'mobiel' end,
      v_email,
      'main', case when nullif(trim(p_referred_phone), '') is null then 'enrich' else 'new' end,
      case when p_outcome = 'referred' then 'referred' else 'wrong_person' end,
      array[case when p_outcome = 'referred' then 'referred' else 'wrong_person' end]
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

  -- What to do next and who does it (Reached: interested).
  if p_outcome = 'reached_interested' and (v_next_action is not null or p_next_owner is not null) then
    update public.companies
    set next_action = coalesce(v_next_action, next_action),
        next_action_date = case when v_next_action is not null then p_next_step_at else next_action_date end,
        owner_id = coalesce(p_next_owner, owner_id)
    where id = v_row.company_id;
  end if;

  -- Not interested: the reasons, and the company goes to lost or parked, out of
  -- sequences, mailing and LinkedIn. A company in the pipeline is left alone.
  if p_outcome = 'reached_not_interested' then
    insert into public.call_rejections (activity_id, company_id, contact_id, caller_id, created_by, reasons, reason_text, parked_until)
    values (v_activity, v_row.company_id, v_row.id, v_caller, v_uid, v_reasons, v_text, case when v_park then p_until end);

    if v_company.pipeline_stage is null or v_company.pipeline_stage in ('lost', 'parked') then
      -- Sequences pause and open call steps go away; running campaign memberships stop.
      -- Claude takes the lead out of Instantly and Seleqt (docs/calls.md).
      perform public.sales_pause_company(v_row.company_id, left('Not interested: ' || coalesce(v_lost, ''), 500));
      update public.campaign_members set status = 'stopped'
      where company_id = v_row.company_id and status in ('queued', 'active');

      if v_park then
        update public.companies set pipeline_stage = 'parked', parked_until = p_until where id = v_row.company_id;
        perform public.sales_set_bucket(v_row.company_id, 'parked', p_until, v_lost, p_note => 'Not interested, parked until ' || p_until);
      else
        update public.companies set pipeline_stage = 'lost', lost_reason = coalesce(v_lost, 'Not interested')
        where id = v_row.company_id;
        perform public.sales_set_bucket(v_row.company_id, 'no_go', null, coalesce(v_lost, 'Not interested'), p_note => 'Not interested');
      end if;
    end if;
  end if;

  -- The call step of a sequence for this company is done.
  update public.sequence_tasks set status = 'done', done_at = now()
  where company_id = v_row.company_id and channel = 'call' and status = 'open' and due_date <= current_date;

  -- Every Activities row this call wrote carries the time of the call; the ones that were
  -- there before it started (another call in the same transaction) are not ours.
  select coalesce(array_agg(id), '{}') into v_written
  from public.activities
  where company_id = v_row.company_id and created_at = v_at and id <> all (v_known);
  insert into public.call_undo (activity_id, actor, contact_id, company_id, snapshot, new_contact_id, meeting_id, activity_ids, logged_at)
  values (v_activity, v_uid, v_row.id, v_row.company_id, v_snapshot, v_new_contact, v_meeting, v_written, v_at);
  -- Undo is for a minute; keep the table small.
  delete from public.call_undo where created_at < now() - interval '1 day';

  return jsonb_build_object(
    'attempts', v_attempts, 'status', v_status, 'new_contact_id', v_new_contact, 'meeting_id', v_meeting,
    'activity_id', v_activity
  );
end;
$$;

revoke execute on function public.sales_log_call(uuid, text, date, text, text, text, text, uuid, text, text, text, text[], text, text, date, text, date, uuid, text) from public, anon;
grant execute on function public.sales_log_call(uuid, text, date, text, text, text, text, uuid, text, text, text, text[], text, text, date, text, date, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Undo
-- ---------------------------------------------------------------------------

-- Puts back everything one call changed: the contact, the other contacts, the
-- company (stage, lost reason, bucket, next action, owner), sequences, campaign
-- memberships, the new contact and the planned meeting, and removes the call
-- and its log rows from Activities. Only the person who logged it, within a
-- minute, and only while nobody else logged or took the contact since. The
-- contact is held again for that person, so the call screen can show it.
-- A meeting booked in Cal.com in the meantime is not cancelled there.
create or replace function public.sales_undo_call(p_activity uuid, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.sales_actor(p_actor, 'handmatig');
  v_u public.call_undo;
  v_contact public.contacts;
  v_snap jsonb;
  v_known uuid[];
begin
  select * into v_u from public.call_undo where activity_id = p_activity for update;
  if v_u.activity_id is null or v_u.actor <> v_uid then
    raise exception 'Nothing to undo' using errcode = 'P0002';
  end if;
  if v_u.created_at < now() - interval '60 seconds' then
    raise exception 'Too late to undo';
  end if;
  select * into v_contact from public.contacts where id = v_u.contact_id for update;
  if v_contact.id is null
     or v_contact.last_attempt_at is distinct from v_u.logged_at
     or v_contact.attempts is distinct from ((v_u.snapshot -> 'contact' ->> 'attempts')::integer + 1)
     or (v_contact.claimed_by is not null and v_contact.claimed_by <> v_uid) then
    raise exception 'This contact was changed after the call';
  end if;
  v_snap := v_u.snapshot;

  -- Rows written at this very moment before the undo does anything are not the undo's.
  select coalesce(array_agg(id), '{}') into v_known
  from public.activities where company_id = v_u.company_id and created_at = now();

  perform set_config('sales.skip_log', 'on', true);

  update public.contacts c
  set status = s.status, role = s.role, attempts = s.attempts, last_attempt_at = s.last_attempt_at,
      callback_at = s.callback_at, referred_to = s.referred_to, caller_note = s.caller_note, phone = s.phone,
      last_contacted_at = s.last_contacted_at,
      claimed_by = v_uid, claimed_at = now()
  from jsonb_populate_record(null::public.contacts, v_snap -> 'contact') s
  where c.id = v_u.contact_id;

  update public.contacts c set status = o.status
  from jsonb_to_recordset(v_snap -> 'others') as o(id uuid, status text)
  where c.id = o.id and c.status is distinct from o.status;

  if v_u.new_contact_id is not null then
    delete from public.contacts where id = v_u.new_contact_id;
  end if;
  if v_u.meeting_id is not null then
    delete from public.meetings where id = v_u.meeting_id and status = 'planned' and external_id is null;
  end if;

  update public.sequence_tasks set status = 'open', done_at = null
  where id in (select jsonb_array_elements_text(v_snap -> 'tasks')::uuid);
  update public.sequence_enrollments set status = 'active', paused_at = null, pause_reason = null
  where id in (select jsonb_array_elements_text(v_snap -> 'enrollments')::uuid);
  update public.campaign_members m set status = o.status
  from jsonb_to_recordset(v_snap -> 'members') as o(id uuid, status text)
  where m.id = o.id;

  -- Company: the stage first (its triggers move the bucket), then the bucket as it was.
  update public.companies co
  set pipeline_stage = s.pipeline_stage, lost_reason = s.lost_reason, parked_until = s.parked_until
  from jsonb_populate_record(null::public.companies, v_snap -> 'company') s
  where co.id = v_u.company_id;
  update public.companies co
  set lead_status = s.lead_status, next_action = s.next_action, next_action_date = s.next_action_date,
      owner_id = s.owner_id, sequence_paused_at = s.sequence_paused_at,
      bucket = s.bucket, bucket_changed_at = s.bucket_changed_at, bucket_by = s.bucket_by,
      bucket_until = s.bucket_until, bucket_reason = s.bucket_reason, bucket_view_id = s.bucket_view_id,
      bucket_caller_id = s.bucket_caller_id, bucket_campaign_id = s.bucket_campaign_id
  from jsonb_populate_record(null::public.companies, v_snap -> 'company') s
  where co.id = v_u.company_id;

  perform set_config('sales.skip_log', '', true);

  -- The call, the rejection (cascade) and every row the call and this undo wrote on the company.
  delete from public.activities
  where id = p_activity
     or id = any (v_u.activity_ids)
     or (company_id = v_u.company_id and created_at = now() and type = 'change' and id <> all (v_known));

  return jsonb_build_object('contact_id', v_u.contact_id, 'company_id', v_u.company_id);
end;
$$;

revoke execute on function public.sales_undo_call(uuid, uuid) from public, anon;
grant execute on function public.sales_undo_call(uuid, uuid) to authenticated, service_role;
