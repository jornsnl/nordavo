-- Nordavo Academy and the ATS, read model (spec Academy: koppeling met het
-- ATS, Academy naar ATS). Live from the Academy tables, no export: one row
-- per ATS candidate with the results in the developer course, for the
-- candidate card and the talent pool columns (sort and filter in SQL).
-- Background for Nordavo only: nothing here rejects anyone.
--
--   academy_ats_progress(candidate_ids)   aggregates per candidate (internal)
--   academy_ats_pool(...)                 talent pool: filter, sort, page
--   academy_ats_candidate_detail(id)      the card: modules, lessons, checks,
--                                         assignments, videos, certificate
--   academy_person_detail(profile)        the same for any Academy person
--
-- Knowledge check scores and assignment scores are read from the base
-- tables (academy_check_attempts: best attempt per check;
-- academy_assignment_submissions + academy_assignment_assessments: latest
-- attempt per assignment). When the check and assignment builders add
-- summary functions, swap them in inside the CTEs `checks` and `subs`.

-- AI drafts (lesson blocks made from a video transcript, see
-- 20261113320000_academy_ats_manage.sql): hidden from learners until Nordavo
-- accepts them. Kept outside the block content, so editing the block in the
-- editor keeps it a draft.
create table public.academy_block_drafts (
  block_id uuid primary key references public.academy_lesson_blocks (id) on delete cascade,
  -- ai: made by Claude from the transcript; transcript: without AI, the
  -- transcript as a starting point.
  source text not null default 'ai' check (source in ('ai', 'transcript')),
  video_id uuid references public.academy_videos (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.academy_block_drafts enable row level security;
create policy "Academy managers manage block drafts" on public.academy_block_drafts
  for all to authenticated using (public.academy_is_manager()) with check (public.academy_is_manager());

create or replace function public.academy_block_is_draft(p_block_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.academy_block_drafts where block_id = p_block_id);
$$;

revoke execute on function public.academy_block_is_draft(uuid) from public, anon;
grant execute on function public.academy_block_is_draft(uuid) to authenticated, service_role;

-- Restrictive: on top of the existing policies, learners never see a draft
-- block or its tasks. Managers see everything.
create policy "Drafts only for Academy managers" on public.academy_lesson_blocks
  as restrictive for select to authenticated
  using (public.academy_is_manager() or not public.academy_block_is_draft(id));
create policy "Draft tasks only for Academy managers" on public.academy_tasks
  as restrictive for select to authenticated
  using (public.academy_is_manager() or not public.academy_block_is_draft(block_id));

-- Indexes for the aggregates over thousands of people.
create index if not exists academy_check_attempts_profile_idx on public.academy_check_attempts (profile_id, block_id);
create index if not exists academy_assignment_submissions_profile_block_idx on public.academy_assignment_submissions (profile_id, block_id, attempt desc);
create index if not exists academy_module_completions_profile_idx on public.academy_module_completions (profile_id, completed_at);
create index if not exists academy_certificates_course_idx on public.academy_certificates (course_id, profile_id);
create index if not exists academy_lesson_blocks_type_idx on public.academy_lesson_blocks (type, lesson_id);

-- Last moment someone did something in the Academy.
create or replace function public.academy_last_activity(p_profile_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    (select am.last_active_at from public.academy_members am where am.profile_id = p_profile_id),
    (select max(greatest(lp.last_viewed_at, lp.updated_at)) from public.academy_lesson_progress lp where lp.profile_id = p_profile_id),
    (select max(w.updated_at) from public.academy_watch_progress w where w.profile_id = p_profile_id)
  );
$$;

-- Aggregates per candidate in the developer course. p_candidate_ids null:
-- every candidate. Not enrolled candidates get a row with enrolled false.
create or replace function public.academy_ats_progress(p_candidate_ids uuid[] default null)
returns table (
  candidate_id uuid,
  profile_id uuid,
  enrolled boolean,
  academy_role text,
  top_candidate boolean,
  invited_at timestamptz,
  course_id uuid,
  lessons_total integer,
  lessons_done integer,
  progress_percent integer,
  modules_total integer,
  modules_done integer,
  started_at timestamptz,
  completed_at timestamptz,
  lead_time_days integer,
  last_activity_at timestamptz,
  inactive_14d boolean,
  checks_done integer,
  check_avg_percent integer,
  assignments_submitted integer,
  assignments_waiting integer,
  ai_avg_score integer,
  final_avg_score integer,
  videos_total integer,
  watch_avg_percent integer,
  certificate_issued_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with course as (select public.academy_ats_developer_course() as id),
  cand as (
    select c.id, c.top_candidate from public.candidates c
    where p_candidate_ids is null or c.id = any (p_candidate_ids)
  ),
  mem as (
    select am.profile_id, am.candidate_id, am.academy_role, am.invited_at, am.last_active_at, am.created_at
    from public.academy_members am join cand on cand.id = am.candidate_id
  ),
  mods as (
    select m.id from public.academy_modules m, course
    where m.course_id = course.id and m.status = 'published' and public.academy_module_has_lessons(m.id)
  ),
  lessons as (
    select distinct ml.lesson_id
    from public.academy_module_lessons ml
    join public.academy_modules m on m.id = ml.module_id
    join public.academy_lessons l on l.id = ml.lesson_id and l.status = 'published'
    join course on course.id = m.course_id
    where m.status = 'published'
  ),
  blocks as (
    select b.id, b.type, b.video_id from public.academy_lesson_blocks b
    where b.lesson_id in (select lesson_id from lessons)
      and not exists (select 1 from public.academy_block_drafts d where d.block_id = b.id)
  ),
  videos as (select distinct video_id from blocks where type = 'video' and video_id is not null),
  totals as (
    select (select count(*) from lessons)::integer as lessons, (select count(*) from mods)::integer as modules,
      (select count(*) from videos)::integer as videos
  ),
  lp as (
    select lp.profile_id,
      count(*) filter (where lp.completed_at is not null)::integer as done,
      min(lp.started_at) as started,
      max(greatest(lp.last_viewed_at, lp.updated_at)) as last_seen
    from public.academy_lesson_progress lp
    join mem on mem.profile_id = lp.profile_id
    where lp.lesson_id in (select lesson_id from lessons)
    group by lp.profile_id
  ),
  mc as (
    select mc.profile_id, count(*)::integer as done, max(mc.completed_at) as last_done
    from public.academy_module_completions mc
    join mem on mem.profile_id = mc.profile_id
    where mc.module_id in (select id from mods)
    group by mc.profile_id
  ),
  -- Best attempt per check (swap point for the knowledge check builder).
  checks as (
    select x.profile_id, count(*)::integer as done, round(avg(x.best))::integer as avg_percent
    from (
      select a.profile_id, a.block_id,
        max(case when a.max_score = 0 then 100 else a.score * 100.0 / a.max_score end) as best
      from public.academy_check_attempts a
      join mem on mem.profile_id = a.profile_id
      where a.block_id in (select id from blocks where type = 'knowledge_check')
      group by a.profile_id, a.block_id
    ) x
    group by x.profile_id
  ),
  -- Latest attempt per assignment (swap point for the assignment builder).
  subs as (
    select s.profile_id, count(*)::integer as submitted,
      count(*) filter (where s.status = 'submitted' and s.feedback_at is null)::integer as waiting,
      round(avg(aa.ai_total))::integer as ai_avg,
      round(avg(s.final_score))::integer as final_avg
    from (
      select distinct on (s.profile_id, s.block_id) s.*
      from public.academy_assignment_submissions s
      join mem on mem.profile_id = s.profile_id
      where s.block_id in (select id from blocks where type = 'assignment')
      order by s.profile_id, s.block_id, s.attempt desc
    ) s
    left join public.academy_assignment_assessments aa on aa.submission_id = s.id and aa.ai_status = 'ready'
    group by s.profile_id
  ),
  watch as (
    select w.profile_id, sum(w.percent)::integer as total, max(w.updated_at) as last_watch
    from public.academy_watch_progress w
    join mem on mem.profile_id = w.profile_id
    where w.video_id in (select video_id from videos)
    group by w.profile_id
  ),
  cert as (
    select ce.profile_id, ce.issued_at from public.academy_certificates ce, course where ce.course_id = course.id
  ),
  agg as (
    select cand.id as candidate_id, mem.profile_id, mem.profile_id is not null as enrolled, mem.academy_role,
      cand.top_candidate, mem.invited_at, course.id as course_id,
      totals.lessons, coalesce(lp.done, 0) as lessons_done,
      totals.modules, coalesce(mc.done, 0) as modules_done,
      lp.started,
      case
        when cert.issued_at is not null then cert.issued_at
        when totals.modules > 0 and coalesce(mc.done, 0) >= totals.modules then mc.last_done
      end as completed,
      greatest(mem.last_active_at, lp.last_seen, watch.last_watch) as last_activity,
      mem.created_at as member_since,
      checks.done as checks_done, checks.avg_percent as check_avg,
      subs.submitted, subs.waiting, subs.ai_avg, subs.final_avg,
      totals.videos, watch.total as watch_total,
      cert.issued_at as cert_at
    from cand
    cross join course
    cross join totals
    left join mem on mem.candidate_id = cand.id
    left join lp on lp.profile_id = mem.profile_id
    left join mc on mc.profile_id = mem.profile_id
    left join checks on checks.profile_id = mem.profile_id
    left join subs on subs.profile_id = mem.profile_id
    left join watch on watch.profile_id = mem.profile_id
    left join cert on cert.profile_id = mem.profile_id
  )
  select r.candidate_id, r.profile_id, r.enrolled, r.academy_role, r.top_candidate, r.invited_at, r.course_id,
    r.lessons, r.lessons_done,
    case when r.lessons > 0 then least(100, (r.lessons_done * 100) / r.lessons) else 0 end,
    r.modules, r.modules_done,
    r.started, r.completed,
    case when r.started is not null then greatest(0, (extract(epoch from coalesce(r.completed, now()) - r.started) / 86400)::integer) end,
    r.last_activity,
    r.enrolled and r.completed is null and coalesce(r.last_activity, r.member_since) < now() - interval '14 days',
    coalesce(r.checks_done, 0), r.check_avg,
    coalesce(r.submitted, 0), coalesce(r.waiting, 0), r.ai_avg, r.final_avg,
    r.videos,
    case when r.enrolled and r.videos > 0 then (coalesce(r.watch_total, 0) / r.videos) end,
    r.cert_at
  from agg r;
$$;

-- The talent pool with Academy columns. Filters (null = any):
--   p_enrolled     true / false
--   p_state        not_started, in_progress, completed
--   p_inactive     only inactive for 14 days
--   p_certificate  true / false
--   p_top          true / false
--   p_min_progress, p_min_check   at least this percent
--   p_vacancy_id   candidates in the pipeline of this vacancy
--   p_group_id     candidates in this Academy group
--   p_search       name, email, title or skill
-- Sort (p_sort): name, progress, lessons, check, ai, final, watch,
-- last_activity, lead_time, started, certificate. total_count is the number
-- of matches before paging.
create or replace function public.academy_ats_pool(
  p_search text default null,
  p_enrolled boolean default null,
  p_state text default null,
  p_inactive boolean default null,
  p_certificate boolean default null,
  p_top boolean default null,
  p_min_progress integer default null,
  p_min_check integer default null,
  p_vacancy_id uuid default null,
  p_group_id uuid default null,
  p_sort text default 'name',
  p_desc boolean default false,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  candidate_id uuid,
  full_name text,
  email text,
  current_title text,
  location text,
  candidate_status text,
  profile_id uuid,
  enrolled boolean,
  academy_role text,
  top_candidate boolean,
  lessons_total integer,
  lessons_done integer,
  progress_percent integer,
  modules_total integer,
  modules_done integer,
  started_at timestamptz,
  completed_at timestamptz,
  lead_time_days integer,
  last_activity_at timestamptz,
  inactive_14d boolean,
  checks_done integer,
  check_avg_percent integer,
  assignments_submitted integer,
  assignments_waiting integer,
  ai_avg_score integer,
  final_avg_score integer,
  watch_avg_percent integer,
  certificate_issued_at timestamptz,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select c.id, c.full_name, c.email, c.current_title, c.location, c.status, c.skills
    from public.candidates c
    where public.academy_ats_can_read()
      and (
        coalesce(btrim(p_search), '') = ''
        or c.full_name ilike '%' || btrim(p_search) || '%'
        or c.email ilike '%' || btrim(p_search) || '%'
        or c.current_title ilike '%' || btrim(p_search) || '%'
        or exists (select 1 from unnest(c.skills) s where s ilike btrim(p_search))
      )
      and (p_vacancy_id is null or exists (
        select 1 from public.applications a where a.candidate_id = c.id and a.vacancy_id = p_vacancy_id
      ))
      and (p_group_id is null or exists (
        select 1 from public.academy_members am join public.academy_group_members gm on gm.profile_id = am.profile_id
        where am.candidate_id = c.id and gm.group_id = p_group_id
      ))
  ),
  joined as (
    select b.*, p.*
    from base b
    join public.academy_ats_progress(coalesce((select array_agg(id) from base), '{}')) p on p.candidate_id = b.id
  ),
  filtered as (
    select * from joined j
    where (p_enrolled is null or j.enrolled = p_enrolled)
      and (p_state is null
        or (p_state = 'not_started' and j.enrolled and j.started_at is null)
        or (p_state = 'in_progress' and j.started_at is not null and j.completed_at is null)
        or (p_state = 'completed' and j.completed_at is not null))
      and (p_inactive is null or not p_inactive or j.inactive_14d)
      and (p_certificate is null or (j.certificate_issued_at is not null) = p_certificate)
      and (p_top is null or j.top_candidate = p_top)
      and (p_min_progress is null or j.progress_percent >= p_min_progress)
      and (p_min_check is null or coalesce(j.check_avg_percent, -1) >= p_min_check)
  ),
  sorted as (
    select f.*, count(*) over () as total,
      case p_sort
        when 'progress' then f.progress_percent::numeric
        when 'lessons' then f.lessons_done::numeric
        when 'check' then f.check_avg_percent::numeric
        when 'ai' then f.ai_avg_score::numeric
        when 'final' then f.final_avg_score::numeric
        when 'watch' then f.watch_avg_percent::numeric
        when 'last_activity' then extract(epoch from f.last_activity_at)::numeric
        when 'lead_time' then f.lead_time_days::numeric
        when 'started' then extract(epoch from f.started_at)::numeric
        when 'certificate' then extract(epoch from f.certificate_issued_at)::numeric
      end as sort_key
    from filtered f
  )
  select s.id, s.full_name, s.email, s.current_title, s.location, s.status,
    s.profile_id, s.enrolled, s.academy_role, s.top_candidate,
    s.lessons_total, s.lessons_done, s.progress_percent, s.modules_total, s.modules_done,
    s.started_at, s.completed_at, s.lead_time_days, s.last_activity_at, s.inactive_14d,
    s.checks_done, s.check_avg_percent, s.assignments_submitted, s.assignments_waiting,
    s.ai_avg_score, s.final_avg_score, s.watch_avg_percent, s.certificate_issued_at, s.total
  from sorted s
  order by
    case when not p_desc then s.sort_key end asc nulls last,
    case when p_desc then s.sort_key end desc nulls last,
    case when p_sort = 'name' and not p_desc then lower(s.full_name) end asc,
    case when p_sort = 'name' and p_desc then lower(s.full_name) end desc,
    lower(s.full_name), s.id
  limit least(greatest(coalesce(p_limit, 50), 1), 500)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- Everything about one Academy person, as JSON (the card in the ATS, the
-- person page and the overviews). Readers: Academy managers, and for
-- candidates also the recruitment team.
create or replace function public.academy_person_detail(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_member public.academy_members%rowtype;
  v_course uuid := public.academy_ats_developer_course();
begin
  select * into v_member from public.academy_members where profile_id = p_profile_id;
  if not found then
    return null;
  end if;
  if not (public.academy_is_manager() or (public.has_module('recruitment') and v_member.candidate_id is not null)) then
    return null;
  end if;

  return jsonb_build_object(
    'member', jsonb_build_object(
      'profile_id', v_member.profile_id, 'academy_role', v_member.academy_role, 'locale', v_member.locale,
      'start_date', v_member.start_date, 'candidate_id', v_member.candidate_id, 'invited_at', v_member.invited_at,
      'created_at', v_member.created_at, 'last_activity_at', public.academy_last_activity(p_profile_id),
      'email', (select email from public.profiles where id = p_profile_id),
      'full_name', (select full_name from public.profiles where id = p_profile_id)
    ),
    'developer_course_id', v_course,
    'courses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'course_id', c.id, 'title', c.title, 'status', c.status,
        'scope', public.academy_course_scope(c.id, p_profile_id),
        'done', public.academy_course_done(c.id, p_profile_id)
      ) order by c.position)
      from public.academy_courses c
      where public.academy_course_scope(c.id, p_profile_id) is not null
    ), '[]'::jsonb),
    'modules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'module_id', m.id, 'course_id', m.course_id, 'title', m.title, 'position', m.position,
        'status', m.status, 'in_default_access', m.in_default_access,
        'state', public.academy_module_state(m.id, p_profile_id),
        'completed_at', mc.completed_at,
        'open_row', o.module_id is not null, 'force', coalesce(o.force, false)
      ) order by m.course_id, m.position)
      from public.academy_modules m
      left join public.academy_module_completions mc on mc.module_id = m.id and mc.profile_id = p_profile_id
      left join public.academy_open_modules o on o.module_id = m.id and o.profile_id = p_profile_id
      where public.academy_course_scope(m.course_id, p_profile_id) is not null or m.course_id = v_course
    ), '[]'::jsonb),
    'lessons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'lesson_id', l.id, 'title', l.title, 'percent', lp.percent, 'started_at', lp.started_at,
        'last_viewed_at', lp.last_viewed_at, 'completed_at', lp.completed_at
      ) order by lp.completed_at nulls last, lp.started_at)
      from public.academy_lesson_progress lp join public.academy_lessons l on l.id = lp.lesson_id
      where lp.profile_id = p_profile_id
    ), '[]'::jsonb),
    'checks', coalesce((
      select jsonb_agg(x order by x ->> 'last_at' desc)
      from (
        select jsonb_build_object(
          'block_id', b.id, 'title', coalesce(b.title, 'Knowledge check'), 'lesson_title', l.title,
          'attempts', count(*),
          'best_percent', round(max(case when a.max_score = 0 then 100 else a.score * 100.0 / a.max_score end)),
          'last_percent', round((array_agg(case when a.max_score = 0 then 100 else a.score * 100.0 / a.max_score end order by a.created_at desc))[1]),
          'last_at', max(a.created_at)
        ) as x
        from public.academy_check_attempts a
        join public.academy_lesson_blocks b on b.id = a.block_id
        join public.academy_lessons l on l.id = b.lesson_id
        where a.profile_id = p_profile_id
        group by b.id, b.title, l.title
      ) checks
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'submission_id', s.id, 'block_id', s.block_id, 'title', coalesce(b.title, 'Assignment'), 'lesson_id', l.id,
        'lesson_title', l.title, 'attempt', s.attempt, 'status', s.status, 'submitted_at', s.submitted_at,
        'feedback_at', s.feedback_at, 'final_score', s.final_score, 'link_url', s.link_url,
        'file_name', s.file_name, 'ai_total', aa.ai_total, 'ai_status', coalesce(aa.ai_status, 'none')
      ) order by s.submitted_at desc)
      from public.academy_assignment_submissions s
      join public.academy_lesson_blocks b on b.id = s.block_id
      join public.academy_lessons l on l.id = b.lesson_id
      left join public.academy_assignment_assessments aa on aa.submission_id = s.id
      where s.profile_id = p_profile_id
    ), '[]'::jsonb),
    'videos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'video_id', v.id, 'title', v.title, 'percent', coalesce(w.percent, 0), 'completed_at', w.completed_at,
        'updated_at', w.updated_at
      ) order by v.title)
      from public.academy_videos v
      left join public.academy_watch_progress w on w.video_id = v.id and w.profile_id = p_profile_id
      where w.profile_id is not null or v.id in (
        select b.video_id from public.academy_lesson_blocks b
        join public.academy_module_lessons ml on ml.lesson_id = b.lesson_id
        join public.academy_modules m on m.id = ml.module_id
        where b.video_id is not null and m.course_id = v_course and m.status = 'published'
      )
    ), '[]'::jsonb),
    'certificates', coalesce((
      select jsonb_agg(jsonb_build_object('course_id', ce.course_id, 'number', ce.number, 'issued_at', ce.issued_at))
      from public.academy_certificates ce where ce.profile_id = p_profile_id
    ), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('group_id', g.id, 'name', g.name, 'kind', g.kind) order by g.name)
      from public.academy_group_members gm join public.academy_groups g on g.id = gm.group_id
      where gm.profile_id = p_profile_id
    ), '[]'::jsonb)
  );
end;
$$;

-- The card on the candidate page: the summary row, the person (when
-- enrolled) and the latest automation events.
create or replace function public.academy_ats_candidate_detail(p_candidate_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
begin
  if not public.academy_ats_can_read() then
    return null;
  end if;
  select profile_id into v_profile from public.academy_members where candidate_id = p_candidate_id;
  return jsonb_build_object(
    'summary', (select to_jsonb(p) from public.academy_ats_progress(array[p_candidate_id]) p),
    'person', case when v_profile is not null then public.academy_person_detail(v_profile) end,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'kind', e.kind, 'status', e.status, 'created_at', e.created_at,
        'processed_at', e.processed_at, 'error', e.error, 'result', e.result
      ) order by e.created_at desc)
      from (select * from public.academy_ats_events where candidate_id = p_candidate_id order by created_at desc limit 10) e
    ), '[]'::jsonb)
  );
end;
$$;

-- Academy columns for a page of the candidate list (ids from the ATS list).
create or replace function public.academy_ats_columns(p_candidate_ids uuid[])
returns table (
  candidate_id uuid,
  enrolled boolean,
  progress_percent integer,
  check_avg_percent integer,
  inactive_14d boolean,
  certificate boolean,
  top_candidate boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.candidate_id, p.enrolled, p.progress_percent, p.check_avg_percent, p.inactive_14d,
    p.certificate_issued_at is not null, p.top_candidate
  from public.academy_ats_progress(p_candidate_ids) p
  where public.academy_ats_can_read() and cardinality(p_candidate_ids) <= 5000;
$$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array['academy_last_activity(uuid)', 'academy_ats_progress(uuid[])'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', v_fn);
    execute format('grant execute on function public.%s to service_role', v_fn);
  end loop;
  foreach v_fn in array array[
    'academy_ats_pool(text, boolean, text, boolean, boolean, boolean, integer, integer, uuid, uuid, text, boolean, integer, integer)',
    'academy_person_detail(uuid)', 'academy_ats_candidate_detail(uuid)', 'academy_ats_columns(uuid[])'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', v_fn);
    execute format('grant execute on function public.%s to authenticated, service_role', v_fn);
  end loop;
end $$;
