-- Nordavo Academy: the assignment, tasks, knowledge check and questionnaire
-- block types (spec Academy: opdrachtblok, takenblok, kennischeck,
-- persoonlijkheidstest als vragenlijst-bloktype). Builds on
-- 20261112020000_academy_learning.sql; replaces only academy_block_done_tasks
-- and academy_block_done_questionnaire, and the questionnaire policies.
--
--   1  Helpers: academy_deadline() (relative deadline to a real one, same
--      rule as deadlineFromOffset in TS), academy_lesson_link()
--   2  Assignment: academy_submit_assignment() (hand in, edit while waiting,
--      new attempt after "changes requested"), academy_review_submission()
--      (Nordavo approves or asks for changes, score, rubric, notification)
--   3  Tasks: academy_task_instances() (to whom a task applies and its real
--      deadline), academy_my_tasks(), academy_set_task_done(),
--      academy_placement_tasks(), academy_overdue_tasks(),
--      academy_remind_overdue_tasks() (job), academy_block_done_tasks
--   4  Knowledge check: academy_check_questions_for() (without answers),
--      academy_submit_check() (scored here, explanations back),
--      academy_check_results()
--   5  Questionnaire: consent (timestamp, withdrawable), save and score,
--      answers only for the person and Academy managers
--   6  For the ATS: academy_candidate_check_scores(),
--      academy_candidate_assignments(), academy_candidate_questionnaire_results(),
--      academy_candidate_learn_summary()

-- ---------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------

-- "By day N" as a real deadline: the last second of start + offset in the
-- zone (the same as deadlineFromOffset in src/lib/academy/time.ts).
create or replace function public.academy_deadline(p_start date, p_offset integer, p_zone text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when p_start is null or p_offset is null then null
    else (((p_start + p_offset + 1)::timestamp) at time zone coalesce(p_zone, 'Europe/Amsterdam')) - interval '1 second'
  end;
$$;

-- The player URL of a lesson for a person (first course of theirs that has
-- it), for notifications. /academy when the person has no course with it.
create or replace function public.academy_lesson_link(p_lesson_id uuid, p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select '/academy/courses/' || m.course_id || '/lessons/' || p_lesson_id || '?module=' || m.id
    from public.academy_module_lessons ml
    join public.academy_modules m on m.id = ml.module_id
    where ml.lesson_id = p_lesson_id and public.academy_has_course(m.course_id, p_profile_id)
    order by m.position, m.id
    limit 1
  ), '/academy');
$$;

-- ---------------------------------------------------------------------------
-- 2. Assignment
-- ---------------------------------------------------------------------------
--
-- Block content: { prompt, formats: ["text", "file", "link"] }. Files are in
-- the bucket attachments under academy/submission/<profile_id>/.

-- Nordavo's rubric scores, cleaned: the four criteria, whole numbers 1 to 5.
create or replace function public.academy_clean_rubric(p_scores jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(k, (p_scores ->> k)::numeric::integer), '{}'::jsonb)
  from unnest(array['clarity', 'proactivity', 'says_no', 'english']) as k
  where jsonb_typeof(p_scores -> k) = 'number'
    and (p_scores ->> k)::numeric between 1 and 5
    and (p_scores ->> k)::numeric = trunc((p_scores ->> k)::numeric);
$$;

-- Hand in (or change while waiting for Nordavo). After "changes requested" a
-- new attempt is made, so the history stays. Approved: nothing more to hand in.
create or replace function public.academy_submit_assignment(
  p_block_id uuid,
  p_body text default null,
  p_file_path text default null,
  p_file_name text default null,
  p_link_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_block public.academy_lesson_blocks%rowtype;
  v_formats jsonb;
  v_last public.academy_assignment_submissions%rowtype;
  v_id uuid;
begin
  if v_uid is null or not exists (select 1 from public.academy_members where profile_id = v_uid) then
    raise exception 'Only participants hand in assignments' using errcode = '42501';
  end if;
  select * into v_block from public.academy_lesson_blocks where id = p_block_id;
  if not found or v_block.type <> 'assignment' or not public.academy_lesson_open_for(v_block.lesson_id, v_uid) then
    raise exception 'This assignment is not open for you' using errcode = '42501';
  end if;

  p_body := nullif(btrim(coalesce(p_body, '')), '');
  p_file_path := nullif(btrim(coalesce(p_file_path, '')), '');
  p_link_url := nullif(btrim(coalesce(p_link_url, '')), '');
  if p_body is null and p_file_path is null and p_link_url is null then
    raise exception 'Hand in a text, a file or a link' using errcode = '22023';
  end if;

  v_formats := v_block.content -> 'formats';
  if jsonb_typeof(v_formats) is distinct from 'array' or jsonb_array_length(v_formats) = 0 then
    v_formats := '["text", "file", "link"]'::jsonb;
  end if;
  if (p_body is not null and not (v_formats ? 'text'))
     or (p_file_path is not null and not (v_formats ? 'file'))
     or (p_link_url is not null and not (v_formats ? 'link')) then
    raise exception 'This way of handing in is not allowed for this assignment' using errcode = '22023';
  end if;
  if p_link_url is not null and p_link_url !~* '^https?://[^[:space:]]+$' then
    raise exception 'The link must start with http:// or https://' using errcode = '22023';
  end if;
  if p_file_path is not null
     and (p_file_path not like 'academy/submission/' || v_uid::text || '/%' or p_file_path like '%..%') then
    raise exception 'File not found' using errcode = '22023';
  end if;

  select * into v_last from public.academy_assignment_submissions
  where block_id = p_block_id and profile_id = v_uid
  order by attempt desc
  limit 1;

  if found and v_last.status = 'approved' then
    raise exception 'This assignment is already approved' using errcode = '22023';
  end if;

  if found and v_last.status = 'submitted' then
    update public.academy_assignment_submissions
    set body = p_body,
        file_path = p_file_path,
        file_name = case when p_file_path is null then null else left(coalesce(nullif(btrim(p_file_name), ''), 'file'), 300) end,
        link_url = p_link_url,
        submitted_at = now()
    where id = v_last.id;
    -- The AI proposal was about the old version.
    delete from public.academy_assignment_assessments where submission_id = v_last.id;
    return v_last.id;
  end if;

  insert into public.academy_assignment_submissions (block_id, profile_id, attempt, body, file_path, file_name, link_url)
  values (
    p_block_id, v_uid, coalesce(v_last.attempt, 0) + 1, p_body, p_file_path,
    case when p_file_path is null then null else left(coalesce(nullif(btrim(p_file_name), ''), 'file'), 300) end,
    p_link_url
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Nordavo reviews the latest attempt: approved or changes requested, with
-- feedback, the final score (0 to 100, Nordavo's own) and the rubric. The
-- learner gets a notification. The AI proposal is never the final score.
create or replace function public.academy_review_submission(
  p_submission_id uuid,
  p_status text,
  p_feedback text default null,
  p_final_score integer default null,
  p_rubric_scores jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.academy_assignment_submissions%rowtype;
  v_locale text;
  v_lesson uuid;
  v_title text;
begin
  if not public.academy_is_manager() then
    raise exception 'Only Nordavo reviews assignments' using errcode = '42501';
  end if;
  if p_status not in ('approved', 'changes_requested') then
    raise exception 'Choose approve or ask for changes' using errcode = '22023';
  end if;
  p_feedback := nullif(btrim(coalesce(p_feedback, '')), '');
  if p_status = 'changes_requested' and p_feedback is null then
    raise exception 'Write what should change' using errcode = '22023';
  end if;
  if p_final_score is not null and p_final_score not between 0 and 100 then
    raise exception 'The score is between 0 and 100' using errcode = '22023';
  end if;

  select * into v_sub from public.academy_assignment_submissions where id = p_submission_id for update;
  if not found then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.academy_assignment_submissions
    where block_id = v_sub.block_id and profile_id = v_sub.profile_id and attempt > v_sub.attempt
  ) then
    raise exception 'A newer attempt was handed in; review that one' using errcode = '22023';
  end if;

  update public.academy_assignment_submissions
  set status = p_status,
      feedback = p_feedback,
      feedback_by = (select auth.uid()),
      feedback_at = now(),
      final_score = p_final_score
  where id = p_submission_id;

  if p_rubric_scores is not null then
    insert into public.academy_assignment_assessments (submission_id, rubric_scores)
    values (p_submission_id, public.academy_clean_rubric(p_rubric_scores))
    on conflict (submission_id) do update set rubric_scores = excluded.rubric_scores;
  end if;

  select am.locale into v_locale from public.academy_members am where am.profile_id = v_sub.profile_id;
  select b.lesson_id, coalesce(b.title, l.title) into v_lesson, v_title
  from public.academy_lesson_blocks b join public.academy_lessons l on l.id = b.lesson_id
  where b.id = v_sub.block_id;

  perform public.academy_notify(
    v_sub.profile_id,
    case p_status when 'approved' then 'assignment_approved' else 'assignment_changes_requested' end,
    case
      when v_locale = 'nl' and p_status = 'approved' then 'Je opdracht is goedgekeurd'
      when v_locale = 'nl' then 'Nordavo vraagt een aanpassing van je opdracht'
      when p_status = 'approved' then 'Your assignment was approved'
      else 'Nordavo asks you to revise your assignment'
    end,
    v_title,
    public.academy_lesson_link(v_lesson, v_sub.profile_id),
    jsonb_build_object('submission_id', v_sub.id, 'block_id', v_sub.block_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Tasks
-- ---------------------------------------------------------------------------

-- How often an overdue task was reminded (at most 3 times, a week apart).
alter table public.academy_task_status
  add column reminder_count integer not null default 0 check (reminder_count >= 0);

-- Every task instance: per person for a personal task, per placement for a
-- shared one, with its real deadline and status. A personal task applies to
-- a person who may open its lesson; a placement-only task only once the
-- person is in a placement. A shared task applies to a placement (not ended)
-- when someone who ticks (client admin, client member, developer) may open
-- its lesson, or once it has a status there. Deadlines: personal from the
-- person's start date (else the first placement start) in their time zone;
-- shared from the placement start in its overlap time zone. Filters: a
-- person (own tasks and the shared tasks of own placements), a placement
-- (its members and its shared tasks), a block. Internal.
create or replace function public.academy_task_instances(
  p_profile_id uuid default null,
  p_placement_id uuid default null,
  p_block_id uuid default null
)
returns table (
  task_id uuid,
  block_id uuid,
  lesson_id uuid,
  profile_id uuid,
  placement_id uuid,
  due_at timestamptz,
  status_id uuid,
  done_at timestamptz,
  done_by uuid,
  reminded_at timestamptz,
  reminder_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with tasks as (
    select t.id, t.block_id, t.shared, t.placement_only, t.deadline_offset_days, b.lesson_id
    from public.academy_tasks t
    join public.academy_lesson_blocks b on b.id = t.block_id and b.type = 'tasks'
    join public.academy_lessons l on l.id = b.lesson_id and l.status = 'published'
    where p_block_id is null or t.block_id = p_block_id
  ),
  people as (
    select am.profile_id, am.start_date, coalesce(pr.time_zone, 'Europe/Amsterdam') as zone,
      (select min(pl.start_date)
       from public.academy_placement_members pm join public.placements pl on pl.id = pm.placement_id
       where pm.profile_id = am.profile_id) as placement_start
    from public.academy_members am
    join public.profiles pr on pr.id = am.profile_id
    where (p_profile_id is null or am.profile_id = p_profile_id)
      and (p_placement_id is null or exists (
        select 1 from public.academy_placement_members pm
        where pm.placement_id = p_placement_id and pm.profile_id = am.profile_id
      ))
  ),
  personal as (
    select t.id as task_id, t.block_id, t.lesson_id, pe.profile_id, null::uuid as placement_id,
      public.academy_deadline(coalesce(pe.start_date, pe.placement_start), t.deadline_offset_days, pe.zone) as due_at
    from tasks t
    cross join people pe
    where not t.shared
      and (not t.placement_only or pe.placement_start is not null)
      and public.academy_lesson_open_for(t.lesson_id, pe.profile_id)
  ),
  places as (
    select pl.id, pl.start_date, coalesce(pl.overlap_time_zone, 'Europe/Amsterdam') as zone
    from public.placements pl
    where pl.status <> 'ended'
      and (p_placement_id is null or pl.id = p_placement_id)
      and exists (
        select 1 from public.academy_placement_members pm
        where pm.placement_id = pl.id and (p_profile_id is null or pm.profile_id = p_profile_id)
      )
  ),
  shared as (
    select t.id as task_id, t.block_id, t.lesson_id, null::uuid as profile_id, pl.id as placement_id,
      public.academy_deadline(pl.start_date, t.deadline_offset_days, pl.zone) as due_at
    from tasks t
    cross join places pl
    where t.shared
      and (
        exists (
          select 1 from public.academy_task_status s
          where s.task_id = t.id and s.placement_id = pl.id and s.profile_id is null
        )
        or exists (
          select 1 from public.academy_placement_members pm
          where pm.placement_id = pl.id and pm.role in ('client_admin', 'client_member', 'developer')
            and public.academy_lesson_open_for(t.lesson_id, pm.profile_id)
        )
      )
  ),
  inst as (
    select * from personal
    union all
    select * from shared
  )
  select i.task_id, i.block_id, i.lesson_id, i.profile_id, i.placement_id, i.due_at,
    s.id, s.done_at, s.done_by, s.reminded_at, coalesce(s.reminder_count, 0)
  from inst i
  left join public.academy_task_status s on s.task_id = i.task_id
    and (
      (i.profile_id is not null and s.profile_id = i.profile_id)
      or (i.profile_id is null and s.profile_id is null and s.placement_id = i.placement_id)
    );
$$;

-- tasks: every required task instance of the block that applies to the
-- person is done (own tasks, and shared tasks of every placement they are in
-- where the task applies). Candidates without a placement never wait for
-- placement-only or shared tasks.
create or replace function public.academy_block_done_tasks(p_block_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.academy_task_instances(p_profile_id, null, p_block_id) i
    join public.academy_tasks t on t.id = i.task_id
    where t.required and i.done_at is null
  );
$$;

-- The tasks of the signed in user (optionally of one block): own tasks and
-- the shared tasks of their placements, with the real deadline. Open first,
-- by deadline.
create or replace function public.academy_my_tasks(p_block_id uuid default null)
returns table (
  task_id uuid,
  block_id uuid,
  lesson_id uuid,
  lesson_title text,
  link text,
  title text,
  description text,
  task_position double precision,
  deadline_offset_days integer,
  required boolean,
  shared boolean,
  placement_only boolean,
  placement_id uuid,
  placement_label text,
  due_at timestamptz,
  done_at timestamptz,
  done_by_name text,
  can_tick boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.task_id, i.block_id, i.lesson_id, l.title,
    public.academy_lesson_link(i.lesson_id, (select auth.uid())),
    t.title, t.description, t.position, t.deadline_offset_days, t.required, t.shared, t.placement_only,
    i.placement_id,
    case when i.placement_id is not null then (
      select concat_ws(' · ', c.name, cand.full_name)
      from public.placements pl
      left join public.clients c on c.id = pl.client_id
      left join public.candidates cand on cand.id = pl.candidate_id
      where pl.id = i.placement_id
    ) end,
    i.due_at, i.done_at,
    (select p.full_name from public.profiles p where p.id = i.done_by),
    case
      when i.placement_id is null then true
      else coalesce(public.academy_placement_role(i.placement_id) in ('client_admin', 'client_member', 'developer'), false)
    end
  from public.academy_task_instances((select auth.uid()), null, p_block_id) i
  join public.academy_tasks t on t.id = i.task_id
  join public.academy_lessons l on l.id = i.lesson_id
  where exists (select 1 from public.academy_members where profile_id = (select auth.uid()))
  order by i.done_at is not null, i.due_at nulls last, l.title, t.position, t.id;
$$;

-- Tick a task off (or undo it): own task, or a shared task of own placement
-- (client admin, client member or developer). Returns done_at.
create or replace function public.academy_set_task_done(p_task_id uuid, p_placement_id uuid default null, p_done boolean default true)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_due timestamptz;
  v_done timestamptz := case when p_done then now() end;
begin
  if v_uid is null or not exists (select 1 from public.academy_members where profile_id = v_uid) then
    raise exception 'Only participants tick off tasks' using errcode = '42501';
  end if;

  select i.due_at into v_due
  from public.academy_task_instances(v_uid, null, (select t.block_id from public.academy_tasks t where t.id = p_task_id)) i
  where i.task_id = p_task_id
    and i.placement_id is not distinct from p_placement_id
    and (p_placement_id is not null or i.profile_id = v_uid);
  if not found then
    raise exception 'This task is not open for you' using errcode = '42501';
  end if;

  if p_placement_id is null then
    insert into public.academy_task_status (task_id, profile_id, due_at, done_at, done_by)
    values (p_task_id, v_uid, v_due, v_done, case when p_done then v_uid end)
    on conflict (task_id, profile_id) where profile_id is not null do update
      set done_at = excluded.done_at, done_by = excluded.done_by, due_at = excluded.due_at;
  else
    if coalesce(public.academy_placement_role(p_placement_id), '') not in ('client_admin', 'client_member', 'developer') then
      raise exception 'Only the client and the developer tick off shared tasks' using errcode = '42501';
    end if;
    insert into public.academy_task_status (task_id, placement_id, due_at, done_at, done_by)
    values (p_task_id, p_placement_id, v_due, v_done, case when p_done then v_uid end)
    on conflict (task_id, placement_id) where profile_id is null do update
      set done_at = excluded.done_at, done_by = excluded.done_by, due_at = excluded.due_at;
  end if;
  return v_done;
end;
$$;

-- The course tasks of one placement, for its page: the shared tasks and the
-- placement-only tasks of its people (those whose progress the viewer may
-- follow). Members of the placement and Academy managers.
create or replace function public.academy_placement_tasks(p_placement_id uuid)
returns table (
  task_id uuid,
  block_id uuid,
  lesson_id uuid,
  lesson_title text,
  title text,
  description text,
  deadline_offset_days integer,
  required boolean,
  shared boolean,
  profile_id uuid,
  person_name text,
  due_at timestamptz,
  done_at timestamptz,
  done_by_name text,
  can_tick boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.task_id, i.block_id, i.lesson_id, l.title, t.title, t.description, t.deadline_offset_days, t.required, t.shared,
    i.profile_id,
    (select p.full_name from public.profiles p where p.id = i.profile_id),
    i.due_at, i.done_at,
    (select p.full_name from public.profiles p where p.id = i.done_by),
    case
      when i.profile_id is null then coalesce(public.academy_placement_role(p_placement_id) in ('client_admin', 'client_member', 'developer'), false)
      else i.profile_id = (select auth.uid())
    end
  from public.academy_task_instances(null, p_placement_id, null) i
  join public.academy_tasks t on t.id = i.task_id
  join public.academy_lessons l on l.id = i.lesson_id
  where public.academy_can_see_placement(p_placement_id)
    and (
      i.profile_id is null
      or (t.placement_only and (i.profile_id = (select auth.uid()) or public.academy_can_view_progress(i.profile_id)))
    )
  order by i.done_at is not null, i.due_at nulls last, l.title, t.position, t.id;
$$;

-- The tasks of one person (own tasks and the shared tasks of their
-- placements), for Nordavo's people page.
create or replace function public.academy_person_tasks(p_profile_id uuid)
returns table (
  task_id uuid,
  lesson_id uuid,
  lesson_title text,
  title text,
  required boolean,
  shared boolean,
  placement_only boolean,
  placement_id uuid,
  due_at timestamptz,
  done_at timestamptz,
  reminder_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.task_id, i.lesson_id, l.title, t.title, t.required, t.shared, t.placement_only, i.placement_id,
    i.due_at, i.done_at, i.reminder_count
  from public.academy_task_instances(p_profile_id, null, null) i
  join public.academy_tasks t on t.id = i.task_id
  join public.academy_lessons l on l.id = i.lesson_id
  where public.academy_is_manager()
  order by i.done_at is not null, i.due_at nulls last, l.title, t.position, t.id;
$$;

-- Overdue tasks, for Nordavo (/dashboard/academy/tasks).
create or replace function public.academy_overdue_tasks()
returns table (
  task_id uuid,
  title text,
  lesson_id uuid,
  lesson_title text,
  required boolean,
  shared boolean,
  profile_id uuid,
  person_name text,
  person_email text,
  academy_role text,
  placement_id uuid,
  placement_label text,
  due_at timestamptz,
  days_overdue integer,
  reminded_at timestamptz,
  reminder_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.task_id, t.title, i.lesson_id, l.title, t.required, t.shared,
    i.profile_id, p.full_name, p.email, am.academy_role,
    i.placement_id,
    case when i.placement_id is not null then (
      select concat_ws(' · ', c.name, cand.full_name)
      from public.placements pl
      left join public.clients c on c.id = pl.client_id
      left join public.candidates cand on cand.id = pl.candidate_id
      where pl.id = i.placement_id
    ) end,
    i.due_at,
    floor(extract(epoch from (now() - i.due_at)) / 86400)::integer,
    i.reminded_at, i.reminder_count
  from public.academy_task_instances(null, null, null) i
  join public.academy_tasks t on t.id = i.task_id
  join public.academy_lessons l on l.id = i.lesson_id
  left join public.profiles p on p.id = i.profile_id
  left join public.academy_members am on am.profile_id = i.profile_id
  where public.academy_is_manager() and i.done_at is null and i.due_at < now()
  order by i.due_at, t.title;
$$;

-- Job (service role): a notification for every overdue task, at most three
-- times and a week apart. Personal tasks go to the person, shared tasks to
-- whoever ticks them in the placement. Returns the number of tasks reminded.
create or replace function public.academy_remind_overdue_tasks()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  m record;
  v_count integer := 0;
begin
  for r in
    select i.*, t.title as task_title
    from public.academy_task_instances(null, null, null) i
    join public.academy_tasks t on t.id = i.task_id
    where i.done_at is null and i.due_at < now() and i.reminder_count < 3
      and (i.reminded_at is null or i.reminded_at < now() - interval '7 days')
  loop
    if r.profile_id is not null then
      insert into public.academy_task_status (task_id, profile_id, due_at, reminded_at, reminder_count)
      values (r.task_id, r.profile_id, r.due_at, now(), 1)
      on conflict (task_id, profile_id) where profile_id is not null do update
        set reminded_at = now(), reminder_count = public.academy_task_status.reminder_count + 1, due_at = excluded.due_at;
      for m in select am.profile_id, am.locale from public.academy_members am where am.profile_id = r.profile_id loop
        perform public.academy_notify(
          m.profile_id, 'task_overdue',
          case when m.locale = 'nl' then 'Een taak is over de deadline' else 'A task is past its deadline' end,
          r.task_title, public.academy_lesson_link(r.lesson_id, m.profile_id),
          jsonb_build_object('task_id', r.task_id, 'due_at', r.due_at)
        );
      end loop;
    else
      insert into public.academy_task_status (task_id, placement_id, due_at, reminded_at, reminder_count)
      values (r.task_id, r.placement_id, r.due_at, now(), 1)
      on conflict (task_id, placement_id) where profile_id is null do update
        set reminded_at = now(), reminder_count = public.academy_task_status.reminder_count + 1, due_at = excluded.due_at;
      for m in
        select am.profile_id, am.locale
        from public.academy_placement_members pm join public.academy_members am on am.profile_id = pm.profile_id
        where pm.placement_id = r.placement_id and pm.role in ('client_admin', 'client_member', 'developer')
      loop
        perform public.academy_notify(
          m.profile_id, 'task_overdue',
          case when m.locale = 'nl' then 'Een gedeelde taak is over de deadline' else 'A shared task is past its deadline' end,
          r.task_title, '/academy',
          jsonb_build_object('task_id', r.task_id, 'placement_id', r.placement_id, 'due_at', r.due_at)
        );
      end loop;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Knowledge check
-- ---------------------------------------------------------------------------

-- The questions of a check without the answer, for whoever may open the lesson.
create or replace function public.academy_check_questions_for(p_block_id uuid)
returns table (question_id uuid, question_position double precision, question text, options jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select q.id, q.position, q.question, q.options
  from public.academy_check_questions q
  join public.academy_lesson_blocks b on b.id = q.block_id and b.type = 'knowledge_check'
  where q.block_id = p_block_id and public.academy_can_open_lesson(b.lesson_id)
  order by q.position, q.id;
$$;

-- Score an attempt here (the browser never sees the answers before) and
-- give the explanations back. Every question must be answered. Stored as an
-- attempt for participants; a manager preview is scored but not stored.
create or replace function public.academy_submit_check(p_block_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_block public.academy_lesson_blocks%rowtype;
  v_member boolean;
  q record;
  v_raw text;
  v_choice integer;
  v_score integer := 0;
  v_max integer := 0;
  v_answers jsonb := '{}'::jsonb;
  v_results jsonb := '[]'::jsonb;
  v_attempt uuid;
begin
  select * into v_block from public.academy_lesson_blocks where id = p_block_id;
  if not found or v_block.type <> 'knowledge_check' or not public.academy_can_open_lesson(v_block.lesson_id) then
    raise exception 'This knowledge check is not open for you' using errcode = '42501';
  end if;
  v_member := exists (select 1 from public.academy_members where profile_id = v_uid);
  if jsonb_typeof(p_answers) is distinct from 'object' then
    raise exception 'Answer every question' using errcode = '22023';
  end if;

  for q in
    select * from public.academy_check_questions where block_id = p_block_id order by position, id
  loop
    v_max := v_max + 1;
    v_raw := p_answers ->> q.id::text;
    if coalesce(jsonb_typeof(p_answers -> q.id::text), '') <> 'number' or v_raw !~ '^[0-9]+$' then
      raise exception 'Answer every question' using errcode = '22023';
    end if;
    v_choice := v_raw::integer;
    if v_choice >= jsonb_array_length(q.options) then
      raise exception 'Unknown answer' using errcode = '22023';
    end if;
    if v_choice = q.correct_index then
      v_score := v_score + 1;
    end if;
    v_answers := v_answers || jsonb_build_object(q.id::text, v_choice);
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'question_id', q.id, 'chosen', v_choice, 'correct_index', q.correct_index,
      'correct', v_choice = q.correct_index, 'explanation', q.explanation
    ));
  end loop;

  if v_max = 0 then
    raise exception 'This knowledge check has no questions yet' using errcode = '22023';
  end if;

  if v_member then
    insert into public.academy_check_attempts (block_id, profile_id, answers, score, max_score)
    values (p_block_id, v_uid, v_answers, v_score, v_max)
    returning id into v_attempt;
  end if;

  return jsonb_build_object(
    'attempt_id', v_attempt, 'saved', v_member, 'score', v_score, 'max_score', v_max,
    'percent', round(v_score * 100.0 / v_max)::integer, 'results', v_results
  );
end;
$$;

-- The last own attempt with explanations, the number of attempts and the
-- best score (null without attempts).
create or replace function public.academy_check_results(p_block_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_attempt public.academy_check_attempts%rowtype;
  v_count integer;
  v_best integer;
  v_results jsonb;
begin
  select * into v_attempt from public.academy_check_attempts
  where block_id = p_block_id and profile_id = v_uid
  order by created_at desc, id desc
  limit 1;
  if not found then
    return null;
  end if;
  select count(*), max(case when max_score = 0 then 100 else round(score * 100.0 / max_score) end)
  into v_count, v_best
  from public.academy_check_attempts where block_id = p_block_id and profile_id = v_uid;

  select coalesce(jsonb_agg(jsonb_build_object(
      'question_id', q.id,
      'chosen', case when jsonb_typeof(v_attempt.answers -> q.id::text) = 'number' then (v_attempt.answers ->> q.id::text)::integer end,
      'correct_index', q.correct_index,
      'correct', (v_attempt.answers ->> q.id::text) = q.correct_index::text,
      'explanation', q.explanation
    ) order by q.position, q.id), '[]'::jsonb)
  into v_results
  from public.academy_check_questions q
  where q.block_id = p_block_id;

  return jsonb_build_object(
    'attempt_id', v_attempt.id, 'score', v_attempt.score, 'max_score', v_attempt.max_score,
    'percent', case when v_attempt.max_score = 0 then 100 else round(v_attempt.score * 100.0 / v_attempt.max_score)::integer end,
    'created_at', v_attempt.created_at, 'attempts', v_count, 'best_percent', v_best, 'results', v_results
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Questionnaire (personality test)
-- ---------------------------------------------------------------------------
--
-- Block content: { intro, consent_text, questions: [{ id, kind (scale, choice,
-- open), text, options (choice), option_scores (choice), dimension, reverse
-- (scale), required }], dimensions: [{ key, label }] }. The real test is
-- still to be specified by Julius; this is the generic mechanism.

-- Answers limited to the questions of the block and checked per kind. With
-- p_complete every required question must be answered.
create or replace function public.academy_questionnaire_clean(p_content jsonb, p_answers jsonb, p_complete boolean)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  q jsonb;
  v_id text;
  v_ans jsonb;
  v_text text;
  v_out jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(p_answers) is distinct from 'object' then
    raise exception 'Answers are missing' using errcode = '22023';
  end if;
  for q in select value from jsonb_array_elements(coalesce(p_content -> 'questions', '[]'::jsonb)) loop
    v_id := q ->> 'id';
    if v_id is null then
      continue;
    end if;
    v_ans := p_answers -> v_id;
    v_text := v_ans #>> '{}';
    if v_ans is null or jsonb_typeof(v_ans) = 'null' or btrim(coalesce(v_text, '')) = '' then
      if p_complete and coalesce((q ->> 'required')::boolean, true) then
        raise exception 'Answer every required question' using errcode = '22023';
      end if;
      continue;
    end if;
    if q ->> 'kind' = 'scale' then
      if jsonb_typeof(v_ans) <> 'number' or v_text !~ '^[1-5]$' then
        raise exception 'A scale answer is 1 to 5' using errcode = '22023';
      end if;
    elsif q ->> 'kind' = 'choice' then
      if jsonb_typeof(v_ans) <> 'number' or v_text !~ '^[0-9]+$'
         or v_text::integer >= jsonb_array_length(coalesce(q -> 'options', '[]'::jsonb)) then
        raise exception 'Unknown choice' using errcode = '22023';
      end if;
    elsif q ->> 'kind' = 'open' then
      if jsonb_typeof(v_ans) <> 'string' or char_length(v_text) > 5000 then
        raise exception 'An open answer is at most 5,000 characters' using errcode = '22023';
      end if;
    else
      continue;
    end if;
    v_out := v_out || jsonb_build_object(v_id, v_ans);
  end loop;
  return v_out;
end;
$$;

-- Score per dimension: the average (2 decimals) of the scale answers (1 to
-- 5, reverse: 6 minus the answer) and choice answers (option_scores) that
-- count for it. Same as scoreQuestionnaire in src/lib/academy/learn/questionnaire.ts.
create or replace function public.academy_questionnaire_score(p_content jsonb, p_answers jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  q jsonb;
  d jsonb;
  v_key text;
  v_ans jsonb;
  v_val numeric;
  v_sums jsonb := '{}'::jsonb;
  v_dims jsonb := '[]'::jsonb;
  v_sum numeric;
  v_n integer;
begin
  for q in select value from jsonb_array_elements(coalesce(p_content -> 'questions', '[]'::jsonb)) loop
    v_key := nullif(q ->> 'dimension', '');
    v_ans := p_answers -> (q ->> 'id');
    if v_key is null or v_ans is null or jsonb_typeof(v_ans) <> 'number' then
      continue;
    end if;
    v_val := null;
    if q ->> 'kind' = 'scale' then
      v_val := (v_ans #>> '{}')::numeric;
      if coalesce((q ->> 'reverse')::boolean, false) then
        v_val := 6 - v_val;
      end if;
    elsif q ->> 'kind' = 'choice' and jsonb_typeof(q -> 'option_scores' -> ((v_ans #>> '{}')::integer)) = 'number' then
      v_val := (q -> 'option_scores' ->> ((v_ans #>> '{}')::integer))::numeric;
    end if;
    if v_val is null then
      continue;
    end if;
    v_sums := jsonb_set(v_sums, array[v_key], jsonb_build_object(
      'sum', coalesce((v_sums -> v_key ->> 'sum')::numeric, 0) + v_val,
      'n', coalesce((v_sums -> v_key ->> 'n')::integer, 0) + 1
    ));
  end loop;
  for d in select value from jsonb_array_elements(coalesce(p_content -> 'dimensions', '[]'::jsonb)) loop
    v_key := d ->> 'key';
    if v_key is null then
      continue;
    end if;
    v_sum := (v_sums -> v_key ->> 'sum')::numeric;
    v_n := coalesce((v_sums -> v_key ->> 'n')::integer, 0);
    v_dims := v_dims || jsonb_build_array(jsonb_build_object(
      'key', v_key, 'label', coalesce(d ->> 'label', v_key),
      'score', case when v_n > 0 then round(v_sum / v_n, 2) end, 'answered', v_n
    ));
  end loop;
  return jsonb_build_object('dimensions', v_dims);
end;
$$;

-- Give (or give again) or withdraw consent. Withdrawing deletes the answers.
create or replace function public.academy_questionnaire_consent(p_block_id uuid, p_give boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_lesson uuid;
begin
  if v_uid is null or not exists (select 1 from public.academy_members where profile_id = v_uid) then
    raise exception 'Only participants fill in a questionnaire' using errcode = '42501';
  end if;
  select lesson_id into v_lesson from public.academy_lesson_blocks where id = p_block_id and type = 'questionnaire';
  if v_lesson is null then
    raise exception 'Questionnaire not found' using errcode = 'P0002';
  end if;
  if p_give then
    if not public.academy_lesson_open_for(v_lesson, v_uid) then
      raise exception 'This questionnaire is not open for you' using errcode = '42501';
    end if;
    insert into public.academy_questionnaire_consents (profile_id, block_id, consented_at, withdrawn_at)
    values (v_uid, p_block_id, now(), null)
    on conflict (profile_id, block_id) do update set consented_at = now(), withdrawn_at = null;
  else
    update public.academy_questionnaire_consents
    set withdrawn_at = now()
    where profile_id = v_uid and block_id = p_block_id and withdrawn_at is null;
    delete from public.academy_questionnaire_responses where profile_id = v_uid and block_id = p_block_id;
    perform public.academy_refresh_block(p_block_id, v_uid);
  end if;
end;
$$;

-- Save answers (draft) or submit them (scored here). Needs consent; once
-- submitted the answers stay as they are (withdraw consent to delete them).
create or replace function public.academy_save_questionnaire(p_block_id uuid, p_answers jsonb, p_submit boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_block public.academy_lesson_blocks%rowtype;
  v_answers jsonb;
  v_result jsonb := '{}'::jsonb;
begin
  if v_uid is null or not exists (select 1 from public.academy_members where profile_id = v_uid) then
    raise exception 'Only participants fill in a questionnaire' using errcode = '42501';
  end if;
  select * into v_block from public.academy_lesson_blocks where id = p_block_id;
  if not found or v_block.type <> 'questionnaire' or not public.academy_lesson_open_for(v_block.lesson_id, v_uid) then
    raise exception 'This questionnaire is not open for you' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.academy_questionnaire_consents
    where profile_id = v_uid and block_id = p_block_id and withdrawn_at is null
  ) then
    raise exception 'Give your consent first' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.academy_questionnaire_responses
    where profile_id = v_uid and block_id = p_block_id and submitted_at is not null
  ) then
    raise exception 'This questionnaire is already submitted' using errcode = '22023';
  end if;

  v_answers := public.academy_questionnaire_clean(v_block.content, p_answers, p_submit);
  if p_submit then
    v_result := public.academy_questionnaire_score(v_block.content, v_answers);
  end if;

  insert into public.academy_questionnaire_responses (block_id, profile_id, answers, result, submitted_at)
  values (p_block_id, v_uid, v_answers, v_result, case when p_submit then now() end)
  on conflict (block_id, profile_id) do update
    set answers = excluded.answers, result = excluded.result, submitted_at = excluded.submitted_at;

  return jsonb_build_object('submitted', p_submit, 'result', v_result);
end;
$$;

-- questionnaire: submitted, with consent that was not withdrawn.
create or replace function public.academy_block_done_questionnaire(p_block_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.academy_questionnaire_responses r
    join public.academy_questionnaire_consents c
      on c.block_id = r.block_id and c.profile_id = r.profile_id and c.withdrawn_at is null
    where r.block_id = p_block_id and r.profile_id = p_profile_id and r.submitted_at is not null
  );
$$;

-- Access: the person reads their own consent and answers (writes only
-- through the functions above); Academy managers (admins and members with
-- module academy) read and manage all. Never clients, readers or other
-- learners.
drop policy "Admins manage questionnaire consents" on public.academy_questionnaire_consents;
drop policy "Members manage own questionnaire consent" on public.academy_questionnaire_consents;
drop policy "Admins manage questionnaire responses" on public.academy_questionnaire_responses;
drop policy "Members manage own questionnaire responses" on public.academy_questionnaire_responses;

create policy "Academy managers manage questionnaire consents" on public.academy_questionnaire_consents
  for all to authenticated using (public.academy_is_manager()) with check (public.academy_is_manager());
create policy "Members read own questionnaire consent" on public.academy_questionnaire_consents
  for select to authenticated using (profile_id = (select auth.uid()));
create policy "Academy managers manage questionnaire responses" on public.academy_questionnaire_responses
  for all to authenticated using (public.academy_is_manager()) with check (public.academy_is_manager());
create policy "Members read own questionnaire responses" on public.academy_questionnaire_responses
  for select to authenticated using (profile_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 6. For the ATS (scores and summaries, never answers)
-- ---------------------------------------------------------------------------
--
-- For Academy managers and team members with module recruitment. Per ATS
-- candidate (academy_members.candidate_id); p_candidate_id null is everyone.

-- Per candidate per knowledge check: attempts, best and last score in percent.
create or replace function public.academy_candidate_check_scores(p_candidate_id uuid default null)
returns table (
  candidate_id uuid,
  profile_id uuid,
  block_id uuid,
  check_title text,
  lesson_title text,
  attempts integer,
  best_percent integer,
  last_percent integer,
  last_attempt_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select am.candidate_id, am.profile_id, b.id, coalesce(b.title, l.title), l.title,
    count(*)::integer,
    max(a.pct)::integer,
    (array_agg(a.pct order by a.created_at desc))[1]::integer,
    max(a.created_at)
  from public.academy_members am
  join (
    select x.*, case when x.max_score = 0 then 100 else round(x.score * 100.0 / x.max_score) end as pct
    from public.academy_check_attempts x
  ) a on a.profile_id = am.profile_id
  join public.academy_lesson_blocks b on b.id = a.block_id
  join public.academy_lessons l on l.id = b.lesson_id
  where am.candidate_id is not null
    and (p_candidate_id is null or am.candidate_id = p_candidate_id)
    and (public.academy_is_manager() or public.has_module('recruitment'))
  group by am.candidate_id, am.profile_id, b.id, b.title, l.title
  order by am.candidate_id, max(a.created_at) desc;
$$;

-- Per candidate per assignment: the latest attempt with status, AI proposal
-- and Nordavo's final score, and the review page.
create or replace function public.academy_candidate_assignments(p_candidate_id uuid default null)
returns table (
  candidate_id uuid,
  profile_id uuid,
  submission_id uuid,
  block_id uuid,
  assignment_title text,
  lesson_title text,
  attempt integer,
  status text,
  submitted_at timestamptz,
  ai_total integer,
  final_score integer,
  review_path text
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (am.candidate_id, s.block_id)
    am.candidate_id, am.profile_id, s.id, s.block_id, coalesce(b.title, l.title), l.title,
    s.attempt, s.status, s.submitted_at, aa.ai_total, s.final_score,
    '/dashboard/academy/reviews/' || s.id
  from public.academy_members am
  join public.academy_assignment_submissions s on s.profile_id = am.profile_id
  join public.academy_lesson_blocks b on b.id = s.block_id
  join public.academy_lessons l on l.id = b.lesson_id
  left join public.academy_assignment_assessments aa on aa.submission_id = s.id and aa.ai_status = 'ready'
  where am.candidate_id is not null
    and (p_candidate_id is null or am.candidate_id = p_candidate_id)
    and (public.academy_is_manager() or public.has_module('recruitment'))
  order by am.candidate_id, s.block_id, s.attempt desc;
$$;

-- Per candidate per questionnaire: the result summary (dimension scores),
-- only with consent that was not withdrawn. Never the answers.
create or replace function public.academy_candidate_questionnaire_results(p_candidate_id uuid default null)
returns table (
  candidate_id uuid,
  profile_id uuid,
  block_id uuid,
  title text,
  consented_at timestamptz,
  submitted_at timestamptz,
  result jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select am.candidate_id, am.profile_id, r.block_id, coalesce(b.title, l.title), c.consented_at, r.submitted_at, r.result
  from public.academy_members am
  join public.academy_questionnaire_responses r on r.profile_id = am.profile_id and r.submitted_at is not null
  join public.academy_questionnaire_consents c
    on c.profile_id = r.profile_id and c.block_id = r.block_id and c.withdrawn_at is null
  join public.academy_lesson_blocks b on b.id = r.block_id
  join public.academy_lessons l on l.id = b.lesson_id
  where am.candidate_id is not null
    and (p_candidate_id is null or am.candidate_id = p_candidate_id)
    and (public.academy_is_manager() or public.has_module('recruitment'))
  order by am.candidate_id, r.submitted_at desc;
$$;

-- One row per candidate, for talent pool columns (sort and filter).
create or replace function public.academy_candidate_learn_summary(p_candidate_ids uuid[] default null)
returns table (
  candidate_id uuid,
  profile_id uuid,
  checks_done integer,
  check_average_percent integer,
  assignments_submitted integer,
  assignments_approved integer,
  assignment_average_score integer,
  questionnaire_done boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select am.candidate_id, am.profile_id,
    (select count(distinct a.block_id)::integer from public.academy_check_attempts a where a.profile_id = am.profile_id),
    (select round(avg(best))::integer from (
      select max(case when a.max_score = 0 then 100 else a.score * 100.0 / a.max_score end) as best
      from public.academy_check_attempts a where a.profile_id = am.profile_id group by a.block_id
    ) x),
    (select count(distinct s.block_id)::integer from public.academy_assignment_submissions s where s.profile_id = am.profile_id),
    (select count(distinct s.block_id)::integer from public.academy_assignment_submissions s
      where s.profile_id = am.profile_id and s.status = 'approved'),
    (select round(avg(s.final_score))::integer from public.academy_assignment_submissions s
      where s.profile_id = am.profile_id and s.final_score is not null),
    exists (
      select 1 from public.academy_questionnaire_responses r
      join public.academy_questionnaire_consents c on c.profile_id = r.profile_id and c.block_id = r.block_id and c.withdrawn_at is null
      where r.profile_id = am.profile_id and r.submitted_at is not null
    )
  from public.academy_members am
  where am.candidate_id is not null
    and (p_candidate_ids is null or am.candidate_id = any (p_candidate_ids))
    and (public.academy_is_manager() or public.has_module('recruitment'));
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

do $$
declare
  v_fn text;
begin
  -- Internal: other security definer functions, triggers, jobs (service role).
  foreach v_fn in array array[
    'academy_lesson_link(uuid, uuid)', 'academy_clean_rubric(jsonb)',
    'academy_task_instances(uuid, uuid, uuid)', 'academy_block_done_tasks(uuid, uuid)',
    'academy_remind_overdue_tasks()', 'academy_questionnaire_clean(jsonb, jsonb, boolean)',
    'academy_questionnaire_score(jsonb, jsonb)', 'academy_block_done_questionnaire(uuid, uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', v_fn);
    execute format('grant execute on function public.%s to service_role', v_fn);
  end loop;
  -- For the signed in user (each checks access itself).
  foreach v_fn in array array[
    'academy_deadline(date, integer, text)', 'academy_submit_assignment(uuid, text, text, text, text)',
    'academy_review_submission(uuid, text, text, integer, jsonb)',
    'academy_my_tasks(uuid)', 'academy_set_task_done(uuid, uuid, boolean)', 'academy_placement_tasks(uuid)',
    'academy_overdue_tasks()', 'academy_person_tasks(uuid)', 'academy_check_questions_for(uuid)', 'academy_submit_check(uuid, jsonb)',
    'academy_check_results(uuid)', 'academy_questionnaire_consent(uuid, boolean)',
    'academy_save_questionnaire(uuid, jsonb, boolean)', 'academy_candidate_check_scores(uuid)',
    'academy_candidate_assignments(uuid)', 'academy_candidate_questionnaire_results(uuid)',
    'academy_candidate_learn_summary(uuid[])'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', v_fn);
    execute format('grant execute on function public.%s to authenticated, service_role', v_fn);
  end loop;
end $$;
