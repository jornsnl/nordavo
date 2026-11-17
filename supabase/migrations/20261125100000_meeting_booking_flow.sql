-- Meeting planned only counts after the Cal.com booking (feedback Julius, tasks
-- "Meeting planned slaat op voordat er geboekt is", "Cal link voor
-- salesafspraken", "afspraak via Cal komt niet volledig in Meetings",
-- "afspraken tellen mee in Overview zonder dat ze geboekt zijn").
-- Apply by hand, not run yet. docs/calls.md, chapter "Meeting planned en Cal.com".
--
--   1. meetings.status gets awaiting_booking: the caller said "Meeting planned"
--      and the Cal.com booking is not in yet. Such a meeting writes nothing to
--      Activities, moves no pipeline and counts nowhere.
--   2. sales_start_booking: the call screen creates (or refreshes) the
--      awaiting meeting with the reason, and keeps the contact open.
--   3. The booking (webhook or claude-calcom, both through sales_save_meeting)
--      fills in the awaiting meeting: date and time, source calcom, the caller,
--      status planned. Only then the call attempt is logged and the pipeline
--      moves (meetings_after_change and sales_finish_booking).
--   4. sales_cancel_booking: the caller gives up; the contact stays open.
--   5. sales_booking_links: the Cal.com links of Settings (who the meeting is
--      with: Julius or Floris), with the Cal question names to prefill.

-- ---------------------------------------------------------------------------
-- 1. Status and who the meeting is with
-- ---------------------------------------------------------------------------

alter table public.meetings drop constraint if exists meetings_status_check;
alter table public.meetings add constraint meetings_status_check
  check (status in ('awaiting_booking', 'planned', 'held', 'approved', 'rejected', 'no_show', 'cancelled'));

alter table public.meetings
  add column if not exists with_label text check (char_length(with_label) <= 80);

comment on column public.meetings.with_label is 'Who the meeting is with (the label of the Cal.com link the caller picked).';

create index if not exists meetings_awaiting_idx on public.meetings (created_at) where status = 'awaiting_booking';

-- ---------------------------------------------------------------------------
-- 2. The Cal.com links for sales meetings (Settings)
-- ---------------------------------------------------------------------------

create table if not exists public.sales_booking_links (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(btrim(label)) between 1 and 60),
  url text not null check (url ~ '^https://' and char_length(url) <= 500),
  -- The identifiers of the Cal.com booking questions that get the company and
  -- the role (the part after ?): Cal.com fills a question from ?<identifier>=.
  company_field text not null default 'bedrijfsnaam' check (company_field ~ '^[A-Za-z0-9_-]{1,60}$'),
  role_field text not null default 'welke-rol-zoek-je' check (role_field ~ '^[A-Za-z0-9_-]{1,60}$'),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.sales_booking_links is 'Cal.com booking links for sales meetings; edited under Settings, General (docs/calls.md).';

drop trigger if exists sales_booking_links_set_updated_at on public.sales_booking_links;
create trigger sales_booking_links_set_updated_at before update on public.sales_booking_links
  for each row execute function public.set_updated_at();

alter table public.sales_booking_links enable row level security;

drop policy if exists "Sales read booking links" on public.sales_booking_links;
create policy "Sales read booking links" on public.sales_booking_links
  for select to authenticated using ((select public.has_module('sales')));
drop policy if exists "Admins write booking links" on public.sales_booking_links;
create policy "Admins write booking links" on public.sales_booking_links
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

grant select, insert, update, delete on public.sales_booking_links to authenticated;

-- The link Julius gave in the feedback; the portal used a link that does not exist.
insert into public.sales_booking_links (label, url, position)
select 'Kennismaking', 'https://cal.com/nordavo-support-jwoop2/kennismaking', 0
where not exists (select 1 from public.sales_booking_links);

-- ---------------------------------------------------------------------------
-- 3. A booking completes the call: the attempt, the pipeline, the contact
-- ---------------------------------------------------------------------------

-- What "Meeting planned" used to do the moment the button was pressed: the
-- call attempt in Activities (this is what the caller statistics count), the
-- contact to Reached, the company in sequence, the call step done. Runs once
-- per meeting, when the booking is in.
create or replace function public.sales_finish_booking(p_meeting uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.meetings;
begin
  select * into m from public.meetings where id = p_meeting;
  if m.id is null or m.contact_id is null then
    return;
  end if;
  if exists (
    select 1 from public.activities
    where meeting_id = m.id and channel = 'bellen' and outcome = 'meeting_planned'
  ) then
    return;
  end if;

  perform set_config('sales.source', 'handmatig', true);
  update public.contacts
  set attempts = attempts + 1,
      last_attempt_at = now(),
      status = 'reached',
      callback_at = null,
      caller_note = coalesce(nullif(btrim(m.reason), ''), caller_note),
      claimed_by = case when claimed_by is not distinct from m.booked_by then null else claimed_by end,
      claimed_at = case when claimed_by is not distinct from m.booked_by then null else claimed_at end
  where id = m.contact_id;

  insert into public.activities (
    company_id, contact_id, channel, type, direction, outcome, notes, source, created_by, caller_id, meeting_id
  ) values (
    m.company_id, m.contact_id, 'bellen', 'contact', 'outbound', 'meeting_planned', nullif(btrim(m.reason), ''),
    'handmatig', m.booked_by, m.caller_id, m.id
  );

  update public.companies set lead_status = 'in_sequence'
  where id = m.company_id and lead_status in ('new', 'review', 'ready', 'enrich', 'cooled_down');

  update public.sequence_tasks set status = 'done', done_at = now()
  where company_id = m.company_id and channel = 'call' and status = 'open' and due_date <= current_date;
end;
$$;

revoke execute on function public.sales_finish_booking(uuid) from public, anon, authenticated;

-- Meetings move the pipeline and land in the timeline. An awaiting meeting
-- does neither: it only counts once the booking is in (awaiting to planned).
create or replace function public.meetings_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outcome text;
  v_booked boolean := false;
begin
  if tg_op = 'INSERT' then
    if new.status = 'awaiting_booking' then
      return null;
    end if;
    v_outcome := 'meeting_planned';
  elsif new.status is distinct from old.status then
    if old.status = 'awaiting_booking' then
      -- Given up before it was booked: nothing to tell.
      if new.status = 'cancelled' then
        return null;
      end if;
      v_booked := new.status = 'planned';
    end if;
    v_outcome := case new.status
      when 'planned' then case when v_booked then 'meeting_planned' end
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
    case when tg_op = 'INSERT' or v_booked then new.reason end,
    case when tg_op = 'INSERT' then coalesce(least(new.scheduled_at, now()), now()) else now() end,
    case when public.sales_current_source() = 'handmatig' then new.source else public.sales_current_source() end,
    public.sales_current_actor(), new.caller_id, new.id
  );

  if v_booked then
    perform public.sales_finish_booking(new.id);
  end if;

  if new.status = 'approved' or new.status = 'held' then
    perform public.sales_advance_stage(new.company_id, 'meeting_held');
  end if;
  return null;
end;
$$;

revoke execute on function public.meetings_after_change() from public, anon, authenticated;

-- A meeting from the call screen, the meetings page, the Cal.com webhook or
-- Claude. A booking with a known external id is a no-op. A booking without
-- one fills in the awaiting meeting (first) or the planned meeting of the same
-- contact from the last 14 days: it gets the booking uid, the time, source
-- Cal.com and the caller, and an awaiting meeting becomes planned.
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
    where company_id = v_company and external_id is null and status in ('awaiting_booking', 'planned')
      and (p_contact is null or contact_id is null or contact_id = p_contact)
      and created_at > now() - interval '14 days'
    order by (status = 'awaiting_booking') desc, created_at desc
    limit 1;
    if v_id is not null then
      update public.meetings
      set external_id = p_external_id,
          scheduled_at = coalesce(p_scheduled_at, scheduled_at),
          contact_id = coalesce(contact_id, p_contact),
          caller_id = coalesce(caller_id, p_caller),
          reason = coalesce(reason, nullif(trim(p_reason), '')),
          source = case when p_source in ('handmatig', 'calcom', 'claude', 'system') then p_source else source end,
          status = 'planned'
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

-- ---------------------------------------------------------------------------
-- 4. Start and cancel a booking from the call screen
-- ---------------------------------------------------------------------------

-- "Meeting planned" on the call screen: the reason is asked, the awaiting
-- meeting is made (or refreshed) and the contact stays open. When the lead was
-- already booked through the agenda button in the last 3 hours, that booking
-- is completed at once (status planned in the result).
create or replace function public.sales_start_booking(
  p_contact uuid,
  p_reason text,
  p_note text default null,
  p_with text default null,
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
  v_reason text := nullif(btrim(p_reason), '');
  v_with text := nullif(btrim(p_with), '');
  v_id uuid;
begin
  if v_reason is null then
    raise exception 'Say what the meeting is about';
  end if;
  select * into v_row from public.contacts where id = p_contact for update;
  if v_row.id is null then
    raise exception 'Contact not found' using errcode = 'P0002';
  end if;
  if v_caller is not null and v_row.claimed_by is distinct from v_uid then
    raise exception 'Open this contact on the call screen first' using errcode = '42501';
  end if;
  v_reason := left(concat_ws(E'\n', v_reason, nullif(btrim(p_note), '')), 2000);

  select m.id into v_id from public.meetings m
  where m.contact_id = p_contact and m.status = 'planned' and m.external_id is not null
    and m.created_at > now() - interval '3 hours'
    and not exists (
      select 1 from public.activities a where a.meeting_id = m.id and a.channel = 'bellen' and a.outcome = 'meeting_planned'
    )
  order by m.created_at desc
  limit 1;
  if v_id is not null then
    update public.meetings
    set reason = v_reason,
        caller_id = coalesce(caller_id, v_caller),
        booked_by = coalesce(booked_by, v_uid),
        with_label = coalesce(v_with, with_label)
    where id = v_id;
    perform public.sales_finish_booking(v_id);
    return jsonb_build_object('meeting_id', v_id, 'status', 'planned');
  end if;

  select id into v_id from public.meetings
  where contact_id = p_contact and status = 'awaiting_booking' and created_at > now() - interval '14 days'
  order by created_at desc
  limit 1;
  if v_id is not null then
    update public.meetings
    set reason = v_reason, caller_id = coalesce(v_caller, caller_id), booked_by = v_uid, with_label = v_with
    where id = v_id;
  else
    insert into public.meetings (company_id, contact_id, caller_id, booked_by, reason, status, source, with_label)
    values (v_row.company_id, p_contact, v_caller, v_uid, v_reason, 'awaiting_booking', 'handmatig', v_with)
    returning id into v_id;
  end if;

  -- The caller keeps the contact while the booking is made.
  update public.contacts set claimed_at = now() where id = p_contact and claimed_by = v_uid;
  return jsonb_build_object('meeting_id', v_id, 'status', 'awaiting_booking');
end;
$$;

revoke execute on function public.sales_start_booking(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.sales_start_booking(uuid, text, text, text, uuid) to authenticated, service_role;

-- The caller gives up, or the booking did not work: the awaiting meeting goes
-- to cancelled (quietly) and the lead stays open. Returns whether it changed.
create or replace function public.sales_cancel_booking(p_meeting uuid, p_actor uuid default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.sales_actor(p_actor, 'handmatig');
  v_caller uuid := public.caller_id_for(v_uid);
  v_count integer;
begin
  update public.meetings
  set status = 'cancelled'
  where id = p_meeting and status = 'awaiting_booking'
    and (v_caller is null or caller_id = v_caller);
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke execute on function public.sales_cancel_booking(uuid, uuid) from public, anon;
grant execute on function public.sales_cancel_booking(uuid, uuid) to authenticated, service_role;
