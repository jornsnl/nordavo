-- Academy media: video block, documents and fillable worksheets, images in
-- the explanation block, certificates and notifications (docs/academy.md,
-- section "Media, werkbladen, certificaten en meldingen").
--
--   1  Storage: bucket academy-media for videos and subtitles (large files),
--      explanation images under academy/image/ in attachments
--   2  Video: transcript language and error, watched ranges per person,
--      academy_record_watch() measures real watched seconds
--   3  Completion: academy_block_done_video, _document, _worksheet
--   4  Worksheets: answers checked against the fields, locked once submitted
--   5  Certificates: issued automatically when a course is completed
--   6  Jobs academy-* belong to module academy

-- ---------------------------------------------------------------------------
-- 1. Storage
-- ---------------------------------------------------------------------------

-- Videos are far larger than the 20 MB of the attachments bucket. Same path
-- convention (academy/video/<video_id>/<file>), same read rule
-- (academy_can_read_file). 5 GB per file; the project's global upload limit
-- in Supabase (Storage settings) must be at least as high.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'academy-media', 'academy-media', false, 5368709120,
  array['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v', 'text/vtt', 'text/plain']
)
on conflict (id) do nothing;

create policy "Academy managers manage media files" on storage.objects
  for all to authenticated
  using (bucket_id = 'academy-media' and split_part(name, '/', 1) = 'academy' and public.academy_is_manager())
  with check (bucket_id = 'academy-media' and split_part(name, '/', 1) = 'academy' and public.academy_is_manager());

create policy "Academy participants read media files" on storage.objects
  for select to authenticated
  using (bucket_id = 'academy-media' and public.academy_can_read_file(name));

-- Images in the explanation block: attachments/academy/image/<id>/<file>,
-- uploaded by managers (staff policy, module academy), shown to every
-- Academy participant through /academy/files/image/...
create policy "Academy participants read explanation images" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and split_part(name, '/', 1) = 'academy' and split_part(name, '/', 2) = 'image'
    and (public.academy_is_manager() or exists (select 1 from public.academy_members where profile_id = (select auth.uid())))
  );

-- ---------------------------------------------------------------------------
-- 2. Video
-- ---------------------------------------------------------------------------

alter table public.academy_video_versions
  add column transcript_language text check (transcript_language in ('nl', 'en')),
  add column transcript_error text check (char_length(transcript_error) <= 2000);

-- What a person really played of the current version, as merged
-- [start, end] ranges in seconds. Seeking adds nothing; watching back adds
-- nothing new. Reset when a new version is watched (the percent on
-- academy_watch_progress never goes down, so nobody loses progress).
create table public.academy_watch_ranges (
  profile_id uuid not null references public.academy_members (profile_id) on delete cascade,
  video_id uuid not null references public.academy_videos (id) on delete cascade,
  version_id uuid references public.academy_video_versions (id) on delete set null,
  ranges jsonb not null default '[]'::jsonb check (jsonb_typeof(ranges) = 'array'),
  updated_at timestamptz not null default now(),
  primary key (profile_id, video_id)
);

alter table public.academy_watch_ranges enable row level security;

create policy "Academy managers manage academy_watch_ranges" on public.academy_watch_ranges
  for all to authenticated using (public.academy_is_manager()) with check (public.academy_is_manager());
create policy "Members read own watch ranges" on public.academy_watch_ranges
  for select to authenticated using (profile_id = (select auth.uid()));

-- Merge [start, end] ranges (jsonb arrays of two numbers) within 0..duration;
-- gaps of a second or less are closed. Internal.
create or replace function public.academy_merge_ranges(p_ranges jsonb, p_duration numeric)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with raw as (
    select (e ->> 0)::numeric as s, (e ->> 1)::numeric as e
    from jsonb_array_elements(case when jsonb_typeof(p_ranges) = 'array' then p_ranges else '[]'::jsonb end) as x(e)
    where jsonb_typeof(e) = 'array' and jsonb_array_length(e) = 2
      and jsonb_typeof(e -> 0) = 'number' and jsonb_typeof(e -> 1) = 'number'
  ),
  clipped as (
    select greatest(0, s) as s, case when p_duration > 0 then least(p_duration, e) else e end as e
    from raw
  ),
  valid as (select s, e from clipped where e > s),
  ordered as (
    select s, e, max(e) over (order by s, e rows between unbounded preceding and 1 preceding) as prev_end
    from valid
  ),
  grouped as (
    select s, e, sum(case when prev_end is null or s > prev_end + 1 then 1 else 0 end) over (order by s, e) as grp
    from ordered
  )
  select coalesce(jsonb_agg(jsonb_build_array(round(lo, 2), round(hi, 2)) order by lo), '[]'::jsonb)
  from (select min(s) as lo, max(e) as hi from grouped group by grp) m;
$$;

-- Seconds covered by merged ranges. Internal.
create or replace function public.academy_ranges_seconds(p_ranges jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce(sum((e ->> 1)::numeric - (e ->> 0)::numeric), 0)
  from jsonb_array_elements(case when jsonb_typeof(p_ranges) = 'array' then p_ranges else '[]'::jsonb end) as x(e);
$$;

-- Watch progress from the player, replacing the foundation version (same
-- arguments plus p_ranges). The percent is what was really watched:
--   with p_ranges (the player sends the ranges it played): covered seconds
--     of the merged ranges of this version / duration;
--   without (older callers): total watched seconds / duration;
--   a version without a duration: the reported percent.
-- With ranges the reported percent is ignored; without, it is capped. The
-- stored percent never goes down, and the position is clamped to the
-- duration.
drop function public.academy_record_watch(uuid, uuid, numeric, integer, numeric);

create or replace function public.academy_record_watch(
  p_video_id uuid,
  p_version_id uuid,
  p_position_seconds numeric,
  p_percent integer,
  p_watched_seconds numeric default 0,
  p_ranges jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_version uuid;
  v_duration numeric;
  v_ranges jsonb;
  v_old public.academy_watch_ranges;
  v_previous_seconds numeric;
  v_watched numeric := least(greatest(coalesce(p_watched_seconds, 0), 0), 3600);
  v_cap integer;
  v_percent integer;
  v_position numeric := greatest(coalesce(p_position_seconds, 0), 0);
  v_row public.academy_watch_progress;
begin
  if not exists (
    select 1 from public.academy_lesson_blocks b
    where b.video_id = p_video_id and public.academy_lesson_open_for(b.lesson_id, v_uid)
  ) then
    if public.academy_is_manager() then
      return null; -- preview: nothing is recorded
    end if;
    raise exception 'This video is not open for you' using errcode = '42501';
  end if;

  -- The version must belong to the video; otherwise the current one.
  select vv.id, vv.duration_seconds into v_version, v_duration
  from public.academy_video_versions vv where vv.id = p_version_id and vv.video_id = p_video_id;
  if v_version is null then
    select vv.id, vv.duration_seconds into v_version, v_duration
    from public.academy_videos v join public.academy_video_versions vv on vv.id = v.current_version_id
    where v.id = p_video_id;
  end if;
  if v_duration is not null and v_duration > 0 then
    v_position := least(v_position, v_duration);
    v_watched := least(v_watched, v_duration);
  end if;

  if v_duration is null or v_duration <= 0 then
    v_cap := 100;
  elsif p_ranges is not null then
    select * into v_old from public.academy_watch_ranges where profile_id = v_uid and video_id = p_video_id;
    v_ranges := public.academy_merge_ranges(
      case when v_old.version_id is not distinct from v_version then coalesce(v_old.ranges, '[]'::jsonb) else '[]'::jsonb end
        || (select coalesce(jsonb_agg(e), '[]'::jsonb) from (
              select e from jsonb_array_elements(case when jsonb_typeof(p_ranges) = 'array' then p_ranges else '[]'::jsonb end) as x(e) limit 500
            ) l),
      v_duration
    );
    insert into public.academy_watch_ranges (profile_id, video_id, version_id, ranges, updated_at)
    values (v_uid, p_video_id, v_version, v_ranges, now())
    on conflict (profile_id, video_id) do update set version_id = excluded.version_id, ranges = excluded.ranges, updated_at = now();
    v_cap := case
      when v_duration - public.academy_ranges_seconds(v_ranges) <= 1.5 then 100
      else least(100, floor(public.academy_ranges_seconds(v_ranges) / v_duration * 100))::integer
    end;
  else
    select coalesce(w.watched_seconds, 0) into v_previous_seconds
    from public.academy_watch_progress w where w.profile_id = v_uid and w.video_id = p_video_id;
    v_cap := least(100, floor((coalesce(v_previous_seconds, 0) + v_watched) / v_duration * 100))::integer;
  end if;

  -- With ranges and a known duration only what was played counts; otherwise
  -- the reported percent, capped.
  v_percent := case
    when p_ranges is not null and v_duration > 0 then v_cap
    else least(greatest(coalesce(p_percent, v_cap), 0), v_cap, 100)
  end;

  insert into public.academy_watch_progress as w (profile_id, video_id, version_id, position_seconds, percent, watched_seconds, completed_at)
  values (v_uid, p_video_id, v_version, v_position, v_percent, v_watched, case when v_percent >= 100 then now() end)
  on conflict (profile_id, video_id) do update set
    version_id = coalesce(excluded.version_id, w.version_id),
    position_seconds = excluded.position_seconds,
    percent = greatest(w.percent, excluded.percent),
    watched_seconds = w.watched_seconds + excluded.watched_seconds,
    completed_at = coalesce(w.completed_at, excluded.completed_at),
    updated_at = now()
  returning * into v_row;
  perform public.academy_touch();
  return to_jsonb(v_row);
end;
$$;

revoke execute on function public.academy_record_watch(uuid, uuid, numeric, integer, numeric, jsonb) from public, anon;
grant execute on function public.academy_record_watch(uuid, uuid, numeric, integer, numeric, jsonb) to authenticated, service_role;
revoke execute on function public.academy_merge_ranges(jsonb, numeric) from public, anon, authenticated;
revoke execute on function public.academy_ranges_seconds(jsonb) from public, anon, authenticated;
grant execute on function public.academy_merge_ranges(jsonb, numeric) to service_role;
grant execute on function public.academy_ranges_seconds(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Completion (replaces the foundation versions of these three)
-- ---------------------------------------------------------------------------

-- video: watched at least completion.min_percent (default 90), or to the
-- end. A block without a video (or a video without a file) has nothing to
-- watch and does not hold the lesson back.
create or replace function public.academy_block_done_video(p_block_id uuid, p_profile_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.academy_lesson_blocks b
    left join public.academy_videos v on v.id = b.video_id
    left join public.academy_watch_progress w on w.video_id = b.video_id and w.profile_id = p_profile_id
    where b.id = p_block_id and (
      v.id is null or v.current_version_id is null
      or w.completed_at is not null
      or w.percent >= coalesce((b.completion ->> 'min_percent')::integer, 90)
    )
  );
$$;

-- document: opened or downloaded (academy_record_block_view, also by the
-- download route). Without a document or a file there is nothing to open.
create or replace function public.academy_block_done_document(p_block_id uuid, p_profile_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.academy_lesson_blocks b
    left join public.academy_documents d on d.id = b.document_id
    where b.id = p_block_id and (
      d.id is null or d.current_version = 0
      or exists (
        select 1 from public.academy_block_progress p
        where p.block_id = b.id and p.profile_id = p_profile_id and p.viewed_at is not null
      )
    )
  );
$$;

-- worksheet: answers submitted for the block's document. A block without a
-- worksheet, or a worksheet without fields, has nothing to fill in.
create or replace function public.academy_block_done_worksheet(p_block_id uuid, p_profile_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.academy_lesson_blocks b
    left join public.academy_documents d on d.id = b.document_id
    where b.id = p_block_id and (
      d.id is null or jsonb_array_length(d.worksheet_fields) = 0
      or exists (
        select 1 from public.academy_worksheet_answers a
        where a.document_id = d.id and a.profile_id = p_profile_id and a.submitted_at is not null
      )
    )
  );
$$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'academy_block_done_video(uuid, uuid)', 'academy_block_done_document(uuid, uuid)', 'academy_block_done_worksheet(uuid, uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', v_fn);
    execute format('grant execute on function public.%s to service_role', v_fn);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Worksheets
-- ---------------------------------------------------------------------------

-- Does a value count as filled in for a field of this type?
create or replace function public.academy_worksheet_value_filled(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case jsonb_typeof(p_value)
    when 'string' then btrim(p_value #>> '{}') <> ''
    when 'boolean' then (p_value #>> '{}')::boolean
    when 'number' then true
    when 'array' then jsonb_array_length(p_value) > 0
    else false
  end;
$$;

-- Answers of a participant: only on worksheets, at most 200 kB, locked once
-- submitted (Nordavo can reopen by clearing submitted_at). Submitting needs
-- every required field filled in; the time is the server's. The server
-- action cleans the values per field type (src/lib/academy/media/worksheet.ts).
create or replace function public.academy_worksheet_answers_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fields jsonb;
  v_kind text;
  v_missing text;
begin
  if public.academy_is_manager() or (select auth.uid()) is null then
    return new;
  end if;
  select d.kind, d.worksheet_fields into v_kind, v_fields from public.academy_documents d where d.id = new.document_id;
  if v_kind is distinct from 'worksheet' then
    raise exception 'This document is not a worksheet' using errcode = '22023';
  end if;
  if octet_length(new.answers::text) > 200000 then
    raise exception 'The answers are too long' using errcode = '22001';
  end if;
  if tg_op = 'UPDATE' and old.submitted_at is not null then
    raise exception 'This worksheet has been submitted' using errcode = '42501';
  end if;
  if new.submitted_at is not null then
    select f ->> 'label' into v_missing
    from jsonb_array_elements(v_fields) as x(f)
    where coalesce((f ->> 'required')::boolean, false)
      and not public.academy_worksheet_value_filled(new.answers -> (f ->> 'key'))
    limit 1;
    if v_missing is not null then
      raise exception 'Fill in: %', v_missing using errcode = '23514';
    end if;
    new.submitted_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function public.academy_worksheet_answers_guard() from public, anon, authenticated;
revoke execute on function public.academy_worksheet_value_filled(jsonb) from public, anon;

create trigger academy_worksheet_answers_guard before insert or update on public.academy_worksheet_answers
  for each row execute function public.academy_worksheet_answers_guard();

-- ---------------------------------------------------------------------------
-- 5. Certificates
-- ---------------------------------------------------------------------------

-- Issue the certificate of a course once it is completed: published course,
-- the person has access and every module with lessons is done. Idempotent.
-- Notifies the person in their language. Returns the certificate id when one
-- was issued now.
create or replace function public.academy_issue_certificate(p_course_id uuid, p_profile_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text;
  v_locale text;
  v_title text;
begin
  if not exists (select 1 from public.academy_courses c where c.id = p_course_id and c.status = 'published')
    or not exists (select 1 from public.academy_members m where m.profile_id = p_profile_id)
    or not public.academy_has_course(p_course_id, p_profile_id)
    or not public.academy_course_done(p_course_id, p_profile_id) then
    return null;
  end if;
  select coalesce(nullif(btrim(p.full_name), ''), p.email, 'Nordavo Academy') into v_name
  from public.profiles p where p.id = p_profile_id;
  insert into public.academy_certificates (profile_id, course_id, full_name)
  values (p_profile_id, p_course_id, left(coalesce(v_name, 'Nordavo Academy'), 200))
  on conflict (profile_id, course_id) do nothing
  returning id into v_id;
  if v_id is null then
    return null;
  end if;
  select m.locale into v_locale from public.academy_members m where m.profile_id = p_profile_id;
  select c.title into v_title from public.academy_courses c where c.id = p_course_id;
  perform public.academy_notify(
    p_profile_id,
    'certificate',
    case when v_locale = 'nl' then 'Je certificaat staat klaar' else 'Your certificate is ready' end,
    case when v_locale = 'nl'
      then format('Je hebt %s afgerond. Download je certificaat.', v_title)
      else format('You completed %s. Download your certificate.', v_title) end,
    '/academy/certificates/' || v_id,
    jsonb_build_object('course_id', p_course_id, 'certificate_id', v_id)
  );
  return v_id;
end;
$$;

revoke execute on function public.academy_issue_certificate(uuid, uuid) from public, anon, authenticated;
grant execute on function public.academy_issue_certificate(uuid, uuid) to service_role;

-- A module completion may complete a course (also another course that has
-- the module's lessons is checked through its own module completions).
create or replace function public.academy_after_module_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.academy_issue_certificate(m.course_id, new.profile_id)
  from public.academy_modules m where m.id = new.module_id;
  return null;
end;
$$;

revoke execute on function public.academy_after_module_completion() from public, anon, authenticated;

create trigger academy_module_completions_certificate after insert on public.academy_module_completions
  for each row execute function public.academy_after_module_completion();

-- Whoever completed a course before this migration gets the certificate now.
select public.academy_issue_certificate(c.id, m.profile_id)
from public.academy_courses c
cross join public.academy_members m
where c.status = 'published';

-- ---------------------------------------------------------------------------
-- 6. Jobs: academy-* belong to module academy (Jobs page, can_see_job).
-- ---------------------------------------------------------------------------

create or replace function public.job_module(p_job_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_job_name ~ '^s[0-9]+-' or p_job_name like 'max-%' or p_job_name like 'claude-%' then 'sales'
    when p_job_name like 'work-%' or p_job_name like 'clickup-%' then null
    when p_job_name like 'academy-%' then 'academy'
    else 'recruitment'
  end;
$$;
