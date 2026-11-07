-- T2 matches portal candidates (client feedback, point 8).
--
-- The talent pool used to live in Airtable and `matches` stored the Airtable
-- record id. Everything now lives in the portal: T2 reads its pool
-- from public.candidates and a match references candidates.id.
--
-- 1. Candidates get the fields the matcher and the anonymous profile need.
-- 2. matches.airtable_candidate_id is replaced by matches.candidate_id.
--    The old matches pointed at external records that were never copied into
--    the portal, so they cannot be linked to a candidate. They are first
--    copied to archive.matches_airtable and archive.anonymous_profiles_airtable
--    (staff and clients cannot read that schema; only the service role and the
--    SQL editor can), then removed from the live tables. Re-run matching on
--    the vacancy to score the portal candidates. Vacancy history (talent stage,
--    intake, profiles sent and first interview dates, search brief) is kept.
--    Profile PDFs of deleted profiles stay in storage under
--    vacancy/<vacancy id>/profiles/ and can be removed by hand.
-- 3. t2_candidate_pool(): the prefilter in SQL, so T2 never loads the whole
--    candidates table.

-- ---------------------------------------------------------------------------
-- 1. Candidate fields for matching
-- ---------------------------------------------------------------------------

alter table public.candidates
  add column seniority text check (seniority in ('junior', 'medior', 'senior', 'lead')),
  -- Current employer first. Only used to keep anonymous profiles anonymous.
  add column employers text[] not null default '{}',
  add column project_types text[] not null default '{}',
  add column sectors text[] not null default '{}',
  -- Plain text version of the CV, read by the matcher (the uploaded file is not parsed).
  add column cv_text text check (char_length(cv_text) <= 100000),
  add column english_level text check (char_length(english_level) <= 100),
  -- Free text, for example "30 days notice" or "immediately".
  add column availability text check (char_length(availability) <= 200),
  -- Consent to share an anonymous profile with clients: null unknown, true given, false refused.
  add column profile_consent boolean;

comment on column public.candidates.employers is 'Current and previous employers, current first. Used by the anonymity check on profiles.';
comment on column public.candidates.cv_text is 'Plain text CV for T2 matching and T4 profiles.';
comment on column public.candidates.profile_consent is 'Consent to share an anonymous profile: null unknown, true given, false refused.';

-- ---------------------------------------------------------------------------
-- 2. Matches reference portal candidates
-- ---------------------------------------------------------------------------

-- Old matches reference external records only (see the header). Keep a copy
-- before removing them, so nothing that was sent to a client is lost.
create schema if not exists archive;
revoke all on schema archive from public, anon, authenticated;
create table archive.matches_airtable as table public.matches;
create table archive.anonymous_profiles_airtable as table public.anonymous_profiles;
comment on table archive.matches_airtable is 'T2 matches from the Airtable era (before 2026-11-07), kept when matching moved to portal candidates.';
comment on table archive.anonymous_profiles_airtable is 'Anonymous profiles of the Airtable-era matches, kept for reference.';
delete from public.matches;

alter table public.matches drop column airtable_candidate_id;
alter table public.matches
  add column candidate_id uuid not null references public.candidates (id) on delete cascade,
  add constraint matches_vacancy_id_candidate_id_key unique (vacancy_id, candidate_id);

create index on public.matches (candidate_id);

comment on table public.matches is 'T2: a portal candidate matched to a vacancy, with score, reason, risks and status.';

-- ---------------------------------------------------------------------------
-- 3. Candidate pool for T2
-- ---------------------------------------------------------------------------

-- The bounded, ranked pool for one vacancy. The caller passes one regex per
-- wanted skill (case-insensitive, already escaped) with its weight; a
-- candidate scores the weight of every pattern found in its skills, summary
-- or CV text. The exact ranking happens in code on this set.
--
-- Left out: candidates that are placed or unavailable, juniors, candidates
-- already in the vacancy's pipeline and matches staff rejected for it.
-- With p_require_hit, a candidate must match at least one pattern.
--
-- Security invoker: RLS on candidates applies (staff, or the service role in jobs).
create or replace function public.t2_candidate_pool(
  p_vacancy_id uuid,
  p_patterns text[] default '{}',
  p_weights integer[] default '{}',
  p_require_hit boolean default false,
  p_limit integer default 500
)
returns setof public.candidates
language sql
stable
security invoker
set search_path = ''
as $$
  select c.*
  from public.candidates c
  cross join lateral (
    select lower(concat_ws(' ', array_to_string(c.skills, ' , '), c.summary, c.cv_text)) as hay
  ) h
  cross join lateral (
    select coalesce(sum(w.weight), 0)::integer as points, count(*)::integer as hits
    from unnest(p_patterns, p_weights) as w (pattern, weight)
    where w.pattern is not null and h.hay ~* w.pattern
  ) r
  where c.status in ('available', 'in_process')
    and c.seniority is distinct from 'junior'
    and not (c.seniority is null and c.years_experience is not null and c.years_experience < 2)
    and not exists (
      select 1 from public.applications a
      where a.vacancy_id = p_vacancy_id and a.candidate_id = c.id
    )
    and not exists (
      select 1 from public.matches m
      where m.vacancy_id = p_vacancy_id and m.candidate_id = c.id and m.status = 'afgewezen'
    )
    and (not p_require_hit or r.hits > 0)
  order by r.points + least(coalesce(c.years_experience, 0), 10) desc, c.updated_at desc, c.id
  limit least(greatest(coalesce(p_limit, 500), 1), 2000);
$$;

revoke execute on function public.t2_candidate_pool(uuid, text[], integer[], boolean, integer) from public, anon;
grant execute on function public.t2_candidate_pool(uuid, text[], integer[], boolean, integer) to authenticated, service_role;
