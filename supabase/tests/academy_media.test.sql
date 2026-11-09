-- Academy media (supabase/migrations/20261113000000_academy_media.sql):
-- watch measurement from played ranges, video versions keep progress,
-- completion of video, document and worksheet blocks, worksheet answers
-- (own only, locked once submitted, managers see all, readers never),
-- storage of media and images, certificate and notification on completing
-- a course, academy jobs in module academy. One transaction, rolled back.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000c001', 'hr.me@nordavo.nl', '{"full_name": "HR Media"}'),
  ('00000000-0000-0000-0000-00000000c002', 'cand.me@example.in', '{"full_name": "Ravi Media"}'),
  ('00000000-0000-0000-0000-00000000c003', 'cand2.me@example.in', '{"full_name": "Priya Media"}'),
  ('00000000-0000-0000-0000-00000000c004', 'boss.me@kg.nl', '{"full_name": "Klant Beheer"}'),
  ('00000000-0000-0000-0000-00000000c005', 'board.me@kg.nl', '{"full_name": "Meelezer"}'),
  ('00000000-0000-0000-0000-00000000c006', 'outsider.me@acme.nl', '{"full_name": "Outsider"}');

insert into public.clients (id, name, status) values ('00000000-0000-0000-0000-00000000cc01', 'KG Media', 'active');
update public.profiles set role = 'member', modules = array['academy'] where email = 'hr.me@nordavo.nl';
update public.profiles set role = 'client', client_id = '00000000-0000-0000-0000-00000000cc01' where email in ('boss.me@kg.nl', 'board.me@kg.nl', 'outsider.me@acme.nl');

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

create or replace function pg_temp.done(p_block uuid) returns boolean language sql as $$
  select done from public.academy_lesson_blocks_state('00000000-0000-0000-0000-00000000cf01') where block_id = p_block;
$$;

grant execute on function pg_temp.act(text), pg_temp.check(boolean, text), pg_temp.done(uuid) to authenticated;

-- Range helpers (internal).
select pg_temp.check(public.academy_merge_ranges('[[10,20],[0,5],[5.5,8],[15,25],[-2,1]]', 100) = '[[0, 8], [10, 25]]'::jsonb, 'ranges merge');
select pg_temp.check(public.academy_merge_ranges('[[90,130],"x",[1],[7,7]]', 100) = '[[90, 100]]'::jsonb, 'ranges clipped, junk dropped');
select pg_temp.check(public.academy_ranges_seconds('[[0,8],[10,25]]') = 23, 'covered seconds');
select pg_temp.check(public.job_module('academy-digest') = 'academy', 'academy jobs are module academy');
select pg_temp.check(public.job_module('work-daily') is null and public.job_module('s1-signals') = 'sales', 'other jobs unchanged');

-- ---------------------------------------------------------------------------
-- HR builds a course of one lesson with video, document and worksheet.
-- ---------------------------------------------------------------------------
select pg_temp.act('hr.me@nordavo.nl');
set role authenticated;

insert into public.academy_courses (id, title, language, audience, status) values
  ('00000000-0000-0000-0000-00000000cd01', 'Media course', 'en', 'developer', 'published');
insert into public.academy_modules (id, course_id, title, position, status, in_default_access) values
  ('00000000-0000-0000-0000-00000000ce01', '00000000-0000-0000-0000-00000000cd01', 'M1', 1, 'published', true);
insert into public.academy_lessons (id, title, status) values ('00000000-0000-0000-0000-00000000cf01', 'Media lesson', 'published');
insert into public.academy_module_lessons (module_id, lesson_id, position) values
  ('00000000-0000-0000-0000-00000000ce01', '00000000-0000-0000-0000-00000000cf01', 1);

insert into public.academy_videos (id, title) values
  ('00000000-0000-0000-0000-00000000ca01', 'Intro'),
  ('00000000-0000-0000-0000-00000000ca02', 'No file yet');
insert into public.academy_video_versions (id, video_id, version, storage_path, duration_seconds) values
  ('00000000-0000-0000-0000-00000000cb01', '00000000-0000-0000-0000-00000000ca01', 1, 'academy/video/00000000-0000-0000-0000-00000000ca01/v1-intro.mp4', 100);
update public.academy_videos set current_version_id = '00000000-0000-0000-0000-00000000cb01' where id = '00000000-0000-0000-0000-00000000ca01';

insert into public.academy_documents (id, title, kind, category, current_version, worksheet_fields) values
  ('00000000-0000-0000-0000-00000000c0d1', 'Workbook', 'download', 'workbook', 1, '[]'),
  ('00000000-0000-0000-0000-00000000c0d2', 'Plan', 'worksheet', 'workbook', 0,
   '[{"key": "goal", "label": "Your goal", "type": "short_text", "required": true}, {"key": "size", "label": "Team size", "type": "number"}]'),
  ('00000000-0000-0000-0000-00000000c0d3', 'Not uploaded', 'download', 'template', 0, '[]');
insert into public.academy_document_versions (document_id, version, storage_path, file_name) values
  ('00000000-0000-0000-0000-00000000c0d1', 1, 'academy/document/00000000-0000-0000-0000-00000000c0d1/v1-workbook.pdf', 'workbook.pdf');

insert into public.academy_lesson_blocks (id, lesson_id, type, position, required, completion, video_id, document_id, content) values
  ('00000000-0000-0000-0000-00000000c1b1', '00000000-0000-0000-0000-00000000cf01', 'video', 1, true, '{"min_percent": 50}', '00000000-0000-0000-0000-00000000ca01', null, '{"transcript": true}'),
  ('00000000-0000-0000-0000-00000000c1b2', '00000000-0000-0000-0000-00000000cf01', 'document', 2, true, '{}', null, '00000000-0000-0000-0000-00000000c0d1', '{}'),
  ('00000000-0000-0000-0000-00000000c1b3', '00000000-0000-0000-0000-00000000cf01', 'worksheet', 3, true, '{}', null, '00000000-0000-0000-0000-00000000c0d2', '{}'),
  -- Nothing to watch or open yet: these do not hold the lesson back.
  ('00000000-0000-0000-0000-00000000c1b4', '00000000-0000-0000-0000-00000000cf01', 'video', 4, true, '{}', '00000000-0000-0000-0000-00000000ca02', null, '{}'),
  ('00000000-0000-0000-0000-00000000c1b5', '00000000-0000-0000-0000-00000000cf01', 'document', 5, true, '{}', null, '00000000-0000-0000-0000-00000000c0d3', '{}'),
  ('00000000-0000-0000-0000-00000000c1b6', '00000000-0000-0000-0000-00000000cf01', 'video', 6, true, '{}', null, null, '{}');

select public.academy_add_person('00000000-0000-0000-0000-00000000c002', 'candidate', null, null, null, null,
  '00000000-0000-0000-0000-00000000cd01', 'default', '{}');
select public.academy_add_person('00000000-0000-0000-0000-00000000c003', 'candidate', null, null, null, null,
  '00000000-0000-0000-0000-00000000cd01', 'default', '{}');
select public.academy_add_person('00000000-0000-0000-0000-00000000c004', 'client_admin', null, null, '00000000-0000-0000-0000-00000000cc01');
select public.academy_add_person('00000000-0000-0000-0000-00000000c005', 'client_reader', null, null, '00000000-0000-0000-0000-00000000cc01');
reset role;

-- Files in storage (as the storage service would store them).
insert into storage.objects (bucket_id, name) values
  ('academy-media', 'academy/video/00000000-0000-0000-0000-00000000ca01/v1-intro.mp4'),
  ('attachments', 'academy/image/abc/picture.png');
select pg_temp.check((select file_size_limit from storage.buckets where id = 'academy-media') = 5368709120, 'media bucket takes 5 GB');

-- ---------------------------------------------------------------------------
-- Candidate: completion of the media blocks.
-- ---------------------------------------------------------------------------
select pg_temp.act('cand.me@example.in');
set role authenticated;
select public.academy_open_lesson('00000000-0000-0000-0000-00000000cf01', '00000000-0000-0000-0000-00000000cd01');
select pg_temp.check(pg_temp.done('00000000-0000-0000-0000-00000000c1b4'), 'video without a file is done');
select pg_temp.check(pg_temp.done('00000000-0000-0000-0000-00000000c1b5'), 'document without a file is done');
select pg_temp.check(pg_temp.done('00000000-0000-0000-0000-00000000c1b6'), 'video block without a video is done');
select pg_temp.check(not pg_temp.done('00000000-0000-0000-0000-00000000c1b1'), 'video not watched yet');
select pg_temp.check(not pg_temp.done('00000000-0000-0000-0000-00000000c1b2'), 'document not opened yet');
select pg_temp.check(not pg_temp.done('00000000-0000-0000-0000-00000000c1b3'), 'worksheet not submitted yet');

-- Files: the video of an open lesson and Academy images.
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'academy-media') = 1, 'candidate reads the video file');
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'attachments' and name like 'academy/image/%') = 1, 'candidate reads explanation images');
do $$ begin
  insert into storage.objects (bucket_id, name) values ('academy-media', 'academy/video/00000000-0000-0000-0000-00000000ca01/v9-mine.mp4');
  raise exception 'FAIL: candidate uploaded a video';
exception when insufficient_privilege then null;
end $$;

-- Watching: only played ranges count; the reported percent is ignored.
select public.academy_record_watch('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000cb01', 30, 100, 30, '[[0, 30]]');
select pg_temp.check((select percent from public.academy_watch_progress where video_id = '00000000-0000-0000-0000-00000000ca01') = 30, 'thirty seconds of a hundred');
-- Seeking to the end and playing the last five seconds adds five, not seventy.
select public.academy_record_watch('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000cb01', 100, 100, 5, '[[95, 100]]');
select pg_temp.check((select percent from public.academy_watch_progress where video_id = '00000000-0000-0000-0000-00000000ca01') = 35, 'seeking does not count');
select pg_temp.check(not pg_temp.done('00000000-0000-0000-0000-00000000c1b1'), 'video at 35 percent is not done');
-- Watching the same part again adds nothing; the position follows, clamped.
select public.academy_record_watch('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000cb01', 500, 100, 20, '[[0, 20]]');
select pg_temp.check((select percent = 35 and position_seconds = 100 from public.academy_watch_progress where video_id = '00000000-0000-0000-0000-00000000ca01'), 'rewatching adds nothing, position clamped');
select public.academy_record_watch('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000cb01', 60, 0, 30, '[[30, 60]]');
select pg_temp.check((select percent from public.academy_watch_progress where video_id = '00000000-0000-0000-0000-00000000ca01') = 65, 'ranges add up across calls');
select pg_temp.check(pg_temp.done('00000000-0000-0000-0000-00000000c1b1'), 'video done at min_percent 50');
select pg_temp.check((select ranges from public.academy_watch_ranges) = '[[0, 60], [95, 100]]'::jsonb, 'own ranges stored merged');
-- A version from another video is not accepted: the current one is used.
select public.academy_record_watch('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000c1b1', 61, 0, 1, '[[60, 61]]');
select pg_temp.check((select version_id from public.academy_watch_progress where video_id = '00000000-0000-0000-0000-00000000ca01') = '00000000-0000-0000-0000-00000000cb01', 'foreign version ignored');
-- Without ranges (older callers) the percent is capped by the watched seconds.
select public.academy_record_watch('00000000-0000-0000-0000-00000000ca01', null, 61, 100, 0);
select pg_temp.check((select percent from public.academy_watch_progress where video_id = '00000000-0000-0000-0000-00000000ca01') < 100, 'percent capped without ranges');

-- Document: opening it completes the block.
select public.academy_record_block_view('00000000-0000-0000-0000-00000000c1b2');
select pg_temp.check(pg_temp.done('00000000-0000-0000-0000-00000000c1b2'), 'document opened');

-- Worksheet: drafts are saved, submit needs the required fields.
insert into public.academy_worksheet_answers (document_id, profile_id, answers)
values ('00000000-0000-0000-0000-00000000c0d2', (select auth.uid()), '{"size": 4}');
update public.academy_worksheet_answers set answers = '{"size": 5}' where document_id = '00000000-0000-0000-0000-00000000c0d2';
do $$ begin
  update public.academy_worksheet_answers set submitted_at = now() where document_id = '00000000-0000-0000-0000-00000000c0d2';
  raise exception 'FAIL: submitted without the required field';
exception when check_violation then null;
end $$;
do $$ begin
  insert into public.academy_worksheet_answers (document_id, profile_id, answers)
  values ('00000000-0000-0000-0000-00000000c0d1', (select auth.uid()), '{}');
  raise exception 'FAIL: answers on a download';
exception when invalid_parameter_value then null;
end $$;
do $$ begin
  insert into public.academy_worksheet_answers (document_id, profile_id, answers)
  values ('00000000-0000-0000-0000-00000000c0d2', '00000000-0000-0000-0000-00000000c003', '{"goal": "spoof"}');
  raise exception 'FAIL: answers for someone else';
exception when insufficient_privilege then null;
end $$;
update public.academy_worksheet_answers set answers = '{"goal": "Ship weekly", "size": 5}', submitted_at = '2000-01-01'
where document_id = '00000000-0000-0000-0000-00000000c0d2';
select pg_temp.check((select submitted_at > now() - interval '1 minute' from public.academy_worksheet_answers), 'submit time is the server''s');
select pg_temp.check(pg_temp.done('00000000-0000-0000-0000-00000000c1b3'), 'worksheet submitted');
do $$ begin
  update public.academy_worksheet_answers set answers = '{"goal": "changed"}' where document_id = '00000000-0000-0000-0000-00000000c0d2';
  raise exception 'FAIL: changed a submitted worksheet';
exception when insufficient_privilege then null;
end $$;

-- All required blocks done: lesson, module and course complete, certificate and notification.
select pg_temp.check((select completed_at is not null from public.academy_lesson_progress where lesson_id = '00000000-0000-0000-0000-00000000cf01'), 'lesson complete');
select pg_temp.check((select count(*) from public.academy_certificates where course_id = '00000000-0000-0000-0000-00000000cd01') = 1, 'certificate issued');
select pg_temp.check((select full_name from public.academy_certificates) = 'Ravi Media', 'certificate on name');
select pg_temp.check((select count(*) from public.academy_notifications where kind = 'certificate' and link like '/academy/certificates/%') = 1, 'certificate notification');
reset role;

-- Issuing again does nothing.
select pg_temp.check(public.academy_issue_certificate('00000000-0000-0000-0000-00000000cd01', '00000000-0000-0000-0000-00000000c002') is null, 'certificate issued once');
select pg_temp.check(public.academy_issue_certificate('00000000-0000-0000-0000-00000000cd01', '00000000-0000-0000-0000-00000000c003') is null, 'no certificate without completing');

-- ---------------------------------------------------------------------------
-- A second candidate sees nothing of the first.
-- ---------------------------------------------------------------------------
select pg_temp.act('cand2.me@example.in');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_worksheet_answers) = 0, 'other candidate sees no answers');
select pg_temp.check((select count(*) from public.academy_watch_ranges) = 0, 'other candidate sees no watch ranges');
select pg_temp.check((select count(*) from public.academy_certificates) = 0, 'other candidate sees no certificate');
update public.academy_worksheet_answers set answers = '{}';
reset role;
select pg_temp.check((select answers ->> 'goal' from public.academy_worksheet_answers) = 'Ship weekly', 'other candidate changed nothing');

-- ---------------------------------------------------------------------------
-- Clients: the admin and the reader never see answers; the reader sees no
-- media files; someone outside the Academy sees no images.
-- ---------------------------------------------------------------------------
select pg_temp.act('board.me@kg.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_worksheet_answers) = 0, 'reader never sees answers');
select pg_temp.check((select count(*) from public.academy_watch_ranges) = 0, 'reader sees no watch ranges');
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'academy-media') = 0, 'reader reads no video files');
reset role;

select pg_temp.act('boss.me@kg.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_worksheet_answers) = 0, 'client admin sees no answers');
reset role;

select pg_temp.act('outsider.me@acme.nl');
set role authenticated;
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'attachments' and name like 'academy/image/%') = 0, 'no Academy images outside the Academy');
reset role;

-- ---------------------------------------------------------------------------
-- HR sees all answers and can reopen; a new video version keeps progress.
-- ---------------------------------------------------------------------------
select pg_temp.act('hr.me@nordavo.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_worksheet_answers) = 1, 'manager sees all answers');
select pg_temp.check((select count(*) from public.academy_watch_ranges) = 1, 'manager sees watch ranges');
update public.academy_worksheet_answers set submitted_at = null;
insert into public.academy_video_versions (id, video_id, version, storage_path, duration_seconds) values
  ('00000000-0000-0000-0000-00000000cb02', '00000000-0000-0000-0000-00000000ca01', 2, 'academy/video/00000000-0000-0000-0000-00000000ca01/v2-intro.mp4', 50);
update public.academy_videos set current_version_id = '00000000-0000-0000-0000-00000000cb02' where id = '00000000-0000-0000-0000-00000000ca01';
insert into storage.objects (bucket_id, name) values ('academy-media', 'academy/video/00000000-0000-0000-0000-00000000ca01/v2-intro.mp4');
-- Manager preview records nothing.
select pg_temp.check(public.academy_record_watch('00000000-0000-0000-0000-00000000ca01', null, 1, 1, 1, '[[0, 1]]') is null, 'manager preview records nothing');
reset role;

select pg_temp.act('cand.me@example.in');
set role authenticated;
-- Reopened: the candidate may change and submit again; the lesson stays done.
update public.academy_worksheet_answers set answers = '{"goal": "Ship daily"}';
select pg_temp.check((select completed_at is not null from public.academy_lesson_progress where lesson_id = '00000000-0000-0000-0000-00000000cf01'), 'lesson stays done after reopening');
-- New version: ranges start over for it, the percent stays.
select public.academy_record_watch('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000cb02', 10, 0, 10, '[[0, 10]]');
select pg_temp.check((select percent from public.academy_watch_progress where video_id = '00000000-0000-0000-0000-00000000ca01') >= 65, 'progress kept across versions');
select pg_temp.check((select ranges = '[[0, 10]]'::jsonb and version_id = '00000000-0000-0000-0000-00000000cb02' from public.academy_watch_ranges), 'ranges per version');
select public.academy_record_watch('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000cb02', 50, 0, 40, '[[10, 50]]');
select pg_temp.check((select percent = 100 and completed_at is not null from public.academy_watch_progress where video_id = '00000000-0000-0000-0000-00000000ca01'), 'whole new version watched');
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'academy-media') = 2, 'candidate reads both versions');
reset role;

rollback;
