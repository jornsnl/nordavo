-- Talent pool vacancies (supabase/migrations/*_talent_pool_vacancies.sql),
-- played out with real RLS. Run against a database with every migration
-- applied, for example a local Supabase after `supabase db reset`:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/talent_pool_rls.test.sql
--
-- Everything happens in one transaction that is rolled back at the end.
-- A failed check raises an exception and stops the script.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'floris@nordavo.nl', '{"full_name": "Floris"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'sabine@kg.nl', '{"full_name": "Sabine"}');

insert into public.clients (id, name, status) values
  ('00000000-0000-0000-0000-0000000000c1', 'KG', 'active');
insert into public.companies (id, name, domain) values
  ('00000000-0000-0000-0000-0000000000d1', 'Prospect BV', 'prospect.nl');

update public.profiles set role = 'member' where email = 'floris@nordavo.nl';
update public.profiles set role = 'client', client_id = '00000000-0000-0000-0000-0000000000c1'
  where email = 'sabine@kg.nl';

create or replace function pg_temp.act(p_email text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', (select id from auth.users where email = p_email),
    'role', 'authenticated',
    'email', p_email)::text, false);
end $$;

-- Expect a statement to fail.
create or replace function pg_temp.fails(p_sql text, p_what text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL: % should have been refused', p_what;
exception
  when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  when others then null;
end $$;

grant execute on function pg_temp.act(text), pg_temp.fails(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Staff create a client vacancy and a talent pool vacancy
-- ---------------------------------------------------------------------------

select pg_temp.act('floris@nordavo.nl');
set role authenticated;

insert into public.vacancies (id, client_id, title) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', 'Data engineer KG');
insert into public.vacancies (id, title, is_talent_pool) values
  ('00000000-0000-0000-0000-0000000000e2', 'Python developer pool', true);

insert into public.candidates (id, full_name) values
  ('00000000-0000-0000-0000-0000000000f1', 'Asha'),
  ('00000000-0000-0000-0000-0000000000f2', 'Ravi');
-- Ravi is "presented" on the talent pool vacancy only.
insert into public.applications (vacancy_id, candidate_id, stage) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', 'presented'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000f2', 'presented');

-- The owner check: exactly talent pool, or an owner.
select pg_temp.fails($$insert into public.vacancies (title) values ('No owner')$$, 'a vacancy without client, prospect or talent pool');
select pg_temp.fails(
  $$insert into public.vacancies (title, is_talent_pool, client_id) values ('Both', true, '00000000-0000-0000-0000-0000000000c1')$$,
  'a talent pool vacancy with a client');
select pg_temp.fails(
  $$insert into public.vacancies (title, is_talent_pool, company_id) values ('Both', true, '00000000-0000-0000-0000-0000000000d1')$$,
  'a talent pool vacancy with a prospect');

do $$ begin
  if (select count(*) from public.vacancies) <> 2 then
    raise exception 'FAIL: staff should see both vacancies';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The client portal never sees the talent pool vacancy or its pipeline
-- ---------------------------------------------------------------------------

reset role;
insert into storage.objects (bucket_id, name) values
  ('attachments', 'candidate/00000000-0000-0000-0000-0000000000f1/cv.pdf'),
  ('attachments', 'candidate/00000000-0000-0000-0000-0000000000f2/cv.pdf');

select pg_temp.act('sabine@kg.nl');
set role authenticated;

do $$ begin
  if (select count(*) from public.vacancies) <> 1
     or exists (select 1 from public.vacancies where is_talent_pool) then
    raise exception 'FAIL: a client sees only their own vacancy, never the talent pool';
  end if;
  if (select count(*) from public.applications) <> 1 then
    raise exception 'FAIL: a client sees no applications of talent pool vacancies';
  end if;
  if exists (select 1 from public.candidates where full_name = 'Ravi') then
    raise exception 'FAIL: a client sees no candidates presented on talent pool vacancies';
  end if;
  if (select count(*) from storage.objects) <> 1 then
    raise exception 'FAIL: a client opens no files of talent pool candidates';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Linking the talent pool vacancy to the client makes it a normal vacancy
-- ---------------------------------------------------------------------------

select pg_temp.act('floris@nordavo.nl');
update public.vacancies
  set is_talent_pool = false, client_id = '00000000-0000-0000-0000-0000000000c1'
  where id = '00000000-0000-0000-0000-0000000000e2';

select pg_temp.act('sabine@kg.nl');
do $$ begin
  if (select count(*) from public.vacancies) <> 2 then
    raise exception 'FAIL: a linked vacancy shows in the client portal';
  end if;
  if not exists (select 1 from public.candidates where full_name = 'Ravi') then
    raise exception 'FAIL: candidates presented on a linked vacancy become visible';
  end if;
end $$;

reset role;
rollback;

\echo 'talent pool RLS tests passed'
