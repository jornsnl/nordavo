-- Academy completion rules and module unlocking
-- (supabase/migrations/20261112020000_academy_learning.sql): required blocks
-- per lesson, green check only when met, modules in order, required modules,
-- release after the start date, scope default plus open modules per person,
-- completed progress kept. One transaction, rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000b001', 'hr.en@nordavo.nl', '{"full_name": "HR"}'),
  ('00000000-0000-0000-0000-00000000b002', 'cand.en@example.in', '{"full_name": "Ravi"}'),
  ('00000000-0000-0000-0000-00000000b003', 'top.en@example.in', '{"full_name": "Top"}'),
  ('00000000-0000-0000-0000-00000000b004', 'boss.en@kg.nl', '{"full_name": "Boss"}'),
  ('00000000-0000-0000-0000-00000000b005', 'dev.en@example.in', '{"full_name": "Dev"}');

insert into public.clients (id, name) values ('00000000-0000-0000-0000-00000000bc01', 'KG');
update public.profiles set role = 'member', modules = array['academy'] where email = 'hr.en@nordavo.nl';
update public.profiles set time_zone = 'Asia/Kolkata' where email in ('cand.en@example.in', 'top.en@example.in', 'dev.en@example.in');

create or replace function pg_temp.act(p_email text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', (select id from auth.users where email = p_email),
    'role', 'authenticated',
    'email', p_email)::text, false);
end $$;

create or replace function pg_temp.check(p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_what; end if;
end $$;

-- The state of a module (by title) in the outline of the signed in user.
create or replace function pg_temp.state(p_title text) returns text language sql as $$
  select module_state from public.academy_course_outline('00000000-0000-0000-0000-00000000bc11')
  where module_title = p_title limit 1;
$$;

grant execute on function pg_temp.act(text), pg_temp.check(boolean, text), pg_temp.state(text) to authenticated;

-- ---------------------------------------------------------------------------
-- A course of five modules, built by HR.
-- ---------------------------------------------------------------------------
select pg_temp.act('hr.en@nordavo.nl');
set role authenticated;

insert into public.academy_courses (id, title, language, audience, status) values
  ('00000000-0000-0000-0000-00000000bc11', 'Dev course', 'en', 'developer', 'published');
insert into public.academy_modules (id, course_id, title, position, status, in_default_access, requires_previous, release_offset_days) values
  ('00000000-0000-0000-0000-00000000bd01', '00000000-0000-0000-0000-00000000bc11', 'M1', 1, 'published', true, true, null),
  ('00000000-0000-0000-0000-00000000bd02', '00000000-0000-0000-0000-00000000bc11', 'M2', 2, 'published', true, true, null),
  -- Empty: never blocks the next module.
  ('00000000-0000-0000-0000-00000000bd03', '00000000-0000-0000-0000-00000000bc11', 'Empty', 3, 'published', false, true, null),
  ('00000000-0000-0000-0000-00000000bd04', '00000000-0000-0000-0000-00000000bc11', 'M4', 4, 'published', false, true, null),
  -- From month 2, needs M1, not in order.
  ('00000000-0000-0000-0000-00000000bd05', '00000000-0000-0000-0000-00000000bc11', 'M5', 5, 'published', false, false, 30),
  ('00000000-0000-0000-0000-00000000bd06', '00000000-0000-0000-0000-00000000bc11', 'Draft', 6, 'draft', false, true, null);
insert into public.academy_module_requirements (module_id, required_module_id) values
  ('00000000-0000-0000-0000-00000000bd05', '00000000-0000-0000-0000-00000000bd01');

insert into public.academy_videos (id, title) values ('00000000-0000-0000-0000-00000000be01', 'Intro');
insert into public.academy_video_versions (id, video_id, version, storage_path, duration_seconds) values
  ('00000000-0000-0000-0000-00000000be11', '00000000-0000-0000-0000-00000000be01', 1, 'academy/video/x/v1.mp4', 100);
update public.academy_videos set current_version_id = '00000000-0000-0000-0000-00000000be11' where id = '00000000-0000-0000-0000-00000000be01';

insert into public.academy_lessons (id, title, status) values
  ('00000000-0000-0000-0000-00000000bf01', 'L1 video and tasks', 'published'),
  ('00000000-0000-0000-0000-00000000bf02', 'L2 no requirements', 'published'),
  ('00000000-0000-0000-0000-00000000bf03', 'L3 notes', 'published'),
  ('00000000-0000-0000-0000-00000000bf04', 'L4', 'published'),
  ('00000000-0000-0000-0000-00000000bf05', 'L5', 'published'),
  ('00000000-0000-0000-0000-00000000bf06', 'L6 shared', 'published');
insert into public.academy_module_lessons (module_id, lesson_id, position) values
  ('00000000-0000-0000-0000-00000000bd01', '00000000-0000-0000-0000-00000000bf01', 1),
  ('00000000-0000-0000-0000-00000000bd01', '00000000-0000-0000-0000-00000000bf02', 2),
  ('00000000-0000-0000-0000-00000000bd02', '00000000-0000-0000-0000-00000000bf03', 1),
  ('00000000-0000-0000-0000-00000000bd04', '00000000-0000-0000-0000-00000000bf04', 1),
  ('00000000-0000-0000-0000-00000000bd05', '00000000-0000-0000-0000-00000000bf05', 1),
  -- Reusable: L6 in M4 and M5.
  ('00000000-0000-0000-0000-00000000bd04', '00000000-0000-0000-0000-00000000bf06', 2),
  ('00000000-0000-0000-0000-00000000bd05', '00000000-0000-0000-0000-00000000bf06', 2);
insert into public.academy_lesson_blocks (id, lesson_id, type, position, required, completion, video_id, content) values
  ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-00000000bf01', 'video', 1, true, '{"min_percent": 90}', '00000000-0000-0000-0000-00000000be01', '{}'),
  ('00000000-0000-0000-0000-00000000bb02', '00000000-0000-0000-0000-00000000bf01', 'tasks', 2, true, '{}', null, '{}'),
  ('00000000-0000-0000-0000-00000000bb03', '00000000-0000-0000-0000-00000000bf01', 'explanation', 3, false, '{}', null, '{"html": "<p>x</p>"}'),
  ('00000000-0000-0000-0000-00000000bb04', '00000000-0000-0000-0000-00000000bf02', 'explanation', 1, false, '{}', null, '{"html": "<p>y</p>"}'),
  ('00000000-0000-0000-0000-00000000bb05', '00000000-0000-0000-0000-00000000bf03', 'notes', 1, true, '{}', null, '{"scope": "lesson"}'),
  ('00000000-0000-0000-0000-00000000bb06', '00000000-0000-0000-0000-00000000bf04', 'knowledge_check', 1, true, '{"min_percent": 60}', null, '{}'),
  ('00000000-0000-0000-0000-00000000bb07', '00000000-0000-0000-0000-00000000bf06', 'tasks', 1, true, '{}', null, '{}');
insert into public.academy_tasks (id, block_id, title, required, placement_only, shared) values
  ('00000000-0000-0000-0000-00000000ba01', '00000000-0000-0000-0000-00000000bb02', 'Calendar', true, false, false),
  -- Only with a placement: does not count for a candidate.
  ('00000000-0000-0000-0000-00000000ba02', '00000000-0000-0000-0000-00000000bb02', 'Meet the team', true, true, false),
  ('00000000-0000-0000-0000-00000000ba03', '00000000-0000-0000-0000-00000000bb07', 'Repo access', true, true, true);

-- Candidate (scope default), top candidate (default + M4 open), developer (all).
select public.academy_add_person('00000000-0000-0000-0000-00000000b002', 'candidate', null, null, null, null,
  '00000000-0000-0000-0000-00000000bc11', 'default', '{}');
select public.academy_add_person('00000000-0000-0000-0000-00000000b003', 'candidate', null, current_date, null, null,
  '00000000-0000-0000-0000-00000000bc11', 'default', array['00000000-0000-0000-0000-00000000bd04'::uuid]);
select public.academy_add_person('00000000-0000-0000-0000-00000000b005', 'developer', null, current_date - 40, null, null,
  '00000000-0000-0000-0000-00000000bc11', 'all', '{}');
select public.academy_add_person('00000000-0000-0000-0000-00000000b004', 'client_admin', null, current_date, '00000000-0000-0000-0000-00000000bc01');
reset role;

-- ---------------------------------------------------------------------------
-- Candidate: M1 open, M2 in order, Empty and M4 outside scope.
-- ---------------------------------------------------------------------------
select pg_temp.act('cand.en@example.in');
set role authenticated;
select pg_temp.check(pg_temp.state('M1') = 'open', 'M1 open');
select pg_temp.check(pg_temp.state('M2') = 'locked_order', 'M2 waits for M1');
select pg_temp.check(pg_temp.state('Empty') = 'locked_scope', 'Empty outside scope');
select pg_temp.check(pg_temp.state('M4') = 'locked_scope', 'M4 outside scope');
select pg_temp.check(pg_temp.state('M5') = 'locked_scope', 'M5 outside scope');
select pg_temp.check(pg_temp.state('Draft') is null, 'draft module invisible');
select pg_temp.check((select count(*) from public.academy_course_outline('00000000-0000-0000-0000-00000000bc11') where module_title = 'Draft') = 0, 'no draft in outline');

-- Opening L1: video and the calendar task are required (meet the team only with placement).
select pg_temp.check((public.academy_open_lesson('00000000-0000-0000-0000-00000000bf01', '00000000-0000-0000-0000-00000000bc11') ->> 'required_total')::int = 2, 'two required blocks');
select pg_temp.check((select completed_at is null from public.academy_lesson_progress where lesson_id = '00000000-0000-0000-0000-00000000bf01'), 'not done on opening');
select pg_temp.check(not (select done from public.academy_lesson_blocks_state('00000000-0000-0000-0000-00000000bf01') where block_id = '00000000-0000-0000-0000-00000000bb01'), 'video not done');

select public.academy_record_watch('00000000-0000-0000-0000-00000000be01', '00000000-0000-0000-0000-00000000be11', 50, 50, 50);
select pg_temp.check((select percent from public.academy_lesson_progress where lesson_id = '00000000-0000-0000-0000-00000000bf01') = 0, 'half a video is not enough');
select public.academy_record_watch('00000000-0000-0000-0000-00000000be01', '00000000-0000-0000-0000-00000000be11', 92, 92, 42);
select pg_temp.check((select percent from public.academy_lesson_progress where lesson_id = '00000000-0000-0000-0000-00000000bf01') = 50, 'video counts at 90 percent');
-- Watching back does not lower the percentage.
select public.academy_record_watch('00000000-0000-0000-0000-00000000be01', '00000000-0000-0000-0000-00000000be11', 10, 10, 0);
select pg_temp.check((select percent from public.academy_watch_progress) = 92, 'percent never goes down');
select pg_temp.check((select position_seconds from public.academy_watch_progress) = 10, 'position follows the player');

insert into public.academy_task_status (task_id, profile_id, done_at, done_by)
values ('00000000-0000-0000-0000-00000000ba01', (select auth.uid()), now(), (select auth.uid()));
select pg_temp.check((select completed_at is not null from public.academy_lesson_progress where lesson_id = '00000000-0000-0000-0000-00000000bf01'), 'L1 green check');
select pg_temp.check(pg_temp.state('M1') = 'open', 'M1 not done yet (L2 open)');
select pg_temp.check(pg_temp.state('M2') = 'locked_order', 'M2 still waits');

-- L2 has no required blocks: done once opened. Then M1 is done and M2 opens.
select public.academy_open_lesson('00000000-0000-0000-0000-00000000bf02', '00000000-0000-0000-0000-00000000bc11');
select pg_temp.check(pg_temp.state('M1') = 'completed', 'M1 completed');
select pg_temp.check(pg_temp.state('M2') = 'open', 'M2 opens after M1');
select pg_temp.check((select lessons_done from public.academy_my_courses() where course_id = '00000000-0000-0000-0000-00000000bc11') = 2, 'two lessons done');
select pg_temp.check((select lessons_total from public.academy_my_courses() where course_id = '00000000-0000-0000-0000-00000000bc11') = 3, 'three lessons in scope');

-- L4 is in a locked module: cannot be opened.
do $$ begin
  perform public.academy_open_lesson('00000000-0000-0000-0000-00000000bf04');
  raise exception 'FAIL: opened a locked lesson';
exception when insufficient_privilege then null;
end $$;

-- L3: a required note.
select public.academy_open_lesson('00000000-0000-0000-0000-00000000bf03');
insert into public.academy_notes (profile_id, lesson_id, body) values ((select auth.uid()), '00000000-0000-0000-0000-00000000bf03', '   ');
select pg_temp.check((select completed_at is null from public.academy_lesson_progress where lesson_id = '00000000-0000-0000-0000-00000000bf03'), 'an empty note does not count');
update public.academy_notes set body = 'My first note' where lesson_id = '00000000-0000-0000-0000-00000000bf03';
select pg_temp.check((select completed_at is not null from public.academy_lesson_progress where lesson_id = '00000000-0000-0000-0000-00000000bf03'), 'a note completes L3');
select pg_temp.check(pg_temp.state('M2') = 'completed', 'M2 completed');
reset role;

-- ---------------------------------------------------------------------------
-- Completed progress is kept: new required block, new lesson, new video version.
-- ---------------------------------------------------------------------------
select pg_temp.act('hr.en@nordavo.nl');
set role authenticated;
insert into public.academy_lesson_blocks (lesson_id, type, required, content)
values ('00000000-0000-0000-0000-00000000bf01', 'explanation', true, '{"html": "<p>new</p>"}');
insert into public.academy_lessons (id, title, status) values ('00000000-0000-0000-0000-00000000bf09', 'L1b new', 'published');
insert into public.academy_module_lessons (module_id, lesson_id, position) values
  ('00000000-0000-0000-0000-00000000bd01', '00000000-0000-0000-0000-00000000bf09', 3);
insert into public.academy_video_versions (id, video_id, version, storage_path, duration_seconds) values
  ('00000000-0000-0000-0000-00000000be12', '00000000-0000-0000-0000-00000000be01', 2, 'academy/video/x/v2.mp4', 80);
update public.academy_videos set current_version_id = '00000000-0000-0000-0000-00000000be12' where id = '00000000-0000-0000-0000-00000000be01';
reset role;

select pg_temp.act('cand.en@example.in');
set role authenticated;
select public.academy_open_lesson('00000000-0000-0000-0000-00000000bf01');
select pg_temp.check((select completed_at is not null and percent = 100 from public.academy_lesson_progress where lesson_id = '00000000-0000-0000-0000-00000000bf01'), 'L1 stays done');
select pg_temp.check(pg_temp.state('M1') = 'completed', 'M1 stays completed with a new lesson');
select pg_temp.check((select percent from public.academy_watch_progress) = 92, 'watch progress survives a new video version');
reset role;

-- ---------------------------------------------------------------------------
-- Top candidate: M4 opened per person, still in order (after M2).
-- ---------------------------------------------------------------------------
select pg_temp.act('top.en@example.in');
set role authenticated;
select pg_temp.check(pg_temp.state('M4') = 'locked_order', 'M4 in scope but waits for M2');
select pg_temp.check(pg_temp.state('Empty') = 'locked_scope', 'Empty still outside scope');
reset role;

select pg_temp.act('hr.en@nordavo.nl');
set role authenticated;
update public.academy_open_modules set force = true
where profile_id = '00000000-0000-0000-0000-00000000b003' and module_id = '00000000-0000-0000-0000-00000000bd04';
reset role;

select pg_temp.act('top.en@example.in');
set role authenticated;
select pg_temp.check(pg_temp.state('M4') = 'open', 'forced open');
select pg_temp.check((select count(*) from public.academy_lesson_blocks where lesson_id = '00000000-0000-0000-0000-00000000bf04') = 1, 'forced module content readable');
-- Knowledge check with a minimum: 1 of 3 is not enough, 2 of 3 is (60%).
reset role;
insert into public.academy_check_attempts (block_id, profile_id, score, max_score) values
  ('00000000-0000-0000-0000-00000000bb06', '00000000-0000-0000-0000-00000000b003', 1, 3);
select pg_temp.check((select completed_at is null from public.academy_lesson_progress
  where lesson_id = '00000000-0000-0000-0000-00000000bf04' and profile_id = '00000000-0000-0000-0000-00000000b003'), 'check below minimum');
insert into public.academy_check_attempts (block_id, profile_id, score, max_score) values
  ('00000000-0000-0000-0000-00000000bb06', '00000000-0000-0000-0000-00000000b003', 2, 3);
select pg_temp.check((select completed_at is not null from public.academy_lesson_progress
  where lesson_id = '00000000-0000-0000-0000-00000000bf04' and profile_id = '00000000-0000-0000-0000-00000000b003'), 'check at minimum');

-- ---------------------------------------------------------------------------
-- Developer (scope all, start 40 days ago): release and requirement on M5.
-- ---------------------------------------------------------------------------
select pg_temp.act('dev.en@example.in');
set role authenticated;
select pg_temp.check(pg_temp.state('Empty') = 'locked_order', 'empty module in scope all, after M2');
-- M4 skips the empty module and waits for M2.
select pg_temp.check(pg_temp.state('M4') = 'locked_order', 'M4 waits for M2, not for the empty module');
select pg_temp.check(pg_temp.state('M5') = 'locked_requirement', 'M5 released but needs M1');
select pg_temp.check(
  (select release_date from public.academy_course_outline('00000000-0000-0000-0000-00000000bc11') where module_title = 'M5' limit 1) = current_date - 10,
  'release date is start plus offset');
reset role;

-- Start date today: M5 not released yet.
select pg_temp.act('hr.en@nordavo.nl');
set role authenticated;
update public.academy_members set start_date = current_date where profile_id = '00000000-0000-0000-0000-00000000b005';
reset role;
select pg_temp.act('dev.en@example.in');
set role authenticated;
select pg_temp.check(pg_temp.state('M5') = 'locked_release', 'M5 waits for month 2');
reset role;

-- Candidate without a start date: release never reached.
select pg_temp.act('hr.en@nordavo.nl');
set role authenticated;
insert into public.academy_open_modules (profile_id, module_id) values
  ('00000000-0000-0000-0000-00000000b002', '00000000-0000-0000-0000-00000000bd05');
reset role;
select pg_temp.act('cand.en@example.in');
set role authenticated;
select pg_temp.check(pg_temp.state('M5') = 'locked_release', 'no start date, no release');
reset role;
select pg_temp.act('hr.en@nordavo.nl');
set role authenticated;
update public.academy_members set start_date = current_date - 31 where profile_id = '00000000-0000-0000-0000-00000000b002';
reset role;
select pg_temp.act('cand.en@example.in');
set role authenticated;
select pg_temp.check(pg_temp.state('M5') = 'open', 'released and M1 done: open');
reset role;

-- ---------------------------------------------------------------------------
-- Shared placement task: the client ticks it off, the developer's lesson completes.
-- ---------------------------------------------------------------------------
insert into public.candidates (id, full_name) values ('00000000-0000-0000-0000-00000000bcd1', 'Dev');
insert into public.placements (id, client_id, candidate_id, start_date) values
  ('00000000-0000-0000-0000-00000000bc91', '00000000-0000-0000-0000-00000000bc01', '00000000-0000-0000-0000-00000000bcd1', current_date);
insert into public.academy_placement_members (placement_id, profile_id, role) values
  ('00000000-0000-0000-0000-00000000bc91', '00000000-0000-0000-0000-00000000b004', 'client_admin'),
  ('00000000-0000-0000-0000-00000000bc91', '00000000-0000-0000-0000-00000000b005', 'developer');
update public.academy_open_modules set force = true where module_id = '00000000-0000-0000-0000-00000000bd04';
insert into public.academy_open_modules (profile_id, module_id, force) values
  ('00000000-0000-0000-0000-00000000b005', '00000000-0000-0000-0000-00000000bd04', true);

select pg_temp.act('dev.en@example.in');
set role authenticated;
select public.academy_open_lesson('00000000-0000-0000-0000-00000000bf06');
select pg_temp.check((select completed_at is null from public.academy_lesson_progress where lesson_id = '00000000-0000-0000-0000-00000000bf06'), 'shared task open');
-- Placement-only tasks now count: the developer is placed.
select pg_temp.check((select count(*) from public.academy_tasks where placement_only) >= 1, 'placed developer sees placement-only tasks');
reset role;

select pg_temp.act('boss.en@kg.nl');
set role authenticated;
insert into public.academy_task_status (task_id, placement_id, done_at, done_by)
values ('00000000-0000-0000-0000-00000000ba03', '00000000-0000-0000-0000-00000000bc91', now(), (select auth.uid()));
reset role;

select pg_temp.check((select completed_at is not null from public.academy_lesson_progress
  where lesson_id = '00000000-0000-0000-0000-00000000bf06' and profile_id = '00000000-0000-0000-0000-00000000b005'),
  'the client ticked the shared task: developer lesson done');
-- The reusable lesson counts in both modules.
select pg_temp.check((select count(*) from public.academy_lesson_progress
  where lesson_id = '00000000-0000-0000-0000-00000000bf06' and profile_id = '00000000-0000-0000-0000-00000000b005') = 1,
  'one progress row for a lesson used twice');

-- Managers preview everything without recording progress.
select pg_temp.act('hr.en@nordavo.nl');
set role authenticated;
select pg_temp.check(public.academy_open_lesson('00000000-0000-0000-0000-00000000bf04') is null, 'preview records nothing');
select pg_temp.check((select count(distinct module_id) from public.academy_course_outline('00000000-0000-0000-0000-00000000bc11')) = 6, 'manager outline has drafts too');
select pg_temp.check(
  (select bool_and(module_state = 'open') from public.academy_course_outline('00000000-0000-0000-0000-00000000bc11')),
  'manager outline is all open');

-- Editor helpers: duplicate a lesson (deep copy) and a module.
select public.academy_duplicate_lesson('00000000-0000-0000-0000-00000000bf01', '00000000-0000-0000-0000-00000000bd01') as copy_id \gset
select pg_temp.check((select status = 'draft' and title = 'L1 video and tasks (copy)' from public.academy_lessons where id = :'copy_id'), 'copy is a draft');
select pg_temp.check((select count(*) from public.academy_lesson_blocks where lesson_id = :'copy_id') = 4, 'blocks copied');
select pg_temp.check((select count(*) from public.academy_tasks t join public.academy_lesson_blocks b on b.id = t.block_id where b.lesson_id = :'copy_id') = 2, 'tasks copied');
select pg_temp.check(
  (select position from public.academy_module_lessons where lesson_id = :'copy_id') between 1 and 2,
  'copy right after the original');
select pg_temp.check((select video_id from public.academy_lesson_blocks where lesson_id = :'copy_id' and type = 'video') = '00000000-0000-0000-0000-00000000be01', 'video shared, not copied');
select public.academy_duplicate_module('00000000-0000-0000-0000-00000000bd05') as module_copy \gset
select pg_temp.check((select status = 'draft' and position = 7 from public.academy_modules where id = :'module_copy'), 'module copy at the end, draft');
select pg_temp.check((select count(*) from public.academy_module_lessons where module_id = :'module_copy') = 2, 'module copy has its lessons');
select pg_temp.check(
  not exists (select 1 from public.academy_module_lessons a join public.academy_module_lessons b on a.lesson_id = b.lesson_id
    where a.module_id = :'module_copy' and b.module_id = '00000000-0000-0000-0000-00000000bd05'),
  'module copy has its own lessons');
select pg_temp.check((select count(*) from public.academy_module_requirements where module_id = :'module_copy') = 1, 'requirements copied');
select pg_temp.check((select count(*) from public.academy_client_options()) >= 1, 'managers see client names');
reset role;

-- Learners cannot use the editor helpers.
select pg_temp.act('cand.en@example.in');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_client_options()) = 0, 'learner sees no client options');
select pg_temp.check((select count(*) from public.academy_candidate_options(null)) = 0, 'learner sees no candidates');
do $$ begin
  perform public.academy_duplicate_lesson('00000000-0000-0000-0000-00000000bf01');
  raise exception 'FAIL: learner duplicated a lesson';
exception when insufficient_privilege then null;
end $$;
reset role;

rollback;
