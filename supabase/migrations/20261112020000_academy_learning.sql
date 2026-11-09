-- Nordavo Academy, learning data and the completion engine (spec Academy:
-- datamodel, afrondregels per les en ontgrendeling van modules). Builds on
-- 20261112000000_academy_foundation.sql and 20261112010000_academy_placements.sql.
--
--   1  Learner data per block type: block progress, notes, watch progress,
--      worksheet answers, assignment submissions (+ staff only assessments),
--      tasks and task status, knowledge check questions and attempts,
--      questionnaire consents and responses (personality test)
--   2  Lesson progress, module completions, certificates
--   3  Module states: academy_module_state() (scope, release, requirements,
--      order; completed and started modules stay open)
--   4  Completion engine: academy_block_done() dispatches to
--      academy_block_done_<type>(block, profile); academy_refresh_lesson()
--      recomputes a lesson and records module completion; triggers on the
--      learner tables call it, so a block type only has to write its data
--   5  RPCs for the learner: academy_open_lesson(), academy_record_block_view(),
--      academy_record_watch(), academy_course_outline(), academy_my_courses(),
--      academy_lesson_blocks_state(), academy_people_progress()
--   6  academy_add_person(): Nordavo adds a person (role, course, scope,
--      open modules, start date)
--   7  Row level security and storage

-- ---------------------------------------------------------------------------
-- 1. Learner data
-- ---------------------------------------------------------------------------

-- Generic per block, per person: viewed (explanation, document) and a free
-- state for block types that need little else. Written by
-- academy_record_block_view() and by block type functions.
create table public.academy_block_progress (
  profile_id uuid not null references public.academy_members (profile_id) on delete cascade,
  block_id uuid not null references public.academy_lesson_blocks (id) on delete cascade,
  viewed_at timestamptz,
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (profile_id, block_id)
);

create index on public.academy_block_progress (block_id);

-- Own notes, per lesson or per module (notes block). Never visible to
-- readers or clients.
create table public.academy_notes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.academy_members (profile_id) on delete cascade default auth.uid(),
  lesson_id uuid references public.academy_lessons (id) on delete cascade,
  module_id uuid references public.academy_modules (id) on delete cascade,
  body text not null default '' check (char_length(body) <= 50000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academy_notes_target check ((lesson_id is null) <> (module_id is null))
);

create unique index academy_notes_lesson on public.academy_notes (profile_id, lesson_id) where lesson_id is not null;
create unique index academy_notes_module on public.academy_notes (profile_id, module_id) where module_id is not null;

create trigger academy_notes_set_updated_at before update on public.academy_notes
  for each row execute function public.set_updated_at();

-- Watch progress per video (not per version): replacing the video keeps it.
create table public.academy_watch_progress (
  profile_id uuid not null references public.academy_members (profile_id) on delete cascade,
  video_id uuid not null references public.academy_videos (id) on delete cascade,
  -- The version last watched; position is clamped when the new one is shorter.
  version_id uuid references public.academy_video_versions (id) on delete set null,
  position_seconds numeric(10, 2) not null default 0 check (position_seconds >= 0),
  -- Highest share watched, 0 to 100. Never goes down.
  percent integer not null default 0 check (percent between 0 and 100),
  watched_seconds numeric(12, 2) not null default 0 check (watched_seconds >= 0),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (profile_id, video_id)
);

create index on public.academy_watch_progress (video_id);

-- Fillable worksheet (a document of kind worksheet), per person.
create table public.academy_worksheet_answers (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.academy_documents (id) on delete cascade,
  profile_id uuid not null references public.academy_members (profile_id) on delete cascade default auth.uid(),
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, profile_id)
);

create trigger academy_worksheet_answers_set_updated_at before update on public.academy_worksheet_answers
  for each row execute function public.set_updated_at();

-- Assignment: text, file or link. Nordavo approves or asks for changes.
create table public.academy_assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references public.academy_lesson_blocks (id) on delete cascade,
  profile_id uuid not null references public.academy_members (profile_id) on delete cascade default auth.uid(),
  attempt integer not null default 1 check (attempt >= 1),
  body text check (char_length(body) <= 50000),
  -- Storage bucket attachments, path academy/submission/<profile_id>/<file>.
  file_path text check (char_length(file_path) <= 1000),
  file_name text check (char_length(file_name) <= 300),
  link_url text check (char_length(link_url) <= 2000),
  status text not null default 'submitted' check (status in ('submitted', 'changes_requested', 'approved')),
  feedback text check (char_length(feedback) <= 20000),
  feedback_by uuid references public.profiles (id) on delete set null,
  feedback_at timestamptz,
  -- Nordavo's score (0 to 100). The AI proposal is in academy_assignment_assessments.
  final_score integer check (final_score between 0 and 100),
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (block_id, profile_id, attempt)
);

create index on public.academy_assignment_submissions (status, submitted_at);
create index on public.academy_assignment_submissions (profile_id);

create trigger academy_assignment_submissions_set_updated_at before update on public.academy_assignment_submissions
  for each row execute function public.set_updated_at();

-- Staff only: the AI proposal on the fixed rubric (clarity, proactivity,
-- dares to say no, English). Nordavo always decides itself.
create table public.academy_assignment_assessments (
  submission_id uuid primary key references public.academy_assignment_submissions (id) on delete cascade,
  -- { "clarity": 1-5, "proactivity": 1-5, "says_no": 1-5, "english": 1-5 }
  ai_scores jsonb not null default '{}'::jsonb check (jsonb_typeof(ai_scores) = 'object'),
  ai_total integer check (ai_total between 0 and 100),
  ai_summary text check (char_length(ai_summary) <= 10000),
  ai_status text not null default 'none' check (ai_status in ('none', 'pending', 'ready', 'failed')),
  ai_created_at timestamptz,
  -- Nordavo's own rubric scores, same keys.
  rubric_scores jsonb not null default '{}'::jsonb check (jsonb_typeof(rubric_scores) = 'object'),
  updated_at timestamptz not null default now()
);

create trigger academy_assignment_assessments_set_updated_at before update on public.academy_assignment_assessments
  for each row execute function public.set_updated_at();

-- Tasks of a tasks block.
create table public.academy_tasks (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references public.academy_lesson_blocks (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 500),
  description text check (char_length(description) <= 5000),
  position double precision not null default 0,
  -- Deadline relative to the start date: 0 = day 1, 7 = in week 2 (null: none).
  deadline_offset_days integer check (deadline_offset_days between -365 and 3650),
  -- Shared within a placement: one status per placement (the client ticks
  -- it off, developer and Nordavo see it).
  shared boolean not null default false,
  -- Only with a placement: candidates see it once they are placed.
  placement_only boolean not null default false,
  required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.academy_tasks (block_id, position);

create trigger academy_tasks_set_updated_at before update on public.academy_tasks
  for each row execute function public.set_updated_at();

-- Status per person (profile_id), or per placement for shared tasks
-- (profile_id null). due_at is the real deadline once known.
create table public.academy_task_status (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.academy_tasks (id) on delete cascade,
  profile_id uuid references public.academy_members (profile_id) on delete cascade,
  placement_id uuid references public.placements (id) on delete cascade,
  due_at timestamptz,
  done_at timestamptz,
  done_by uuid references public.profiles (id) on delete set null,
  reminded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academy_task_status_target check (profile_id is not null or placement_id is not null)
);

create unique index academy_task_status_person on public.academy_task_status (task_id, profile_id) where profile_id is not null;
create unique index academy_task_status_shared on public.academy_task_status (task_id, placement_id) where profile_id is null;
create index on public.academy_task_status (placement_id);
create index on public.academy_task_status (due_at) where done_at is null;

create trigger academy_task_status_set_updated_at before update on public.academy_task_status
  for each row execute function public.set_updated_at();

-- Knowledge check: questions (staff only, the learner gets them without the
-- answer through a function) and attempts.
create table public.academy_check_questions (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references public.academy_lesson_blocks (id) on delete cascade,
  position double precision not null default 0,
  question text not null check (char_length(question) between 1 and 2000),
  -- ["option a", "option b", ...]
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  correct_index integer not null default 0 check (correct_index >= 0),
  explanation text check (char_length(explanation) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.academy_check_questions (block_id, position);

create trigger academy_check_questions_set_updated_at before update on public.academy_check_questions
  for each row execute function public.set_updated_at();

create table public.academy_check_attempts (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references public.academy_lesson_blocks (id) on delete cascade,
  profile_id uuid not null references public.academy_members (profile_id) on delete cascade,
  -- { "<question_id>": <chosen index> }
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  score integer not null default 0 check (score >= 0),
  max_score integer not null default 0 check (max_score >= 0),
  created_at timestamptz not null default now()
);

create index on public.academy_check_attempts (block_id, profile_id, created_at desc);

-- Questionnaire (personality test, still to be specified): its own consent
-- and its own access rights (the person and admins only).
create table public.academy_questionnaire_consents (
  profile_id uuid not null references public.academy_members (profile_id) on delete cascade default auth.uid(),
  block_id uuid not null references public.academy_lesson_blocks (id) on delete cascade,
  consented_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  primary key (profile_id, block_id)
);

create table public.academy_questionnaire_responses (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references public.academy_lesson_blocks (id) on delete cascade,
  profile_id uuid not null references public.academy_members (profile_id) on delete cascade default auth.uid(),
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (block_id, profile_id)
);

create trigger academy_questionnaire_responses_set_updated_at before update on public.academy_questionnaire_responses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Progress
-- ---------------------------------------------------------------------------

-- Per lesson, per person. Written only by academy_refresh_lesson() and
-- academy_open_lesson(). completed_at, once set, is never cleared.
create table public.academy_lesson_progress (
  profile_id uuid not null references public.academy_members (profile_id) on delete cascade,
  lesson_id uuid not null references public.academy_lessons (id) on delete cascade,
  started_at timestamptz not null default now(),
  last_viewed_at timestamptz,
  -- Where the person was (the lesson can be in more than one course).
  last_course_id uuid references public.academy_courses (id) on delete set null,
  required_total integer not null default 0,
  required_done integer not null default 0,
  percent integer not null default 0 check (percent between 0 and 100),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (profile_id, lesson_id)
);

create index on public.academy_lesson_progress (lesson_id);
create index on public.academy_lesson_progress (profile_id, last_viewed_at desc);

-- A module is done once all its published lessons are done. Recorded once
-- and kept, also when lessons are added later.
create table public.academy_module_completions (
  profile_id uuid not null references public.academy_members (profile_id) on delete cascade,
  module_id uuid not null references public.academy_modules (id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (profile_id, module_id)
);

create index on public.academy_module_completions (module_id);

-- PDF certificate on name after finishing a course.
create table public.academy_certificates (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.academy_members (profile_id) on delete cascade,
  course_id uuid not null references public.academy_courses (id) on delete cascade,
  -- Shown on the certificate, e.g. NA-2026-000123.
  number text not null unique default ('NA-' || to_char(now(), 'YYYY') || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 8))),
  full_name text not null check (char_length(full_name) between 1 and 200),
  -- Storage bucket attachments, path academy/certificate/<profile_id>/<file>.pdf
  storage_path text check (char_length(storage_path) <= 1000),
  issued_at timestamptz not null default now(),
  unique (profile_id, course_id)
);

-- ---------------------------------------------------------------------------
-- 3. Module states
-- ---------------------------------------------------------------------------

create or replace function public.academy_module_done(p_module_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.academy_module_completions
    where module_id = p_module_id and profile_id = p_profile_id
  );
$$;

-- A published module with at least one published lesson.
create or replace function public.academy_module_has_lessons(p_module_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.academy_module_lessons ml
    join public.academy_lessons l on l.id = ml.lesson_id
    where ml.module_id = p_module_id and l.status = 'published'
  );
$$;

-- The day a module opens for a person (start date + release offset), or
-- null when it has no release offset or the person has no start date.
create or replace function public.academy_module_release_date(p_module_id uuid, p_profile_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select am.start_date + m.release_offset_days
  from public.academy_modules m, public.academy_members am
  where m.id = p_module_id and am.profile_id = p_profile_id and m.release_offset_days is not null;
$$;

-- The state of a module for a person, in this order:
--   null                not visible (draft, no access)
--   completed           done (kept for ever)
--   open                forced open for this person (academy_open_modules.force)
--   locked_scope        outside the person's access (scope default and not
--                       in_default_access, no open module row)
--   open                started before (a lesson has progress): stays open
--   locked_release      release offset after the start date not reached
--                       (also when the person has no start date yet)
--   locked_requirement  a required module is not done
--   locked_order        the previous module in the person's scope (published,
--                       with lessons) is not done
--   open
create or replace function public.academy_module_state(p_module_id uuid, p_profile_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_module public.academy_modules%rowtype;
  v_course_status text;
  v_scope text;
  v_open_row boolean;
  v_force boolean;
  v_start date;
  v_tz text;
  v_prev uuid;
begin
  select m.* into v_module from public.academy_modules m where m.id = p_module_id;
  if not found or v_module.status <> 'published' then
    return null;
  end if;
  select c.status into v_course_status from public.academy_courses c where c.id = v_module.course_id;
  if v_course_status is distinct from 'published' then
    return null;
  end if;
  v_scope := public.academy_course_scope(v_module.course_id, p_profile_id);
  if v_scope is null then
    return null;
  end if;

  if public.academy_module_done(p_module_id, p_profile_id) then
    return 'completed';
  end if;

  select true, o.force into v_open_row, v_force
  from public.academy_open_modules o
  where o.profile_id = p_profile_id and o.module_id = p_module_id;
  if coalesce(v_force, false) then
    return 'open';
  end if;

  if not (v_scope = 'all' or v_module.in_default_access or coalesce(v_open_row, false)) then
    return 'locked_scope';
  end if;

  if exists (
    select 1 from public.academy_lesson_progress lp
    join public.academy_module_lessons ml on ml.lesson_id = lp.lesson_id
    where ml.module_id = p_module_id and lp.profile_id = p_profile_id
  ) then
    return 'open';
  end if;

  if v_module.release_offset_days is not null then
    select am.start_date, coalesce(p.time_zone, 'Europe/Amsterdam') into v_start, v_tz
    from public.academy_members am join public.profiles p on p.id = am.profile_id
    where am.profile_id = p_profile_id;
    if v_start is null or (now() at time zone v_tz)::date < v_start + v_module.release_offset_days then
      return 'locked_release';
    end if;
  end if;

  if exists (
    select 1 from public.academy_module_requirements r
    where r.module_id = p_module_id
      and not public.academy_module_done(r.required_module_id, p_profile_id)
  ) then
    return 'locked_requirement';
  end if;

  if v_module.requires_previous then
    select prev.id into v_prev
    from public.academy_modules prev
    where prev.course_id = v_module.course_id
      and prev.status = 'published'
      and (prev.position, prev.id) < (v_module.position, v_module.id)
      and public.academy_module_has_lessons(prev.id)
      and (
        v_scope = 'all' or prev.in_default_access
        or exists (select 1 from public.academy_open_modules o where o.profile_id = p_profile_id and o.module_id = prev.id)
      )
    order by prev.position desc, prev.id desc
    limit 1;
    if v_prev is not null and not public.academy_module_done(v_prev, p_profile_id) then
      return 'locked_order';
    end if;
  end if;

  return 'open';
end;
$$;

-- May this person open this lesson (published, in an open or completed module)?
create or replace function public.academy_lesson_open_for(p_lesson_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.academy_lessons l
    join public.academy_module_lessons ml on ml.lesson_id = l.id
    where l.id = p_lesson_id and l.status = 'published'
      and public.academy_module_state(ml.module_id, p_profile_id) in ('open', 'completed')
  );
$$;

-- The signed in user may open the lesson; managers always (preview, drafts too).
create or replace function public.academy_can_open_lesson(p_lesson_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.academy_is_manager() or public.academy_lesson_open_for(p_lesson_id, (select auth.uid()));
$$;

-- The signed in user may open the module (managers always).
create or replace function public.academy_can_open_module(p_module_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.academy_is_manager()
    or public.academy_module_state(p_module_id, (select auth.uid())) in ('open', 'completed');
$$;

-- ---------------------------------------------------------------------------
-- 4. Completion engine
-- ---------------------------------------------------------------------------
--
-- Each block type has academy_block_done_<type>(block_id, profile_id). A
-- block type builder replaces only its own function (create or replace) and
-- adds its own table; the dispatcher and lesson refresh stay as they are.
-- The rule config is academy_lesson_blocks.completion (jsonb).

-- explanation: opened (academy_record_block_view).
create or replace function public.academy_block_done_explanation(p_block_id uuid, p_profile_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.academy_block_progress
    where block_id = p_block_id and profile_id = p_profile_id and viewed_at is not null
  );
$$;

-- document: opened or downloaded (academy_record_block_view).
create or replace function public.academy_block_done_document(p_block_id uuid, p_profile_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.academy_block_done_explanation(p_block_id, p_profile_id);
$$;

-- notes: a note that is not empty, on the lesson or (content.scope =
-- 'module') on a module the lesson is in.
create or replace function public.academy_block_done_notes(p_block_id uuid, p_profile_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.academy_lesson_blocks b
    join public.academy_notes n on n.profile_id = p_profile_id and btrim(n.body) <> ''
      and (
        n.lesson_id = b.lesson_id
        or n.module_id in (select ml.module_id from public.academy_module_lessons ml where ml.lesson_id = b.lesson_id)
      )
    where b.id = p_block_id
  );
$$;

-- video: watched at least completion.min_percent (default 90) of the video.
create or replace function public.academy_block_done_video(p_block_id uuid, p_profile_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.academy_lesson_blocks b
    join public.academy_watch_progress w on w.video_id = b.video_id and w.profile_id = p_profile_id
    where b.id = p_block_id
      and w.percent >= coalesce((b.completion ->> 'min_percent')::integer, 90)
  );
$$;

-- worksheet: answers submitted for the block's document.
create or replace function public.academy_block_done_worksheet(p_block_id uuid, p_profile_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.academy_lesson_blocks b
    join public.academy_worksheet_answers a on a.document_id = b.document_id and a.profile_id = p_profile_id
    where b.id = p_block_id and a.submitted_at is not null
  );
$$;

-- assignment: handed in (latest attempt submitted or approved); with
-- completion.require = 'approved' only once Nordavo approved it.
create or replace function public.academy_block_done_assignment(p_block_id uuid, p_profile_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case
      when b.completion ->> 'require' = 'approved' then s.status = 'approved'
      else s.status in ('submitted', 'approved')
    end
    from public.academy_lesson_blocks b
    join public.academy_assignment_submissions s on s.block_id = b.id and s.profile_id = p_profile_id
    where b.id = p_block_id
    order by s.attempt desc
    limit 1
  ), false);
$$;

-- tasks: every required task of the block that applies to the person is
-- done. placement_only tasks apply once the person is in a placement;
-- shared tasks count as done when done for one of their placements.
create or replace function public.academy_block_done_tasks(p_block_id uuid, p_profile_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.academy_tasks t
    where t.block_id = p_block_id and t.required
      and (
        not t.placement_only
        or exists (select 1 from public.academy_placement_members pm where pm.profile_id = p_profile_id)
      )
      and not exists (
        select 1 from public.academy_task_status s
        where s.task_id = t.id and s.done_at is not null
          and (
            (not t.shared and s.profile_id = p_profile_id)
            or (t.shared and s.profile_id is null and s.placement_id in (
              select pm.placement_id from public.academy_placement_members pm where pm.profile_id = p_profile_id
            ))
          )
      )
  );
$$;

-- knowledge_check: an attempt with at least completion.min_percent (default 0).
create or replace function public.academy_block_done_knowledge_check(p_block_id uuid, p_profile_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.academy_lesson_blocks b
    join public.academy_check_attempts a on a.block_id = b.id and a.profile_id = p_profile_id
    where b.id = p_block_id
      and (case when a.max_score = 0 then 100 else a.score * 100 / a.max_score end)
          >= coalesce((b.completion ->> 'min_percent')::integer, 0)
  );
$$;

-- questionnaire: submitted.
create or replace function public.academy_block_done_questionnaire(p_block_id uuid, p_profile_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.academy_questionnaire_responses
    where block_id = p_block_id and profile_id = p_profile_id and submitted_at is not null
  );
$$;

-- Dispatcher: academy_block_done_<type>.
create or replace function public.academy_block_done(p_block_id uuid, p_profile_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_type text;
  v_done boolean;
begin
  select type into v_type from public.academy_lesson_blocks where id = p_block_id;
  if v_type is null then
    return false;
  end if;
  execute format('select public.%I($1, $2)', 'academy_block_done_' || v_type)
    into v_done using p_block_id, p_profile_id;
  return coalesce(v_done, false);
end;
$$;

-- Recompute one lesson for one person: required blocks done, percent, and
-- completed_at (set once, never cleared). A lesson without required blocks
-- is complete once opened. Records module completions. Only for lessons the
-- person may open; returns the progress row (null otherwise).
create or replace function public.academy_refresh_lesson(p_lesson_id uuid, p_profile_id uuid)
returns public.academy_lesson_progress
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer := 0;
  v_done integer := 0;
  v_row public.academy_lesson_progress;
  v_was_completed boolean;
  v_module uuid;
begin
  if not exists (select 1 from public.academy_members where profile_id = p_profile_id)
     or not public.academy_lesson_open_for(p_lesson_id, p_profile_id) then
    return null;
  end if;

  select count(*), count(*) filter (where public.academy_block_done(b.id, p_profile_id))
  into v_total, v_done
  from public.academy_lesson_blocks b
  where b.lesson_id = p_lesson_id and b.required;

  select completed_at is not null into v_was_completed
  from public.academy_lesson_progress where profile_id = p_profile_id and lesson_id = p_lesson_id;

  insert into public.academy_lesson_progress as lp (profile_id, lesson_id, required_total, required_done, percent, completed_at)
  values (
    p_profile_id, p_lesson_id, v_total, v_done,
    case when v_total = 0 or v_done >= v_total then 100 else (v_done * 100) / v_total end,
    case when v_done >= v_total then now() end
  )
  on conflict (profile_id, lesson_id) do update set
    required_total = excluded.required_total,
    required_done = excluded.required_done,
    percent = case when lp.completed_at is not null then 100 else excluded.percent end,
    completed_at = coalesce(lp.completed_at, excluded.completed_at),
    updated_at = now()
  returning * into v_row;

  if v_row.completed_at is not null and not coalesce(v_was_completed, false) then
    for v_module in
      select ml.module_id from public.academy_module_lessons ml where ml.lesson_id = p_lesson_id
    loop
      if public.academy_module_has_lessons(v_module) and not exists (
        select 1 from public.academy_module_lessons ml2
        join public.academy_lessons l on l.id = ml2.lesson_id and l.status = 'published'
        where ml2.module_id = v_module
          and not exists (
            select 1 from public.academy_lesson_progress p
            where p.profile_id = p_profile_id and p.lesson_id = ml2.lesson_id and p.completed_at is not null
          )
      ) then
        insert into public.academy_module_completions (profile_id, module_id)
        values (p_profile_id, v_module)
        on conflict do nothing;
      end if;
    end loop;
  end if;

  return v_row;
end;
$$;

-- All lessons a block belongs to are refreshed for a person.
create or replace function public.academy_refresh_block(p_block_id uuid, p_profile_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select public.academy_refresh_lesson(b.lesson_id, p_profile_id)
  from public.academy_lesson_blocks b where b.id = p_block_id;
$$;

-- A course is done when every published module with lessons is completed.
create or replace function public.academy_course_done(p_course_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.academy_modules m
    where m.course_id = p_course_id and m.status = 'published' and public.academy_module_has_lessons(m.id)
  )
  and not exists (
    select 1 from public.academy_modules m
    where m.course_id = p_course_id and m.status = 'published' and public.academy_module_has_lessons(m.id)
      and not public.academy_module_done(m.id, p_profile_id)
  );
$$;

-- Triggers on the learner tables: refresh the lessons the change touches.
create or replace function public.academy_after_learning_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_profile uuid := (v_row ->> 'profile_id')::uuid;
  v_block uuid;
  v_lesson uuid;
begin
  if tg_table_name in ('academy_block_progress', 'academy_assignment_submissions', 'academy_check_attempts', 'academy_questionnaire_responses') then
    perform public.academy_refresh_block((v_row ->> 'block_id')::uuid, v_profile);
  elsif tg_table_name = 'academy_watch_progress' then
    for v_block in select id from public.academy_lesson_blocks where video_id = (v_row ->> 'video_id')::uuid loop
      perform public.academy_refresh_block(v_block, v_profile);
    end loop;
  elsif tg_table_name = 'academy_worksheet_answers' then
    for v_block in select id from public.academy_lesson_blocks where document_id = (v_row ->> 'document_id')::uuid loop
      perform public.academy_refresh_block(v_block, v_profile);
    end loop;
  elsif tg_table_name = 'academy_notes' then
    for v_lesson in
      select distinct b.lesson_id from public.academy_lesson_blocks b
      where b.type = 'notes' and (
        b.lesson_id = (v_row ->> 'lesson_id')::uuid
        or b.lesson_id in (select ml.lesson_id from public.academy_module_lessons ml where ml.module_id = (v_row ->> 'module_id')::uuid)
      )
    loop
      perform public.academy_refresh_lesson(v_lesson, v_profile);
    end loop;
  elsif tg_table_name = 'academy_task_status' then
    select t.block_id into v_block from public.academy_tasks t where t.id = (v_row ->> 'task_id')::uuid;
    if v_profile is not null then
      perform public.academy_refresh_block(v_block, v_profile);
    else
      for v_profile in
        select pm.profile_id from public.academy_placement_members pm where pm.placement_id = (v_row ->> 'placement_id')::uuid
      loop
        perform public.academy_refresh_block(v_block, v_profile);
      end loop;
    end if;
  end if;
  return null;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'academy_block_progress', 'academy_notes', 'academy_watch_progress', 'academy_worksheet_answers',
    'academy_assignment_submissions', 'academy_task_status', 'academy_check_attempts', 'academy_questionnaire_responses'
  ] loop
    execute format(
      'create trigger %1$s_refresh after insert or update on public.%1$I for each row execute function public.academy_after_learning_change()',
      v_table
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. RPCs for the learner
-- ---------------------------------------------------------------------------

-- Last activity, for "not active for 14 days".
create or replace function public.academy_touch()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.academy_members set last_active_at = now()
  where profile_id = (select auth.uid())
    and (last_active_at is null or last_active_at < now() - interval '5 minutes');
$$;

-- Opening a lesson: records where the person is, refreshes the lesson and
-- returns its progress (percent, required_done, required_total, completed_at).
create or replace function public.academy_open_lesson(p_lesson_id uuid, p_course_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.academy_lesson_progress;
begin
  if not public.academy_lesson_open_for(p_lesson_id, v_uid) then
    if public.academy_is_manager() then
      return null; -- preview: nothing is recorded
    end if;
    raise exception 'This lesson is not open for you' using errcode = '42501';
  end if;
  insert into public.academy_lesson_progress (profile_id, lesson_id, last_viewed_at, last_course_id)
  values (v_uid, p_lesson_id, now(), p_course_id)
  on conflict (profile_id, lesson_id) do update
    set last_viewed_at = now(), last_course_id = coalesce(excluded.last_course_id, academy_lesson_progress.last_course_id);
  perform public.academy_touch();
  v_row := public.academy_refresh_lesson(p_lesson_id, v_uid);
  return to_jsonb(v_row);
end;
$$;

-- A block was viewed (explanation read, document opened or downloaded).
create or replace function public.academy_record_block_view(p_block_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_lesson uuid;
begin
  select lesson_id into v_lesson from public.academy_lesson_blocks where id = p_block_id;
  if v_lesson is null or not public.academy_lesson_open_for(v_lesson, v_uid) then
    if public.academy_is_manager() then
      return;
    end if;
    raise exception 'This lesson is not open for you' using errcode = '42501';
  end if;
  insert into public.academy_block_progress (profile_id, block_id, viewed_at)
  values (v_uid, p_block_id, now())
  on conflict (profile_id, block_id) do update
    set viewed_at = coalesce(academy_block_progress.viewed_at, now()), updated_at = now();
end;
$$;

-- Watch progress from the player. percent only goes up; position is where
-- to continue. Works across video versions (progress is per video).
create or replace function public.academy_record_watch(
  p_video_id uuid,
  p_version_id uuid,
  p_position_seconds numeric,
  p_percent integer,
  p_watched_seconds numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.academy_watch_progress;
begin
  if not exists (
    select 1 from public.academy_lesson_blocks b
    where b.video_id = p_video_id and public.academy_lesson_open_for(b.lesson_id, v_uid)
  ) then
    if public.academy_is_manager() then
      return null;
    end if;
    raise exception 'This video is not open for you' using errcode = '42501';
  end if;
  insert into public.academy_watch_progress as w (profile_id, video_id, version_id, position_seconds, percent, watched_seconds, completed_at)
  values (
    v_uid, p_video_id, p_version_id, greatest(coalesce(p_position_seconds, 0), 0),
    least(greatest(coalesce(p_percent, 0), 0), 100), greatest(coalesce(p_watched_seconds, 0), 0),
    case when coalesce(p_percent, 0) >= 100 then now() end
  )
  on conflict (profile_id, video_id) do update set
    version_id = coalesce(excluded.version_id, w.version_id),
    position_seconds = excluded.position_seconds,
    percent = greatest(w.percent, excluded.percent),
    watched_seconds = w.watched_seconds + excluded.watched_seconds,
    completed_at = coalesce(w.completed_at, excluded.completed_at),
    updated_at = now()
  returning * into v_row;
  perform public.academy_touch();
  return to_jsonb(v_row);
end;
$$;

-- The course outline for the signed in user: every visible module with its
-- state and each lesson with the person's progress. One row per module and
-- lesson (lesson columns null for a module without published lessons).
-- Managers see every module and lesson (drafts too) as open: preview.
create or replace function public.academy_course_outline(p_course_id uuid)
returns table (
  module_id uuid,
  module_title text,
  module_description text,
  module_position double precision,
  module_status text,
  module_state text,
  release_date date,
  is_core boolean,
  required_before_start boolean,
  workbook_document_id uuid,
  lesson_id uuid,
  lesson_title text,
  lesson_summary text,
  lesson_status text,
  lesson_position double precision,
  duration_minutes integer,
  started_at timestamptz,
  last_viewed_at timestamptz,
  percent integer,
  completed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select (select auth.uid()) as uid, public.academy_is_manager() as manager
  ),
  mods as (
    select m.*,
      case
        when me.manager and not public.academy_has_course(m.course_id, me.uid) then 'open'
        else public.academy_module_state(m.id, me.uid)
      end as state
    from public.academy_modules m, me
    where m.course_id = p_course_id
      and (me.manager or exists (select 1 from public.academy_courses c where c.id = m.course_id and c.status = 'published'))
  )
  select m.id, m.title, m.description, m.position, m.status, m.state,
    public.academy_module_release_date(m.id, me.uid),
    m.is_core, m.required_before_start, m.workbook_document_id,
    l.id, l.title, l.summary, l.status, ml.position, l.duration_minutes,
    lp.started_at, lp.last_viewed_at, lp.percent, lp.completed_at
  from mods m
  cross join me
  left join public.academy_module_lessons ml on ml.module_id = m.id
    and exists (select 1 from public.academy_lessons x where x.id = ml.lesson_id and (x.status = 'published' or me.manager))
  left join public.academy_lessons l on l.id = ml.lesson_id
  left join public.academy_lesson_progress lp on lp.lesson_id = l.id and lp.profile_id = me.uid
  where m.state is not null
  order by m.position, m.id, ml.position, l.id;
$$;

-- Courses of the signed in user with progress over the modules in their
-- scope. Managers see every course.
create or replace function public.academy_my_courses()
returns table (
  course_id uuid,
  slug text,
  title text,
  description text,
  language text,
  audience text,
  status text,
  scope text,
  lessons_total integer,
  lessons_done integer,
  last_viewed_at timestamptz,
  completed boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select (select auth.uid()) as uid, public.academy_is_manager() as manager
  ),
  courses as (
    select c.*, public.academy_course_scope(c.id, me.uid) as scope
    from public.academy_courses c, me
    where (c.status = 'published' and public.academy_course_scope(c.id, me.uid) is not null) or me.manager
  ),
  lessons as (
    select distinct c.id as course_id, l.id as lesson_id
    from courses c
    cross join me
    join public.academy_modules m on m.course_id = c.id and m.status = 'published'
    join public.academy_module_lessons ml on ml.module_id = m.id
    join public.academy_lessons l on l.id = ml.lesson_id and l.status = 'published'
    where c.scope is null
       or coalesce(public.academy_module_state(m.id, me.uid), 'locked_scope') <> 'locked_scope'
  )
  select c.id, c.slug, c.title, c.description, c.language, c.audience, c.status, c.scope,
    (select count(*)::integer from lessons x where x.course_id = c.id),
    (select count(*)::integer from lessons x
      join public.academy_lesson_progress lp on lp.lesson_id = x.lesson_id and lp.profile_id = me.uid
      where x.course_id = c.id and lp.completed_at is not null),
    (select max(lp.last_viewed_at) from lessons x
      join public.academy_lesson_progress lp on lp.lesson_id = x.lesson_id and lp.profile_id = me.uid
      where x.course_id = c.id),
    public.academy_course_done(c.id, me.uid)
  from courses c, me
  order by c.position, c.title;
$$;

-- The blocks of a lesson the signed in user may open, with done per block.
create or replace function public.academy_lesson_blocks_state(p_lesson_id uuid)
returns table (block_id uuid, done boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, public.academy_block_done(b.id, (select auth.uid()))
  from public.academy_lesson_blocks b
  where b.lesson_id = p_lesson_id and public.academy_can_open_lesson(p_lesson_id)
  order by b.position, b.id;
$$;

-- Progress and scores (never answers or notes) of the people the signed in
-- user may follow (academy_can_view_progress), per course they have.
create or replace function public.academy_people_progress()
returns table (
  profile_id uuid,
  full_name text,
  academy_role text,
  course_id uuid,
  course_title text,
  lessons_total integer,
  lessons_done integer,
  check_average_percent integer,
  assignments_approved integer,
  last_active_at timestamptz,
  certificate_issued_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with people as (
    select am.profile_id, am.academy_role, am.last_active_at, p.full_name
    from public.academy_members am join public.profiles p on p.id = am.profile_id
    where public.academy_can_view_progress(am.profile_id)
  ),
  pc as (
    select distinct pe.profile_id, c.id as course_id, c.title
    from people pe
    join public.academy_courses c on c.status = 'published'
    where public.academy_course_scope(c.id, pe.profile_id) is not null
  ),
  course_lessons as (
    select distinct m.course_id, ml.lesson_id
    from public.academy_modules m
    join public.academy_module_lessons ml on ml.module_id = m.id
    join public.academy_lessons l on l.id = ml.lesson_id and l.status = 'published'
    where m.status = 'published'
  )
  select pe.profile_id, pe.full_name, pe.academy_role, pc.course_id, pc.title,
    (select count(*)::integer from course_lessons cl where cl.course_id = pc.course_id),
    (select count(*)::integer from course_lessons cl
      join public.academy_lesson_progress lp on lp.lesson_id = cl.lesson_id and lp.profile_id = pe.profile_id
      where cl.course_id = pc.course_id and lp.completed_at is not null),
    (select round(avg(case when a.max_score = 0 then 100 else a.score * 100.0 / a.max_score end))::integer
      from public.academy_check_attempts a
      join public.academy_lesson_blocks b on b.id = a.block_id
      join course_lessons cl on cl.lesson_id = b.lesson_id and cl.course_id = pc.course_id
      where a.profile_id = pe.profile_id),
    (select count(distinct s.block_id)::integer
      from public.academy_assignment_submissions s
      join public.academy_lesson_blocks b on b.id = s.block_id
      join course_lessons cl on cl.lesson_id = b.lesson_id and cl.course_id = pc.course_id
      where s.profile_id = pe.profile_id and s.status = 'approved'),
    pe.last_active_at,
    (select ce.issued_at from public.academy_certificates ce where ce.profile_id = pe.profile_id and ce.course_id = pc.course_id)
  from people pe
  join pc on pc.profile_id = pe.profile_id
  order by pe.full_name, pc.title;
$$;

-- ---------------------------------------------------------------------------
-- 6. Adding people
-- ---------------------------------------------------------------------------

-- Nordavo adds a person to the Academy (the auth account is made by the app
-- with the secret key, see src/lib/academy/people.ts). Sets the profile role
-- (client users stay client, candidates and developers get their own role,
-- team members keep theirs), the Academy row, course access and open modules.
-- Re-running it updates the person. Managers only.
create or replace function public.academy_add_person(
  p_profile_id uuid,
  p_academy_role text,
  p_locale text default null,
  p_start_date date default null,
  p_client_id uuid default null,
  p_candidate_id uuid default null,
  p_course_id uuid default null,
  p_scope text default 'all',
  p_open_module_ids uuid[] default '{}',
  -- profiles.time_zone (Europe/Amsterdam, Asia/Kolkata); null keeps it.
  p_time_zone text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_new_role text;
  v_module uuid;
begin
  if not public.academy_is_manager() then
    raise exception 'Only Nordavo adds people to the Academy' using errcode = '42501';
  end if;
  if p_academy_role not in ('client_admin', 'client_member', 'client_reader', 'developer', 'candidate') then
    raise exception 'Unknown Academy role';
  end if;
  if p_scope not in ('all', 'default') then
    raise exception 'Unknown access scope';
  end if;

  select role into v_role from public.profiles where id = p_profile_id;
  if v_role is null then
    raise exception 'User not found';
  end if;

  v_new_role := case when p_academy_role like 'client_%' then 'client' else p_academy_role end;
  if v_new_role = 'client' and p_client_id is null then
    raise exception 'A client user must be linked to a client';
  end if;

  if v_role in ('admin', 'member') then
    null; -- the Nordavo team keeps its role (and sees the Academy as manager)
  elsif v_role = 'caller' then
    raise exception 'This account is an external caller';
  elsif v_role = 'client' and v_new_role <> 'client' then
    raise exception 'This account is a client user';
  elsif v_role in ('developer', 'candidate') and v_new_role = 'client' then
    raise exception 'This account is a developer or candidate';
  else
    -- external, candidate, developer or client: set the role. A developer is
    -- never turned back into a candidate.
    if not (v_role = 'developer' and v_new_role = 'candidate') then
      update public.profiles
      set role = v_new_role,
          client_id = case when v_new_role = 'client' then p_client_id else null end,
          modules = '{}'
      where id = p_profile_id;
    end if;
  end if;

  insert into public.academy_members (profile_id, academy_role, locale, start_date, candidate_id, invited_at, invited_by)
  values (
    p_profile_id, p_academy_role,
    coalesce(p_locale, case when p_academy_role like 'client_%' then 'nl' else 'en' end),
    p_start_date, p_candidate_id, now(), (select auth.uid())
  )
  on conflict (profile_id) do update set
    academy_role = case
      when academy_members.academy_role = 'developer' and excluded.academy_role = 'candidate' then 'developer'
      else excluded.academy_role
    end,
    locale = coalesce(p_locale, academy_members.locale),
    start_date = coalesce(excluded.start_date, academy_members.start_date),
    candidate_id = coalesce(excluded.candidate_id, academy_members.candidate_id),
    invited_at = now(),
    invited_by = excluded.invited_by;

  if p_time_zone is not null and v_role not in ('admin', 'member') then
    update public.profiles set time_zone = p_time_zone where id = p_profile_id;
  end if;

  if p_course_id is not null then
    insert into public.academy_course_access (course_id, profile_id, scope)
    values (p_course_id, p_profile_id, p_scope)
    on conflict (course_id, profile_id) where profile_id is not null do update
      set scope = case when academy_course_access.scope = 'all' then 'all' else excluded.scope end;

    foreach v_module in array coalesce(p_open_module_ids, '{}') loop
      if not exists (select 1 from public.academy_modules where id = v_module and course_id = p_course_id) then
        raise exception 'Module is not part of this course';
      end if;
      insert into public.academy_open_modules (profile_id, module_id)
      values (p_profile_id, v_module)
      on conflict do nothing;
    end loop;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants on the functions
-- ---------------------------------------------------------------------------

do $$
declare
  v_fn text;
begin
  -- Internal: other security definer functions, triggers and the service role.
  foreach v_fn in array array[
    'academy_module_done(uuid, uuid)', 'academy_module_has_lessons(uuid)',
    'academy_module_release_date(uuid, uuid)', 'academy_module_state(uuid, uuid)',
    'academy_lesson_open_for(uuid, uuid)', 'academy_block_done(uuid, uuid)',
    'academy_block_done_explanation(uuid, uuid)', 'academy_block_done_document(uuid, uuid)',
    'academy_block_done_notes(uuid, uuid)', 'academy_block_done_video(uuid, uuid)',
    'academy_block_done_worksheet(uuid, uuid)', 'academy_block_done_assignment(uuid, uuid)',
    'academy_block_done_tasks(uuid, uuid)', 'academy_block_done_knowledge_check(uuid, uuid)',
    'academy_block_done_questionnaire(uuid, uuid)', 'academy_refresh_lesson(uuid, uuid)',
    'academy_refresh_block(uuid, uuid)', 'academy_course_done(uuid, uuid)',
    'academy_after_learning_change()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', v_fn);
    execute format('grant execute on function public.%s to service_role', v_fn);
  end loop;
  -- For the signed in user.
  foreach v_fn in array array[
    'academy_can_open_lesson(uuid)', 'academy_can_open_module(uuid)', 'academy_touch()', 'academy_open_lesson(uuid, uuid)',
    'academy_record_block_view(uuid)', 'academy_record_watch(uuid, uuid, numeric, integer, numeric)',
    'academy_course_outline(uuid)', 'academy_my_courses()', 'academy_lesson_blocks_state(uuid)',
    'academy_people_progress()', 'academy_add_person(uuid, text, text, date, uuid, uuid, uuid, text, uuid[], text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', v_fn);
    execute format('grant execute on function public.%s to authenticated, service_role', v_fn);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Row level security
-- ---------------------------------------------------------------------------

-- Media and documents the signed in user may see.
create or replace function public.academy_can_see_video(p_video_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.academy_is_manager() or exists (
    select 1 from public.academy_lesson_blocks b
    where b.video_id = p_video_id and public.academy_lesson_open_for(b.lesson_id, (select auth.uid()))
  );
$$;

create or replace function public.academy_can_see_document(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.academy_is_manager() or exists (
    select 1 from public.academy_documents d
    where d.id = p_document_id and (
      (d.scope = 'placement' and public.academy_placement_role(d.placement_id) is not null)
      or (d.scope = 'global' and (
        exists (
          select 1 from public.academy_lesson_blocks b
          where b.document_id = d.id and public.academy_lesson_open_for(b.lesson_id, (select auth.uid()))
        )
        or exists (
          select 1 from public.academy_modules m
          where m.workbook_document_id = d.id
            and public.academy_module_state(m.id, (select auth.uid())) in ('open', 'completed')
        )
      ))
    )
  );
$$;

-- Storage paths academy/<kind>/<id>/<file>.
create or replace function public.academy_can_read_file(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select split_part(p_path, '/', 1) = 'academy' and (
    public.academy_is_manager()
    or case split_part(p_path, '/', 2)
      when 'video' then public.academy_can_see_video(nullif(split_part(p_path, '/', 3), '')::uuid)
      when 'document' then public.academy_can_see_document(nullif(split_part(p_path, '/', 3), '')::uuid)
      when 'submission' then split_part(p_path, '/', 3) = (select auth.uid())::text
      when 'certificate' then public.academy_can_view_progress(nullif(split_part(p_path, '/', 3), '')::uuid)
      else false
    end
  );
$$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array['academy_can_see_video(uuid)', 'academy_can_see_document(uuid)', 'academy_can_read_file(text)'] loop
    execute format('revoke execute on function public.%s from public, anon', v_fn);
    execute format('grant execute on function public.%s to authenticated, service_role', v_fn);
  end loop;
end $$;

-- Academy files are for Academy managers, not for every team member.
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
    when p_entity_type = 'academy' then public.has_module('academy')
    else public.is_staff()
  end;
$$;

create policy "Academy participants read their files" on storage.objects
  for select to authenticated using (bucket_id = 'attachments' and public.academy_can_read_file(name));
create policy "Academy participants upload own submissions" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'attachments'
    and split_part(name, '/', 1) = 'academy' and split_part(name, '/', 2) = 'submission'
    and split_part(name, '/', 3) = (select auth.uid())::text
    and exists (select 1 from public.academy_members where profile_id = (select auth.uid()))
  );

-- Content: block content once the lesson is open; media and documents
-- through the blocks and workbooks that use them.
create policy "Members read open lesson blocks" on public.academy_lesson_blocks
  for select to authenticated using (public.academy_can_open_lesson(lesson_id));
create policy "Members read open videos" on public.academy_videos
  for select to authenticated using (public.academy_can_see_video(id));
create policy "Members read open video versions" on public.academy_video_versions
  for select to authenticated using (public.academy_can_see_video(video_id));
create policy "Members read their documents" on public.academy_documents
  for select to authenticated using (public.academy_can_see_document(id));
create policy "Members read their document versions" on public.academy_document_versions
  for select to authenticated using (public.academy_can_see_document(document_id));

alter table public.academy_block_progress enable row level security;
alter table public.academy_notes enable row level security;
alter table public.academy_watch_progress enable row level security;
alter table public.academy_worksheet_answers enable row level security;
alter table public.academy_assignment_submissions enable row level security;
alter table public.academy_assignment_assessments enable row level security;
alter table public.academy_tasks enable row level security;
alter table public.academy_task_status enable row level security;
alter table public.academy_check_questions enable row level security;
alter table public.academy_check_attempts enable row level security;
alter table public.academy_questionnaire_consents enable row level security;
alter table public.academy_questionnaire_responses enable row level security;
alter table public.academy_lesson_progress enable row level security;
alter table public.academy_module_completions enable row level security;
alter table public.academy_certificates enable row level security;

-- Managers manage everything, except the questionnaire (admins only, below).
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'academy_block_progress', 'academy_notes', 'academy_watch_progress', 'academy_worksheet_answers',
    'academy_assignment_submissions', 'academy_assignment_assessments', 'academy_tasks',
    'academy_task_status', 'academy_check_questions', 'academy_check_attempts',
    'academy_lesson_progress', 'academy_module_completions', 'academy_certificates'
  ] loop
    execute format(
      'create policy "Academy managers manage %1$s" on public.%1$I for all to authenticated using (public.academy_is_manager()) with check (public.academy_is_manager())',
      v_table
    );
  end loop;
end $$;

-- Progress and scores: the person and whoever may follow them.
create policy "Progress readers read lesson progress" on public.academy_lesson_progress
  for select to authenticated using (public.academy_can_view_progress(profile_id));
create policy "Progress readers read module completions" on public.academy_module_completions
  for select to authenticated using (public.academy_can_view_progress(profile_id));
create policy "Progress readers read certificates" on public.academy_certificates
  for select to authenticated using (public.academy_can_view_progress(profile_id));
create policy "Progress readers read watch progress" on public.academy_watch_progress
  for select to authenticated using (public.academy_can_view_progress(profile_id));

-- Own only (written through functions).
create policy "Members read own block progress" on public.academy_block_progress
  for select to authenticated using (profile_id = (select auth.uid()));

-- Notes: own, autosaved; never for readers or clients.
create policy "Members manage own notes" on public.academy_notes
  for all to authenticated
  using (profile_id = (select auth.uid()))
  with check (
    profile_id = (select auth.uid())
    and (
      (lesson_id is not null and public.academy_can_open_lesson(lesson_id))
      or (module_id is not null and public.academy_can_open_module(module_id))
    )
  );

-- Worksheets: own answers on documents they may see.
create policy "Members manage own worksheet answers" on public.academy_worksheet_answers
  for all to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()) and public.academy_can_see_document(document_id));

-- Assignments: own submissions; status, feedback and score are Nordavo's
-- (guard trigger below).
create policy "Members read own submissions" on public.academy_assignment_submissions
  for select to authenticated using (profile_id = (select auth.uid()));
create policy "Members hand in assignments" on public.academy_assignment_submissions
  for insert to authenticated with check (
    profile_id = (select auth.uid())
    and status = 'submitted' and feedback is null and feedback_by is null and final_score is null
    and exists (
      select 1 from public.academy_lesson_blocks b
      where b.id = block_id and b.type = 'assignment' and public.academy_can_open_lesson(b.lesson_id)
    )
  );
create policy "Members edit own open submissions" on public.academy_assignment_submissions
  for update to authenticated
  using (profile_id = (select auth.uid()) and status in ('submitted', 'changes_requested'))
  with check (profile_id = (select auth.uid()));

create or replace function public.academy_submissions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.academy_is_manager() or (select auth.uid()) is null then
    return new;
  end if;
  if new.feedback is distinct from old.feedback or new.feedback_by is distinct from old.feedback_by
     or new.feedback_at is distinct from old.feedback_at or new.final_score is distinct from old.final_score
     or new.block_id is distinct from old.block_id or new.attempt is distinct from old.attempt
     or new.status not in ('submitted') then
    raise exception 'Only Nordavo reviews assignments' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.academy_submissions_guard() from public, anon, authenticated;

create trigger academy_submissions_guard before update on public.academy_assignment_submissions
  for each row execute function public.academy_submissions_guard();

-- Tasks: definitions of open lessons, and shared tasks of own placements.
-- The checks go through security definer helpers, so the policies of
-- academy_tasks and academy_task_status do not query each other.
create or replace function public.academy_task_open(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.academy_tasks t
    join public.academy_lesson_blocks b on b.id = t.block_id
    where t.id = p_task_id
      and public.academy_can_open_lesson(b.lesson_id)
      -- Placement-only tasks appear once the person is in a placement.
      and (not t.placement_only or exists (
        select 1 from public.academy_placement_members pm where pm.profile_id = (select auth.uid())
      ))
  )
  or exists (
    select 1 from public.academy_tasks t
    join public.academy_task_status s on s.task_id = t.id
    where t.id = p_task_id and t.shared and s.placement_id is not null
      and public.academy_placement_role(s.placement_id) is not null
  );
$$;

-- May the signed in user tick off this task: own (personal task of an open
-- lesson) or shared (client admin, client member or developer of the placement).
create or replace function public.academy_task_can_tick(p_task_id uuid, p_profile_id uuid, p_placement_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_profile_id is not null then
      p_profile_id = (select auth.uid())
      and exists (
        select 1 from public.academy_tasks t join public.academy_lesson_blocks b on b.id = t.block_id
        where t.id = p_task_id and not t.shared and public.academy_can_open_lesson(b.lesson_id)
      )
    else
      p_placement_id is not null
      and public.academy_placement_role(p_placement_id) in ('client_admin', 'client_member', 'developer')
      and exists (select 1 from public.academy_tasks t where t.id = p_task_id and t.shared)
  end;
$$;

revoke execute on function public.academy_task_open(uuid) from public, anon;
grant execute on function public.academy_task_open(uuid) to authenticated, service_role;
revoke execute on function public.academy_task_can_tick(uuid, uuid, uuid) from public, anon;
grant execute on function public.academy_task_can_tick(uuid, uuid, uuid) to authenticated, service_role;

create policy "Members read tasks" on public.academy_tasks
  for select to authenticated using (public.academy_task_open(id));

-- Task status: own rows, rows of own placements (all three sides see them),
-- and rows of people whose progress one may follow.
create policy "Members read task status" on public.academy_task_status
  for select to authenticated using (
    profile_id = (select auth.uid())
    or (placement_id is not null and public.academy_placement_role(placement_id) is not null)
    or (profile_id is not null and public.academy_can_view_progress(profile_id))
  );
create policy "Members tick off tasks" on public.academy_task_status
  for insert to authenticated with check (public.academy_task_can_tick(task_id, profile_id, placement_id));
create policy "Members update ticked tasks" on public.academy_task_status
  for update to authenticated
  using (public.academy_task_can_tick(task_id, profile_id, placement_id))
  with check (public.academy_task_can_tick(task_id, profile_id, placement_id));

-- Knowledge checks: questions (with the answer) are staff only; attempts
-- are the person's own. Scores reach readers through academy_people_progress().
create policy "Members read own check attempts" on public.academy_check_attempts
  for select to authenticated using (profile_id = (select auth.uid()));

-- Questionnaire (personality test): the person and admins only.
create policy "Admins manage questionnaire consents" on public.academy_questionnaire_consents
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Members manage own questionnaire consent" on public.academy_questionnaire_consents
  for all to authenticated
  using (profile_id = (select auth.uid()))
  with check (
    profile_id = (select auth.uid())
    and exists (
      select 1 from public.academy_lesson_blocks b
      where b.id = block_id and b.type = 'questionnaire' and public.academy_can_open_lesson(b.lesson_id)
    )
  );
create policy "Admins manage questionnaire responses" on public.academy_questionnaire_responses
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Members manage own questionnaire responses" on public.academy_questionnaire_responses
  for all to authenticated
  using (profile_id = (select auth.uid()))
  with check (
    profile_id = (select auth.uid())
    and exists (
      select 1 from public.academy_questionnaire_consents c
      where c.block_id = academy_questionnaire_responses.block_id and c.profile_id = (select auth.uid()) and c.withdrawn_at is null
    )
  );
