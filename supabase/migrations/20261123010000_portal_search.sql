-- Global search that forgives typos (feedback Julius: Ctrl/Cmd K only found
-- exact pieces of a name). docs/work.md, "Sneltoetsen en zoeken".
--
-- portal_search(query) looks through leads (companies), their contacts,
-- clients and client contacts, vacancies (also by client name) and
-- candidates, with trigram similarity (pg_trgm) next to the plain "contains"
-- match, so "brigth fintec" still finds Bright Fintech. It runs as the
-- caller (security invoker): row level security decides what someone sees,
-- exactly as with the lists themselves.
-- Safe to run again.

create extension if not exists pg_trgm with schema extensions;

-- Trigram indexes on the names people search for. The operator class lives
-- where pg_trgm was installed (extensions on Supabase, public elsewhere).
do $$
declare
  v_schema text := (
    select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm'
  );
begin
  execute format('create index if not exists companies_name_trgm on public.companies using gin (name %I.gin_trgm_ops)', v_schema);
  execute format('create index if not exists clients_name_trgm on public.clients using gin (name %I.gin_trgm_ops)', v_schema);
  execute format('create index if not exists vacancies_title_trgm on public.vacancies using gin (title %I.gin_trgm_ops)', v_schema);
  execute format('create index if not exists candidates_full_name_trgm on public.candidates using gin (full_name %I.gin_trgm_ops)', v_schema);
  execute format('create index if not exists client_contacts_full_name_trgm on public.client_contacts using gin (full_name %I.gin_trgm_ops)', v_schema);
  execute format(
    'create index if not exists contacts_name_trgm on public.contacts using gin ((coalesce(first_name, '''') || '' '' || coalesce(last_name, '''')) %I.gin_trgm_ops)',
    v_schema
  );
end $$;

create or replace function public.portal_search(p_query text, p_limit integer default 5)
returns table (kind text, id uuid, parent_id uuid, label text, sublabel text, score real)
language plpgsql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  v_q text := left(trim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g')), 80);
  v_like text;
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 20);
  -- Below this a trigram match is noise; a plain "contains" always counts.
  v_min real := case when length(v_q) <= 3 then 0.5 else 0.3 end;
begin
  if length(v_q) < 2 then
    return;
  end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  with
  companies as (
    select 'company'::text as kind, c.id, null::uuid as parent_id, c.name as label, c.domain as sublabel,
      greatest(
        word_similarity(v_q, c.name),
        coalesce(word_similarity(v_q, c.domain), 0),
        case when c.name ilike v_like or c.domain ilike v_like then 0.9 else 0 end,
        case when lower(c.name) = lower(v_q) then 1 else 0 end
      )::real as score
    from public.companies c
    where c.name ilike v_like or c.domain ilike v_like or word_similarity(v_q, c.name) >= v_min
    order by 6 desc, c.name
    limit v_limit
  ),
  contacts as (
    select 'contact'::text, ct.id, ct.company_id,
      nullif(trim(coalesce(ct.first_name, '') || ' ' || coalesce(ct.last_name, '')), ''),
      concat_ws(' at ', ct.title, co.name),
      greatest(
        word_similarity(v_q, coalesce(ct.first_name, '') || ' ' || coalesce(ct.last_name, '')),
        case when (coalesce(ct.first_name, '') || ' ' || coalesce(ct.last_name, '')) ilike v_like or ct.email ilike v_like then 0.9 else 0 end
      )::real
    from public.contacts ct
    join public.companies co on co.id = ct.company_id
    where (coalesce(ct.first_name, '') || ' ' || coalesce(ct.last_name, '')) ilike v_like
      or ct.email ilike v_like
      or word_similarity(v_q, coalesce(ct.first_name, '') || ' ' || coalesce(ct.last_name, '')) >= v_min
    order by 6 desc
    limit v_limit
  ),
  clients as (
    select 'client'::text, cl.id, null::uuid, cl.name, cl.city,
      greatest(
        word_similarity(v_q, cl.name),
        case when cl.name ilike v_like then 0.9 else 0 end,
        case when lower(cl.name) = lower(v_q) then 1 else 0 end
      )::real
    from public.clients cl
    where cl.name ilike v_like or word_similarity(v_q, cl.name) >= v_min
    order by 6 desc, cl.name
    limit v_limit
  ),
  client_people as (
    select 'client_contact'::text, cc.id, cc.client_id, cc.full_name, concat_ws(' at ', cc.job_title, cl.name),
      greatest(
        word_similarity(v_q, cc.full_name),
        case when cc.full_name ilike v_like or cc.email ilike v_like then 0.9 else 0 end
      )::real
    from public.client_contacts cc
    join public.clients cl on cl.id = cc.client_id
    where cc.full_name ilike v_like or cc.email ilike v_like or word_similarity(v_q, cc.full_name) >= v_min
    order by 6 desc
    limit v_limit
  ),
  vacancies as (
    select 'vacancy'::text, v.id, v.client_id, v.title, cl.name,
      greatest(
        word_similarity(v_q, v.title),
        word_similarity(v_q, cl.name) * 0.9,
        case when v.title ilike v_like then 0.9 when cl.name ilike v_like then 0.8 else 0 end
      )::real
    from public.vacancies v
    join public.clients cl on cl.id = v.client_id
    where v.title ilike v_like or cl.name ilike v_like
      or word_similarity(v_q, v.title) >= v_min or word_similarity(v_q, cl.name) >= v_min
    order by 6 desc, v.opened_at desc nulls last
    limit v_limit
  ),
  candidates as (
    select 'candidate'::text, ca.id, null::uuid, ca.full_name, ca.current_title,
      greatest(
        word_similarity(v_q, ca.full_name),
        case when ca.full_name ilike v_like then 0.9 when ca.current_title ilike v_like then 0.6 else 0 end
      )::real
    from public.candidates ca
    where ca.full_name ilike v_like or ca.current_title ilike v_like or word_similarity(v_q, ca.full_name) >= v_min
    order by 6 desc, ca.full_name
    limit v_limit
  )
  select * from companies
  union all select * from contacts
  union all select * from clients
  union all select * from client_people
  union all select * from vacancies
  union all select * from candidates;
end;
$$;

revoke execute on function public.portal_search(text, integer) from public, anon;
grant execute on function public.portal_search(text, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
