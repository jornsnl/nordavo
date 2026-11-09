-- Nordavo Academy, candidate management and overviews (spec Academy:
-- kandidatenbeheer; beheeroverzichten en afhaakanalyse). Builds on
-- 20261113300000_academy_ats_core.sql and 20261113310000_academy_ats_read.sql.
--
--   1  academy_admin_people(): per person progress, watch %, open and overdue
--      tasks, assignments waiting for a reply, pulse (Nordavo only), inactive
--   2  academy_admin_rollup(): the same per client company or per group
--   3  academy_lesson_funnel(): per lesson who reached it, finished it and
--      stopped there (drop-off), for a course, a group or a client
--   4  academy_group_report(): started, completed, drop-off, score distribution
--   5  Reminders to candidates who get stuck: academy_reminders (log) and
--      academy_stuck_candidates() for the job academy-reminders
--   6  Retention: academy_retention_log, academy_retention_candidates() and
--      academy_retention_anonymise() for the job academy-retention

-- ---------------------------------------------------------------------------
-- 1. People overview
-- ---------------------------------------------------------------------------

-- The client company of an Academy person: own client (client users) or
-- the client of their latest placement (developers).
create or replace function public.academy_person_client(p_profile_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.client_id from public.profiles p where p.id = p_profile_id and p.role = 'client'),
    (select pl.client_id from public.academy_placement_members pm
      join public.placements pl on pl.id = pm.placement_id
      where pm.profile_id = p_profile_id
      order by (pl.status = 'ended'), pl.start_date desc limit 1)
  );
$$;

-- Per person: lessons in the published courses they have access to,
-- watch %, tasks, assignments waiting, pulse and activity. Managers only.
-- Filters: client company, group, role, course (null = any).
create or replace function public.academy_admin_people(
  p_client_id uuid default null,
  p_group_id uuid default null,
  p_role text default null,
  p_course_id uuid default null
)
returns table (
  profile_id uuid,
  full_name text,
  email text,
  academy_role text,
  client_id uuid,
  client_name text,
  candidate_id uuid,
  lessons_total integer,
  lessons_done integer,
  progress_percent integer,
  watch_avg_percent integer,
  tasks_open integer,
  tasks_overdue integer,
  assignments_waiting integer,
  pulse_last integer,
  pulse_avg numeric,
  pulse_flagged boolean,
  last_activity_at timestamptz,
  inactive_14d boolean,
  completed_courses integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with people as (
    select am.profile_id, am.academy_role, am.candidate_id, am.created_at, am.last_active_at,
      p.full_name, p.email, public.academy_person_client(am.profile_id) as client_id
    from public.academy_members am
    join public.profiles p on p.id = am.profile_id
    where public.academy_is_manager()
      and (p_role is null or am.academy_role = p_role)
      and (p_group_id is null or exists (
        select 1 from public.academy_group_members gm where gm.group_id = p_group_id and gm.profile_id = am.profile_id
      ))
  ),
  scoped as (
    select * from people where p_client_id is null or client_id = p_client_id
  ),
  access as (
    select distinct s.profile_id, c.id as course_id
    from scoped s
    join public.academy_courses c on c.status = 'published' and (p_course_id is null or c.id = p_course_id)
    where public.academy_course_scope(c.id, s.profile_id) is not null
  ),
  course_lessons as (
    select distinct m.course_id, ml.lesson_id
    from public.academy_modules m
    join public.academy_module_lessons ml on ml.module_id = m.id
    join public.academy_lessons l on l.id = ml.lesson_id and l.status = 'published'
    where m.status = 'published' and m.course_id in (select course_id from access)
  ),
  person_lessons as (
    select distinct a.profile_id, cl.lesson_id from access a join course_lessons cl on cl.course_id = a.course_id
  ),
  lessons as (
    select pl.profile_id, count(*)::integer as total,
      count(*) filter (where lp.completed_at is not null)::integer as done,
      max(greatest(lp.last_viewed_at, lp.updated_at)) as last_seen
    from person_lessons pl
    left join public.academy_lesson_progress lp on lp.profile_id = pl.profile_id and lp.lesson_id = pl.lesson_id
    group by pl.profile_id
  ),
  person_videos as (
    select distinct pl.profile_id, b.video_id
    from person_lessons pl
    join public.academy_lesson_blocks b on b.lesson_id = pl.lesson_id and b.type = 'video' and b.video_id is not null
    where not public.academy_block_is_draft(b.id)
  ),
  watch as (
    select pv.profile_id, round(avg(coalesce(w.percent, 0)))::integer as avg_percent, max(w.updated_at) as last_watch
    from person_videos pv
    left join public.academy_watch_progress w on w.profile_id = pv.profile_id and w.video_id = pv.video_id
    group by pv.profile_id
  ),
  -- Tasks that apply: in lessons the person started, required or not, not
  -- placement-only unless placed; done personally or for one of their placements.
  person_tasks as (
    select s.profile_id, t.id as task_id, t.shared,
      (select min(ts.due_at) from public.academy_task_status ts
        where ts.task_id = t.id and ts.done_at is null
          and (ts.profile_id = s.profile_id or (t.shared and ts.profile_id is null and ts.placement_id in (
            select pm.placement_id from public.academy_placement_members pm where pm.profile_id = s.profile_id)))) as due_at,
      exists (
        select 1 from public.academy_task_status ts
        where ts.task_id = t.id and ts.done_at is not null
          and (ts.profile_id = s.profile_id or (t.shared and ts.profile_id is null and ts.placement_id in (
            select pm.placement_id from public.academy_placement_members pm where pm.profile_id = s.profile_id)))
      ) as done
    from scoped s
    join public.academy_lesson_progress lp on lp.profile_id = s.profile_id
    join public.academy_lesson_blocks b on b.lesson_id = lp.lesson_id and b.type = 'tasks'
    join public.academy_tasks t on t.block_id = b.id
    where (not t.placement_only or exists (select 1 from public.academy_placement_members pm where pm.profile_id = s.profile_id))
      and s.academy_role <> 'client_reader'
      and not public.academy_block_is_draft(b.id)
  ),
  tasks as (
    select profile_id,
      count(distinct task_id) filter (where not done)::integer as open,
      count(distinct task_id) filter (where not done and due_at < now())::integer as overdue
    from person_tasks group by profile_id
  ),
  waiting as (
    select s.profile_id, count(*)::integer as n
    from (
      select distinct on (sub.profile_id, sub.block_id) sub.profile_id, sub.status, sub.feedback_at
      from public.academy_assignment_submissions sub
      where sub.profile_id in (select profile_id from scoped)
      order by sub.profile_id, sub.block_id, sub.attempt desc
    ) s
    where s.status = 'submitted' and s.feedback_at is null
    group by s.profile_id
  ),
  pulse as (
    select p.profile_id,
      (array_agg(a.score order by p.period_start desc))[1] as last_score,
      round(avg(a.score), 1) as avg_score,
      bool_or(a.flagged) as flagged
    from public.academy_pulses p join public.academy_pulse_answers a on a.pulse_id = p.id
    where p.profile_id in (select profile_id from scoped)
    group by p.profile_id
  ),
  done_courses as (
    select a.profile_id, count(*) filter (where public.academy_course_done(a.course_id, a.profile_id))::integer as n
    from access a group by a.profile_id
  )
  select s.profile_id, s.full_name, s.email, s.academy_role, s.client_id, c.name, s.candidate_id,
    coalesce(l.total, 0), coalesce(l.done, 0),
    case when coalesce(l.total, 0) > 0 then (l.done * 100) / l.total else 0 end,
    w.avg_percent,
    coalesce(t.open, 0), coalesce(t.overdue, 0), coalesce(wa.n, 0),
    pu.last_score, pu.avg_score, coalesce(pu.flagged, false),
    greatest(s.last_active_at, l.last_seen, w.last_watch),
    s.academy_role <> 'client_reader'
      and coalesce(greatest(s.last_active_at, l.last_seen, w.last_watch), s.created_at) < now() - interval '14 days'
      and coalesce(dc.n, 0) < (select count(*) from access a where a.profile_id = s.profile_id),
    coalesce(dc.n, 0)
  from scoped s
  left join public.clients c on c.id = s.client_id
  left join lessons l on l.profile_id = s.profile_id
  left join watch w on w.profile_id = s.profile_id
  left join tasks t on t.profile_id = s.profile_id
  left join waiting wa on wa.profile_id = s.profile_id
  left join pulse pu on pu.profile_id = s.profile_id
  left join done_courses dc on dc.profile_id = s.profile_id
  order by s.full_name nulls last, s.profile_id;
$$;

-- ---------------------------------------------------------------------------
-- 2. Per client company or per group
-- ---------------------------------------------------------------------------

create or replace function public.academy_admin_rollup(p_by text)
returns table (
  key_id uuid,
  name text,
  people integer,
  avg_progress integer,
  completed integer,
  inactive integer,
  tasks_open integer,
  tasks_overdue integer,
  assignments_waiting integer,
  pulse_avg numeric,
  pulse_flagged integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.academy_is_manager() then
    return;
  end if;
  if p_by = 'client' then
    return query
      select p.client_id, coalesce(max(p.client_name), 'Unknown'), count(*)::integer,
        round(avg(p.progress_percent))::integer,
        count(*) filter (where p.lessons_total > 0 and p.lessons_done >= p.lessons_total)::integer,
        count(*) filter (where p.inactive_14d)::integer,
        sum(p.tasks_open)::integer, sum(p.tasks_overdue)::integer, sum(p.assignments_waiting)::integer,
        round(avg(p.pulse_last), 1), count(*) filter (where p.pulse_flagged)::integer
      from public.academy_admin_people() p
      where p.client_id is not null
      group by p.client_id
      order by 2;
  elsif p_by = 'group' then
    return query
      select g.id, g.name, count(p.profile_id)::integer,
        round(avg(p.progress_percent))::integer,
        count(p.profile_id) filter (where p.lessons_total > 0 and p.lessons_done >= p.lessons_total)::integer,
        count(p.profile_id) filter (where p.inactive_14d)::integer,
        coalesce(sum(p.tasks_open), 0)::integer, coalesce(sum(p.tasks_overdue), 0)::integer,
        coalesce(sum(p.assignments_waiting), 0)::integer,
        round(avg(p.pulse_last), 1), count(p.profile_id) filter (where p.pulse_flagged)::integer
      from public.academy_groups g
      left join public.academy_group_members gm on gm.group_id = g.id
      left join public.academy_admin_people() p on p.profile_id = gm.profile_id
      group by g.id, g.name
      order by g.name;
  else
    raise exception 'Unknown overview';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Funnel: where people drop out
-- ---------------------------------------------------------------------------

-- Per published lesson of a course, in order: the cohort (people with
-- access, optionally of one group or client), how many reached the lesson,
-- finished it, and stopped there: their furthest lesson, not finished,
-- inactive for 14 days and the course not done.
create or replace function public.academy_lesson_funnel(
  p_course_id uuid,
  p_group_id uuid default null,
  p_client_id uuid default null
)
returns table (
  step integer,
  module_id uuid,
  module_title text,
  lesson_id uuid,
  lesson_title text,
  cohort integer,
  reached integer,
  completed integer,
  stopped_here integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with cohort as (
    select am.profile_id, am.created_at, am.last_active_at
    from public.academy_members am
    where public.academy_is_manager()
      and public.academy_course_scope(p_course_id, am.profile_id) is not null
      and am.academy_role <> 'client_reader'
      and (p_group_id is null or exists (
        select 1 from public.academy_group_members gm where gm.group_id = p_group_id and gm.profile_id = am.profile_id))
      and (p_client_id is null or public.academy_person_client(am.profile_id) = p_client_id)
  ),
  steps as (
    select row_number() over (order by m.position, m.id, ml.position, l.id)::integer as step,
      m.id as module_id, m.title as module_title, l.id as lesson_id, l.title as lesson_title
    from public.academy_modules m
    join public.academy_module_lessons ml on ml.module_id = m.id
    join public.academy_lessons l on l.id = ml.lesson_id and l.status = 'published'
    where m.course_id = p_course_id and m.status = 'published'
  ),
  -- A lesson in two modules counts at its first place.
  firsts as (
    select distinct on (lesson_id) * from steps order by lesson_id, step
  ),
  progress as (
    select c.profile_id, f.step, lp.completed_at,
      greatest(c.last_active_at, lp.last_viewed_at, lp.updated_at) as seen
    from cohort c
    join public.academy_lesson_progress lp on lp.profile_id = c.profile_id
    join firsts f on f.lesson_id = lp.lesson_id
  ),
  furthest as (
    select distinct on (p.profile_id) p.profile_id, p.step, p.completed_at,
      max(p.seen) over (partition by p.profile_id) as last_seen
    from progress p
    order by p.profile_id, p.step desc
  ),
  stopped as (
    select f.step, count(*)::integer as n
    from furthest f
    join cohort c on c.profile_id = f.profile_id
    where f.completed_at is null
      and coalesce(f.last_seen, c.created_at) < now() - interval '14 days'
      and not public.academy_course_done(p_course_id, f.profile_id)
    group by f.step
  )
  select f.step, f.module_id, f.module_title, f.lesson_id, f.lesson_title,
    (select count(*) from cohort)::integer,
    (select count(*) from progress p where p.step = f.step)::integer,
    (select count(*) from progress p where p.step = f.step and p.completed_at is not null)::integer,
    coalesce((select s.n from stopped s where s.step = f.step), 0)
  from firsts f
  order by f.step;
$$;

-- ---------------------------------------------------------------------------
-- 4. Group report
-- ---------------------------------------------------------------------------

-- A candidate group in numbers: members, started, completed, inactive,
-- average progress, the knowledge check and final assignment score
-- distribution (buckets 0-49, 50-69, 70-89, 90-100) and the funnel.
create or replace function public.academy_group_report(p_group_id uuid, p_course_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_course uuid := coalesce(p_course_id, public.academy_ats_developer_course());
  v_candidates uuid[];
begin
  if not public.academy_is_manager() then
    return null;
  end if;
  select coalesce(array_agg(am.candidate_id), '{}') into v_candidates
  from public.academy_group_members gm join public.academy_members am on am.profile_id = gm.profile_id
  where gm.group_id = p_group_id and am.candidate_id is not null;

  return jsonb_build_object(
    'course_id', v_course,
    'members', (select count(*) from public.academy_group_members where group_id = p_group_id),
    'summary', (
      select jsonb_build_object(
        'candidates', count(*),
        'started', count(*) filter (where p.started_at is not null),
        'completed', count(*) filter (where p.completed_at is not null),
        'inactive', count(*) filter (where p.inactive_14d),
        'certificates', count(*) filter (where p.certificate_issued_at is not null),
        'avg_progress', round(avg(p.progress_percent)),
        'avg_check', round(avg(p.check_avg_percent)),
        'avg_final', round(avg(p.final_avg_score)),
        'avg_lead_time_days', round(avg(p.lead_time_days) filter (where p.completed_at is not null))
      )
      from public.academy_ats_progress(v_candidates) p
    ),
    'check_distribution', (
      select jsonb_build_object(
        '0-49', count(*) filter (where p.check_avg_percent < 50),
        '50-69', count(*) filter (where p.check_avg_percent between 50 and 69),
        '70-89', count(*) filter (where p.check_avg_percent between 70 and 89),
        '90-100', count(*) filter (where p.check_avg_percent >= 90),
        'none', count(*) filter (where p.check_avg_percent is null)
      )
      from public.academy_ats_progress(v_candidates) p
    ),
    'final_distribution', (
      select jsonb_build_object(
        '0-49', count(*) filter (where p.final_avg_score < 50),
        '50-69', count(*) filter (where p.final_avg_score between 50 and 69),
        '70-89', count(*) filter (where p.final_avg_score between 70 and 89),
        '90-100', count(*) filter (where p.final_avg_score >= 90),
        'none', count(*) filter (where p.final_avg_score is null)
      )
      from public.academy_ats_progress(v_candidates) p
    ),
    'funnel', coalesce((
      select jsonb_agg(to_jsonb(f) order by f.step) from public.academy_lesson_funnel(v_course, p_group_id) f
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Reminders
-- ---------------------------------------------------------------------------

-- Every reminder sent (or counted in a dry run) to someone who got stuck.
create table public.academy_reminders (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.academy_members (profile_id) on delete cascade,
  kind text not null default 'stuck' check (kind in ('stuck')),
  course_id uuid references public.academy_courses (id) on delete set null,
  lesson_id uuid references public.academy_lessons (id) on delete set null,
  days_inactive integer,
  mailed boolean not null default false,
  sent_at timestamptz not null default now()
);

create index on public.academy_reminders (profile_id, sent_at desc);

alter table public.academy_reminders enable row level security;
create policy "Academy managers read reminders" on public.academy_reminders
  for select to authenticated using (public.academy_is_manager());

-- Candidates who are stuck: access to the developer course, not done, no
-- activity for reminder_after_days, fewer than reminder_max reminders since
-- their last activity and none in the last reminder_repeat_days. With the
-- next lesson to open (first open lesson not done). Service role (job).
create or replace function public.academy_stuck_candidates(p_now timestamptz default now())
returns table (
  profile_id uuid,
  full_name text,
  email text,
  locale text,
  time_zone text,
  course_id uuid,
  course_title text,
  days_inactive integer,
  reminders_sent integer,
  next_lesson_id uuid,
  next_lesson_title text
)
language sql
stable
security definer
set search_path = ''
as $$
  with s as (select * from public.academy_ats_settings where id),
  course as (select public.academy_ats_developer_course() as id),
  people as (
    select am.profile_id, p.full_name, p.email, am.locale, p.time_zone, course.id as course_id,
      coalesce(public.academy_last_activity(am.profile_id), am.invited_at, am.created_at) as last_activity
    from public.academy_members am
    join public.profiles p on p.id = am.profile_id
    cross join course
    join public.academy_courses c on c.id = course.id and c.status = 'published'
    where am.academy_role = 'candidate' and p.email is not null
      and public.academy_course_scope(course.id, am.profile_id) is not null
      and not public.academy_course_done(course.id, am.profile_id)
  ),
  due as (
    select pe.*,
      (select count(*) from public.academy_reminders r where r.profile_id = pe.profile_id and r.sent_at > pe.last_activity)::integer as sent,
      (select max(r.sent_at) from public.academy_reminders r where r.profile_id = pe.profile_id) as last_sent
    from people pe, s
    where s.reminder_enabled and pe.last_activity < p_now - make_interval(days => s.reminder_after_days)
  )
  select d.profile_id, d.full_name, d.email, d.locale, d.time_zone, d.course_id,
    (select c.title from public.academy_courses c where c.id = d.course_id),
    floor(extract(epoch from p_now - d.last_activity) / 86400)::integer,
    d.sent,
    n.lesson_id, n.title
  from due d
  cross join s
  left join lateral (
    select l.id as lesson_id, l.title
    from public.academy_modules m
    join public.academy_module_lessons ml on ml.module_id = m.id
    join public.academy_lessons l on l.id = ml.lesson_id and l.status = 'published'
    where m.course_id = d.course_id and m.status = 'published'
      and public.academy_module_state(m.id, d.profile_id) in ('open')
      and not exists (
        select 1 from public.academy_lesson_progress lp
        where lp.profile_id = d.profile_id and lp.lesson_id = l.id and lp.completed_at is not null
      )
    order by m.position, ml.position
    limit 1
  ) n on true
  where d.sent < s.reminder_max
    and (d.last_sent is null or d.last_sent < p_now - make_interval(days => s.reminder_repeat_days))
    -- Nothing to remind about when nothing is open.
    and n.lesson_id is not null
  order by d.last_activity;
$$;

-- ---------------------------------------------------------------------------
-- 6. Retention
-- ---------------------------------------------------------------------------

-- What the retention job did, per person. No names or addresses: only ids
-- (which no longer resolve after deletion) and the action.
create table public.academy_retention_log (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid,
  candidate_id uuid,
  action text not null check (action in ('anonymise', 'delete', 'dry_run', 'failed')),
  last_activity_at timestamptz,
  detail jsonb not null default '{}'::jsonb,
  job_run_id uuid,
  created_at timestamptz not null default now()
);

create index on public.academy_retention_log (created_at desc);

alter table public.academy_retention_log enable row level security;
create policy "Academy managers read the retention log" on public.academy_retention_log
  for select to authenticated using (public.academy_is_manager());

-- Candidates whose Academy data is past the talent pool retention period:
-- Academy role candidate (never developer), portal role candidate, never
-- placed (no placement, not status placed, never a placement member), no
-- application in the flow (only parked or rejected, or none), not already
-- anonymised, and no activity in ATS or Academy for p_months (default the
-- setting). Conservative on purpose: anything unclear is left alone.
create or replace function public.academy_retention_candidates(p_months integer default null, p_now timestamptz default now())
returns table (profile_id uuid, candidate_id uuid, last_activity_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with s as (select coalesce(p_months, retention_months) as months from public.academy_ats_settings where id),
  people as (
    select am.profile_id, am.candidate_id,
      greatest(
        am.created_at, am.invited_at, public.academy_last_activity(am.profile_id),
        c.updated_at, c.created_at,
        (select max(a.updated_at) from public.applications a where a.candidate_id = c.id)
      ) as last_activity
    from public.academy_members am
    join public.profiles p on p.id = am.profile_id
    left join public.candidates c on c.id = am.candidate_id
    where am.academy_role = 'candidate' and p.role = 'candidate'
      and coalesce(p.full_name, '') <> 'Anonymised candidate'
      and not exists (select 1 from public.academy_placement_members pm where pm.profile_id = am.profile_id)
      and (c.id is null or (
        c.status <> 'placed'
        and not exists (select 1 from public.placements pl where pl.candidate_id = c.id)
        and not exists (select 1 from public.applications a where a.candidate_id = c.id and a.stage not in ('parked', 'rejected'))
      ))
  )
  select pe.profile_id, pe.candidate_id, pe.last_activity
  from people pe, s
  where pe.last_activity < p_now - make_interval(months => s.months)
  order by pe.last_activity;
$$;

-- Anonymise the Academy data of one person: free text and files go
-- (notes, worksheet answers, assignments, questionnaire, notifications,
-- certificates, block state, reminders), the link to the ATS candidate and
-- the name go. Scores and progress stay as anonymous numbers for the
-- funnel. Returns the storage paths the job deletes. Checks again that the
-- person still qualifies. The auth account (e-mail) is anonymised by the
-- job with the admin API.
create or replace function public.academy_retention_anonymise(p_profile_id uuid, p_job_run_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate uuid;
  v_last timestamptz;
  v_paths text[];
begin
  select r.candidate_id, r.last_activity_at into v_candidate, v_last
  from public.academy_retention_candidates() r where r.profile_id = p_profile_id;
  if not found then
    raise exception 'This person does not qualify for retention';
  end if;

  select coalesce(array_agg(path), '{}') into v_paths from (
    select s.file_path as path from public.academy_assignment_submissions s where s.profile_id = p_profile_id and s.file_path is not null
    union all
    select c.storage_path from public.academy_certificates c where c.profile_id = p_profile_id and c.storage_path is not null
  ) x;

  delete from public.academy_notes where profile_id = p_profile_id;
  delete from public.academy_worksheet_answers where profile_id = p_profile_id;
  delete from public.academy_assignment_submissions where profile_id = p_profile_id;
  delete from public.academy_questionnaire_responses where profile_id = p_profile_id;
  delete from public.academy_questionnaire_consents where profile_id = p_profile_id;
  delete from public.academy_certificates where profile_id = p_profile_id;
  delete from public.academy_notifications where profile_id = p_profile_id;
  delete from public.academy_reminders where profile_id = p_profile_id;
  update public.academy_block_progress set state = '{}'::jsonb where profile_id = p_profile_id and state <> '{}'::jsonb;
  update public.academy_check_attempts set answers = '{}'::jsonb where profile_id = p_profile_id;
  update public.academy_members
  set candidate_id = null, digest_frequency = 'off', invited_by = null
  where profile_id = p_profile_id;
  update public.profiles set full_name = 'Anonymised candidate', email = null where id = p_profile_id;

  insert into public.academy_retention_log (profile_id, candidate_id, action, last_activity_at, detail, job_run_id)
  values (p_profile_id, v_candidate, 'anonymise', v_last, jsonb_build_object('files', cardinality(v_paths)), p_job_run_id);

  return jsonb_build_object('candidate_id', v_candidate, 'paths', to_jsonb(v_paths));
end;
$$;

-- Log a dry run, a deletion (done by the job with the admin API) or a failure.
create or replace function public.academy_retention_note(
  p_profile_id uuid, p_candidate_id uuid, p_action text, p_last timestamptz, p_detail jsonb default '{}'::jsonb, p_job_run_id uuid default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.academy_retention_log (profile_id, candidate_id, action, last_activity_at, detail, job_run_id)
  values (p_profile_id, p_candidate_id, p_action, p_last, coalesce(p_detail, '{}'::jsonb), p_job_run_id);
$$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'academy_stuck_candidates(timestamptz)',
    'academy_retention_candidates(integer, timestamptz)',
    'academy_retention_anonymise(uuid, uuid)',
    'academy_retention_note(uuid, uuid, text, timestamptz, jsonb, uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', v_fn);
    execute format('grant execute on function public.%s to service_role', v_fn);
  end loop;
  foreach v_fn in array array[
    'academy_person_client(uuid)', 'academy_admin_people(uuid, uuid, text, uuid)', 'academy_admin_rollup(text)',
    'academy_lesson_funnel(uuid, uuid, uuid)', 'academy_group_report(uuid, uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', v_fn);
    execute format('grant execute on function public.%s to authenticated, service_role', v_fn);
  end loop;
end $$;

-- Managers may see how many candidates the retention job would pick up
-- (the count only, for the settings page).
create or replace function public.academy_retention_preview()
returns table (due integer, oldest timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer, min(last_activity_at)
  from public.academy_retention_candidates()
  where public.academy_is_manager();
$$;

revoke execute on function public.academy_retention_preview() from public, anon;
grant execute on function public.academy_retention_preview() to authenticated, service_role;
