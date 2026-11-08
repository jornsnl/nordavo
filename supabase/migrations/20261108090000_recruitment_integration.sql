-- Recruitment, integration of the parts of 8 November.
--
-- 1. Module access on the new recruitment tables. The planning migration
--    (20261108040000) moved the existing recruitment tables from is_staff()
--    to has_module('recruitment'). The tables added by the pipeline, forms,
--    screening and custom fields migrations still checked is_staff() only,
--    so a member without recruitment (sales only) could read assessments,
--    compensation, form answers and CV scores. They now need the module too.
--
-- 2. Client portal reads through portal_* functions only. RLS works per row,
--    so a client who could read a presented application or candidate row
--    could also read every internal column on it through the API (rejection
--    and park reasons, video and background check notes, topper reason, CV
--    text, contact details, custom fields). The client policies on the base
--    tables are removed; security definer functions return exactly the
--    columns the portal shows, for the signed in client only. Storage keeps
--    a client policy for the CV file, through a definer helper.

-- ---------------------------------------------------------------------------
-- 1. Module access
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_using text;
  v_check text;
  v_sql text;
begin
  for r in
    select tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'application_assessments', 'application_compensation', 'cv_scores',
        'form_invites', 'form_responses', 'recruitment_form_versions',
        'recruitment_forms', 'techstack_checks', 'vacancy_requirements',
        'exchange_rates', 'screening_prompts', 'custom_field_definitions'
      )
  loop
    v_using := replace(r.qual, 'is_staff()', '(is_staff() and has_module(''recruitment''::text))');
    v_using := replace(v_using, 'is_admin()', '(is_admin() and has_module(''recruitment''::text))');
    v_check := replace(r.with_check, 'is_staff()', '(is_staff() and has_module(''recruitment''::text))');
    v_check := replace(v_check, 'is_admin()', '(is_admin() and has_module(''recruitment''::text))');
    v_sql := format('alter policy %I on public.%I', r.policyname, r.tablename);
    if v_using is not null then
      v_sql := v_sql || format(' using (%s)', v_using);
    end if;
    if v_check is not null then
      v_sql := v_sql || format(' with check (%s)', v_check);
    end if;
    if v_using is not null or v_check is not null then
      execute v_sql;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Client portal through functions
-- ---------------------------------------------------------------------------

drop policy if exists "Clients read presented applications" on public.applications;
drop policy if exists "Clients read presented candidates" on public.candidates;
drop policy if exists "Clients read placed candidates" on public.candidates;
drop policy if exists "Clients read own vacancies" on public.vacancies;
drop policy if exists "Clients read own placements" on public.placements;
drop policy if exists "Clients read own company" on public.clients;

-- Own company.
create or replace function public.portal_company()
returns table (id uuid, name text, city text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.name, c.city
  from public.clients c
  where c.id = public.current_client_id();
$$;

-- Own vacancies with the number of presented candidates and open reviews.
create or replace function public.portal_vacancies()
returns table (
  id uuid,
  title text,
  status text,
  seniority text,
  stack text[],
  opened_at date,
  closed_at date,
  presented_count integer,
  pending_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.title, v.status, v.seniority, v.stack, v.opened_at, v.closed_at,
    (select count(*)::integer from public.applications a
      where a.vacancy_id = v.id and public.is_presented_stage(a.stage)),
    (select count(*)::integer from public.applications a
      where a.vacancy_id = v.id and a.stage in ('matched', 'client_interview') and a.client_decision = 'pending')
  from public.vacancies v
  where v.client_id = public.current_client_id()
    and v.client_id is not null
    and not v.is_talent_pool
  order by v.opened_at desc;
$$;

-- One own vacancy (null when it is not theirs).
create or replace function public.portal_vacancy(p_vacancy_id uuid)
returns table (
  id uuid,
  title text,
  description text,
  stack text[],
  seniority text,
  status text,
  opened_at date,
  closed_at date,
  desired_start_date date
)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.title, v.description, v.stack, v.seniority, v.status, v.opened_at, v.closed_at, v.desired_start_date
  from public.vacancies v
  where v.id = p_vacancy_id
    and v.client_id = public.current_client_id()
    and v.client_id is not null
    and not v.is_talent_pool;
$$;

-- Presented candidates of own vacancies: only what the portal shows.
-- p_vacancy_id null: all own vacancies. p_pending_only: open reviews only.
create or replace function public.portal_candidates(p_vacancy_id uuid default null, p_pending_only boolean default false)
returns table (
  application_id uuid,
  vacancy_id uuid,
  vacancy_title text,
  stage text,
  technical_score integer,
  english_score integer,
  presented_at timestamptz,
  client_decision text,
  client_feedback text,
  client_decided_at timestamptz,
  candidate_id uuid,
  full_name text,
  current_title text,
  location text,
  years_experience integer,
  skills text[],
  video_url text,
  summary text,
  has_cv boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, v.id, v.title, a.stage, a.technical_score, a.english_score, a.presented_at,
    a.client_decision, a.client_feedback, a.client_decided_at,
    c.id, c.full_name, c.current_title, c.location, c.years_experience, c.skills, c.video_url, c.summary,
    c.cv_path is not null
  from public.applications a
  join public.vacancies v on v.id = a.vacancy_id
  join public.candidates c on c.id = a.candidate_id
  where v.client_id = public.current_client_id()
    and v.client_id is not null
    and not v.is_talent_pool
    and public.is_presented_stage(a.stage)
    and (p_vacancy_id is null or v.id = p_vacancy_id)
    and (not p_pending_only or (a.client_decision = 'pending' and a.stage in ('matched', 'client_interview')))
  order by a.presented_at asc nulls last;
$$;

-- Storage path of the CV of one presented application of this client.
create or replace function public.portal_cv_path(p_application_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select c.cv_path
  from public.applications a
  join public.vacancies v on v.id = a.vacancy_id
  join public.candidates c on c.id = a.candidate_id
  where a.id = p_application_id
    and v.client_id = public.current_client_id()
    and v.client_id is not null
    and not v.is_talent_pool
    and public.is_presented_stage(a.stage)
    and c.cv_path like 'candidate/' || c.id::text || '/%';
$$;

-- Own placements.
create or replace function public.portal_placements()
returns table (
  id uuid,
  start_date date,
  end_date date,
  status text,
  notice_given_at date,
  guarantee_until date,
  monthly_rate numeric,
  candidate_name text,
  candidate_title text,
  vacancy_title text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.start_date, p.end_date, p.status, p.notice_given_at, p.guarantee_until, p.monthly_rate,
    c.full_name, c.current_title, v.title
  from public.placements p
  left join public.candidates c on c.id = p.candidate_id
  left join public.vacancies v on v.id = p.vacancy_id
  where p.client_id = public.current_client_id()
    and p.client_id is not null
  order by p.start_date desc;
$$;

-- Storage: may this client open this file? Only the CV of a presented or
-- placed candidate (the file named in candidates.cv_path, or an attachment of
-- kind 'cv'), never payslips, background checks or other files.
create or replace function public.client_can_open_file(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_client_id() is not null
    and split_part(p_path, '/', 1) = 'candidate'
    and exists (
      select 1 from public.candidates c
      where c.id::text = split_part(p_path, '/', 2)
        and (
          c.cv_path = p_path
          or exists (
            select 1 from public.attachments f
            where f.storage_path = p_path and f.kind = 'cv'
              and f.entity_type = 'candidate' and f.entity_id = c.id
          )
        )
        and (
          exists (
            select 1 from public.applications a
            join public.vacancies v on v.id = a.vacancy_id
            where a.candidate_id = c.id
              and public.is_presented_stage(a.stage)
              and v.client_id = public.current_client_id()
              and not v.is_talent_pool
          )
          or exists (
            select 1 from public.placements pl
            where pl.candidate_id = c.id and pl.client_id = public.current_client_id()
          )
        )
    );
$$;

drop policy if exists "Clients read presented candidate files" on storage.objects;
create policy "Clients read presented candidate files"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'attachments' and public.client_can_open_file(name));

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'portal_company()', 'portal_vacancies()', 'portal_vacancy(uuid)',
    'portal_candidates(uuid, boolean)', 'portal_cv_path(uuid)', 'portal_placements()',
    'client_can_open_file(text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', v_fn);
    execute format('grant execute on function public.%s to authenticated', v_fn);
  end loop;
end $$;

comment on function public.portal_candidates(uuid, boolean) is
  'Client portal: presented candidates of the signed in client, only the columns the portal shows. Clients have no direct read access to applications or candidates.';
