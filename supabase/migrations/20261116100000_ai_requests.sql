-- One queue for the judgement the portal used to ask the Claude API for
-- (docs/claude-jobs.md, task claude-requests). The portal needs no
-- ANTHROPIC_API_KEY: a button stores a request with the instructions, the
-- input and the answer it expects; Claude reads it through the MCP
-- (list_ai_requests), answers (complete_ai_request) and the portal applies
-- the answer with the same code as before.
--
-- Kinds: vacancy_extract, techstack_check, talent_pool_rank,
-- anonymous_profile, cv_score_compare, cv_fields, cv_read,
-- academy_assessment, lesson_draft.

-- Safe to run again: everything below skips or replaces what already exists.
create table if not exists public.ai_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind ~ '^[a-z_]{3,40}$'),
  -- The module whose team may see the request and whose MCP owner may answer it.
  module text not null check (module in ('sales', 'recruitment', 'clients', 'report', 'academy')),
  entity_type text,
  entity_id uuid,
  -- Kind specific data the answer is applied with (ids, prompt version).
  context jsonb not null default '{}',
  -- Instructions and input as they are handed to Claude. Input parts:
  -- {type: text, text} or {type: file, path, mime, title} (a stored file).
  system text not null,
  input jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed', 'applied')),
  result jsonb,
  error text check (char_length(error) <= 2000),
  model text,
  requested_by uuid references public.profiles (id) on delete set null default auth.uid(),
  completed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists ai_requests_status_created_at_idx on public.ai_requests (status, created_at) where status = 'pending';
create index if not exists ai_requests_kind_entity_id_created_at_idx on public.ai_requests (kind, entity_id, created_at desc);
-- One open request per record and kind: asking again refreshes it.
create unique index if not exists ai_requests_one_pending on public.ai_requests (kind, entity_id) where status = 'pending' and entity_id is not null;

alter table public.ai_requests enable row level security;

drop policy if exists "Team reads the AI requests of its modules" on public.ai_requests;
create policy "Team reads the AI requests of its modules" on public.ai_requests
  for select to authenticated using (public.is_staff() and public.has_module(module));
drop policy if exists "Team asks for AI requests in its modules" on public.ai_requests;
create policy "Team asks for AI requests in its modules" on public.ai_requests
  for insert to authenticated with check (public.is_staff() and public.has_module(module) and status = 'pending');
drop policy if exists "Team refreshes or marks its AI requests" on public.ai_requests;
create policy "Team refreshes or marks its AI requests" on public.ai_requests
  for update to authenticated using (public.is_staff() and public.has_module(module))
  with check (public.is_staff() and public.has_module(module));

grant select, insert, update on public.ai_requests to authenticated;

-- claude-requests serves several modules: every staff member sees its runs.
create or replace function public.job_module(p_job_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_job_name = 'claude-requests' then null
    when p_job_name in ('claude-match', 'claude-screening') then 'recruitment'
    when p_job_name ~ '^s[0-9]+-' or p_job_name like 'max-%' or p_job_name like 'claude-%' then 'sales'
    when p_job_name like 'work-%' or p_job_name like 'clickup-%' then null
    when p_job_name like 'academy-%' then 'academy'
    else 'recruitment'
  end;
$$;
