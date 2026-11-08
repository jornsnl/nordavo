-- Recruitment pipeline (recruitment brief of 2026-11-08, sections 2.1 to
-- 2.4, 2.12 and 2.13). Builds on 20261108000000_recruitment_foundation.sql.
--
-- 1. Assessment per application (video review by, screening call with years
--    per tool, interview, technical test result). Staff only.
-- 2. Old scores stay in sync: technical_score follows the test score,
--    english_score follows the video score (the client portal shows both).
-- 3. Toppers: a mark on the candidate that stays across vacancies.
-- 4. Parking candidates and vacancies by hand: parked_at kept by a trigger.
-- 5. Notes on an application record the stage they were written in.
-- 6. move_applications_as(): the MCP server (secret key) moves candidates in
--    the name of the token owner, so checks and history stay the same.

-- ---------------------------------------------------------------------------
-- 1. Assessment
-- ---------------------------------------------------------------------------

-- Screening tools: [{"tool": "Clay", "years": 2}, ...], at most 30 entries,
-- tool 1 to 60 characters, years 0 to 50 (halves allowed).
create or replace function public.valid_screening_tools(p_tools jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_tools is null or jsonb_typeof(p_tools) <> 'array' then false
    when jsonb_array_length(p_tools) > 30 then false
    else not exists (
      select 1
      from jsonb_array_elements(p_tools) e
      where case
          when jsonb_typeof(e) <> 'object' then true
          when jsonb_typeof(e -> 'tool') is distinct from 'string' then true
          when jsonb_typeof(e -> 'years') is distinct from 'number' then true
          when (select count(*) from jsonb_object_keys(e)) <> 2 then true
          else char_length(trim(e ->> 'tool')) not between 1 and 60
            or (e ->> 'years')::numeric not between 0 and 50
        end
    )
  end;
$$;

create table public.application_assessments (
  application_id uuid primary key references public.applications (id) on delete cascade,

  -- Video review (score and notes live on applications.video_score/video_notes).
  video_reviewed_by uuid references public.profiles (id) on delete set null,
  video_reviewed_at timestamptz,

  -- Screening call: years of experience per tool, communication.
  screening_tools jsonb not null default '[]' check (public.valid_screening_tools(screening_tools)),
  screening_communication_score integer check (screening_communication_score between 0 and 100),
  screening_notes text check (char_length(screening_notes) <= 5000),
  screened_by uuid references public.profiles (id) on delete set null,
  screened_at timestamptz,

  -- Interview with a technical recruiter (Judith, Floris or someone else).
  interview_rating integer check (interview_rating between 1 and 5),
  interview_communication_feedback text check (char_length(interview_communication_feedback) <= 5000),
  interview_linkedin_feedback text check (char_length(interview_linkedin_feedback) <= 5000),
  interviewer_id uuid references public.profiles (id) on delete set null,
  -- An interviewer outside the team (an external technical recruiter).
  interviewer_name text check (char_length(interviewer_name) <= 200),
  interviewed_at timestamptz,

  -- Technical test, done in other software; only the result is kept here.
  test_score integer check (test_score between 0 and 100),
  test_notes text check (char_length(test_notes) <= 5000),
  test_url text check (char_length(test_url) <= 2000 and test_url ~* '^https?://'),
  test_completed_at timestamptz,

  updated_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger application_assessments_set_updated_at before update on public.application_assessments
  for each row execute function public.set_updated_at();

alter table public.application_assessments enable row level security;
-- Staff only: clients never see assessments, not even for presented candidates.
create policy "Staff manage assessments" on public.application_assessments
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

comment on table public.application_assessments is 'Structured assessment of one application (2.12): screening call, interview, technical test result. Staff only.';
comment on column public.application_assessments.screening_tools is 'Years of experience per tool from the screening call, e.g. [{"tool":"Clay","years":2}].';

-- ---------------------------------------------------------------------------
-- 2. Old scores in sync
-- ---------------------------------------------------------------------------
--
-- technical_score (shown in the client portal) follows the test result,
-- english_score follows the video review score. Existing values are carried
-- over once: technical_score becomes the test score, english_score the video
-- score, where those are still empty.

insert into public.application_assessments (application_id, test_score, updated_by)
select id, technical_score, null from public.applications where technical_score is not null
on conflict (application_id) do nothing;

update public.applications set video_score = english_score
where video_score is null and english_score is not null;

create or replace function public.application_assessments_sync_scores()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.test_score is distinct from old.test_score then
    update public.applications
    set technical_score = new.test_score
    where id = new.application_id and technical_score is distinct from new.test_score;
  end if;
  return null;
end;
$$;

create trigger application_assessments_sync_scores after insert or update of test_score on public.application_assessments
  for each row execute function public.application_assessments_sync_scores();

create or replace function public.applications_sync_english_score()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.video_score is distinct from old.video_score then
    new.english_score := new.video_score;
  end if;
  return new;
end;
$$;

create trigger applications_sync_english_score before insert or update of video_score on public.applications
  for each row execute function public.applications_sync_english_score();

-- ---------------------------------------------------------------------------
-- 3. Toppers
-- ---------------------------------------------------------------------------

alter table public.candidates
  add column is_topper boolean not null default false,
  add column topper_reason text check (char_length(topper_reason) <= 1000),
  add column topper_by uuid references public.profiles (id) on delete set null,
  add column topper_at timestamptz,
  add constraint candidates_topper_reason check (not is_topper or char_length(trim(coalesce(topper_reason, ''))) > 0);

create index candidates_is_topper_idx on public.candidates (is_topper) where is_topper;

-- Who and when come from the database: the signed in user (or, for the MCP
-- server, the topper_by it passes), now. Unmarking clears the mark.
create or replace function public.candidates_track_topper()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_topper then
    if tg_op = 'INSERT' or not old.is_topper then
      new.topper_at := now();
      new.topper_by := coalesce((select auth.uid()), new.topper_by);
    elsif new.topper_reason is distinct from old.topper_reason then
      new.topper_at := old.topper_at;
      new.topper_by := coalesce((select auth.uid()), new.topper_by, old.topper_by);
    else
      new.topper_at := old.topper_at;
      new.topper_by := old.topper_by;
    end if;
  else
    new.topper_reason := null;
    new.topper_by := null;
    new.topper_at := null;
  end if;
  return new;
end;
$$;

create trigger candidates_track_topper before insert or update of is_topper, topper_reason, topper_by, topper_at on public.candidates
  for each row execute function public.candidates_track_topper();

comment on column public.candidates.is_topper is 'Topper (2.13): someone we really trust after all reviews. Stays on the candidate across vacancies.';

-- ---------------------------------------------------------------------------
-- 4. Parking by hand: candidates and vacancies
-- ---------------------------------------------------------------------------

create or replace function public.candidates_track_park()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'parked' then
    if tg_op = 'INSERT' or old.status <> 'parked' then
      new.parked_at := now();
    end if;
  else
    new.parked_at := null;
    new.park_reason := null;
  end if;
  return new;
end;
$$;

create trigger candidates_track_park before insert or update of status on public.candidates
  for each row execute function public.candidates_track_park();

-- Vacancies: on_hold is shown as Parked.
create or replace function public.vacancies_track_park()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'on_hold' then
    if tg_op = 'INSERT' or old.status <> 'on_hold' then
      new.parked_at := now();
    end if;
  else
    new.parked_at := null;
    new.park_reason := null;
  end if;
  return new;
end;
$$;

create trigger vacancies_track_park before insert or update of status on public.vacancies
  for each row execute function public.vacancies_track_park();

-- ---------------------------------------------------------------------------
-- 5. Notes on an application record their stage
-- ---------------------------------------------------------------------------

create or replace function public.notes_set_stage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.entity_type = 'application' and new.stage is null then
    select a.stage into new.stage from public.applications a where a.id = new.entity_id;
  end if;
  return new;
end;
$$;

create trigger notes_set_stage before insert on public.notes
  for each row execute function public.notes_set_stage();

create index notes_application_stage_idx on public.notes (entity_id, stage) where entity_type = 'application';

-- ---------------------------------------------------------------------------
-- 6. Moves by the MCP server
-- ---------------------------------------------------------------------------
--
-- The MCP server talks to the database with the secret key, so auth.uid()
-- is empty and move_applications() would refuse. This wrapper is for the
-- service role only: it acts as p_actor for the length of the call, so
-- move_applications() checks that p_actor is staff and the stage history
-- records p_actor as the one who moved.

create or replace function public.move_applications_as(
  p_actor uuid,
  p_application_ids uuid[],
  p_stage text,
  p_reason text default null,
  p_park_until date default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('request.jwt.claims', true);
  v_count integer;
begin
  if p_actor is null then
    raise exception 'An actor is required';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  v_count := public.move_applications(p_application_ids, p_stage, p_reason, p_park_until);
  perform set_config('request.jwt.claims', coalesce(v_previous, ''), true);
  return v_count;
end;
$$;

revoke execute on function public.move_applications_as(uuid, uuid[], text, text, date) from public, anon, authenticated;
grant execute on function public.move_applications_as(uuid, uuid[], text, text, date) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Client file policy: look up the attachment kind past RLS
-- ---------------------------------------------------------------------------
--
-- The foundation policy checked "no attachment record of another kind than
-- cv" with a subquery on public.attachments. That subquery runs with the
-- client's rights, and clients cannot read attachments at all, so it never
-- found the record and a client could open a background check or payslip
-- in the candidate folder. The kind is now looked up by a narrow security
-- definer function.

create or replace function public.is_restricted_attachment(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.attachments f
    where f.storage_path = p_path and f.kind <> 'cv'
  );
$$;

revoke execute on function public.is_restricted_attachment(text) from public, anon;
grant execute on function public.is_restricted_attachment(text) to authenticated;

drop policy "Clients read presented candidate files" on storage.objects;
create policy "Clients read presented candidate files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'candidate'
    and not public.is_restricted_attachment(name)
    and exists (
      select 1
      from public.applications a
      join public.vacancies v on v.id = a.vacancy_id
      where a.candidate_id::text = (storage.foldername(name))[2]
        and public.is_presented_stage(a.stage)
        and v.client_id = public.current_client_id()
        and not v.is_talent_pool
    )
  );
