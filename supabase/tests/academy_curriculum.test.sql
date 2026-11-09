-- The start curriculum content
-- (supabase/migrations/20261114000000_academy_start_content.sql): every
-- module has lessons, every check three questions with one valid answer,
-- the empty video never blocks a lesson, module settings and draft courses
-- are untouched, and running the seed again adds nothing and never
-- overwrites what a manager changed. One transaction, rolled back at the end.

begin;

create or replace function pg_temp.check(p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_what; end if;
end $$;

-- Stable id of a seed key (same as the migration).
create or replace function pg_temp.sid(p_key text) returns uuid language sql immutable as $$
  select md5('nordavo-academy-start:' || p_key)::uuid;
$$;

create or replace function pg_temp.act(p_email text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', (select id from auth.users where email = p_email),
    'role', 'authenticated',
    'email', p_email)::text, false);
end $$;

-- Is a block done for the signed in user?
create or replace function pg_temp.done(p_lesson uuid, p_block uuid) returns boolean language sql as $$
  select done from public.academy_lesson_blocks_state(p_lesson) where block_id = p_block;
$$;

grant execute on function pg_temp.check(boolean, text), pg_temp.sid(text), pg_temp.act(text), pg_temp.done(uuid, uuid) to authenticated;

-- The seeded lessons: in a module with a seed key.
create temporary view seeded_lessons as
  select l.*, m.seed_key as module_key, c.slug as course_slug
  from public.academy_lessons l
  join public.academy_module_lessons ml on ml.lesson_id = l.id
  join public.academy_modules m on m.id = ml.module_id
  join public.academy_courses c on c.id = m.course_id
  where m.seed_key is not null;
grant select on seeded_lessons to authenticated;

-- ---------------------------------------------------------------------------
-- Structure and counts.
-- ---------------------------------------------------------------------------
select pg_temp.check((select count(*) from seeded_lessons) = 39, 'start curriculum has 39 lessons');
select pg_temp.check((select count(*) from seeded_lessons where course_slug = 'client') = 26, 'client course has 26 lessons');
select pg_temp.check((select count(*) from seeded_lessons where course_slug = 'developer') = 13, 'developer course has 13 lessons');
select pg_temp.check(
  not exists (
    select 1 from public.academy_modules m
    where m.seed_key is not null
      and (select count(*) from seeded_lessons s where s.module_key = m.seed_key and s.status = 'published')
        not between (case when m.seed_key like 'client-%' then 2 else 3 end) and 4
  ),
  'every module has 2 to 4 published lessons (developer modules 3 to 4)');
select pg_temp.check(
  not exists (select 1 from seeded_lessons where language <> case course_slug when 'client' then 'nl' else 'en' end),
  'lessons are in the language of their course');
select pg_temp.check(
  (select count(*) from seeded_lessons s where s.id = pg_temp.sid(s.module_key || '.1')) = 13,
  'lesson ids are derived from their seed key');

-- Every lesson: a video waiting for a recording, then an explanation.
select pg_temp.check(
  not exists (
    select 1 from seeded_lessons s
    where not exists (
      select 1 from public.academy_lesson_blocks b
      where b.lesson_id = s.id and b.type = 'video' and b.position = 1 and b.video_id is null and b.required
        and (b.completion ->> 'min_percent')::int = 90 and coalesce(b.content ->> 'recording_note', '') <> ''
    )
  ),
  'every lesson starts with a required video block without a video and with a recording brief');
select pg_temp.check(
  not exists (
    select 1 from seeded_lessons s
    where not exists (
      select 1 from public.academy_lesson_blocks b
      where b.lesson_id = s.id and b.type = 'explanation' and b.required
        and b.content ->> 'html' like '%<h2>%' and length(b.content ->> 'html') > 1500
    )
  ),
  'every lesson has a required explanation with headings');

-- Every knowledge check: exactly three questions, one valid correct answer each.
select pg_temp.check((select count(*) from public.academy_lesson_blocks b join seeded_lessons s on s.id = b.lesson_id where b.type = 'knowledge_check') = 39, '39 knowledge checks');
select pg_temp.check(
  not exists (
    select 1 from public.academy_lesson_blocks b join seeded_lessons s on s.id = b.lesson_id
    where b.type = 'knowledge_check'
      and (select count(*) from public.academy_check_questions q where q.block_id = b.id) <> 3
  ),
  'every check has exactly 3 questions');
select pg_temp.check(
  not exists (
    select 1 from public.academy_check_questions q
    join public.academy_lesson_blocks b on b.id = q.block_id
    join seeded_lessons s on s.id = b.lesson_id
    where jsonb_array_length(q.options) not between 2 and 6
      or q.correct_index >= jsonb_array_length(q.options)
      or coalesce(q.explanation, '') = ''
  ),
  'every question has 2 to 6 options, one correct answer in range and an explanation');

-- Tasks, worksheets, assignments, documents.
select pg_temp.check(
  (select deadline_offset_days from public.academy_tasks where title like 'Zet het overlapvenster%') = 0,
  'client module 1: overlap window in the calendar by day 1');
select pg_temp.check(not exists (select 1 from public.academy_tasks t where t.shared and not t.placement_only), 'shared tasks are placement-only');
select pg_temp.check(exists (select 1 from public.academy_tasks t where t.shared), 'there are shared tasks');
select pg_temp.check(
  exists (
    select 1 from public.academy_lesson_blocks b
    where b.lesson_id = pg_temp.sid('client-4.1') and b.type = 'assignment' and b.title like '%5W%' and b.content ->> 'prompt' like '%waarom%'
      and b.completion ->> 'require' = 'submitted'
  ),
  'client Delegeren: assignment with the 5W template');
select pg_temp.check(
  (select count(*) from public.academy_lesson_blocks b
   where b.lesson_id in (pg_temp.sid('developer-3.2'), pg_temp.sid('developer-3.4')) and b.type = 'assignment') = 2,
  'developer: weekly plan and escalation message assignments');
select pg_temp.check(
  (select d.kind = 'worksheet' and d.category = 'template' and jsonb_array_length(d.worksheet_fields) = 6
   from public.academy_lesson_blocks b join public.academy_documents d on d.id = b.document_id
   where b.lesson_id = pg_temp.sid('client-4.1') and b.type = 'worksheet'),
  '5W worksheet with six fields');
select pg_temp.check(
  (select count(*) from public.academy_documents where category = 'escalation_matrix' and kind = 'worksheet') = 2,
  'escalation matrix worksheets in both courses');
select pg_temp.check(
  (select count(*) from public.academy_lesson_blocks b join public.academy_documents d on d.id = b.document_id
   where b.lesson_id = pg_temp.sid('developer-3.1') and b.type = 'document' and d.category = 'policy' and d.current_version = 0) = 4,
  'four policy placeholders without a file');

-- Settings of the foundation are untouched.
select pg_temp.check((select count(*) from public.academy_courses where slug in ('client', 'developer') and status = 'draft') = 2, 'courses stay draft');
select pg_temp.check((select count(*) from public.academy_modules where seed_key in ('client-1', 'client-2', 'client-3', 'client-4') and is_core) = 4, 'client modules 1 to 4 are core');
select pg_temp.check((select required_before_start from public.academy_modules where seed_key = 'client-1'), 'client module 1 before the start');
select pg_temp.check(
  (select count(*) from public.academy_modules where seed_key like 'developer-%' and in_default_access) = 2
  and (select bool_and(in_default_access) from public.academy_modules where seed_key in ('developer-1', 'developer-2')),
  'developer modules 1 and 2 open for candidates');

-- ---------------------------------------------------------------------------
-- Running the seed again adds nothing.
-- ---------------------------------------------------------------------------
create temporary table counts as
  select
    (select count(*) from public.academy_lessons) as lessons,
    (select count(*) from public.academy_module_lessons) as links,
    (select count(*) from public.academy_lesson_blocks) as blocks,
    (select count(*) from public.academy_tasks) as tasks,
    (select count(*) from public.academy_check_questions) as questions,
    (select count(*) from public.academy_documents) as documents;

select pg_temp.check(public.academy_seed_start_curriculum() = 0, 'rerun adds no lessons');
select pg_temp.check(
  (select row(lessons, links, blocks, tasks, questions, documents) from counts) =
  (select row(
    (select count(*) from public.academy_lessons), (select count(*) from public.academy_module_lessons),
    (select count(*) from public.academy_lesson_blocks), (select count(*) from public.academy_tasks),
    (select count(*) from public.academy_check_questions), (select count(*) from public.academy_documents))),
  'rerun adds no rows anywhere');

-- What a manager changed stays; a deleted lesson comes back.
update public.academy_lessons set title = 'Edited by Julius', status = 'draft' where id = pg_temp.sid('client-1.1');
update public.academy_lesson_blocks set content = '{"html": "<p>Own text</p>"}' where lesson_id = pg_temp.sid('client-1.1') and type = 'explanation';
delete from public.academy_lesson_blocks where lesson_id = pg_temp.sid('client-1.1') and type = 'notes';
update public.academy_check_questions set question = 'Own question'
  where block_id = (select id from public.academy_lesson_blocks where lesson_id = pg_temp.sid('client-1.1') and type = 'knowledge_check') and position = 1;
delete from public.academy_module_lessons where lesson_id = pg_temp.sid('client-1.2');
delete from public.academy_lessons where id = pg_temp.sid('client-2.1');

select pg_temp.check(public.academy_seed_start_curriculum() = 1, 'rerun adds only the deleted lesson');
select pg_temp.check((select title || status from public.academy_lessons where id = pg_temp.sid('client-1.1')) = 'Edited by Julius' || 'draft', 'edited lesson kept');
select pg_temp.check(
  (select content ->> 'html' from public.academy_lesson_blocks where lesson_id = pg_temp.sid('client-1.1') and type = 'explanation') = '<p>Own text</p>',
  'edited explanation kept');
select pg_temp.check(not exists (select 1 from public.academy_lesson_blocks where lesson_id = pg_temp.sid('client-1.1') and type = 'notes'), 'removed block not re-added');
select pg_temp.check(exists (select 1 from public.academy_check_questions where question = 'Own question'), 'edited question kept');
select pg_temp.check(not exists (select 1 from public.academy_module_lessons where lesson_id = pg_temp.sid('client-1.2')), 'lesson taken out of a module stays out');
select pg_temp.check(
  (select count(*) from public.academy_lesson_blocks where lesson_id = pg_temp.sid('client-2.1')) = 4
  and (select count(*) from public.academy_tasks t join public.academy_lesson_blocks b on b.id = t.block_id where b.lesson_id = pg_temp.sid('client-2.1')) = 3
  and exists (select 1 from public.academy_module_lessons ml join public.academy_modules m on m.id = ml.module_id
              where ml.lesson_id = pg_temp.sid('client-2.1') and m.seed_key = 'client-2'),
  'deleted lesson restored with its blocks, tasks and module link');
select pg_temp.check(public.academy_seed_start_curriculum() = 0, 'and then nothing again');

-- ---------------------------------------------------------------------------
-- Completion: the empty video never blocks; a candidate gets modules 1 and 2.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000d001', 'hr.cu@nordavo.nl', '{"full_name": "HR"}'),
  ('00000000-0000-0000-0000-00000000d002', 'boss.cu@kg.nl', '{"full_name": "Klant"}'),
  ('00000000-0000-0000-0000-00000000d003', 'cand.cu@example.in', '{"full_name": "Ravi"}');
insert into public.clients (id, name) values ('00000000-0000-0000-0000-00000000dc01', 'KG');
update public.profiles set role = 'member', modules = array['academy'] where email = 'hr.cu@nordavo.nl';
update public.academy_courses set status = 'published' where slug in ('client', 'developer');

select pg_temp.act('hr.cu@nordavo.nl');
set role authenticated;
select public.academy_add_person('00000000-0000-0000-0000-00000000d002', 'client_admin', null, current_date, '00000000-0000-0000-0000-00000000dc01',
  null, (select id from public.academy_courses where slug = 'client'), 'all', '{}');
select public.academy_add_person('00000000-0000-0000-0000-00000000d003', 'candidate', null, null, null,
  null, (select id from public.academy_courses where slug = 'developer'), 'default', '{}');
reset role;

-- The client works through client lesson 1.3 (video, explanation, check, tasks; no placement).
select pg_temp.act('boss.cu@kg.nl');
set role authenticated;
select public.academy_open_lesson(pg_temp.sid('client-1.3'), (select id from public.academy_courses where slug = 'client'));
select pg_temp.check(pg_temp.done(pg_temp.sid('client-1.3'), pg_temp.sid('client-1.3:block:1')), 'a video block without a video counts as done');
select pg_temp.check(pg_temp.done(pg_temp.sid('client-1.3'), pg_temp.sid('client-1.3:block:4')), 'placement-only tasks do not count without a placement');
select pg_temp.check(not pg_temp.done(pg_temp.sid('client-1.3'), pg_temp.sid('client-1.3:block:2')), 'explanation not seen yet');
select public.academy_record_block_view(pg_temp.sid('client-1.3:block:2'));
select pg_temp.check(
  (select completed_at is null from public.academy_lesson_progress where lesson_id = pg_temp.sid('client-1.3')),
  'lesson not complete before the check');
select public.academy_submit_check(pg_temp.sid('client-1.3:block:3'), (
  select jsonb_object_agg(question_id, 0) from public.academy_check_questions_for(pg_temp.sid('client-1.3:block:3'))
));
select pg_temp.check(
  (select completed_at is not null from public.academy_lesson_progress where lesson_id = pg_temp.sid('client-1.3')),
  'lesson complete: explanation seen and check done, the video waits for a recording');
reset role;

-- A candidate sees the lessons of developer modules 1 and 2, not the policies in module 3.
select pg_temp.act('cand.cu@example.in');
set role authenticated;
select pg_temp.check(public.academy_can_open_lesson(pg_temp.sid('developer-1.1')), 'candidate opens developer module 1');
select pg_temp.check(not public.academy_can_open_lesson(pg_temp.sid('developer-3.1')), 'candidate cannot open the policy lesson');
select pg_temp.check((select count(*) from public.academy_documents where category = 'policy') = 0, 'candidate does not see the policy documents');
select pg_temp.check((select count(*) from public.academy_check_questions) = 0, 'candidate never reads the answers');
reset role;

rollback;
