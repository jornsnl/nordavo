-- Nordavo Academy, placements and the rhythm around them (spec Academy:
-- datamodel, Deel 2 en 3). Builds on 20261112000000_academy_foundation.sql.
--
--   1  placements: hours per week, overlap window, end of probation, Nordavo
--      contact (status already exists: active, notice, ended)
--   2  academy_placement_members (client admin, client member, reader,
--      developer) and the safe functions academy_my_placements() and
--      academy_placement_people(): clients and developers never read the
--      placements table itself, so rates and costs stay out of reach
--   3  academy_can_view_progress(): who sees whose progress and scores
--   4  Rituals and ritual logs
--   5  Pulse and pulse answers (scores only for Nordavo)
--   6  Leave requests and leave balances
--   7  Holidays (country, region, year)
--   8  Milestones and reviews
--   9  Notifications, academy_notify()
--  10  Row level security

-- ---------------------------------------------------------------------------
-- 1. Placements
-- ---------------------------------------------------------------------------

alter table public.placements
  add column hours_per_week numeric(5, 2) check (hours_per_week between 0 and 80),
  -- Overlap window, wall clock time in overlap_time_zone.
  add column overlap_start time,
  add column overlap_end time,
  add column overlap_time_zone text not null default 'Europe/Amsterdam' check (char_length(overlap_time_zone) between 1 and 64),
  add column probation_end_date date,
  add column nordavo_contact_id uuid references public.profiles (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 2. Placement members
-- ---------------------------------------------------------------------------

-- The triangle per placement: client people, the developer (Nordavo is every
-- manager). Candidates are never members.
create table public.academy_placement_members (
  placement_id uuid not null references public.placements (id) on delete cascade,
  profile_id uuid not null references public.academy_members (profile_id) on delete cascade,
  role text not null check (role in ('client_admin', 'client_member', 'client_reader', 'developer')),
  added_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (placement_id, profile_id)
);

create index on public.academy_placement_members (profile_id);

-- The role of a person in a placement (null when not a member).
create or replace function public.academy_placement_role(p_placement_id uuid, p_profile_id uuid default null)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select pm.role from public.academy_placement_members pm
  where pm.placement_id = p_placement_id
    and pm.profile_id = coalesce(p_profile_id, (select auth.uid()));
$$;

-- The signed in user is in this placement, or manages the Academy.
create or replace function public.academy_can_see_placement(p_placement_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.academy_is_manager() or public.academy_placement_role(p_placement_id) is not null;
$$;

revoke execute on function public.academy_placement_role(uuid, uuid) from public, anon;
grant execute on function public.academy_placement_role(uuid, uuid) to authenticated, service_role;
revoke execute on function public.academy_can_see_placement(uuid) from public, anon;
grant execute on function public.academy_can_see_placement(uuid) to authenticated, service_role;

-- Own placements, without money: no monthly_rate, no compensation, no costs.
-- The only way clients and developers read placement facts in the Academy.
create or replace function public.academy_my_placements()
returns table (
  id uuid,
  my_role text,
  status text,
  start_date date,
  end_date date,
  probation_end_date date,
  hours_per_week numeric,
  overlap_start time,
  overlap_end time,
  overlap_time_zone text,
  client_id uuid,
  client_name text,
  developer_name text,
  developer_title text,
  vacancy_title text,
  nordavo_contact_name text,
  nordavo_contact_email text,
  nordavo_contact_booking_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, pm.role, p.status, p.start_date, p.end_date, p.probation_end_date, p.hours_per_week,
    p.overlap_start, p.overlap_end, p.overlap_time_zone,
    p.client_id, c.name, cand.full_name, cand.current_title, v.title,
    nc.full_name, nc.email, nc.booking_url
  from public.academy_placement_members pm
  join public.placements p on p.id = pm.placement_id
  left join public.clients c on c.id = p.client_id
  left join public.candidates cand on cand.id = p.candidate_id
  left join public.vacancies v on v.id = p.vacancy_id
  left join public.profiles nc on nc.id = p.nordavo_contact_id
  where pm.profile_id = (select auth.uid())
  order by p.start_date desc;
$$;

-- The people of a placement (names, roles, mail) for its members and managers.
create or replace function public.academy_placement_people(p_placement_id uuid)
returns table (profile_id uuid, full_name text, email text, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select pr.id, pr.full_name, pr.email, pm.role
  from public.academy_placement_members pm
  join public.profiles pr on pr.id = pm.profile_id
  where pm.placement_id = p_placement_id
    and public.academy_can_see_placement(p_placement_id)
  order by pm.role, pr.full_name;
$$;

revoke execute on function public.academy_my_placements() from public, anon;
grant execute on function public.academy_my_placements() to authenticated;
revoke execute on function public.academy_placement_people(uuid) from public, anon;
grant execute on function public.academy_placement_people(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Who sees whose progress
-- ---------------------------------------------------------------------------
--
-- Progress and scores (never answers or notes) of a person are visible to:
--   the person, Academy managers,
--   client admins and readers of the same client (colleagues),
--   client admins and readers of a placement the person is the developer of.
create or replace function public.academy_can_view_progress(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile_id = (select auth.uid())
    or public.academy_is_manager()
    or (
      public.academy_member_role() in ('client_admin', 'client_reader')
      and (
        exists (
          select 1 from public.profiles me, public.profiles them
          where me.id = (select auth.uid()) and them.id = p_profile_id
            and me.role = 'client' and them.role = 'client'
            and me.client_id is not null and me.client_id = them.client_id
        )
        or exists (
          select 1
          from public.academy_placement_members dev
          join public.academy_placement_members viewer on viewer.placement_id = dev.placement_id
          where dev.profile_id = p_profile_id and dev.role = 'developer'
            and viewer.profile_id = (select auth.uid()) and viewer.role in ('client_admin', 'client_reader')
        )
      )
    );
$$;

revoke execute on function public.academy_can_view_progress(uuid) from public, anon;
grant execute on function public.academy_can_view_progress(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Rituals
-- ---------------------------------------------------------------------------

-- Week plan on Monday, daily check-in, review on Friday, monthly talk with
-- Nordavo. Set per course (template) or per placement (own or adjusted).
create table public.academy_rituals (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references public.academy_courses (id) on delete cascade,
  placement_id uuid references public.placements (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text check (char_length(description) <= 2000),
  cadence text not null check (cadence in ('daily', 'weekly', 'monthly')),
  -- ISO weekday 1 (Monday) to 7 for weekly rituals.
  weekday integer check (weekday between 1 and 7),
  -- Who ticks it off.
  audience text not null default 'both' check (audience in ('client', 'developer', 'both', 'nordavo')),
  active boolean not null default true,
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academy_rituals_owner check (course_id is not null or placement_id is not null)
);

create index on public.academy_rituals (placement_id);
create index on public.academy_rituals (course_id);

create trigger academy_rituals_set_updated_at before update on public.academy_rituals
  for each row execute function public.set_updated_at();

create table public.academy_ritual_logs (
  id uuid primary key default gen_random_uuid(),
  ritual_id uuid not null references public.academy_rituals (id) on delete cascade,
  placement_id uuid not null references public.placements (id) on delete cascade,
  profile_id uuid references public.academy_members (profile_id) on delete set null default auth.uid(),
  -- The day (daily), the Monday of the week (weekly) or the first of the month (monthly).
  period_date date not null,
  done_at timestamptz not null default now(),
  note text check (char_length(note) <= 2000),
  unique (ritual_id, placement_id, period_date)
);

create index on public.academy_ritual_logs (placement_id, period_date);

-- ---------------------------------------------------------------------------
-- 5. Pulse
-- ---------------------------------------------------------------------------

-- Every two weeks three questions to client and developer.
create table public.academy_pulses (
  id uuid primary key default gen_random_uuid(),
  placement_id uuid not null references public.placements (id) on delete cascade,
  profile_id uuid not null references public.academy_members (profile_id) on delete cascade,
  period_start date not null,
  sent_at timestamptz,
  reminded_at timestamptz,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (placement_id, profile_id, period_start)
);

create index on public.academy_pulses (profile_id, answered_at);

create table public.academy_pulse_answers (
  pulse_id uuid primary key references public.academy_pulses (id) on delete cascade,
  score integer not null check (score between 1 and 10),
  going_well text check (char_length(going_well) <= 5000),
  friction text check (char_length(friction) <= 5000),
  -- Set by the pulse job when the score is low or dropping.
  flagged boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 6. Leave
-- ---------------------------------------------------------------------------

create table public.academy_leave_requests (
  id uuid primary key default gen_random_uuid(),
  placement_id uuid not null references public.placements (id) on delete cascade,
  profile_id uuid not null references public.academy_members (profile_id) on delete cascade default auth.uid(),
  kind text not null default 'vacation' check (kind in ('vacation', 'sick', 'unpaid', 'other')),
  start_date date not null,
  end_date date not null,
  days numeric(5, 1) check (days > 0),
  note text check (char_length(note) <= 2000),
  -- requested: by the developer; client_agreed: Nordavo checked with the
  -- client; approved / rejected: final; cancelled: by the developer.
  status text not null default 'requested' check (status in ('requested', 'client_agreed', 'approved', 'rejected', 'cancelled')),
  decision_note text check (char_length(decision_note) <= 2000),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index on public.academy_leave_requests (placement_id, start_date);

create trigger academy_leave_requests_set_updated_at before update on public.academy_leave_requests
  for each row execute function public.set_updated_at();

create table public.academy_leave_balances (
  id uuid primary key default gen_random_uuid(),
  placement_id uuid not null references public.placements (id) on delete cascade,
  profile_id uuid not null references public.academy_members (profile_id) on delete cascade,
  year integer not null check (year between 2020 and 2100),
  entitled_days numeric(5, 1) not null default 0,
  carried_over_days numeric(5, 1) not null default 0,
  -- Days taken outside the portal (before Wisemonk was replaced).
  adjustment_days numeric(5, 1) not null default 0,
  updated_at timestamptz not null default now(),
  unique (placement_id, profile_id, year)
);

create trigger academy_leave_balances_set_updated_at before update on public.academy_leave_balances
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 7. Holidays
-- ---------------------------------------------------------------------------

create table public.academy_holidays (
  id uuid primary key default gen_random_uuid(),
  country text not null check (country in ('NL', 'IN')),
  -- Subdivision code, e.g. KA (Karnataka); null for the whole country.
  region text check (char_length(region) <= 10),
  year integer not null check (year between 2020 and 2100),
  date date not null,
  name_nl text not null check (char_length(name_nl) between 1 and 200),
  name_en text not null check (char_length(name_en) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (country, region, date)
);

create index on public.academy_holidays (year, country);

-- ---------------------------------------------------------------------------
-- 8. Milestones and reviews
-- ---------------------------------------------------------------------------

create table public.academy_milestones (
  id uuid primary key default gen_random_uuid(),
  placement_id uuid not null references public.placements (id) on delete cascade,
  kind text not null default 'custom' check (kind in ('day_1', 'week_1', 'day_30', 'day_90', 'custom')),
  title text not null check (char_length(title) between 1 and 200),
  due_date date,
  completed_at timestamptz,
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.academy_milestones (placement_id, due_date);

create trigger academy_milestones_set_updated_at before update on public.academy_milestones
  for each row execute function public.set_updated_at();

create table public.academy_reviews (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid references public.academy_milestones (id) on delete set null,
  placement_id uuid not null references public.placements (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null default auth.uid(),
  -- Review form answers and the written report.
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  report text check (char_length(report) <= 20000),
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.academy_reviews (placement_id);

create trigger academy_reviews_set_updated_at before update on public.academy_reviews
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 9. Notifications
-- ---------------------------------------------------------------------------

create table public.academy_notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (char_length(kind) between 1 and 60),
  title text not null check (char_length(title) between 1 and 300),
  body text check (char_length(body) <= 5000),
  -- Path inside the portal, e.g. /academy/courses/<id>.
  link text check (char_length(link) <= 1000 and (link is null or link like '/%')),
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  -- Set when the notification went out in the daily or weekly mail summary.
  digested_at timestamptz,
  created_at timestamptz not null default now()
);

create index on public.academy_notifications (profile_id, created_at desc);
create index on public.academy_notifications (profile_id) where read_at is null;

-- For other security definer functions and jobs: one notification.
create or replace function public.academy_notify(
  p_profile_id uuid,
  p_kind text,
  p_title text,
  p_body text default null,
  p_link text default null,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.academy_notifications (profile_id, kind, title, body, link, payload)
  values (p_profile_id, p_kind, p_title, p_body, p_link, coalesce(p_payload, '{}'::jsonb))
  returning id;
$$;

revoke execute on function public.academy_notify(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.academy_notify(uuid, text, text, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 10. Row level security
-- ---------------------------------------------------------------------------

alter table public.academy_placement_members enable row level security;
alter table public.academy_rituals enable row level security;
alter table public.academy_ritual_logs enable row level security;
alter table public.academy_pulses enable row level security;
alter table public.academy_pulse_answers enable row level security;
alter table public.academy_leave_requests enable row level security;
alter table public.academy_leave_balances enable row level security;
alter table public.academy_holidays enable row level security;
alter table public.academy_milestones enable row level security;
alter table public.academy_reviews enable row level security;
alter table public.academy_notifications enable row level security;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'academy_placement_members', 'academy_rituals', 'academy_ritual_logs', 'academy_pulses',
    'academy_pulse_answers', 'academy_leave_requests', 'academy_leave_balances', 'academy_holidays',
    'academy_milestones', 'academy_reviews', 'academy_notifications'
  ] loop
    execute format(
      'create policy "Academy managers manage %1$s" on public.%1$I for all to authenticated using (public.academy_is_manager()) with check (public.academy_is_manager())',
      v_table
    );
  end loop;
end $$;

-- Members of a placement see who else is in it.
create policy "Placement members read members" on public.academy_placement_members
  for select to authenticated using (public.academy_placement_role(placement_id) is not null);

-- Rituals: placement rituals for its members; course templates for people
-- with access to the course.
create policy "Members read rituals" on public.academy_rituals
  for select to authenticated using (
    (placement_id is not null and public.academy_placement_role(placement_id) is not null)
    or (placement_id is null and public.academy_course_visible(course_id))
  );

-- Both sides see each other's rituals in the placement and tick their own.
create policy "Placement members read ritual logs" on public.academy_ritual_logs
  for select to authenticated using (public.academy_placement_role(placement_id) is not null);
create policy "Placement members log rituals" on public.academy_ritual_logs
  for insert to authenticated with check (
    profile_id = (select auth.uid())
    and public.academy_placement_role(placement_id) in ('client_admin', 'client_member', 'developer')
  );
create policy "Placement members undo own ritual logs" on public.academy_ritual_logs
  for delete to authenticated using (profile_id = (select auth.uid()));

-- Pulse: the recipient sees and answers their own; scores are only for
-- Nordavo (no policy for anyone else).
create policy "Recipients read own pulses" on public.academy_pulses
  for select to authenticated using (profile_id = (select auth.uid()));
create policy "Recipients read own pulse answers" on public.academy_pulse_answers
  for select to authenticated using (
    exists (select 1 from public.academy_pulses p where p.id = pulse_id and p.profile_id = (select auth.uid()))
  );
create policy "Recipients answer own pulses" on public.academy_pulse_answers
  for insert to authenticated with check (
    flagged = false
    and exists (select 1 from public.academy_pulses p where p.id = pulse_id and p.profile_id = (select auth.uid()))
  );

-- Leave: visible to all three sides of the placement; the developer asks
-- and may cancel while it is open. Decisions go through Nordavo.
create policy "Placement members read leave" on public.academy_leave_requests
  for select to authenticated using (public.academy_placement_role(placement_id) is not null);
create policy "Developers request leave" on public.academy_leave_requests
  for insert to authenticated with check (
    profile_id = (select auth.uid())
    and status = 'requested' and decided_by is null and decided_at is null
    and public.academy_placement_role(placement_id) = 'developer'
  );
create policy "Placement members read leave balances" on public.academy_leave_balances
  for select to authenticated using (public.academy_placement_role(placement_id) is not null);

-- Holidays are public knowledge for everyone signed in.
create policy "Everyone reads holidays" on public.academy_holidays
  for select to authenticated using (true);

create policy "Placement members read milestones" on public.academy_milestones
  for select to authenticated using (public.academy_placement_role(placement_id) is not null);

-- Reviews: submitted ones for the whole placement (not the reader), drafts
-- for their author.
create policy "Placement members read reviews" on public.academy_reviews
  for select to authenticated using (
    author_id = (select auth.uid())
    or (status = 'submitted' and public.academy_placement_role(placement_id) in ('client_admin', 'client_member', 'developer'))
  );
create policy "Placement members write own reviews" on public.academy_reviews
  for insert to authenticated with check (
    author_id = (select auth.uid())
    and public.academy_placement_role(placement_id) in ('client_admin', 'client_member', 'developer')
  );
create policy "Authors update own reviews" on public.academy_reviews
  for update to authenticated
  using (author_id = (select auth.uid()) and status = 'draft')
  with check (author_id = (select auth.uid()) and public.academy_placement_role(placement_id) is not null);

-- Notifications: own only; mark as read.
create policy "Users read own notifications" on public.academy_notifications
  for select to authenticated using (profile_id = (select auth.uid()));
create policy "Users mark own notifications" on public.academy_notifications
  for update to authenticated using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

-- Users may only change read_at of their own; managers anything.
create or replace function public.academy_notifications_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.academy_is_manager() or (select auth.uid()) is null then
    return new;
  end if;
  if (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at') then
    raise exception 'Only read_at can be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.academy_notifications_guard() from public, anon, authenticated;

create trigger academy_notifications_guard before update on public.academy_notifications
  for each row execute function public.academy_notifications_guard();
