-- Meetings in Work (20261125300000_work_meetings.sql): who sees which agenda,
-- who may add, change, make tasks and close, and how points move on. Played out
-- with real RLS:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/work_meetings.test.sql
--
-- Julius and Jorn are portal admins (admins of Nordavo), Floris and Judith are
-- members, Fred is a freelancer (guest of Nordavo, later), Mia is an outsider.
-- One transaction, rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'julius@nordavo.nl', '{"full_name": "Julius"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'jorn@nordavo.nl', '{"full_name": "Jorn"}'),
  ('00000000-0000-0000-0000-0000000000a3', 'floris@nordavo.nl', '{"full_name": "Floris"}'),
  ('00000000-0000-0000-0000-0000000000a4', 'judith@nordavo.nl', '{"full_name": "Judith"}'),
  ('00000000-0000-0000-0000-0000000000a5', 'fred@freelance.dev', '{"full_name": "Fred"}'),
  ('00000000-0000-0000-0000-0000000000a6', 'mia@elsewhere.nl', '{"full_name": "Mia"}');

update public.profiles set role = 'admin' where email in ('julius@nordavo.nl', 'jorn@nordavo.nl');
update public.profiles set role = 'member' where email in ('floris@nordavo.nl', 'judith@nordavo.nl');

create temporary table ids (name text primary key, id uuid);
grant select, insert on ids to authenticated, service_role;

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
-- How many agenda points the current user sees in a meeting.
create or replace function pg_temp.seen(p_meeting text) returns integer language sql as $$
  select count(*)::integer from public.work_agenda_items where meeting_id = pg_temp.id(p_meeting) $$;
create or replace function pg_temp.sees(p_meeting text) returns boolean language sql as $$
  select exists (select 1 from public.work_meetings where id = pg_temp.id(p_meeting)) $$;
grant execute on function pg_temp.act(text), pg_temp.id(text), pg_temp.uid(text), pg_temp.fails(text, text),
  pg_temp.seen(text), pg_temp.sees(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Two meetings: a weekly for two people, a team meeting for the workspace
-- ---------------------------------------------------------------------------

select pg_temp.act('julius@nordavo.nl');
set role authenticated;
insert into ids values ('nordavo', (select id from public.work_workspaces where slug = 'nordavo'));
insert into ids values ('weekly', public.work_create_meeting(pg_temp.id('nordavo'), 'Weekly with Floris', 'invited',
  array[pg_temp.uid('floris@nordavo.nl')]));
insert into ids values ('team', public.work_create_meeting(pg_temp.id('nordavo'), 'Team meeting'));

-- Everyone picked has to be in the workspace; a guest cannot make a meeting.
select pg_temp.fails($$select public.work_create_meeting(pg_temp.id('nordavo'), 'Outsiders', 'invited', array[pg_temp.uid('mia@elsewhere.nl')])$$,
  'a meeting with someone who is not in the workspace');
select pg_temp.fails($$select public.work_create_meeting(pg_temp.id('nordavo'), 'x', 'secret')$$, 'an unknown visibility');
select pg_temp.fails($$select public.work_create_meeting(pg_temp.id('nordavo'), '   ')$$, 'a meeting without a name');
-- The inbox is for tasks.
select pg_temp.fails($$select public.work_create_meeting((select workspace_id from public.work_projects where id = public.work_ensure_inbox()), 'x')$$, 'a meeting in the inbox');

-- Each meeting starts with one open session.
do $$ begin
  if (select count(*) from public.work_meeting_sessions where closed_at is null) <> 2 then
    raise exception 'FAIL: each meeting has one open session';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Who sees what
-- ---------------------------------------------------------------------------

select public.work_add_agenda_item(pg_temp.id('weekly'), 'Hiring plan Q1', 'Two roles?');
select public.work_add_agenda_item(pg_temp.id('team'), 'Office move');

select pg_temp.act('floris@nordavo.nl');
do $$ begin
  if not pg_temp.sees('weekly') or not pg_temp.sees('team') then
    raise exception 'FAIL: Floris sees the meeting he is invited to and the team meeting';
  end if;
  if pg_temp.seen('weekly') <> 1 or pg_temp.seen('team') <> 1 then
    raise exception 'FAIL: Floris sees the points of both';
  end if;
  if (select count(*) from public.work_meeting_members where meeting_id = pg_temp.id('weekly')) <> 1 then
    raise exception 'FAIL: the people picked are listed';
  end if;
end $$;

-- Judith is a member, but not invited to the weekly.
select pg_temp.act('judith@nordavo.nl');
do $$ begin
  if pg_temp.sees('weekly') or pg_temp.seen('weekly') <> 0 then
    raise exception 'FAIL: Judith should not see the weekly or its points';
  end if;
  if not pg_temp.sees('team') then
    raise exception 'FAIL: Judith sees the team meeting';
  end if;
end $$;
select pg_temp.fails($$select public.work_add_agenda_item(pg_temp.id('weekly'), 'Sneaky')$$, 'a point on a meeting you cannot see');

-- Jorn is an admin of the workspace: still no weekly (privacy follows the invitation, not the role).
select pg_temp.act('jorn@nordavo.nl');
do $$ begin
  if pg_temp.sees('weekly') or pg_temp.seen('weekly') <> 0 then
    raise exception 'FAIL: a workspace admin should not see a meeting he was not invited to';
  end if;
  if not pg_temp.sees('team') then
    raise exception 'FAIL: a workspace admin sees the team meeting';
  end if;
end $$;
select pg_temp.fails($$select public.work_update_meeting(pg_temp.id('weekly'), 'Mine now', 'workspace')$$, 'an admin taking over a meeting he cannot see');
select pg_temp.fails($$select public.work_close_meeting(pg_temp.id('weekly'))$$, 'an admin closing a meeting he cannot see');

-- An outsider and a guest see nothing; a guest picked for a meeting sees that one.
select pg_temp.act('mia@elsewhere.nl');
do $$ begin
  if exists (select 1 from public.work_meetings) or exists (select 1 from public.work_agenda_items) then
    raise exception 'FAIL: an outsider should see no meetings';
  end if;
end $$;
select pg_temp.fails($$select public.work_add_agenda_item(pg_temp.id('team'), 'Hello')$$, 'a point by an outsider');

reset role;
insert into public.work_members (workspace_id, user_id, role) values (pg_temp.id('nordavo'), pg_temp.uid('fred@freelance.dev'), 'guest');
set role authenticated;
select pg_temp.act('fred@freelance.dev');
do $$ begin
  if pg_temp.sees('team') or pg_temp.sees('weekly') then
    raise exception 'FAIL: a guest should not see the workspace meetings';
  end if;
end $$;
select pg_temp.fails($$select public.work_create_meeting(pg_temp.id('nordavo'), 'Guest meeting')$$, 'a meeting made by a guest');
select pg_temp.act('julius@nordavo.nl');
select public.work_update_meeting(pg_temp.id('weekly'), 'Weekly with Floris', 'invited',
  array[pg_temp.uid('floris@nordavo.nl'), pg_temp.uid('fred@freelance.dev')]);
select pg_temp.act('fred@freelance.dev');
do $$ begin
  if not pg_temp.sees('weekly') or pg_temp.seen('weekly') <> 1 then
    raise exception 'FAIL: a guest who was picked sees that meeting';
  end if;
  if pg_temp.sees('team') then
    raise exception 'FAIL: a guest still does not see the team meeting';
  end if;
end $$;
select pg_temp.act('julius@nordavo.nl');
select public.work_update_meeting(pg_temp.id('weekly'), 'Weekly with Floris', 'invited', array[pg_temp.uid('floris@nordavo.nl')]);
select pg_temp.act('fred@freelance.dev');
do $$ begin
  if pg_temp.sees('weekly') then raise exception 'FAIL: taking someone out of a meeting hides it'; end if;
end $$;

-- No direct writes: only the functions.
select pg_temp.act('julius@nordavo.nl');
select pg_temp.fails($$insert into public.work_agenda_items (meeting_id, session_id, title)
  select meeting_id, id, 'Direct' from public.work_meeting_sessions limit 1$$, 'a direct insert');
select pg_temp.fails($$update public.work_agenda_items set status = 'dropped'$$, 'a direct update');
select pg_temp.fails($$delete from public.work_meetings$$, 'a direct delete');
select pg_temp.fails($$insert into public.work_meeting_members (meeting_id, user_id) values (pg_temp.id('weekly'), pg_temp.uid('judith@nordavo.nl'))$$,
  'a direct member insert');

-- ---------------------------------------------------------------------------
-- Adding points: idempotent with a device id, the source cannot be faked
-- ---------------------------------------------------------------------------

select pg_temp.act('judith@nordavo.nl');
insert into ids values ('p_offline', gen_random_uuid());
insert into ids values ('item_offline', public.work_add_agenda_item(pg_temp.id('team'), 'Budget  ', null, pg_temp.id('p_offline'),
  now() - interval '2 hours', 'claude'));
do $$ begin
  if public.work_add_agenda_item(pg_temp.id('team'), 'Budget', null, pg_temp.id('p_offline')) <> pg_temp.id('item_offline') then
    raise exception 'FAIL: the same id twice makes one point';
  end if;
  if (select count(*) from public.work_agenda_items where title = 'Budget') <> 1 then
    raise exception 'FAIL: one point called Budget';
  end if;
  if (select source from public.work_agenda_items where id = pg_temp.id('item_offline')) <> 'portal' then
    raise exception 'FAIL: a signed-in user cannot claim the source claude';
  end if;
  if (select created_at from public.work_agenda_items where id = pg_temp.id('item_offline')) > now() - interval '1 hour' then
    raise exception 'FAIL: a point added offline keeps its time';
  end if;
end $$;
select pg_temp.act('floris@nordavo.nl');
select pg_temp.fails($$select public.work_add_agenda_item(pg_temp.id('team'), 'Stolen', null, pg_temp.id('p_offline'))$$, 'taking over someone else''s id');
select pg_temp.fails($$select public.work_add_agenda_item(pg_temp.id('team'), '')$$, 'an empty point');
select pg_temp.fails($$select public.work_add_agenda_item(pg_temp.id('team'), repeat('x', 301))$$, 'a title over 300 characters');

-- ---------------------------------------------------------------------------
-- Changing points: text by who added it (or the owner of the meeting), the
-- outcome by anyone in the meeting
-- ---------------------------------------------------------------------------

insert into ids values ('item_office', (select id from public.work_agenda_items where title = 'Office move'));
insert into ids values ('item_hiring', (select id from public.work_agenda_items where title = 'Hiring plan Q1'));
select public.work_update_agenda_item(pg_temp.id('item_office'), jsonb_build_object('status', 'discussed', 'decision', 'Move in March'));
do $$ begin
  if (select status from public.work_agenda_items where id = pg_temp.id('item_office')) <> 'discussed'
     or (select decision from public.work_agenda_items where id = pg_temp.id('item_office')) <> 'Move in March'
     or (select decided_by from public.work_agenda_items where id = pg_temp.id('item_office')) <> pg_temp.uid('floris@nordavo.nl') then
    raise exception 'FAIL: anyone in the meeting can record the outcome, with their name';
  end if;
end $$;
select pg_temp.fails($$select public.work_update_agenda_item(pg_temp.id('item_office'), jsonb_build_object('title', 'Renamed'))$$,
  'changing the text of a point someone else added');
select pg_temp.fails($$select public.work_update_agenda_item(pg_temp.id('item_office'), jsonb_build_object('status', 'forwarded'))$$,
  'setting the status forwarded by hand');
select pg_temp.fails($$select public.work_update_agenda_item(pg_temp.id('item_office'), jsonb_build_object('status', 'nonsense'))$$, 'an unknown status');
select pg_temp.fails($$select public.work_update_agenda_item(pg_temp.id('item_hiring'), jsonb_build_object('note', 'Floris edits'))$$,
  'changing the note of a point someone else added');

select pg_temp.act('julius@nordavo.nl');
-- The maker of the meeting may change the text of any point.
select public.work_update_agenda_item(pg_temp.id('item_office'), jsonb_build_object('title', 'Office move (March)'));
-- Clearing the decision clears who wrote it.
select public.work_update_agenda_item(pg_temp.id('item_office'), jsonb_build_object('decision', ''));
do $$ begin
  if (select decided_by from public.work_agenda_items where id = pg_temp.id('item_office')) is not null then
    raise exception 'FAIL: no decision, no decider';
  end if;
end $$;
select public.work_update_agenda_item(pg_temp.id('item_office'), jsonb_build_object('decision', 'Move in March'));

-- ---------------------------------------------------------------------------
-- Make task
-- ---------------------------------------------------------------------------

-- The owner has to be in the meeting: Judith is not in the weekly.
select pg_temp.fails($$select public.work_agenda_item_to_task(pg_temp.id('item_hiring'), pg_temp.uid('judith@nordavo.nl'))$$,
  'a task for someone who is not in the meeting');
select pg_temp.fails($$select public.work_agenda_item_to_task(pg_temp.id('item_hiring'), pg_temp.uid('floris@nordavo.nl'), null, null, null, 'huge')$$,
  'an unknown priority');

-- Julius hands the hiring point to Floris, due Friday: it lands in Floris' inbox.
insert into ids values ('task_hiring', public.work_agenda_item_to_task(pg_temp.id('item_hiring'), pg_temp.uid('floris@nordavo.nl'),
  '2026-11-27 17:00+01'));
select pg_temp.fails($$select public.work_agenda_item_to_task(pg_temp.id('item_hiring'), pg_temp.uid('floris@nordavo.nl'))$$,
  'a second task for the same point');
reset role;
do $$ begin
  if (select task_id from public.work_agenda_items where id = pg_temp.id('item_hiring')) <> pg_temp.id('task_hiring') then
    raise exception 'FAIL: the point links to its task';
  end if;
  if (select status from public.work_agenda_items where id = pg_temp.id('item_hiring')) <> 'discussed' then
    raise exception 'FAIL: a point with a task counts as discussed';
  end if;
  if not exists (
    select 1 from public.work_tasks t
    join public.work_workspaces w on w.id = t.workspace_id
    join public.work_task_assignees a on a.task_id = t.id
    where t.id = pg_temp.id('task_hiring') and w.kind = 'inbox' and w.owner_id = pg_temp.uid('floris@nordavo.nl')
      and a.user_id = pg_temp.uid('floris@nordavo.nl') and t.title = 'Hiring plan Q1'
      and t.due_at = '2026-11-27 17:00+01' and t.created_by = pg_temp.uid('julius@nordavo.nl')
      and t.description like '%Two roles?%' and t.description like '%Weekly with Floris%'
  ) then
    raise exception 'FAIL: the task is in Floris'' inbox with his name, the deadline and the text of the point';
  end if;
  if not exists (select 1 from public.work_notifications where task_id = pg_temp.id('task_hiring')
                 and user_id = pg_temp.uid('floris@nordavo.nl') and kind = 'assigned') then
    raise exception 'FAIL: Floris is told about the task';
  end if;
end $$;

-- Floris sees it as his own task; Julius does not see into Floris' inbox.
select pg_temp.act('floris@nordavo.nl');
set role authenticated;
do $$ begin
  if not exists (select 1 from public.work_tasks where id = pg_temp.id('task_hiring')) then
    raise exception 'FAIL: Floris sees the task in his inbox';
  end if;
end $$;
select pg_temp.act('julius@nordavo.nl');
do $$ begin
  if exists (select 1 from public.work_tasks where id = pg_temp.id('task_hiring')) then
    raise exception 'FAIL: a private inbox stays private for the one who made the task';
  end if;
end $$;

-- A task for yourself goes to your own inbox; with a project, to that project.
insert into ids values ('task_own', public.work_agenda_item_to_task(pg_temp.id('item_office'), null, null, null, 'Plan the move', 'high'));
do $$ begin
  if not exists (
    select 1 from public.work_tasks t join public.work_workspaces w on w.id = t.workspace_id
    where t.id = pg_temp.id('task_own') and w.kind = 'inbox' and w.owner_id = pg_temp.uid('julius@nordavo.nl')
      and t.title = 'Plan the move' and t.priority = 'high'
  ) then
    raise exception 'FAIL: the own task is in Julius'' inbox with the title and priority given';
  end if;
end $$;
insert into ids values ('project', public.work_create_project(pg_temp.id('nordavo'), 'Office'));
insert into ids values ('item_cleanup', public.work_add_agenda_item(pg_temp.id('team'), 'Clean the kitchen'));
insert into ids values ('task_project', public.work_agenda_item_to_task(pg_temp.id('item_cleanup'), pg_temp.uid('judith@nordavo.nl'), null, pg_temp.id('project')));
do $$ begin
  if (select project_id from public.work_tasks where id = pg_temp.id('task_project')) <> pg_temp.id('project')
     or not exists (select 1 from public.work_task_assignees where task_id = pg_temp.id('task_project') and user_id = pg_temp.uid('judith@nordavo.nl')) then
    raise exception 'FAIL: a task in a project goes to the chosen owner';
  end if;
end $$;

-- A dropped point makes no task until it is opened again.
select pg_temp.act('judith@nordavo.nl');
select public.work_update_agenda_item(pg_temp.id('item_offline'), jsonb_build_object('status', 'dropped'));
select pg_temp.fails($$select public.work_agenda_item_to_task(pg_temp.id('item_offline'))$$, 'a task from a dropped point');
select public.work_update_agenda_item(pg_temp.id('item_offline'), jsonb_build_object('status', 'open'));

-- ---------------------------------------------------------------------------
-- Close the meeting: what was not discussed moves on
-- ---------------------------------------------------------------------------

-- Team now: Office move (discussed, task), Budget (open), Clean the kitchen (discussed, task).
insert into ids values ('item_extra', public.work_add_agenda_item(pg_temp.id('team'), 'Holiday cover'));
select public.work_update_agenda_item(pg_temp.id('item_extra'), jsonb_build_object('status', 'dropped'));
insert into ids values ('item_open', public.work_add_agenda_item(pg_temp.id('team'), 'Printer'));

-- Judith is a member, not the maker or an admin: she cannot close.
select pg_temp.fails($$select public.work_close_meeting(pg_temp.id('team'))$$, 'a member closing a meeting she did not make');

-- Jorn, admin of the workspace, may close a meeting for the whole workspace.
select pg_temp.act('jorn@nordavo.nl');
insert into ids values ('session2', public.work_close_meeting(pg_temp.id('team')));
select pg_temp.fails($$select public.work_update_agenda_item(pg_temp.id('item_office'), jsonb_build_object('status', 'open'))$$,
  'changing a point of a closed session');
do $$ begin
  -- One open session again, the old one closed.
  if (select count(*) from public.work_meeting_sessions where meeting_id = pg_temp.id('team') and closed_at is null) <> 1
     or (select id from public.work_meeting_sessions where meeting_id = pg_temp.id('team') and closed_at is null) <> pg_temp.id('session2')
     or (select count(*) from public.work_meeting_sessions where meeting_id = pg_temp.id('team') and closed_at is not null) <> 1 then
    raise exception 'FAIL: closing makes a new open session';
  end if;
  -- Open points moved (Budget, Printer); discussed and dropped stayed.
  if (select count(*) from public.work_agenda_items where session_id = pg_temp.id('session2')) <> 2
     or exists (select 1 from public.work_agenda_items where session_id = pg_temp.id('session2') and (status <> 'open' or carried_count <> 1 or carried_from is null)) then
    raise exception 'FAIL: only the open points move to the next session, with a counter of 1';
  end if;
  if (select status from public.work_agenda_items where id = pg_temp.id('item_open')) <> 'forwarded'
     or (select forwarded_to from public.work_agenda_items where id = pg_temp.id('item_open')) is null
     or (select status from public.work_agenda_items where id = pg_temp.id('item_office')) <> 'discussed'
     or (select status from public.work_agenda_items where id = pg_temp.id('item_extra')) <> 'dropped' then
    raise exception 'FAIL: the old point is forwarded and points to the new one; the others keep their status';
  end if;
  -- The new point keeps who added it and when.
  if not exists (
    select 1 from public.work_agenda_items n join public.work_agenda_items o on o.id = n.carried_from
    where n.title = 'Printer' and n.added_by = o.added_by and n.created_at = o.created_at and o.id = pg_temp.id('item_open')
  ) then
    raise exception 'FAIL: a point that moves on keeps its maker and its first date';
  end if;
  -- The decision and the task stay with the point that was discussed.
  if (select decision from public.work_agenda_items where id = pg_temp.id('item_office')) <> 'Move in March'
     or (select task_id from public.work_agenda_items where id = pg_temp.id('item_office')) <> pg_temp.id('task_own') then
    raise exception 'FAIL: the decision and the task stay on the discussed point';
  end if;
end $$;

-- Closing again: the same points move on once more.
select pg_temp.act('julius@nordavo.nl');
select public.work_close_meeting(pg_temp.id('team'));
do $$ begin
  if (select count(*) from public.work_agenda_items where title = 'Printer' and carried_count = 2) <> 1 then
    raise exception 'FAIL: the counter grows each time a point moves on';
  end if;
  if (select count(*) from public.work_agenda_items where title = 'Printer') <> 3 then
    raise exception 'FAIL: the history of a point stays (3 rounds)';
  end if;
end $$;

-- The weekly is Julius'; Floris is in it, but cannot close it.
select pg_temp.act('floris@nordavo.nl');
select pg_temp.fails($$select public.work_close_meeting(pg_temp.id('weekly'))$$, 'a closed weekly by someone invited');
select pg_temp.fails($$select public.work_update_meeting(pg_temp.id('weekly'), 'Renamed', 'workspace')$$, 'changing a meeting you did not make');

-- Archived meetings take no new points.
select pg_temp.act('julius@nordavo.nl');
select public.work_update_meeting(pg_temp.id('weekly'), 'Weekly with Floris', 'invited', array[pg_temp.uid('floris@nordavo.nl')], true);
select pg_temp.fails($$select public.work_add_agenda_item(pg_temp.id('weekly'), 'Too late')$$, 'a point on an archived meeting');
select public.work_update_meeting(pg_temp.id('weekly'), 'Weekly with Floris', 'invited', array[pg_temp.uid('floris@nordavo.nl')], false);

-- Switching to the whole workspace clears the list of people.
select public.work_update_meeting(pg_temp.id('weekly'), 'Weekly with Floris', 'workspace');
do $$ begin
  if exists (select 1 from public.work_meeting_members where meeting_id = pg_temp.id('weekly')) then
    raise exception 'FAIL: a meeting for the whole workspace has no list of people';
  end if;
end $$;
select pg_temp.act('judith@nordavo.nl');
do $$ begin
  if not pg_temp.sees('weekly') then raise exception 'FAIL: now the whole workspace sees the weekly'; end if;
end $$;
select pg_temp.act('julius@nordavo.nl');
select public.work_update_meeting(pg_temp.id('weekly'), 'Weekly with Floris', 'invited', array[pg_temp.uid('floris@nordavo.nl')]);

-- ---------------------------------------------------------------------------
-- Private workspaces stay private
-- ---------------------------------------------------------------------------

insert into ids values ('home', public.work_create_private_workspace('Home', 'home-julius'));
insert into ids values ('home_meeting', public.work_create_meeting(pg_temp.id('home'), 'Me and my VA'));
select public.work_add_agenda_item(pg_temp.id('home_meeting'), 'Taxes');
select pg_temp.fails($$select public.work_create_meeting(pg_temp.id('home'), 'x', 'invited', array[pg_temp.uid('jorn@nordavo.nl')])$$,
  'inviting a stranger to a meeting in a private workspace');
select pg_temp.act('jorn@nordavo.nl');
do $$ begin
  if pg_temp.sees('home_meeting') or pg_temp.seen('home_meeting') <> 0 then
    raise exception 'FAIL: another portal admin does not see a meeting in a private workspace';
  end if;
end $$;
select pg_temp.fails($$select public.work_add_agenda_item(pg_temp.id('home_meeting'), 'Hello')$$, 'a point in a private workspace of someone else');

-- Someone who leaves the workspace loses the meeting.
select pg_temp.act('julius@nordavo.nl');
select public.work_deactivate_member(pg_temp.id('nordavo'), pg_temp.uid('floris@nordavo.nl'), pg_temp.uid('julius@nordavo.nl'));
select pg_temp.act('floris@nordavo.nl');
do $$ begin
  if pg_temp.sees('weekly') or pg_temp.sees('team') then
    raise exception 'FAIL: someone who left the workspace sees no meetings';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The API (secret key): the source claude and the rights of the token owner
-- ---------------------------------------------------------------------------

reset role;
select pg_temp.act('judith@nordavo.nl');
set role service_role;
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, false);
insert into ids values ('item_claude', public.work_add_agenda_item(pg_temp.id('team'), 'Added by Claude', null, null, null, 'claude',
  pg_temp.uid('judith@nordavo.nl')));
do $$ begin
  if (select source from public.work_agenda_items where id = pg_temp.id('item_claude')) <> 'claude'
     or (select added_by from public.work_agenda_items where id = pg_temp.id('item_claude')) <> pg_temp.uid('judith@nordavo.nl') then
    raise exception 'FAIL: the API adds a point for the token owner with the source claude';
  end if;
  if not public.work_api_can_view_meeting(pg_temp.id('team'), pg_temp.uid('judith@nordavo.nl'))
     or public.work_api_can_view_meeting(pg_temp.id('weekly'), pg_temp.uid('judith@nordavo.nl'))
     or public.work_api_can_view_meeting(pg_temp.id('weekly'), pg_temp.uid('jorn@nordavo.nl')) then
    raise exception 'FAIL: the API follows the rights of the token owner';
  end if;
  if exists (select 1 from public.work_api_visible_meetings(pg_temp.uid('jorn@nordavo.nl')) where name like 'Weekly%') then
    raise exception 'FAIL: the list of visible meetings follows the token owner';
  end if;
end $$;
select pg_temp.fails($$select public.work_add_agenda_item(pg_temp.id('weekly'), 'Sneaky', null, null, null, 'claude', pg_temp.uid('judith@nordavo.nl'))$$,
  'the API adding to a meeting the token owner cannot see');
reset role;

-- Signed-in users cannot use the API helpers.
select pg_temp.act('julius@nordavo.nl');
set role authenticated;
select pg_temp.fails($$select public.work_api_can_view_meeting(pg_temp.id('team'), pg_temp.uid('judith@nordavo.nl'))$$, 'the api helper for a signed-in user');
reset role;

rollback;

\echo 'work meetings tests passed'
