-- Private workspaces, the inbox and archiving a workspace
-- (20261121000000_work_personal.sql), played out with real RLS:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/work_personal.test.sql
--
-- Julius and Jorn are portal admins, Floris is a member, Fred is a freelancer
-- (external). One transaction, rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'julius@nordavo.nl', '{"full_name": "Julius"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'jorn@nordavo.nl', '{"full_name": "Jorn"}'),
  ('00000000-0000-0000-0000-0000000000a3', 'floris@nordavo.nl', '{"full_name": "Floris"}'),
  ('00000000-0000-0000-0000-0000000000a4', 'fred@freelance.dev', '{"full_name": "Fred"}');

update public.profiles set role = 'admin' where email in ('julius@nordavo.nl', 'jorn@nordavo.nl');
update public.profiles set role = 'member' where email = 'floris@nordavo.nl';

create temporary table ids (name text primary key, id uuid);
grant select, insert on ids to authenticated;

create or replace function pg_temp.act(p_email text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', (select id from auth.users where email = p_email),
    'role', 'authenticated',
    'email', p_email)::text, false);
end $$;
create or replace function pg_temp.id(p_name text) returns uuid language sql as $$ select id from ids where name = p_name $$;
create or replace function pg_temp.uid(p_email text) returns uuid language sql security definer as $$
  select id from auth.users where email = p_email $$;
create or replace function pg_temp.fails(p_sql text, p_what text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL: % should have been refused', p_what;
exception
  when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  when others then null;
end $$;
grant execute on function pg_temp.act(text), pg_temp.id(text), pg_temp.uid(text), pg_temp.fails(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Julius makes two private workspaces; nobody else sees them
-- ---------------------------------------------------------------------------

select pg_temp.act('julius@nordavo.nl');
set role authenticated;
insert into ids values ('nordavo', (select id from public.work_workspaces where slug = 'nordavo'));
insert into ids values ('home', public.work_create_private_workspace('Home', 'home'));
insert into ids values ('sport', public.work_create_private_workspace('Sport', null));
insert into ids values ('home_project', (select id from public.work_projects where workspace_id = pg_temp.id('home')));
insert into ids values ('home_task', public.work_create_task(pg_temp.id('home_project'), 'Call the plumber', null, 'normal', null, null,
  array[pg_temp.uid('julius@nordavo.nl')]));

do $$ begin
  if (select count(*) from public.work_workspaces where kind = 'private') <> 2 then
    raise exception 'FAIL: Julius should see his two private workspaces';
  end if;
  if (select owner_id from public.work_workspaces where id = pg_temp.id('home')) <> pg_temp.uid('julius@nordavo.nl') then
    raise exception 'FAIL: the maker owns the private workspace';
  end if;
end $$;

-- Nobody else can be added, invited or made owner or reviewer.
select pg_temp.fails($$select public.work_create_invite(pg_temp.id('home'), null, 'jorn@nordavo.nl', 'member', null, 'hash-1')$$,
  'an invite into a private workspace');
select pg_temp.fails($$select public.work_set_assignees(pg_temp.id('home_task'), array[pg_temp.uid('jorn@nordavo.nl')])$$,
  'another owner on a private task');
select pg_temp.fails($$select public.work_update_task(pg_temp.id('home_task'), jsonb_build_object('reviewer_id', pg_temp.uid('jorn@nordavo.nl')))$$,
  'another reviewer on a private task');
reset role;
select pg_temp.fails($$insert into public.work_members (workspace_id, user_id, role) values (pg_temp.id('home'), pg_temp.uid('jorn@nordavo.nl'), 'admin')$$,
  'another member in a private workspace, even with the secret key');
select pg_temp.fails($$insert into public.work_project_members (project_id, user_id) values (pg_temp.id('home_project'), pg_temp.uid('jorn@nordavo.nl'))$$,
  'another project member in a private workspace');

-- Jorn, also a portal admin, sees nothing of it.
select pg_temp.act('jorn@nordavo.nl');
set role authenticated;
do $$ begin
  if exists (select 1 from public.work_workspaces where id in (pg_temp.id('home'), pg_temp.id('sport')))
     or exists (select 1 from public.work_projects where workspace_id = pg_temp.id('home'))
     or exists (select 1 from public.work_tasks where id = pg_temp.id('home_task')) then
    raise exception 'FAIL: another admin should not see a private workspace';
  end if;
  if exists (select 1 from public.work_search('plumber')) then
    raise exception 'FAIL: search should not find a private task of someone else';
  end if;
end $$;
select pg_temp.fails($$select public.work_rename_workspace(pg_temp.id('home'), 'Mine')$$, 'renaming someone else''s private workspace');

-- Floris (member) may make his own; Fred (external) may not.
select pg_temp.act('floris@nordavo.nl');
insert into ids values ('floris_space', public.work_create_private_workspace('Floris private', 'home'));
do $$ begin
  if (select slug from public.work_workspaces where id = pg_temp.id('floris_space')) = 'home' then
    raise exception 'FAIL: a taken web address should get a number';
  end if;
end $$;
select pg_temp.act('fred@freelance.dev');
select pg_temp.fails($$select public.work_create_private_workspace('Fred', null)$$, 'a private workspace for an external account');

-- ---------------------------------------------------------------------------
-- The inbox: one per user, also for Fred, and sorting it later
-- ---------------------------------------------------------------------------

insert into ids values ('fred_inbox', public.work_ensure_inbox());
do $$ begin
  if public.work_ensure_inbox() <> pg_temp.id('fred_inbox') then
    raise exception 'FAIL: the inbox is made once';
  end if;
end $$;

select pg_temp.act('julius@nordavo.nl');
insert into ids values ('inbox', public.work_ensure_inbox());
insert into ids values ('dump', public.work_create_task(pg_temp.id('inbox'), 'Book the dentist', null, 'normal', null, null,
  array[pg_temp.uid('julius@nordavo.nl')]));
select public.work_create_task(pg_temp.id('inbox'), 'Subtask', p_parent => pg_temp.id('dump'), p_assignees => array[pg_temp.uid('julius@nordavo.nl')]);
insert into ids values ('hiring', public.work_create_project(pg_temp.id('nordavo'), 'Hiring', null, 'open', false));
select pg_temp.fails($$select public.work_archive_workspace((select workspace_id from public.work_projects where id = pg_temp.id('inbox')), true)$$,
  'archiving the inbox');

-- Sort: from the inbox to a shared project in Nordavo, subtasks along.
select public.work_move_task(pg_temp.id('dump'), pg_temp.id('hiring'));
do $$ begin
  if (select count(*) from public.work_tasks where (id = pg_temp.id('dump') or parent_id = pg_temp.id('dump'))
      and workspace_id = pg_temp.id('nordavo') and project_id = pg_temp.id('hiring')) <> 2 then
    raise exception 'FAIL: a task and its subtasks move out of the inbox into another workspace';
  end if;
end $$;
-- Back from a shared workspace into the inbox is not possible.
select pg_temp.fails($$select public.work_move_task(pg_temp.id('dump'), pg_temp.id('inbox'))$$, 'a shared task into the inbox');

-- Jorn's tasks in Nordavo cannot be moved into Julius' private workspace either.
reset role;
insert into public.work_members (workspace_id, user_id, role) values (pg_temp.id('nordavo'), pg_temp.uid('jorn@nordavo.nl'), 'member')
on conflict do nothing;
set role authenticated;
select pg_temp.act('jorn@nordavo.nl');
insert into ids values ('jorn_task', public.work_create_task(pg_temp.id('hiring'), 'Jorn''s task', null, 'normal', null, null,
  array[pg_temp.uid('jorn@nordavo.nl')]));
select pg_temp.fails($$select public.work_move_task(pg_temp.id('jorn_task'), pg_temp.id('home_project'))$$, 'moving into someone else''s private workspace');

-- ---------------------------------------------------------------------------
-- Archiving a workspace
-- ---------------------------------------------------------------------------

select pg_temp.act('julius@nordavo.nl');
select public.work_archive_workspace(pg_temp.id('sport'), true);
do $$ begin
  if (select archived_at from public.work_workspaces where id = pg_temp.id('sport')) is null then
    raise exception 'FAIL: the workspace should be archived';
  end if;
end $$;
select public.work_archive_workspace(pg_temp.id('sport'), false);

select pg_temp.act('floris@nordavo.nl');
select pg_temp.fails($$select public.work_archive_workspace(pg_temp.id('nordavo'), true)$$, 'archiving by a member');

reset role;
do $$ begin
  if (select archived_at from public.work_workspaces where id = pg_temp.id('sport')) is not null then
    raise exception 'FAIL: the workspace should be back';
  end if;
  if not exists (select 1 from public.work_access_log where workspace_id = pg_temp.id('sport') and action = 'archived')
     or not exists (select 1 from public.work_access_log where workspace_id = pg_temp.id('sport') and action = 'restored') then
    raise exception 'FAIL: archiving and restoring are logged';
  end if;
end $$;

rollback;

\echo 'work personal tests passed'
