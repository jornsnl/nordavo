-- Recruitment planning (recruitment brief of 2026-11-08, sections 2.5, 2.14,
-- 2.16 and 2.6.4.3).
--
-- 1. Who sees what: modules per team member (sales, recruitment, clients,
--    report), has_module(), and the RLS policies of GTM and recruitment
--    tables moved from is_staff() to the module they belong to.
-- 2. Interview scheduling: a Cal.com booking link per interviewer, the
--    interviews table and interview_from_booking() for the Cal.com webhook.
--
-- The recruitment report reads existing tables (applications,
-- application_stage_events, vacancies) and needs no schema of its own.

-- ---------------------------------------------------------------------------
-- 1. Modules
-- ---------------------------------------------------------------------------
--
-- sales        GTM: leads (companies), contacts, signals, lists, campaigns,
--              activities, suppressions, list exports and the GTM job runs.
-- recruitment  vacancies, candidates, applications, placements, matches,
--              anonymous profiles, stage history, interviews.
-- clients      client companies and their contact persons.
-- report       the report page (each section still needs its own module).
--
-- Admins always have every module. Client and Work only accounts have none
-- (they never pass is_staff() either). Existing and new team members get
-- every module, so nothing changes until an admin narrows it down.

alter table public.profiles
  add column modules text[] not null default array['sales', 'recruitment', 'clients', 'report']
    check (modules <@ array['sales', 'recruitment', 'clients', 'report']);

comment on column public.profiles.modules is
  'Portal modules a member sees (sales, recruitment, clients, report). Admins see all. Changed by admins through admin_set_profile_modules().';

create or replace function public.has_module(p_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.role = 'admin' or (p.role = 'member' and p_module = any (p.modules))
     from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;

revoke execute on function public.has_module(text) from public, anon;
grant execute on function public.has_module(text) to authenticated, service_role;

-- Notes, tasks, attachments and the activity log hang off many record types
-- (entity_type). They follow the module of the record they belong to.
create or replace function public.can_access_entity(p_entity_type text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_entity_type is null then public.is_staff()
    when p_entity_type = 'company' then public.has_module('sales')
    when p_entity_type = 'client' then public.has_module('clients')
    when p_entity_type in ('vacancy', 'candidate', 'application', 'placement') then public.has_module('recruitment')
    else public.is_staff()
  end;
$$;

revoke execute on function public.can_access_entity(text) from public, anon;
grant execute on function public.can_access_entity(text) to authenticated, service_role;

-- Job runs: the GTM jobs (s1 to s10, Max) are sales; the task tool jobs are
-- for every team member; everything else (t2-match, interview reminders and
-- the other recruitment jobs) is recruitment.
create or replace function public.job_module(p_job_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_job_name ~ '^s[0-9]+-' or p_job_name like 'max-%' then 'sales'
    when p_job_name like 'work-%' or p_job_name like 'clickup-%' then null
    else 'recruitment'
  end;
$$;

create or replace function public.can_see_job(p_job_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.job_module(p_job_name) is null then public.is_staff()
    else public.has_module(public.job_module(p_job_name))
  end;
$$;

revoke execute on function public.can_see_job(text) from public, anon;
grant execute on function public.can_see_job(text) to authenticated, service_role;

-- Admins set the modules of a team member. Admin accounts always keep all.
create or replace function public.admin_set_profile_modules(p_user_id uuid, p_modules text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_modules text[];
begin
  if not public.is_admin() then
    raise exception 'Only admins can change who sees what';
  end if;
  select coalesce(array_agg(distinct m order by m), '{}') into v_modules
  from unnest(coalesce(p_modules, '{}')) m;
  if not v_modules <@ array['sales', 'recruitment', 'clients', 'report'] then
    raise exception 'Unknown module';
  end if;

  update public.profiles set modules = v_modules where id = p_user_id;
  if not found then
    raise exception 'User not found';
  end if;
end;
$$;

revoke execute on function public.admin_set_profile_modules(uuid, text[]) from public, anon;
grant execute on function public.admin_set_profile_modules(uuid, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 1b. Policies per module
-- ---------------------------------------------------------------------------

-- GTM (sales).
drop policy "Staff manage companies" on public.companies;
create policy "Sales manage companies" on public.companies
  for all to authenticated using (public.has_module('sales')) with check (public.has_module('sales'));
drop policy "Staff manage contacts" on public.contacts;
create policy "Sales manage contacts" on public.contacts
  for all to authenticated using (public.has_module('sales')) with check (public.has_module('sales'));
drop policy "Staff manage signals" on public.signals;
create policy "Sales manage signals" on public.signals
  for all to authenticated using (public.has_module('sales')) with check (public.has_module('sales'));
drop policy "Staff manage campaigns" on public.campaigns;
create policy "Sales manage campaigns" on public.campaigns
  for all to authenticated using (public.has_module('sales')) with check (public.has_module('sales'));
drop policy "Staff manage activities" on public.activities;
create policy "Sales manage activities" on public.activities
  for all to authenticated using (public.has_module('sales')) with check (public.has_module('sales'));
drop policy "Staff manage suppression" on public.suppression;
create policy "Sales manage suppression" on public.suppression
  for all to authenticated using (public.has_module('sales')) with check (public.has_module('sales'));
drop policy "Staff manage list exports" on public.list_exports;
create policy "Sales manage list exports" on public.list_exports
  for all to authenticated using (public.has_module('sales')) with check (public.has_module('sales'));
drop policy "Staff read job runs" on public.job_runs;
create policy "Team reads the job runs of its modules" on public.job_runs
  for select to authenticated using (public.can_see_job(job_name));

-- Recruitment.
drop policy "Staff manage vacancies" on public.vacancies;
create policy "Recruitment manages vacancies" on public.vacancies
  for all to authenticated using (public.has_module('recruitment')) with check (public.has_module('recruitment'));
drop policy "Staff manage candidates" on public.candidates;
create policy "Recruitment manages candidates" on public.candidates
  for all to authenticated using (public.has_module('recruitment')) with check (public.has_module('recruitment'));
drop policy "Staff manage applications" on public.applications;
create policy "Recruitment manages applications" on public.applications
  for all to authenticated using (public.has_module('recruitment')) with check (public.has_module('recruitment'));
drop policy "Staff manage placements" on public.placements;
create policy "Recruitment manages placements" on public.placements
  for all to authenticated using (public.has_module('recruitment')) with check (public.has_module('recruitment'));
drop policy "Staff manage placement checkins" on public.placement_checkins;
create policy "Recruitment manages placement checkins" on public.placement_checkins
  for all to authenticated using (public.has_module('recruitment')) with check (public.has_module('recruitment'));
drop policy "Staff manage matches" on public.matches;
create policy "Recruitment manages matches" on public.matches
  for all to authenticated using (public.has_module('recruitment')) with check (public.has_module('recruitment'));
drop policy "Staff manage anonymous profiles" on public.anonymous_profiles;
create policy "Recruitment manages anonymous profiles" on public.anonymous_profiles
  for all to authenticated using (public.has_module('recruitment')) with check (public.has_module('recruitment'));
drop policy "Staff read stage events" on public.application_stage_events;
create policy "Recruitment reads stage events" on public.application_stage_events
  for select to authenticated using (public.has_module('recruitment'));

-- Clients. A recruiter must see which client a vacancy is for, and sales
-- turns a lead into a client: both may read client companies. Creating
-- clients is for the clients module and for sales (lead conversion);
-- changing and deleting them is for the clients module. Contact persons
-- are read by recruitment too (client interviews), managed by clients.
drop policy "Staff manage clients" on public.clients;
create policy "Team reads clients" on public.clients
  for select to authenticated
  using (public.has_module('clients') or public.has_module('recruitment') or public.has_module('sales'));
create policy "Clients module and sales add clients" on public.clients
  for insert to authenticated
  with check (public.has_module('clients') or public.has_module('sales'));
create policy "Clients module changes clients" on public.clients
  for update to authenticated
  using (public.has_module('clients')) with check (public.has_module('clients'));
create policy "Clients module deletes clients" on public.clients
  for delete to authenticated using (public.has_module('clients'));

drop policy "Staff manage client contacts" on public.client_contacts;
create policy "Team reads client contacts" on public.client_contacts
  for select to authenticated
  using (public.has_module('clients') or public.has_module('recruitment'));
create policy "Clients module manages client contacts" on public.client_contacts
  for all to authenticated
  using (public.has_module('clients')) with check (public.has_module('clients'));

-- Polymorphic rows follow their record. A task without a record, or one you
-- created or are assigned to, stays visible to you.
drop policy "Staff manage tasks" on public.tasks;
create policy "Team manages tasks of its modules" on public.tasks
  for all to authenticated
  using (
    public.is_staff() and (
      public.can_access_entity(entity_type)
      or assignee_id = (select auth.uid())
      or created_by = (select auth.uid())
    )
  )
  with check (public.is_staff() and public.can_access_entity(entity_type));
drop policy "Staff manage notes" on public.notes;
create policy "Team manages notes of its modules" on public.notes
  for all to authenticated
  using (public.is_staff() and public.can_access_entity(entity_type))
  with check (public.is_staff() and public.can_access_entity(entity_type));
drop policy "Staff manage attachments" on public.attachments;
create policy "Team manages attachments of its modules" on public.attachments
  for all to authenticated
  using (public.is_staff() and public.can_access_entity(entity_type))
  with check (public.is_staff() and public.can_access_entity(entity_type));
drop policy "Staff read activity" on public.activity_log;
create policy "Team reads activity of its modules" on public.activity_log
  for select to authenticated
  using (public.is_staff() and public.can_access_entity(entity_type));

-- Files: the first folder of the path is the entity type.
drop policy "Staff manage attachment files" on storage.objects;
create policy "Staff manage attachment files"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'attachments' and public.is_staff()
    and public.can_access_entity((storage.foldername(name))[1])
  )
  with check (
    bucket_id = 'attachments' and public.is_staff()
    and public.can_access_entity((storage.foldername(name))[1])
  );

-- ---------------------------------------------------------------------------
-- 2. Interview scheduling
-- ---------------------------------------------------------------------------

-- The personal Cal.com booking link of an interviewer (Settings, Profile).
alter table public.profiles
  add column booking_url text check (
    booking_url is null or (booking_url ~ '^https://[^[:space:]]+$' and char_length(booking_url) <= 500)
  );

comment on column public.profiles.booking_url is
  'Cal.com booking link of this interviewer. The interview invitation prefills it with the candidate and the interview id.';

-- Members edit their own name, time zone and booking link (never role or modules).
revoke update on public.profiles from authenticated;
grant update (full_name, time_zone, booking_url) on public.profiles to authenticated;

create table public.interviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  interviewer_id uuid references public.profiles (id) on delete set null,
  kind text not null default 'interview' check (kind in ('interview', 'english_interview', 'client_interview')),
  -- invited: the candidate got the link, nothing booked yet.
  status text not null default 'invited' check (status in (
    'invited', 'scheduled', 'rescheduled', 'cancelled', 'done', 'no_show'
  )),
  -- The booking link as sent (with prefill), so it can be copied again.
  invite_url text check (char_length(invite_url) <= 2000),
  invite_mailed_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  cal_uid text unique,
  -- Earlier uids of the same booking (Cal.com gives a reschedule a new uid).
  previous_cal_uids text[] not null default '{}',
  cancellation_reason text check (char_length(cancellation_reason) <= 2000),
  reminder_sent_at timestamptz,
  -- Feedback by the interviewer afterwards (1 to 5).
  rating integer check (rating between 1 and 5),
  communication integer check (communication between 1 and 5),
  feedback text check (char_length(feedback) <= 5000),
  feedback_at timestamptz,
  feedback_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at >= starts_at)
);

create index on public.interviews (application_id, created_at desc);
create index on public.interviews (status, starts_at);
create index on public.interviews using gin (previous_cal_uids);
create index on public.interviews (interviewer_id, starts_at);

create trigger interviews_set_updated_at before update on public.interviews
  for each row execute function public.set_updated_at();

alter table public.interviews enable row level security;
create policy "Recruitment manages interviews" on public.interviews
  for all to authenticated
  using (public.has_module('recruitment')) with check (public.has_module('recruitment'));

comment on table public.interviews is
  'Planned interviews (2.14). Created as invited by Plan interview; Cal.com bookings fill the time through interview_from_booking().';

-- The interview_at of an application: the next planned interview, or the
-- last held one when none is planned.
create or replace function public.refresh_application_interview_at(p_application_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.applications a
  set interview_at = (
    select coalesce(
      (select min(i.starts_at) from public.interviews i
        where i.application_id = a.id and i.status in ('scheduled', 'rescheduled') and i.starts_at >= now() - interval '2 hours'),
      (select max(i.starts_at) from public.interviews i
        where i.application_id = a.id and i.status in ('scheduled', 'rescheduled', 'done'))
    )
  )
  where a.id = p_application_id;
$$;

revoke execute on function public.refresh_application_interview_at(uuid) from public, anon, authenticated;

create or replace function public.interviews_refresh_application()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_application_interview_at(old.application_id);
  else
    perform public.refresh_application_interview_at(new.application_id);
  end if;
  return null;
end;
$$;

create trigger interviews_refresh_application
  after insert or delete or update of status, starts_at on public.interviews
  for each row execute function public.interviews_refresh_application();

-- Cal.com webhook (service role only). Finds the interview of a booking by
--   1. the interview id in the booking metadata (the prefilled link),
--   2. the Cal.com uid (reschedules and cancellations),
--   3. the attendee e-mail matching a candidate with an open invitation,
-- then stores the time and status and moves the application forward to
-- interview (or client_interview) through move_applications, acting as the
-- interviewer so the stage history shows who the interview is with.
-- Returns { matched: false } when the booking is not an interview, so the
-- webhook can hand it to the sales flow.
create or replace function public.interview_from_booking(
  p_trigger text,
  p_uid text,
  p_previous_uid text default null,
  p_interview_id uuid default null,
  p_attendee_email text default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_interview public.interviews%rowtype;
  v_stage text;
  v_target text;
  v_flow text[] := array[
    'sourced', 'techstack_check', 'fill_out', 'video_review', 'technical_test',
    'interview', 'matched', 'client_interview', 'final_screening', 'placed'
  ];
  v_actor uuid;
  v_claims text;
  v_moved integer := 0;
  v_status text;
begin
  -- Callable by the service role only (see the grants below): the webhook
  -- checks the Cal.com signature before it gets here.
  if p_trigger not in ('BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED') then
    return jsonb_build_object('matched', false, 'reason', 'unsupported trigger');
  end if;

  if p_interview_id is not null then
    select * into v_interview from public.interviews where id = p_interview_id;
  end if;
  if v_interview.id is null and (p_uid is not null or p_previous_uid is not null) then
    select * into v_interview from public.interviews
    where cal_uid in (p_uid, p_previous_uid)
       or p_uid = any (previous_cal_uids)
       or p_previous_uid = any (previous_cal_uids)
    order by updated_at desc limit 1;
  end if;
  if v_interview.id is null and p_attendee_email is not null and p_trigger <> 'BOOKING_CANCELLED' then
    select i.* into v_interview
    from public.interviews i
    join public.applications a on a.id = i.application_id
    join public.candidates c on c.id = a.candidate_id
    where i.status = 'invited' and lower(c.email) = lower(trim(p_attendee_email))
    order by i.created_at desc
    limit 1;
  end if;

  if v_interview.id is null then
    return jsonb_build_object('matched', false);
  end if;

  if p_trigger = 'BOOKING_CANCELLED' then
    -- An old booking cancelled after a reschedule must not cancel the new one.
    if v_interview.cal_uid is not null and v_interview.cal_uid <> p_uid then
      return jsonb_build_object('matched', true, 'interview_id', v_interview.id, 'status', v_interview.status, 'ignored', 'old booking');
    end if;
    update public.interviews
    set status = case when status = 'done' then status else 'cancelled' end,
        cal_uid = coalesce(cal_uid, p_uid),
        cancellation_reason = left(nullif(trim(coalesce(p_reason, '')), ''), 2000)
    where id = v_interview.id
    returning status into v_status;
    return jsonb_build_object('matched', true, 'interview_id', v_interview.id, 'application_id', v_interview.application_id, 'status', v_status);
  end if;

  v_status := case
    when v_interview.status = 'done' then 'done'
    when p_trigger = 'BOOKING_RESCHEDULED'
      or (v_interview.status in ('scheduled', 'rescheduled') and v_interview.cal_uid is distinct from p_uid) then 'rescheduled'
    else 'scheduled'
  end;

  update public.interviews
  set status = v_status,
      cal_uid = coalesce(p_uid, cal_uid),
      previous_cal_uids = case
        when cal_uid is not null and p_uid is not null and cal_uid <> p_uid and not (cal_uid = any (previous_cal_uids))
          then previous_cal_uids || cal_uid
        else previous_cal_uids
      end,
      starts_at = coalesce(p_starts_at, starts_at),
      ends_at = coalesce(p_ends_at, ends_at),
      cancellation_reason = null,
      reminder_sent_at = case when starts_at is distinct from coalesce(p_starts_at, starts_at) then null else reminder_sent_at end
  where id = v_interview.id;

  -- Move forward only: never back, never out of parked or rejected.
  select stage into v_stage from public.applications where id = v_interview.application_id;
  v_target := case when v_interview.kind = 'client_interview' then 'client_interview' else 'interview' end;
  v_actor := coalesce(v_interview.interviewer_id, v_interview.created_by);

  if v_actor is not null and array_position(v_flow, v_stage) is not null
     and array_position(v_flow, v_stage) < array_position(v_flow, v_target) then
    v_claims := current_setting('request.jwt.claims', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_actor, 'role', 'authenticated')::text, true);
    begin
      v_moved := public.move_applications(array[v_interview.application_id], v_target);
    exception when others then
      -- The interviewer left the team: keep the booking, skip the move.
      v_moved := 0;
    end;
    perform set_config('request.jwt.claims', coalesce(nullif(v_claims, ''), '{}'), true);
  end if;

  return jsonb_build_object(
    'matched', true,
    'interview_id', v_interview.id,
    'application_id', v_interview.application_id,
    'status', v_status,
    'moved_to', case when v_moved > 0 then v_target end
  );
end;
$$;

revoke execute on function public.interview_from_booking(text, text, text, uuid, text, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.interview_from_booking(text, text, text, uuid, text, timestamptz, timestamptz, text) to service_role;
