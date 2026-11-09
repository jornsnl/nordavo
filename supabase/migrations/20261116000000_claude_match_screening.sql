-- Matching (T2, T3) and CV screening (2.11) run through Claude via the MCP
-- (docs/claude-jobs.md, tasks claude-match and claude-screening). The portal
-- no longer needs ANTHROPIC_API_KEY for them: a button in the portal only
-- queues the work, Claude's scheduled task picks it up.
--
--   1  vacancies.match_requested_at: "Match" was pressed; cleared when the
--      matches are saved.
--   2  applications.score_requested_at: a re-score was asked for; cleared
--      when a real score is saved. Unscored applications are always queued.
--   3  claude-match and claude-screening are recruitment jobs, the other
--      claude-* jobs stay sales.

-- Safe to run again: everything below skips what already exists.
alter table public.vacancies add column if not exists match_requested_at timestamptz;
alter table public.applications add column if not exists score_requested_at timestamptz;

create index if not exists vacancies_match_requested_at_idx
  on public.vacancies (match_requested_at) where match_requested_at is not null;
create index if not exists applications_score_requested_at_idx
  on public.applications (score_requested_at) where score_requested_at is not null;

create or replace function public.job_module(p_job_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_job_name in ('claude-match', 'claude-screening') then 'recruitment'
    when p_job_name ~ '^s[0-9]+-' or p_job_name like 'max-%' or p_job_name like 'claude-%' then 'sales'
    when p_job_name like 'work-%' or p_job_name like 'clickup-%' then null
    when p_job_name like 'academy-%' then 'academy'
    else 'recruitment'
  end;
$$;
