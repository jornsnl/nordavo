-- Nordavo Academy, rituals and pulse per placement (spec Academy, Deel 3).
-- Builds on 20261112010000_academy_placements.sql and
-- 20261113200000_academy_placement_page.sql.
--
--   1  Rituals: course rituals are templates; every placement gets its own
--      copy (template_id), which follows the template until Nordavo
--      adjusts it for that placement (customized)
--   2  Ticking off with one click: academy_tick_ritual()
--   3  Reminders when a ritual did not happen, in the time zone of each
--      person: academy_send_ritual_reminders() (job academy-rituals)
--   4  Pulse: flag on a low or dropping score, signal to Nordavo; rounds
--      every two weeks and a reminder: academy_open_pulse_rounds()
--      (job academy-placements), with the review reminders of the timeline
--   5  The four standard rituals in the client course

-- ---------------------------------------------------------------------------
-- 1. Rituals
-- ---------------------------------------------------------------------------

alter table public.academy_rituals
  add column template_id uuid references public.academy_rituals (id) on delete set null,
  add column customized boolean not null default false;

create unique index academy_rituals_one_copy on public.academy_rituals (placement_id, template_id)
  where template_id is not null;

-- Who ticked it off (also a Nordavo manager, who has no academy_members row).
alter table public.academy_ritual_logs
  add column done_by uuid references public.profiles (id) on delete set null default auth.uid();

-- The day a period starts: the day (daily), the Monday (weekly), the first
-- of the month (monthly). Same as periodStart() in src/lib/academy/placement/rituals.ts.
create or replace function public.academy_period_date(p_cadence text, p_day date)
returns date
language sql
immutable
set search_path = ''
as $$
  select case p_cadence
    when 'daily' then p_day
    when 'weekly' then p_day - (extract(isodow from p_day)::integer - 1)
    else date_trunc('month', p_day)::date
  end;
$$;

-- A zone Postgres knows, else Europe/Amsterdam.
create or replace function public.academy_safe_zone(p_zone text)
returns text
language sql
stable
set search_path = ''
as $$
  select case when exists (select 1 from pg_catalog.pg_timezone_names where name = p_zone) then p_zone else 'Europe/Amsterdam' end;
$$;

revoke execute on function public.academy_period_date(text, date) from public, anon;
grant execute on function public.academy_period_date(text, date) to authenticated, service_role;
revoke execute on function public.academy_safe_zone(text) from public, anon;
grant execute on function public.academy_safe_zone(text) to authenticated, service_role;

-- Copies of the active templates of every course a member of the placement
-- follows. Returns the number of new copies.
create or replace function public.academy_ensure_placement_rituals(p_placement_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.academy_rituals (course_id, placement_id, template_id, title, description, cadence, weekday, audience, active, position)
  select t.course_id, p_placement_id, t.id, t.title, t.description, t.cadence, t.weekday, t.audience, true, t.position
  from public.academy_rituals t
  where t.placement_id is null and t.course_id is not null and t.active
    and exists (
      select 1 from public.academy_placement_members pm
      where pm.placement_id = p_placement_id and public.academy_has_course(t.course_id, pm.profile_id)
    )
    and not exists (select 1 from public.academy_rituals c where c.placement_id = p_placement_id and c.template_id = t.id)
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Every placement that is not over (job, and after a template is added).
create or replace function public.academy_ensure_all_placement_rituals()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  for v_id in
    select p.id from public.placements p
    where p.status <> 'ended' and exists (select 1 from public.academy_placement_members pm where pm.placement_id = p.id)
  loop
    v_count := v_count + public.academy_ensure_placement_rituals(v_id);
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.academy_ensure_placement_rituals(uuid) from public, anon, authenticated;
grant execute on function public.academy_ensure_placement_rituals(uuid) to service_role;
revoke execute on function public.academy_ensure_all_placement_rituals() from public, anon, authenticated;
grant execute on function public.academy_ensure_all_placement_rituals() to service_role;

-- A template changed: copies that were not adjusted follow. A template
-- removed: its copies stop (their history stays).
create or replace function public.academy_ritual_templates_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.academy_rituals set active = false where template_id = old.id and not customized;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    perform set_config('academy.ritual_sync', 'on', true);
    update public.academy_rituals c
    set title = new.title, description = new.description, cadence = new.cadence, weekday = new.weekday,
        audience = new.audience, active = new.active, position = new.position
    where c.template_id = new.id and not c.customized;
    perform set_config('academy.ritual_sync', 'off', true);
  end if;
  if new.active then
    perform public.academy_ensure_all_placement_rituals();
  end if;
  return new;
end;
$$;

-- A copy edited by hand is customized; setting customized back to false
-- resets it to the template.
create or replace function public.academy_ritual_copies_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.academy_rituals;
begin
  if new.template_id is null or coalesce(current_setting('academy.ritual_sync', true), '') = 'on' then
    return new;
  end if;
  if old.customized and not new.customized then
    select * into t from public.academy_rituals where id = new.template_id;
    if found then
      new.title := t.title; new.description := t.description; new.cadence := t.cadence;
      new.weekday := t.weekday; new.audience := t.audience; new.active := t.active; new.position := t.position;
    end if;
    return new;
  end if;
  if (new.title, new.description, new.cadence, new.weekday, new.audience, new.active, new.position)
    is distinct from (old.title, old.description, old.cadence, old.weekday, old.audience, old.active, old.position) then
    new.customized := true;
  end if;
  return new;
end;
$$;

-- New member: the rituals of their courses come along.
create or replace function public.academy_placement_members_rituals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.academy_ensure_placement_rituals(new.placement_id);
  return null;
end;
$$;

revoke execute on function public.academy_ritual_templates_sync() from public, anon, authenticated;
revoke execute on function public.academy_ritual_copies_guard() from public, anon, authenticated;
revoke execute on function public.academy_placement_members_rituals() from public, anon, authenticated;

create trigger academy_ritual_templates_sync after insert or update on public.academy_rituals
  for each row when (new.placement_id is null) execute function public.academy_ritual_templates_sync();
create trigger academy_ritual_templates_delete before delete on public.academy_rituals
  for each row when (old.placement_id is null) execute function public.academy_ritual_templates_sync();
create trigger academy_ritual_copies_guard before update on public.academy_rituals
  for each row when (new.placement_id is not null) execute function public.academy_ritual_copies_guard();
create trigger academy_placement_members_rituals after insert on public.academy_placement_members
  for each row execute function public.academy_placement_members_rituals();

-- A weekly ritual has a weekday, the others none.
alter table public.academy_rituals add constraint academy_rituals_weekday
  check ((cadence = 'weekly') = (weekday is not null)) not valid;

-- ---------------------------------------------------------------------------
-- 2. Ticking off
-- ---------------------------------------------------------------------------

-- Tick (or untick) a ritual for a period: the current one or the one before
-- (in the user's own time zone), never the future. Client contacts tick
-- client rituals, the developer developer rituals, both "both"; readers
-- never; Nordavo everything (and alone the Nordavo rituals).
create or replace function public.academy_tick_ritual(p_ritual_id uuid, p_period_date date, p_done boolean default true, p_note text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.academy_rituals;
  v_role text;
  v_manager boolean := public.academy_is_manager();
  v_zone text;
  v_today date;
  v_current date;
  v_previous date;
begin
  select * into r from public.academy_rituals where id = p_ritual_id and placement_id is not null;
  if not found or not r.active then
    raise exception 'Unknown ritual' using errcode = 'P0002';
  end if;
  v_role := public.academy_placement_role(r.placement_id);
  if not v_manager and (
    v_role is null or v_role = 'client_reader' or r.audience = 'nordavo'
    or (r.audience = 'client' and v_role = 'developer')
    or (r.audience = 'developer' and v_role <> 'developer')
  ) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select public.academy_safe_zone(pr.time_zone) into v_zone from public.profiles pr where pr.id = (select auth.uid());
  v_today := (now() at time zone coalesce(v_zone, 'Europe/Amsterdam'))::date;
  v_current := public.academy_period_date(r.cadence, v_today);
  v_previous := public.academy_period_date(r.cadence, case r.cadence when 'daily' then v_today - 7 when 'weekly' then v_current - 1 else v_current - 1 end);
  if p_period_date is distinct from public.academy_period_date(r.cadence, p_period_date)
    or p_period_date > v_current or p_period_date < v_previous then
    raise exception 'This period cannot be ticked off' using errcode = '22023';
  end if;

  if p_done then
    insert into public.academy_ritual_logs (ritual_id, placement_id, profile_id, period_date, note, done_by)
    values (
      r.id, r.placement_id,
      case when exists (select 1 from public.academy_members am where am.profile_id = (select auth.uid())) then (select auth.uid()) end,
      p_period_date, nullif(trim(coalesce(p_note, '')), ''), (select auth.uid())
    )
    on conflict (ritual_id, placement_id, period_date) do nothing;
  else
    delete from public.academy_ritual_logs
    where ritual_id = r.id and placement_id = r.placement_id and period_date = p_period_date
      and (v_manager or done_by = (select auth.uid()) or profile_id = (select auth.uid()));
  end if;
  return true;
end;
$$;

revoke execute on function public.academy_tick_ritual(uuid, date, boolean, text) from public, anon;
grant execute on function public.academy_tick_ritual(uuid, date, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Reminders
-- ---------------------------------------------------------------------------

-- One reminder per ritual, person and period.
create table public.academy_ritual_reminders (
  ritual_id uuid not null references public.academy_rituals (id) on delete cascade,
  placement_id uuid not null references public.placements (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  period_date date not null,
  sent_at timestamptz not null default now(),
  primary key (ritual_id, placement_id, profile_id, period_date)
);

alter table public.academy_ritual_reminders enable row level security;
create policy "Academy managers manage academy_ritual_reminders" on public.academy_ritual_reminders
  for all to authenticated using (public.academy_is_manager()) with check (public.academy_is_manager());

-- Is a ritual due for a reminder at this local moment? Then the period,
-- else null. Daily: weekdays from 16:00. Weekly: from 16:00 on its weekday,
-- or later that working week. Monthly: from the 20th, working days, 16:00.
-- Same as reminderPeriod() in src/lib/academy/placement/rituals.ts.
create or replace function public.academy_ritual_reminder_period(p_cadence text, p_weekday integer, p_local timestamp)
returns date
language sql
immutable
set search_path = ''
as $$
  select case
    when p_cadence = 'daily' then
      case when extract(isodow from p_local) between 1 and 5 and extract(hour from p_local) >= 16 then p_local::date end
    when p_cadence = 'weekly' then
      case when extract(isodow from p_local) >= coalesce(p_weekday, 1)
        and (extract(isodow from p_local) > coalesce(p_weekday, 1) or extract(hour from p_local) >= 16)
        and (extract(isodow from p_local) <= 5 or extract(isodow from p_local) = coalesce(p_weekday, 1))
      then public.academy_period_date('weekly', p_local::date) end
    else
      case when extract(day from p_local) >= 20 and extract(isodow from p_local) between 1 and 5 and extract(hour from p_local) >= 16
      then public.academy_period_date('monthly', p_local::date) end
  end;
$$;

-- The hourly job: everyone who should tick a ritual that did not happen gets
-- one notification per period, in their own time zone, not on their own
-- holidays (day off) and not during their approved leave.
create or replace function public.academy_send_ritual_reminders(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_period date;
  v_count integer := 0;
begin
  for v_row in
    select r.id as ritual_id, r.title, r.cadence, r.weekday, p.id as placement_id, p.start_date, p.end_date,
      x.profile_id, x.locale, public.academy_safe_zone(pr.time_zone) as zone
    from public.academy_rituals r
    join public.placements p on p.id = r.placement_id
    cross join lateral (
      select pm.profile_id, am.locale
      from public.academy_placement_members pm
      join public.academy_members am on am.profile_id = pm.profile_id
      where pm.placement_id = p.id and r.audience <> 'nordavo'
        and (
          (r.audience in ('client', 'both') and pm.role in ('client_admin', 'client_member'))
          or (r.audience in ('developer', 'both') and pm.role = 'developer')
        )
      union all
      select p.nordavo_contact_id, 'en'::text where r.audience = 'nordavo' and p.nordavo_contact_id is not null
    ) x
    join public.profiles pr on pr.id = x.profile_id
    where r.placement_id is not null and r.active and p.status in ('active', 'notice')
  loop
    v_period := public.academy_ritual_reminder_period(v_row.cadence, v_row.weekday, p_now at time zone v_row.zone);
    continue when v_period is null;
    continue when (p_now at time zone v_row.zone)::date < v_row.start_date;
    continue when v_row.end_date is not null and (p_now at time zone v_row.zone)::date > v_row.end_date;
    continue when exists (
      select 1 from public.academy_ritual_logs l
      where l.ritual_id = v_row.ritual_id and l.placement_id = v_row.placement_id and l.period_date = v_period
    );
    continue when exists (
      select 1 from public.academy_holidays h
      where h.day_off and h.date = (p_now at time zone v_row.zone)::date
        and h.country = case when v_row.zone = 'Asia/Kolkata' then 'IN' else 'NL' end
    );
    continue when exists (
      select 1 from public.academy_leave_requests lr
      where lr.profile_id = v_row.profile_id and lr.status = 'approved'
        and (p_now at time zone v_row.zone)::date between lr.start_date and lr.end_date
    );
    insert into public.academy_ritual_reminders (ritual_id, placement_id, profile_id, period_date)
    values (v_row.ritual_id, v_row.placement_id, v_row.profile_id, v_period)
    on conflict do nothing;
    continue when not found;
    perform public.academy_notify(
      v_row.profile_id, 'ritual_reminder',
      case when v_row.locale = 'nl' then 'Nog niet afgevinkt: ' else 'Not ticked off yet: ' end || v_row.title,
      case when v_row.locale = 'nl' then 'Vink het af op de plaatsingspagina zodra het gedaan is.'
        else 'Tick it off on the placement page once it is done.' end,
      '/academy/placements/' || v_row.placement_id,
      jsonb_build_object('ritual_id', v_row.ritual_id, 'placement_id', v_row.placement_id, 'period_date', v_period)
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.academy_ritual_reminder_period(text, integer, timestamp) from public, anon;
grant execute on function public.academy_ritual_reminder_period(text, integer, timestamp) to authenticated, service_role;
revoke execute on function public.academy_send_ritual_reminders(timestamptz) from public, anon, authenticated;
grant execute on function public.academy_send_ritual_reminders(timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Pulse
-- ---------------------------------------------------------------------------

alter table public.academy_pulse_answers
  add column flag_reason text check (flag_reason in ('low', 'drop')),
  add column previous_score integer check (previous_score between 1 and 10),
  -- Nordavo followed up on the signal.
  add column handled_at timestamptz,
  add column handled_by uuid references public.profiles (id) on delete set null,
  add column handled_note text check (char_length(handled_note) <= 2000);

-- Low: 5 or lower. Dropping: at least 2 lower than the previous answer of
-- the same person in the placement. Same as pulseFlag() in
-- src/lib/academy/placement/pulse.ts.
create or replace function public.academy_pulse_flag(p_score integer, p_previous integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_score <= 5 then 'low'
    when p_previous is not null and p_previous - p_score >= 2 then 'drop'
  end;
$$;

revoke execute on function public.academy_pulse_flag(integer, integer) from public, anon;
grant execute on function public.academy_pulse_flag(integer, integer) to authenticated, service_role;

-- An answer came in: answered_at, the flag, and a signal to Nordavo.
create or replace function public.academy_pulse_answered()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pulse public.academy_pulses;
  v_previous integer;
  v_reason text;
  v_name text;
begin
  select * into v_pulse from public.academy_pulses where id = new.pulse_id;
  select a.score into v_previous
  from public.academy_pulse_answers a
  join public.academy_pulses p on p.id = a.pulse_id
  where p.placement_id = v_pulse.placement_id and p.profile_id = v_pulse.profile_id
    and p.period_start < v_pulse.period_start
  order by p.period_start desc
  limit 1;
  v_reason := public.academy_pulse_flag(new.score, v_previous);

  update public.academy_pulse_answers
  set flagged = v_reason is not null, flag_reason = v_reason, previous_score = v_previous
  where pulse_id = new.pulse_id;
  update public.academy_pulses set answered_at = coalesce(answered_at, now()) where id = new.pulse_id;

  if v_reason is not null then
    select pr.full_name into v_name from public.profiles pr where pr.id = v_pulse.profile_id;
    perform public.academy_notify_nordavo(
      v_pulse.placement_id, 'pulse_signal',
      'Pulse ' || new.score || '/10 from ' || coalesce(v_name, 'someone')
        || case v_reason when 'drop' then ' (was ' || v_previous || ')' else '' end,
      new.friction, jsonb_build_object('pulse_id', new.pulse_id, 'score', new.score, 'reason', v_reason)
    );
  end if;
  return null;
end;
$$;

revoke execute on function public.academy_pulse_answered() from public, anon, authenticated;

create trigger academy_pulse_answered after insert on public.academy_pulse_answers
  for each row execute function public.academy_pulse_answered();

-- A pulse that is answered cannot be answered again, and only while its
-- round is open (four weeks).
create or replace function public.academy_pulse_answer_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.academy_is_manager() or (select auth.uid()) is null then
    return new;
  end if;
  if exists (select 1 from public.academy_pulses p where p.id = new.pulse_id and p.period_start < current_date - 28) then
    raise exception 'This pulse is closed' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.academy_pulse_answer_guard() from public, anon, authenticated;

create trigger academy_pulse_answer_guard before insert on public.academy_pulse_answers
  for each row execute function public.academy_pulse_answer_guard();

-- The daily job of the placements: a pulse round every two weeks from day
-- 14 for the client contacts and the developer (not readers), a reminder
-- after three days, and the review forms of the timeline when a moment is
-- due. p_today is the date in the Netherlands.
create or replace function public.academy_open_pulse_rounds(p_today date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := coalesce(p_today, (now() at time zone 'Europe/Amsterdam')::date);
  v_row record;
  v_opened integer := 0;
  v_reminded integer := 0;
  v_reviews integer := 0;
begin
  for v_row in
    with ins as (
      insert into public.academy_pulses (placement_id, profile_id, period_start, sent_at)
      select p.id, pm.profile_id, p.start_date + 14 * ((v_today - p.start_date) / 14), now()
      from public.placements p
      join public.academy_placement_members pm on pm.placement_id = p.id
      where p.status in ('active', 'notice') and v_today - p.start_date >= 14
        and (p.end_date is null or p.end_date >= v_today)
        and pm.role in ('client_admin', 'client_member', 'developer')
      on conflict (placement_id, profile_id, period_start) do nothing
      returning id, placement_id, profile_id
    )
    select ins.*, am.locale from ins join public.academy_members am on am.profile_id = ins.profile_id
  loop
    perform public.academy_notify(
      v_row.profile_id, 'pulse_open',
      case when v_row.locale = 'nl' then 'Hoe gaat het? Drie korte vragen' else 'How is it going? Three quick questions' end,
      case when v_row.locale = 'nl' then 'Je antwoord gaat alleen naar Nordavo.' else 'Your answer only goes to Nordavo.' end,
      '/academy/placements/' || v_row.placement_id || '#pulse',
      jsonb_build_object('pulse_id', v_row.id, 'placement_id', v_row.placement_id)
    );
    v_opened := v_opened + 1;
  end loop;

  for v_row in
    update public.academy_pulses pu set reminded_at = now()
    from public.academy_members am
    where am.profile_id = pu.profile_id and pu.answered_at is null and pu.reminded_at is null
      and pu.sent_at < now() - interval '3 days' and pu.period_start + 14 > v_today
    returning pu.id, pu.placement_id, pu.profile_id, am.locale
  loop
    perform public.academy_notify(
      v_row.profile_id, 'pulse_reminder',
      case when v_row.locale = 'nl' then 'Herinnering: de pulse staat nog open' else 'Reminder: the pulse is still open' end,
      null, '/academy/placements/' || v_row.placement_id || '#pulse',
      jsonb_build_object('pulse_id', v_row.id, 'placement_id', v_row.placement_id)
    );
    v_reminded := v_reminded + 1;
  end loop;

  for v_row in
    update public.academy_milestones m set notified_at = now()
    from public.placements p
    where p.id = m.placement_id and p.status in ('active', 'notice')
      and m.notified_at is null and m.completed_at is null and m.due_date is not null
      and m.due_date <= v_today and m.due_date >= v_today - 7
    returning m.id, m.placement_id, m.kind, m.title
  loop
    perform public.academy_notify_placement(
      v_row.placement_id, array['client_admin', 'client_member', 'developer'], 'review_due',
      'Tijd voor de review: ' || case v_row.kind when 'day_1' then 'dag 1' when 'week_1' then 'week 1'
        when 'day_30' then '30 dagen' when 'day_90' then 'review na 90 dagen' else v_row.title end,
      'Time for the review: ' || case v_row.kind when 'day_1' then 'day 1' when 'week_1' then 'week 1'
        when 'day_30' then '30 days' when 'day_90' then 'review after 90 days' else v_row.title end,
      'Vul het korte reviewformulier in op de plaatsingspagina.', 'Fill in the short review form on the placement page.',
      jsonb_build_object('milestone_id', v_row.id)
    );
    v_reviews := v_reviews + 1;
  end loop;

  return jsonb_build_object('opened', v_opened, 'reminded', v_reminded, 'reviews', v_reviews);
end;
$$;

revoke execute on function public.academy_open_pulse_rounds(date) from public, anon, authenticated;
grant execute on function public.academy_open_pulse_rounds(date) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Standard rituals
-- ---------------------------------------------------------------------------

-- Templates in the client course (every placement has a client contact who
-- follows it). Nordavo adjusts them in /dashboard/academy/rituals.
insert into public.academy_rituals (course_id, title, description, cadence, weekday, audience, position)
select c.id, x.title, x.description, x.cadence, x.weekday, x.audience, x.position
from public.academy_courses c
cross join (values
  ('Weekly plan', 'Monday: agree on the goals and priorities of the week.', 'weekly', 1, 'both', 1),
  ('Daily check-in', 'A short call or message in the overlap window: done, next, blockers.', 'daily', null, 'both', 2),
  ('Friday review', 'Friday: what was delivered, what did not work, what is next.', 'weekly', 5, 'both', 3),
  ('Monthly talk with Nordavo', 'Once a month a talk with Nordavo about how the collaboration goes.', 'monthly', null, 'both', 4)
) x (title, description, cadence, weekday, audience, position)
where c.slug = 'client'
  and not exists (select 1 from public.academy_rituals r where r.course_id = c.id and r.placement_id is null and r.title = x.title);
