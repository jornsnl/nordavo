-- Access rules of the task tool (supabase/migrations/*_work.sql), played out
-- with real RLS. Run against a database with every migration applied, for
-- example a local Supabase after `supabase db reset`:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/work_rls.test.sql
--
-- Everything happens in one transaction that is rolled back at the end.
-- A failed check raises an exception and stops the script.

begin;

-- ---------------------------------------------------------------------------
-- People. Julius runs the portal; Floris and Judith work at Nordavo; Sabine
-- is at KG; Fred is a freelancer; Mira is a member who is not in the
-- private project.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'julius@nordavo.nl', '{"full_name": "Julius"}'),
  ('00000000-0000-0000-0000-00000000000b', 'floris@nordavo.nl', '{"full_name": "Floris"}'),
  ('00000000-0000-0000-0000-00000000000c', 'judith@nordavo.nl', '{"full_name": "Judith"}'),
  ('00000000-0000-0000-0000-00000000000d', 'sabine@kg.nl', '{"full_name": "Sabine"}'),
  ('00000000-0000-0000-0000-00000000000e', 'fred@freelance.dev', '{"full_name": "Fred"}'),
  ('00000000-0000-0000-0000-00000000000f', 'mira@nordavo.nl', '{"full_name": "Mira"}');

-- New accounts never get portal access by themselves.
do $$ begin
  if exists (select 1 from public.profiles where role <> 'external') then
    raise exception 'FAIL: new accounts should start as external';
  end if;
end $$;

update public.profiles set role = 'admin' where email = 'julius@nordavo.nl';
update public.profiles set role = 'member' where email in ('floris@nordavo.nl', 'judith@nordavo.nl', 'mira@nordavo.nl');

create temporary table ids (name text primary key, id uuid);
grant select, insert on ids to authenticated;

create or replace function pg_temp.act(p_email text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', (select id from auth.users where email = p_email),
    'role', 'authenticated',
    'email', p_email)::text, false);
end $$;

create or replace function pg_temp.id(p_name text) returns uuid language sql as $$
  select id from ids where name = p_name
$$;

create or replace function pg_temp.uid(p_email text) returns uuid language sql security definer as $$
  select id from auth.users where email = p_email
$$;

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

grant execute on function pg_temp.act(text), pg_temp.id(text), pg_temp.uid(text), pg_temp.fails(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Julius sets up both workspaces
-- ---------------------------------------------------------------------------

select pg_temp.act('julius@nordavo.nl');
set role authenticated;

insert into ids values ('nordavo', public.work_create_workspace('Nordavo', 'nordavo'));
insert into ids values ('kg', public.work_create_workspace('KG', 'kg'));

reset role;
-- Members join through invites; done directly here to keep the test short.
insert into public.work_members (workspace_id, user_id, role) values
  (pg_temp.id('nordavo'), pg_temp.uid('floris@nordavo.nl'), 'member'),
  (pg_temp.id('nordavo'), pg_temp.uid('judith@nordavo.nl'), 'member'),
  (pg_temp.id('nordavo'), pg_temp.uid('mira@nordavo.nl'), 'member'),
  (pg_temp.id('kg'), pg_temp.uid('sabine@kg.nl'), 'member'),
  (pg_temp.id('kg'), pg_temp.uid('judith@nordavo.nl'), 'guest');

-- Floris is not a portal admin, so he cannot start a workspace.
select pg_temp.act('floris@nordavo.nl');
set role authenticated;
select pg_temp.fails($$select public.work_create_workspace('Mine', 'mine')$$, 'workspace by a non-admin');

-- ---------------------------------------------------------------------------
-- Criterion 1: Floris hands out a task, Judith picks it up and sends it to
-- review, Floris gets a notification and approves or sends it back.
-- ---------------------------------------------------------------------------

insert into ids values ('hiring', public.work_create_project(pg_temp.id('nordavo'), 'Hiring', null, 'open', false));
insert into ids values ('task1', public.work_create_task(
  pg_temp.id('hiring'), 'Screen Magento candidates', 'Goal: shortlist of 3', 'high',
  now() + interval '2 days', null, array[pg_temp.uid('judith@nordavo.nl')]));

-- The reviewer defaults to the maker.
do $$ begin
  if (select reviewer_id from public.work_tasks where id = pg_temp.id('task1')) <> pg_temp.uid('floris@nordavo.nl') then
    raise exception 'FAIL: reviewer should default to the maker';
  end if;
end $$;

select pg_temp.act('judith@nordavo.nl');
select public.work_set_status(pg_temp.id('task1'), 'in_progress');
select public.work_add_comment(pg_temp.id('task1'), 'Two found, still looking', '{}');
-- Judith is not the reviewer: no shortcut to Done.
select pg_temp.fails($$select public.work_set_status(pg_temp.id('task1'), 'done')$$, 'done by a non-reviewer');
select public.work_set_status(pg_temp.id('task1'), 'review');

reset role;
do $$ begin
  if not exists (
    select 1 from public.work_notifications
    where user_id = pg_temp.uid('floris@nordavo.nl') and kind = 'review'
      and task_id = pg_temp.id('task1') and delivery = 'instant'
  ) then
    raise exception 'FAIL: the reviewer should get an instant review notification';
  end if;
end $$;
set role authenticated;

select pg_temp.act('floris@nordavo.nl');
-- Sending it back needs a comment.
select pg_temp.fails($$select public.work_set_status(pg_temp.id('task1'), 'in_progress')$$, 'return without a comment');
select public.work_set_status(pg_temp.id('task1'), 'in_progress', 'Please add the salary expectations');

reset role;
do $$ begin
  if not exists (select 1 from public.work_comments where task_id = pg_temp.id('task1') and kind = 'returned') then
    raise exception 'FAIL: the return comment should be stored';
  end if;
  if not exists (
    select 1 from public.work_notifications
    where user_id = pg_temp.uid('judith@nordavo.nl') and kind = 'returned' and task_id = pg_temp.id('task1')
  ) then
    raise exception 'FAIL: owners should hear that the task came back';
  end if;
end $$;
set role authenticated;

select pg_temp.act('judith@nordavo.nl');
select public.work_set_status(pg_temp.id('task1'), 'review');
select pg_temp.act('floris@nordavo.nl');
select public.work_set_status(pg_temp.id('task1'), 'done');

do $$ begin
  if (select status from public.work_tasks where id = pg_temp.id('task1')) <> 'done' then
    raise exception 'FAIL: the reviewer should be able to approve';
  end if;
  if (select count(*) from public.work_task_activity where task_id = pg_temp.id('task1')) < 6 then
    raise exception 'FAIL: the activity log should record the changes';
  end if;
end $$;

-- Users cannot write to the tables directly, only through the functions.
select pg_temp.fails($$update public.work_tasks set status = 'done' where id = pg_temp.id('task1')$$, 'direct update');
select pg_temp.fails($$insert into public.work_comments (task_id, body) values (pg_temp.id('task1'), 'x')$$, 'direct insert');
select pg_temp.fails($$delete from public.work_tasks where id = pg_temp.id('task1')$$, 'direct delete');

-- ---------------------------------------------------------------------------
-- Criterion 2: a freelancer invited to one private project sees only that
-- project and can update tasks there.
-- ---------------------------------------------------------------------------

insert into ids values ('magento', public.work_create_project(pg_temp.id('nordavo'), 'Vacancy Magento', null, 'private', false));
insert into ids values ('secret', public.work_create_project(pg_temp.id('nordavo'), 'Board', null, 'private', false));
insert into ids values ('mtask', public.work_create_task(pg_temp.id('magento'), 'Write job ad'));
insert into ids values ('stask', public.work_create_task(pg_temp.id('secret'), 'Budget 2027'));
insert into ids values ('htask', public.work_create_task(pg_temp.id('hiring'), 'Open hiring task'));

-- Members invite guests only into projects they manage.
select public.work_create_invite(pg_temp.id('nordavo'), pg_temp.id('magento'), 'Fred@Freelance.dev', 'guest',
  now() + interval '30 days', 'hash-fred');
select pg_temp.fails($$select public.work_create_invite(pg_temp.id('nordavo'), null, 'x@y.nl', 'member', null, 'hash-x')$$,
  'member inviting a member');

-- The invite cannot be used by someone else.
select pg_temp.act('mira@nordavo.nl');
select pg_temp.fails($$select * from public.work_accept_invite('hash-fred')$$, 'accepting another person''s invite');

select pg_temp.act('fred@freelance.dev');
do $$ begin
  if (select status from public.work_invite_preview('hash-fred')) <> 'open' then
    raise exception 'FAIL: the invite should be open';
  end if;
end $$;
select * from public.work_accept_invite('hash-fred');

do $$ begin
  if (select count(*) from public.work_projects) <> 1
     or not exists (select 1 from public.work_projects where id = pg_temp.id('magento')) then
    raise exception 'FAIL: the guest should see exactly one project';
  end if;
  if exists (select 1 from public.work_tasks where id in (pg_temp.id('stask'), pg_temp.id('htask'), pg_temp.id('task1'))) then
    raise exception 'FAIL: the guest should not see tasks outside the project';
  end if;
  if (select count(*) from public.work_workspaces) <> 1 then
    raise exception 'FAIL: the guest should see only the Nordavo workspace';
  end if;
  -- Names: people in the project (Floris made it) and admins, nobody else.
  if exists (select 1 from public.profiles where email in ('mira@nordavo.nl', 'sabine@kg.nl', 'judith@nordavo.nl')) then
    raise exception 'FAIL: the guest should only see people in their projects';
  end if;
  if not exists (select 1 from public.profiles where email = 'floris@nordavo.nl') then
    raise exception 'FAIL: the guest should see the people in the project';
  end if;
end $$;

-- Fred works on the task: status, comment, subtask.
select public.work_set_status(pg_temp.id('mtask'), 'in_progress');
select public.work_add_comment(pg_temp.id('mtask'), 'Draft is in the doc', '{}');
select public.work_create_task(pg_temp.id('magento'), 'Check spelling', null, 'normal', null, null, '{}', pg_temp.id('mtask'));

-- ...but nothing outside it, not even with the ids in hand.
select pg_temp.fails($$select public.work_set_status(pg_temp.id('stask'), 'in_progress')$$, 'guest changing a hidden task');
select pg_temp.fails($$select public.work_add_comment(pg_temp.id('htask'), 'hi', '{}')$$, 'guest commenting outside');
select pg_temp.fails($$select public.work_create_task(pg_temp.id('secret'), 'x')$$, 'guest creating outside');
select pg_temp.fails($$select public.work_create_project(pg_temp.id('nordavo'), 'Mine')$$, 'guest creating a project');
select pg_temp.fails($$select public.work_archive_task(pg_temp.id('mtask'))$$, 'guest archiving');
select pg_temp.fails($$select public.work_add_project_member(pg_temp.id('magento'), pg_temp.uid('mira@nordavo.nl'))$$, 'guest adding people');

do $$ begin
  if exists (select 1 from public.work_search('Budget')) then
    raise exception 'FAIL: search should only find visible tasks';
  end if;
  if not exists (select 1 from public.work_search('job ad')) then
    raise exception 'FAIL: search should find the guest''s own tasks';
  end if;
end $$;

-- Files follow the task.
reset role;
insert into storage.objects (bucket_id, name) values
  ('work', 'task/' || pg_temp.id('stask') || '/abc-budget.pdf'),
  ('work', 'task/' || pg_temp.id('mtask') || '/abc-ad.pdf');
set role authenticated;
do $$ begin
  if exists (select 1 from storage.objects where name like '%budget%') then
    raise exception 'FAIL: the guest should not see files of hidden tasks';
  end if;
  if not exists (select 1 from storage.objects where name like '%ad.pdf') then
    raise exception 'FAIL: the guest should see files of their tasks';
  end if;
end $$;
select pg_temp.fails($$insert into storage.objects (bucket_id, name) values ('work', 'task/' || pg_temp.id('stask') || '/x.pdf')$$,
  'guest uploading to a hidden task');

-- Mira is a member but not in the private projects.
select pg_temp.act('mira@nordavo.nl');
do $$ begin
  if exists (select 1 from public.work_projects where id in (pg_temp.id('magento'), pg_temp.id('secret'))) then
    raise exception 'FAIL: members should not see private projects they are not in';
  end if;
  if not exists (select 1 from public.work_projects where id = pg_temp.id('hiring')) then
    raise exception 'FAIL: members should see open projects';
  end if;
end $$;

-- Access can be revoked per project at once, without removing the account.
select pg_temp.act('floris@nordavo.nl');
select public.work_remove_project_member(pg_temp.id('magento'), pg_temp.uid('fred@freelance.dev'));
select pg_temp.act('fred@freelance.dev');
do $$ begin
  if exists (select 1 from public.work_projects) or exists (select 1 from public.work_tasks) then
    raise exception 'FAIL: revoked access should hide the project at once';
  end if;
end $$;

-- And it expires by itself.
reset role;
insert into public.work_project_members (project_id, user_id, access_expires_at)
values (pg_temp.id('magento'), pg_temp.uid('fred@freelance.dev'), now() - interval '1 minute');
set role authenticated;
do $$ begin
  if exists (select 1 from public.work_projects) then
    raise exception 'FAIL: expired access should not count';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Guests who see only their own tasks
-- ---------------------------------------------------------------------------

reset role;
update public.work_project_members set access_expires_at = null
where project_id = pg_temp.id('magento') and user_id = pg_temp.uid('fred@freelance.dev');
set role authenticated;

select pg_temp.act('floris@nordavo.nl');
select public.work_set_assignees(pg_temp.id('mtask'), array[pg_temp.uid('fred@freelance.dev')]);
select public.work_update_project(pg_temp.id('magento'), 'Vacancy Magento', null, 'private', true, false);
insert into ids values ('other', public.work_create_task(pg_temp.id('magento'), 'Interview notes'));
select pg_temp.act('fred@freelance.dev');
do $$ begin
  if exists (select 1 from public.work_tasks where id = pg_temp.id('other')) then
    raise exception 'FAIL: with "own tasks only" the guest should not see other tasks';
  end if;
  if not exists (select 1 from public.work_tasks where id = pg_temp.id('mtask')) then
    raise exception 'FAIL: the guest should still see the tasks assigned to them';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Criterion 3: someone in both Nordavo and KG sees their tasks from both.
-- ---------------------------------------------------------------------------

select pg_temp.act('sabine@kg.nl');
insert into ids values ('kgproj', public.work_create_project(pg_temp.id('kg'), 'KG ops', null, 'open', false));
select public.work_add_project_member(pg_temp.id('kgproj'), pg_temp.uid('judith@nordavo.nl'));
select public.work_create_task(pg_temp.id('kgproj'), 'KG invoice run', null, 'normal', now() + interval '1 day',
  null, array[pg_temp.uid('judith@nordavo.nl')]);
do $$ begin
  if exists (select 1 from public.work_workspaces where id = pg_temp.id('nordavo')) then
    raise exception 'FAIL: workspaces are fully separate';
  end if;
end $$;

select pg_temp.act('floris@nordavo.nl');
select public.work_create_task(pg_temp.id('hiring'), 'Call candidates', null, 'normal', null, null,
  array[pg_temp.uid('judith@nordavo.nl')]);

select pg_temp.act('judith@nordavo.nl');
do $$ begin
  if (
    select count(distinct t.workspace_id)
    from public.work_tasks t
    join public.work_task_assignees a on a.task_id = t.id
    where a.user_id = pg_temp.uid('judith@nordavo.nl') and t.status <> 'done'
  ) <> 2 then
    raise exception 'FAIL: Judith should see her open tasks from both workspaces';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Criterion 4 (the API side): the checks the API uses give the same answers.
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '{"role": "service_role"}', false);
do $$ begin
  if public.work_api_can_view_task(pg_temp.id('stask'), pg_temp.uid('fred@freelance.dev')) then
    raise exception 'FAIL: API check should hide the hidden task';
  end if;
  if not public.work_api_can_view_task(pg_temp.id('mtask'), pg_temp.uid('fred@freelance.dev')) then
    raise exception 'FAIL: API check should allow the guest''s own task';
  end if;
  if exists (select 1 from public.work_api_list_tasks(pg_temp.uid('fred@freelance.dev')) where project_id <> pg_temp.id('magento')) then
    raise exception 'FAIL: API task list leaks other projects';
  end if;
end $$;

-- Acting for a user through the API obeys that user's rights.
select pg_temp.fails($$select public.work_set_status(pg_temp.id('stask'), 'in_progress', null, pg_temp.uid('fred@freelance.dev'))$$,
  'API write outside the guest''s projects');
select public.work_add_comment(pg_temp.id('mtask'), 'Via the API', '{}', pg_temp.uid('fred@freelance.dev'));
do $$ begin
  if (select author_id from public.work_comments where body = 'Via the API') <> pg_temp.uid('fred@freelance.dev') then
    raise exception 'FAIL: API comments should be written as the token owner';
  end if;
end $$;

-- p_actor means nothing for a signed-in user.
select pg_temp.act('fred@freelance.dev');
set role authenticated;
select pg_temp.fails($$select public.work_set_status(pg_temp.id('stask'), 'in_progress', null, pg_temp.uid('julius@nordavo.nl'))$$,
  'impersonating through p_actor');
select pg_temp.fails($$select public.work_api_list_tasks(pg_temp.uid('julius@nordavo.nl'))$$, 'calling API helpers as a user');

-- ---------------------------------------------------------------------------
-- Trash, deactivation and the access log
-- ---------------------------------------------------------------------------

select pg_temp.act('floris@nordavo.nl');
select public.work_archive_task(pg_temp.id('htask'));
select pg_temp.act('mira@nordavo.nl');
do $$ begin
  if exists (select 1 from public.work_tasks where id = pg_temp.id('htask')) then
    raise exception 'FAIL: archived tasks are only visible to admins and their maker';
  end if;
end $$;
select pg_temp.fails($$select public.work_restore_task(pg_temp.id('htask'))$$, 'restoring someone else''s task');
select pg_temp.act('floris@nordavo.nl');
select public.work_restore_task(pg_temp.id('htask'));

select pg_temp.act('julius@nordavo.nl');
select public.work_set_assignees(pg_temp.id('htask'), array[pg_temp.uid('mira@nordavo.nl')]);
select public.work_deactivate_member(pg_temp.id('nordavo'), pg_temp.uid('mira@nordavo.nl'), pg_temp.uid('judith@nordavo.nl'));
do $$ begin
  if not exists (select 1 from public.work_task_assignees where task_id = pg_temp.id('htask') and user_id = pg_temp.uid('judith@nordavo.nl'))
     or exists (select 1 from public.work_task_assignees where task_id = pg_temp.id('htask') and user_id = pg_temp.uid('mira@nordavo.nl')) then
    raise exception 'FAIL: open tasks should move to the new owner';
  end if;
  if (select count(*) from public.work_access_log where workspace_id = pg_temp.id('nordavo')) < 5 then
    raise exception 'FAIL: access changes should be logged';
  end if;
end $$;

select pg_temp.act('mira@nordavo.nl');
do $$ begin
  if exists (select 1 from public.work_workspaces) then
    raise exception 'FAIL: deactivated people lose access';
  end if;
end $$;

reset role;
rollback;

\echo 'work RLS tests passed'
