-- Recruitment screening (recruitment brief of 2026-11-08, sections 2.6.1,
-- 2.6.2, 2.6.3, 2.7, 2.11, 2.15 and 2.18). Builds on the foundation
-- (20261108000000_recruitment_foundation.sql): applications.cv_score,
-- cv_verdict and cv_scored_at are filled from cv_scores below.
--
-- 1. Screening settings on the vacancy (excluded profiles, stack threshold, model).
-- 2. CV reading state on the candidate (text pending for PDFs without Claude).
-- 3. vacancy_requirements: structured requirements, must have or alternative possible.
-- 4. techstack_checks: the result of the techstack check per application.
-- 5. screening_prompts: versioned instructions for CV scoring, admin edits.
-- 6. cv_scores: every CV score with model, prompt version, breakdown and cost.
--
-- Everything is staff only. Clients see none of it.

-- ---------------------------------------------------------------------------
-- 1. Vacancy settings
-- ---------------------------------------------------------------------------

alter table public.vacancies
  -- Profiles that fall out in the techstack check, e.g. "frontend", "QA", "mobile".
  add column excluded_profiles text[] not null default '{}',
  -- How many stack skills a candidate needs to pass; null: about half the stack, at most 3.
  add column techstack_min_hits integer check (techstack_min_hits between 1 and 50),
  -- Model for CV scoring of this vacancy; null: the default model.
  add column screening_model text check (screening_model in ('claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'));

comment on column public.vacancies.excluded_profiles is 'Techstack check: profiles that do not fit this role (for example frontend for a backend role).';

-- ---------------------------------------------------------------------------
-- 2. CV reading state
-- ---------------------------------------------------------------------------

alter table public.candidates
  -- pending: a CV file is stored but its text could not be read yet (PDF without Claude);
  -- read: cv_text comes from the uploaded file; failed: the file could not be read.
  add column cv_text_status text check (cv_text_status in ('pending', 'read', 'failed')),
  add column cv_read_at timestamptz;

create index on public.candidates (cv_text_status) where cv_text_status = 'pending';

-- Dedupe on import: email and LinkedIn are looked up case-insensitively.
create index if not exists candidates_email_lower_idx on public.candidates (lower(email));
create index if not exists candidates_linkedin_norm_idx on public.candidates (public.normalize_linkedin(linkedin_url));

-- Existing candidates with one of these emails (lowercase), phone keys (the
-- last 10 digits) or LinkedIn URLs (normalize_linkedin). Used by the CSV
-- import and the bulk CV upload to find duplicates. Security invoker: staff
-- RLS on candidates applies.
create or replace function public.screening_find_candidates(
  p_emails text[] default '{}',
  p_phone_keys text[] default '{}',
  p_linkedins text[] default '{}'
)
returns setof public.candidates
language sql
stable
security invoker
set search_path = ''
as $$
  select c.*
  from public.candidates c
  where (cardinality(p_emails) > 0 and lower(c.email) = any (p_emails))
     or (cardinality(p_linkedins) > 0 and public.normalize_linkedin(c.linkedin_url) = any (p_linkedins))
     or (cardinality(p_phone_keys) > 0
         and length(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g')) >= 8
         and right(regexp_replace(c.phone, '\D', '', 'g'), 10) = any (p_phone_keys))
  limit 5000;
$$;

revoke execute on function public.screening_find_candidates(text[], text[], text[]) from public, anon;
grant execute on function public.screening_find_candidates(text[], text[], text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Requirements per vacancy
-- ---------------------------------------------------------------------------

create table public.vacancy_requirements (
  id uuid primary key default gen_random_uuid(),
  vacancy_id uuid not null references public.vacancies (id) on delete cascade,
  label text not null check (char_length(trim(label)) between 1 and 300),
  -- must_have: cannot be missing; alternative: an alternative from the list is fine;
  -- nice_to_have: a bonus, never a reason to reject.
  kind text not null default 'must_have' check (kind in ('must_have', 'alternative', 'nice_to_have')),
  alternatives text[] not null default '{}',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.vacancy_requirements (vacancy_id, position);

alter table public.vacancy_requirements enable row level security;
create policy "Staff manage vacancy requirements" on public.vacancy_requirements
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- 4. Techstack check per application
-- ---------------------------------------------------------------------------

create table public.techstack_checks (
  application_id uuid primary key references public.applications (id) on delete cascade,
  vacancy_id uuid not null references public.vacancies (id) on delete cascade,
  result text not null check (result in ('pass', 'fail', 'unclear')),
  reason text not null check (char_length(reason) <= 1000),
  -- Stack skills found in the candidate.
  hits text[] not null default '{}',
  -- rules: the keyword pass in code; ai: Claude judged an unclear case.
  method text not null default 'rules' check (method in ('rules', 'ai')),
  model text,
  checked_by uuid references public.profiles (id) on delete set null default auth.uid(),
  checked_at timestamptz not null default now()
);

create index on public.techstack_checks (vacancy_id, result);

alter table public.techstack_checks enable row level security;
create policy "Staff manage techstack checks" on public.techstack_checks
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- 5. Screening prompts
-- ---------------------------------------------------------------------------
--
-- The instructions Claude gets for CV scoring. Admins add versions and
-- activate one; every score records the version it used. Without an active
-- version the built-in instructions in the code are used (version 0).

create table public.screening_prompts (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique,
  instructions text not null check (char_length(instructions) between 20 and 20000),
  notes text check (char_length(notes) <= 2000),
  is_active boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  activated_at timestamptz
);

create unique index screening_prompts_one_active on public.screening_prompts (is_active) where is_active;

-- Version numbers are handed out by the database: 1, 2, 3 ...
create or replace function public.screening_prompts_set_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('public.screening_prompts.version'));
  select coalesce(max(version), 0) + 1 into new.version from public.screening_prompts;
  return new;
end;
$$;

create trigger screening_prompts_set_version before insert on public.screening_prompts
  for each row execute function public.screening_prompts_set_version();

alter table public.screening_prompts enable row level security;
create policy "Staff read screening prompts" on public.screening_prompts
  for select to authenticated using (public.is_staff());
create policy "Admins add screening prompts" on public.screening_prompts
  for insert to authenticated with check (public.is_admin());
create policy "Admins change screening prompts" on public.screening_prompts
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins remove screening prompts" on public.screening_prompts
  for delete to authenticated using (public.is_admin() and not is_active);

-- Activate one version (or none with null): admins only, in one step.
create or replace function public.activate_screening_prompt(p_prompt_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can activate a screening prompt';
  end if;
  if p_prompt_id is not null and not exists (select 1 from public.screening_prompts where id = p_prompt_id) then
    raise exception 'Screening prompt not found';
  end if;
  update public.screening_prompts set is_active = false where is_active and id is distinct from p_prompt_id;
  if p_prompt_id is not null then
    update public.screening_prompts set is_active = true, activated_at = now() where id = p_prompt_id and not is_active;
  end if;
end;
$$;

revoke execute on function public.activate_screening_prompt(uuid) from public, anon;
grant execute on function public.activate_screening_prompt(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. CV scores
-- ---------------------------------------------------------------------------

create table public.cv_scores (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  vacancy_id uuid not null references public.vacancies (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  -- score: the real score, copied to the application; compare: a re-score
  -- with another prompt version or model, only for comparing.
  purpose text not null default 'score' check (purpose in ('score', 'compare')),
  score integer not null check (score between 0 and 100),
  verdict text not null check (verdict in ('fit', 'maybe', 'no_fit')),
  summary text check (char_length(summary) <= 2000),
  -- Per requirement: {label, kind, status: met|alternative|missing, evidence}.
  breakdown jsonb not null default '[]',
  must_have_missing integer not null default 0 check (must_have_missing >= 0),
  model text not null,
  prompt_id uuid references public.screening_prompts (id) on delete set null,
  prompt_version integer not null default 0,
  effort text check (effort in ('low', 'medium', 'high')),
  input_tokens integer,
  output_tokens integer,
  cache_read_tokens integer,
  cache_write_tokens integer,
  cost_usd numeric(12, 6),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index on public.cv_scores (application_id, created_at desc);
create index on public.cv_scores (vacancy_id, purpose, created_at desc);
create index on public.cv_scores (prompt_id);

alter table public.cv_scores enable row level security;
create policy "Staff read CV scores" on public.cv_scores
  for select to authenticated using (public.is_staff());
create policy "Staff add CV scores" on public.cv_scores
  for insert to authenticated with check (public.is_staff());
create policy "Staff remove CV scores" on public.cv_scores
  for delete to authenticated using (public.is_staff());

-- A real score lands on the application, so the pipeline and the ranking read one column.
create or replace function public.cv_scores_copy_to_application()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.purpose = 'score' then
    update public.applications
    set cv_score = new.score, cv_verdict = new.verdict, cv_scored_at = new.created_at
    where id = new.application_id;
  end if;
  return null;
end;
$$;

create trigger cv_scores_copy_to_application after insert on public.cv_scores
  for each row execute function public.cv_scores_copy_to_application();

comment on table public.cv_scores is 'CV against JD scores (2.11): match percentage, verdict, breakdown per requirement, model, prompt version and cost.';
comment on table public.screening_prompts is 'Versioned CV scoring instructions. One active version; version 0 means the built-in default.';
comment on table public.techstack_checks is 'Techstack check (2.7) per application: pass, fail or unclear with the reason.';
