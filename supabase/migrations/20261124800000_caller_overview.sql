-- Overview for callers (feedback Julius: week/month/total, weekly goal,
-- call back moments, clickable Your calls). Apply by hand, not run yet.
--
--   * callers.weekly_call_goal: attempts per week a caller aims for, set by an admin.
--   * caller_add_call_note: a caller adds a note to a contact they called.
--   * caller_correct_call: a caller corrects the outcome of one of their own
--     calls, with a reason that goes in the log (Activities).

alter table public.callers
  add column if not exists weekly_call_goal integer not null default 100
  check (weekly_call_goal between 0 and 2000);

-- A caller adds a note to a contact they called before.
create or replace function public.caller_add_call_note(
  p_contact uuid,
  p_note text,
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.sales_actor(p_actor, 'handmatig');
  v_caller uuid := public.caller_id_for(v_uid);
  v_contact public.contacts;
  v_id uuid;
begin
  if v_caller is null then
    raise exception 'Only callers can use this' using errcode = '42501';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'Write a note first';
  end if;
  select * into v_contact from public.contacts where id = p_contact;
  if v_contact.id is null then
    raise exception 'Contact not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.activities
    where contact_id = p_contact and caller_id = v_caller and channel = 'bellen' and type = 'contact'
  ) then
    raise exception 'You have not called this contact' using errcode = '42501';
  end if;
  perform set_config('sales.source', 'handmatig', true);
  update public.contacts set caller_note = left(trim(p_note), 5000) where id = p_contact;
  insert into public.activities (company_id, contact_id, channel, type, direction, notes, source, created_by, caller_id)
  values (v_contact.company_id, p_contact, 'bellen', 'note', 'outbound', left(trim(p_note), 5000), 'handmatig', v_uid, v_caller)
  returning id into v_id;
  return v_id;
end;
$$;

-- A caller corrects the outcome of their own call. Outcomes with consequences
-- (meeting planned, referred) and call back (needs a date) are not set here:
-- the team does that. The reason is required and is logged with old and new.
create or replace function public.caller_correct_call(
  p_activity uuid,
  p_outcome text,
  p_reason text,
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.sales_actor(p_actor, 'handmatig');
  v_caller uuid := public.caller_id_for(v_uid);
  v_act public.activities;
  v_id uuid;
begin
  if v_caller is null then
    raise exception 'Only callers can use this' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Give a reason for the correction';
  end if;
  if p_outcome not in ('no_answer', 'reached_interested', 'reached_not_interested', 'wrong_person', 'wrong_number') then
    raise exception 'This outcome cannot be set here';
  end if;
  select * into v_act from public.activities where id = p_activity for update;
  if v_act.id is null or v_act.caller_id is distinct from v_caller or v_act.channel <> 'bellen' or v_act.type <> 'contact' then
    raise exception 'Call not found' using errcode = 'P0002';
  end if;
  if v_act.outcome in ('meeting_planned', 'referred') then
    raise exception 'Ask Nordavo to change this outcome';
  end if;
  if v_act.outcome = p_outcome then
    raise exception 'That is already the outcome';
  end if;

  perform set_config('sales.source', 'handmatig', true);
  update public.activities set outcome = p_outcome where id = p_activity;
  -- A call back that was corrected no longer waits for a call.
  if v_act.outcome = 'call_back' then
    update public.contacts set callback_at = null
    where id = v_act.contact_id and callback_at is not distinct from v_act.next_action_date;
  end if;
  insert into public.activities (company_id, contact_id, channel, type, direction, notes, source, created_by, caller_id)
  values (
    v_act.company_id, v_act.contact_id, 'bellen', 'note', 'outbound',
    format('Outcome corrected from %s to %s. Reason: %s', coalesce(v_act.outcome, 'none'), p_outcome, left(trim(p_reason), 1000)),
    'handmatig', v_uid, v_caller
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.caller_add_call_note(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.caller_correct_call(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.caller_add_call_note(uuid, text, uuid) to service_role;
grant execute on function public.caller_correct_call(uuid, text, text, uuid) to service_role;
