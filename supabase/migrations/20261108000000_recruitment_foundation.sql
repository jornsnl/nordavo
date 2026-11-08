-- Recruitment in the portal, foundation (recruitment brief of 2026-11-08,
-- sections 2.1 to 2.6). Later migrations of the same date build on the
-- columns defined here: forms fill form_*, AI screening fills cv_score,
-- scheduling fills interview_at, the report reads the stage history.
--
-- 1. New pipeline stages, existing applications mapped onto them.
-- 2. Parking next to rejecting, for applications, candidates and vacancies.
-- 3. Where a candidate came from: channel (source) and origin (applied or headhunted).
-- 4. Shared columns for forms, scoring, interviews and background checks.
-- 5. Stage history, written by a trigger, for the funnel in the report.
-- 6. Candidate status follows the pipeline.
-- 7. Notes per stage, attachment kinds (CV, payslip, background check).
-- 8. move_applications(): move many candidates at once (board, Claude, MCP).
-- 9. Client portal policies on the new stages.

-- ---------------------------------------------------------------------------
-- 1. Stages
-- ---------------------------------------------------------------------------
--
-- Flow:  sourced, techstack_check, fill_out, video_review, technical_test,
--        interview, matched (presented to the client), client_interview,
--        final_screening (incl. background check), placed.
-- Apart: parked and rejected, both remember the stage they left
--        (exit_from_stage) so a parked candidate can be picked up again.
--
-- Old to new: screening -> techstack_check, english_interview -> interview,
-- presented -> matched, final_interview -> client_interview.

alter table public.applications drop constraint if exists applications_stage_check;

update public.applications set stage = case stage
  when 'screening' then 'techstack_check'
  when 'english_interview' then 'interview'
  when 'presented' then 'matched'
  when 'final_interview' then 'client_interview'
  else stage
end;

alter table public.applications
  add constraint applications_stage_check check (stage in (
    'sourced', 'techstack_check', 'fill_out', 'video_review', 'technical_test',
    'interview', 'matched', 'client_interview', 'final_screening', 'placed',
    'parked', 'rejected'
  ));

-- Stages the client portal may see (presented and later).
create or replace function public.is_presented_stage(p_stage text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_stage in ('matched', 'client_interview', 'final_screening', 'placed');
$$;

-- ---------------------------------------------------------------------------
-- 2. Parking
-- ---------------------------------------------------------------------------

alter table public.applications
  -- The flow stage a parked or rejected application left; null otherwise.
  add column exit_from_stage text check (exit_from_stage in (
    'sourced', 'techstack_check', 'fill_out', 'video_review', 'technical_test',
    'interview', 'matched', 'client_interview', 'final_screening'
  )),
  add column parked_at timestamptz,
  add column park_reason text check (char_length(park_reason) <= 2000),
  -- Optional date to look at a parked candidate again.
  add column park_until date,
  add column rejected_at timestamptz;

-- Candidates can be parked as a whole (status), with a reason.
alter table public.candidates drop constraint if exists candidates_status_check;
alter table public.candidates
  add constraint candidates_status_check check (status in ('available', 'in_process', 'parked', 'placed', 'unavailable')),
  add column park_reason text check (char_length(park_reason) <= 2000),
  add column parked_at timestamptz;

-- Vacancies: "on hold" is shown as Parked; the reason and date go with it.
alter table public.vacancies
  add column park_reason text check (char_length(park_reason) <= 2000),
  add column parked_at timestamptz;

-- ---------------------------------------------------------------------------
-- 3. Source and origin
-- ---------------------------------------------------------------------------
--
-- source: the channel (where the candidate was found or applied).
-- origin: applied (came in by themselves) or headhunted (we approached them).
-- Both on the candidate (first known) and on each application (per vacancy,
-- which is what the report counts).

alter table public.candidates
  add column source text check (source in (
    'linkedin', 'naukri', 'manatal', 'indeed', 'monster', 'instagram',
    'referral', 'website', 'headhunted', 'other'
  )),
  add column origin text not null default 'applied' check (origin in ('applied', 'headhunted'));

alter table public.applications
  add column source text check (source in (
    'linkedin', 'naukri', 'manatal', 'indeed', 'monster', 'instagram',
    'referral', 'website', 'headhunted', 'other'
  )),
  add column origin text not null default 'applied' check (origin in ('applied', 'headhunted'));

create index on public.applications (vacancy_id, source);
create index on public.applications (vacancy_id, origin);

-- ---------------------------------------------------------------------------
-- 4. Shared columns
-- ---------------------------------------------------------------------------

alter table public.applications
  -- Application form (filled by the forms feature).
  add column form_sent_at timestamptz,
  add column form_completed_at timestamptz,
  add column form_reminded_at timestamptz,
  -- CV against the JD (filled by AI screening): 0 to 100 and a short verdict.
  add column cv_score integer check (cv_score between 0 and 100),
  add column cv_verdict text check (cv_verdict in ('fit', 'maybe', 'no_fit')),
  add column cv_scored_at timestamptz,
  -- Video review (2.12): English and overall impression, by a person.
  add column video_score integer check (video_score between 0 and 100),
  add column video_notes text check (char_length(video_notes) <= 5000),
  -- Next or last planned interview (filled by scheduling).
  add column interview_at timestamptz,
  -- Shortlist (2.12).
  add column shortlisted_at timestamptz,
  -- Background check by the external partner (2.4, stage final_screening).
  add column background_check_status text not null default 'not_started' check (background_check_status in (
    'not_started', 'requested', 'passed', 'failed'
  )),
  add column background_check_notes text check (char_length(background_check_notes) <= 5000);

-- ---------------------------------------------------------------------------
-- 5. Stage history
-- ---------------------------------------------------------------------------

create table public.application_stage_events (
  id bigint generated always as identity primary key,
  application_id uuid not null references public.applications (id) on delete cascade,
  vacancy_id uuid not null references public.vacancies (id) on delete cascade,
  from_stage text,
  to_stage text not null,
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index on public.application_stage_events (application_id, created_at);
create index on public.application_stage_events (vacancy_id, to_stage);

alter table public.application_stage_events enable row level security;
create policy "Staff read stage events" on public.application_stage_events
  for select to authenticated using (public.is_staff());

-- Existing applications start their history at their current stage.
insert into public.application_stage_events (application_id, vacancy_id, from_stage, to_stage, created_at)
select id, vacancy_id, null, stage, created_at from public.applications;

-- Bookkeeping on every stage change: history, presented/parked/rejected
-- timestamps and the stage that was left. Runs before the row is written
-- so the timestamps land in the same update.
create or replace function public.applications_track_stage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.stage is not distinct from old.stage then
    return new;
  end if;

  if public.is_presented_stage(new.stage) and new.presented_at is null then
    new.presented_at := now();
  end if;

  if new.stage in ('parked', 'rejected') then
    if tg_op = 'UPDATE' and old.stage not in ('parked', 'rejected', 'placed') then
      new.exit_from_stage := old.stage;
    end if;
    if new.stage = 'parked' then
      new.parked_at := now();
    else
      new.rejected_at := now();
    end if;
  else
    new.exit_from_stage := null;
    new.parked_at := null;
    new.park_until := null;
  end if;

  return new;
end;
$$;

create trigger applications_track_stage before insert or update of stage on public.applications
  for each row execute function public.applications_track_stage();

create or replace function public.applications_log_stage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.stage is not distinct from old.stage then
    return null;
  end if;
  insert into public.application_stage_events (application_id, vacancy_id, from_stage, to_stage, actor_id)
  values (new.id, new.vacancy_id, case when tg_op = 'UPDATE' then old.stage end, new.stage, (select auth.uid()));
  return null;
end;
$$;

create trigger applications_log_stage after insert or update of stage on public.applications
  for each row execute function public.applications_log_stage();

-- ---------------------------------------------------------------------------
-- 6. Candidate status follows the pipeline
-- ---------------------------------------------------------------------------
--
-- placed      when any application is placed;
-- in_process  when any application is in the flow;
-- available   otherwise.
-- A status set by hand to parked or unavailable is left alone, except that
-- a placement or a new active application wins over parked.

create or replace function public.refresh_candidate_status(p_candidate_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current text;
  v_next text;
begin
  select status into v_current from public.candidates where id = p_candidate_id;
  if v_current is null then
    return;
  end if;

  select case
    when bool_or(a.stage = 'placed') then 'placed'
    when bool_or(a.stage not in ('parked', 'rejected', 'placed')) then 'in_process'
    else 'available'
  end
  into v_next
  from public.applications a
  where a.candidate_id = p_candidate_id;

  v_next := coalesce(v_next, 'available');

  if v_current = 'unavailable' and v_next <> 'placed' then
    return;
  end if;
  if v_current = 'parked' and v_next = 'available' then
    return;
  end if;
  if v_next is distinct from v_current then
    update public.candidates
    set status = v_next,
        park_reason = case when v_next = 'parked' then park_reason else null end,
        parked_at = case when v_next = 'parked' then parked_at else null end
    where id = p_candidate_id;
  end if;
end;
$$;

revoke execute on function public.refresh_candidate_status(uuid) from public, anon, authenticated;

create or replace function public.applications_refresh_candidate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.refresh_candidate_status(old.candidate_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.candidate_id <> old.candidate_id) then
    perform public.refresh_candidate_status(new.candidate_id);
  end if;
  return null;
end;
$$;

create trigger applications_refresh_candidate after insert or update of stage, candidate_id or delete on public.applications
  for each row execute function public.applications_refresh_candidate();

-- Bring existing candidates in line once (rejected candidates were left on in_process).
select public.refresh_candidate_status(id) from public.candidates;

-- ---------------------------------------------------------------------------
-- 7. Notes per stage, attachment kinds
-- ---------------------------------------------------------------------------

alter table public.notes
  -- The pipeline stage the note was written in (application notes), or null.
  add column stage text check (stage in (
    'sourced', 'techstack_check', 'fill_out', 'video_review', 'technical_test',
    'interview', 'matched', 'client_interview', 'final_screening', 'placed',
    'parked', 'rejected'
  )),
  -- What the note is about: a call with the candidate, a review, and so on.
  add column kind text not null default 'note' check (kind in (
    'note', 'call', 'screening_call', 'video_review', 'interview', 'client_feedback', 'background_check'
  ));

alter table public.attachments
  add column kind text not null default 'other' check (kind in (
    'cv', 'payslip', 'background_check', 'video', 'test_result', 'other'
  ));

create index on public.attachments (entity_type, entity_id, kind);

-- ---------------------------------------------------------------------------
-- 8. Move many applications at once
-- ---------------------------------------------------------------------------
--
-- Staff only. Moves every given application of one vacancy to p_stage and
-- appends them at the bottom of that column, in the given order.
-- p_reason is stored as park_reason (parked) or rejection_reason (rejected).
-- p_stage 'resume' sends parked or rejected applications back to the stage
-- they left. Returns the number of applications moved.

create or replace function public.move_applications(
  p_application_ids uuid[],
  p_stage text,
  p_reason text default null,
  p_park_until date default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_base double precision;
  v_vacancy uuid;
  v_id uuid;
  v_target text;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.is_staff() then
    raise exception 'Only the Nordavo team can move candidates';
  end if;
  if p_stage is null or p_stage not in (
    'sourced', 'techstack_check', 'fill_out', 'video_review', 'technical_test',
    'interview', 'matched', 'client_interview', 'final_screening', 'placed',
    'parked', 'rejected', 'resume'
  ) then
    raise exception 'Unknown stage %', p_stage;
  end if;
  if coalesce(array_length(p_application_ids, 1), 0) = 0 then
    return 0;
  end if;
  if array_length(p_application_ids, 1) > 1000 then
    raise exception 'Move at most 1000 candidates at once';
  end if;

  select count(distinct vacancy_id), min(vacancy_id::text)::uuid into v_count, v_vacancy
  from public.applications where id = any (p_application_ids);
  if v_count > 1 then
    raise exception 'Move candidates of one vacancy at a time';
  end if;
  v_count := 0;

  for v_id in select unnest(p_application_ids) loop
    select case
      when p_stage = 'resume' then coalesce(a.exit_from_stage, 'sourced')
      else p_stage
    end into v_target
    from public.applications a
    where a.id = v_id and (p_stage <> 'resume' or a.stage in ('parked', 'rejected'));

    continue when v_target is null;

    select coalesce(max(position), 0) into v_base
    from public.applications where vacancy_id = v_vacancy and stage = v_target;

    update public.applications
    set stage = v_target,
        position = v_base + 1024,
        park_reason = case when v_target = 'parked' then coalesce(v_reason, park_reason) else park_reason end,
        park_until = case when v_target = 'parked' then p_park_until else park_until end,
        rejection_reason = case when v_target = 'rejected' then coalesce(v_reason, rejection_reason) else rejection_reason end
    where id = v_id and stage is distinct from v_target;

    if found then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.move_applications(uuid[], text, text, date) from public, anon;
grant execute on function public.move_applications(uuid[], text, text, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Client portal on the new stages
-- ---------------------------------------------------------------------------

drop policy "Clients read presented applications" on public.applications;
create policy "Clients read presented applications" on public.applications
  for select to authenticated using (
    public.is_presented_stage(stage)
    and exists (
      select 1 from public.vacancies v
      where v.id = applications.vacancy_id
        and v.client_id = public.current_client_id()
        and not v.is_talent_pool
    )
  );

drop policy "Clients read presented candidates" on public.candidates;
create policy "Clients read presented candidates" on public.candidates
  for select to authenticated using (
    exists (
      select 1
      from public.applications a
      join public.vacancies v on v.id = a.vacancy_id
      where a.candidate_id = candidates.id
        and public.is_presented_stage(a.stage)
        and v.client_id = public.current_client_id()
        and not v.is_talent_pool
    )
  );

-- Clients open the CV only, never payslips, background checks or other files.
drop policy "Clients read presented candidate files" on storage.objects;
create policy "Clients read presented candidate files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'candidate'
    and not exists (
      select 1 from public.attachments f
      where f.storage_path = storage.objects.name and f.kind <> 'cv'
    )
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

create or replace function public.client_review_application(
  p_application_id uuid,
  p_decision text,
  p_feedback text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid decision';
  end if;

  update public.applications a
  set client_decision = p_decision,
      client_feedback = nullif(trim(p_feedback), ''),
      client_decided_at = now()
  from public.vacancies v
  where a.id = p_application_id
    and v.id = a.vacancy_id
    and v.client_id = public.current_client_id()
    and a.stage in ('matched', 'client_interview');

  if not found then
    raise exception 'Candidate not found';
  end if;
end;
$$;

comment on column public.applications.exit_from_stage is 'Flow stage a parked or rejected application left; move_applications(..., ''resume'') returns it there.';
comment on column public.applications.origin is 'applied: came in by themselves; headhunted: approached by Nordavo. Counted per vacancy in the report.';
comment on table public.application_stage_events is 'Every stage an application entered, written by a trigger. Feeds the recruitment funnel.';
