-- Nordavo Academy, editor helpers (Academy: beheer-editor en mensen
-- toevoegen). Managers only.
--
--   academy_client_options()             clients to link client users to
--   academy_candidate_options(search)    ATS candidates to link people to
--                                        (name and mail only, not the CV)
--   academy_duplicate_lesson(lesson, module)  deep copy: blocks, tasks, check questions
--   academy_duplicate_module(module)     copy of the module with copies of its lessons
--
-- A manager with module academy alone cannot read clients or candidates
-- (modules clients and recruitment); these functions give exactly what the
-- editor needs.

create or replace function public.academy_client_options()
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.name from public.clients c
  where public.academy_is_manager()
  order by c.name;
$$;

create or replace function public.academy_candidate_options(p_search text default null)
returns table (id uuid, full_name text, email text, top_candidate boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.full_name, c.email, c.top_candidate
  from public.candidates c
  where public.academy_is_manager()
    and (
      coalesce(btrim(p_search), '') = ''
      or c.full_name ilike '%' || btrim(p_search) || '%'
      or c.email ilike '%' || btrim(p_search) || '%'
    )
  order by c.full_name
  limit 50;
$$;

-- Deep copy of a lesson (draft, "(copy)"): blocks with their tasks and
-- knowledge check questions. Videos and documents are shared, not copied.
-- With a module, the copy is linked right after the original.
create or replace function public.academy_duplicate_lesson(p_lesson_id uuid, p_module_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new uuid;
  v_block record;
  v_new_block uuid;
  v_position double precision;
begin
  if not public.academy_is_manager() then
    raise exception 'Only Nordavo edits the Academy' using errcode = '42501';
  end if;

  insert into public.academy_lessons (title, summary, language, status, duration_minutes, created_by)
  select left(l.title || ' (copy)', 300), l.summary, l.language, 'draft', l.duration_minutes, (select auth.uid())
  from public.academy_lessons l where l.id = p_lesson_id
  returning id into v_new;
  if v_new is null then
    raise exception 'Lesson not found';
  end if;

  for v_block in select * from public.academy_lesson_blocks where lesson_id = p_lesson_id order by position, id loop
    insert into public.academy_lesson_blocks (lesson_id, type, position, title, content, required, completion, video_id, document_id)
    values (v_new, v_block.type, v_block.position, v_block.title, v_block.content, v_block.required, v_block.completion, v_block.video_id, v_block.document_id)
    returning id into v_new_block;
    insert into public.academy_tasks (block_id, title, description, position, deadline_offset_days, shared, placement_only, required)
    select v_new_block, t.title, t.description, t.position, t.deadline_offset_days, t.shared, t.placement_only, t.required
    from public.academy_tasks t where t.block_id = v_block.id;
    insert into public.academy_check_questions (block_id, position, question, options, correct_index, explanation)
    select v_new_block, q.position, q.question, q.options, q.correct_index, q.explanation
    from public.academy_check_questions q where q.block_id = v_block.id;
  end loop;

  if p_module_id is not null then
    select ml.position into v_position from public.academy_module_lessons ml
    where ml.module_id = p_module_id and ml.lesson_id = p_lesson_id;
    -- Halfway to the next lesson, or one further at the end.
    insert into public.academy_module_lessons (module_id, lesson_id, position)
    values (
      p_module_id, v_new,
      coalesce(
        (select (coalesce(v_position, 0) + min(ml.position)) / 2 from public.academy_module_lessons ml
          where ml.module_id = p_module_id and ml.position > coalesce(v_position, 0)),
        coalesce(v_position, 0) + 1
      )
    );
  end if;
  return v_new;
end;
$$;

-- Copy of a module at the end of its course (draft): settings and copies of
-- its lessons, so the copy can be changed without touching the original.
create or replace function public.academy_duplicate_module(p_module_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new uuid;
  v_lesson record;
  v_copy uuid;
begin
  if not public.academy_is_manager() then
    raise exception 'Only Nordavo edits the Academy' using errcode = '42501';
  end if;

  insert into public.academy_modules (
    course_id, title, description, position, status, requires_previous, release_offset_days,
    in_default_access, is_core, required_before_start, workbook_document_id
  )
  select m.course_id, left(m.title || ' (copy)', 200), m.description,
    (select coalesce(max(x.position), 0) + 1 from public.academy_modules x where x.course_id = m.course_id),
    'draft', m.requires_previous, m.release_offset_days, m.in_default_access, m.is_core, m.required_before_start,
    m.workbook_document_id
  from public.academy_modules m where m.id = p_module_id
  returning id into v_new;
  if v_new is null then
    raise exception 'Module not found';
  end if;

  insert into public.academy_module_requirements (module_id, required_module_id)
  select v_new, r.required_module_id from public.academy_module_requirements r where r.module_id = p_module_id;

  for v_lesson in select ml.lesson_id, ml.position from public.academy_module_lessons ml where ml.module_id = p_module_id order by ml.position loop
    v_copy := public.academy_duplicate_lesson(v_lesson.lesson_id, null);
    insert into public.academy_module_lessons (module_id, lesson_id, position) values (v_new, v_copy, v_lesson.position);
  end loop;
  return v_new;
end;
$$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'academy_client_options()', 'academy_candidate_options(text)',
    'academy_duplicate_lesson(uuid, uuid)', 'academy_duplicate_module(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', v_fn);
    execute format('grant execute on function public.%s to authenticated', v_fn);
  end loop;
end $$;
