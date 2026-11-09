-- Sales CRM, the working parts: sequences, Claude's scheduled tasks and the
-- pause after a reply (feedback Julius, parts 5 to 7).
--
--   1  Approved texts: editing the text of a step by hand counts as approved
--   2  Enrollments: pause, resume and stop, with their step tasks
--   3  Pause a company after a reply, from the MCP (same as the trigger)
--   4  Claude's scheduled tasks (claude-*) are sales jobs

-- ---------------------------------------------------------------------------
-- 1. Approved texts. Only approved text is used (sales_start_sequence refuses
--    mail and LinkedIn steps without approval). A concept lives in draft_*;
--    whoever writes or changes subject or body by hand approves it.
-- ---------------------------------------------------------------------------

create or replace function public.sequence_steps_track_approval()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if nullif(trim(coalesce(new.body, '')), '') is not null and new.approved_at is null then
      new.approved_at := now();
      new.approved_by := coalesce(new.approved_by, public.sales_current_actor());
    end if;
    if (new.draft_body is not null or new.draft_subject is not null) and new.draft_at is null then
      new.draft_at := now();
    end if;
    return new;
  end if;

  if new.subject is distinct from old.subject or new.body is distinct from old.body then
    if nullif(trim(coalesce(new.body, '')), '') is null then
      -- No text, nothing approved.
      new.approved_at := null;
      new.approved_by := null;
    else
      new.approved_at := now();
      new.approved_by := coalesce(public.sales_current_actor(), new.approved_by);
    end if;
  end if;
  if new.draft_subject is distinct from old.draft_subject or new.draft_body is distinct from old.draft_body then
    new.draft_at := case when new.draft_body is null and new.draft_subject is null then null else now() end;
    if new.draft_body is null and new.draft_subject is null then
      new.draft_source := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger sequence_steps_track_approval before insert or update on public.sequence_steps
  for each row execute function public.sequence_steps_track_approval();

-- ---------------------------------------------------------------------------
-- 2. One enrollment: pause, resume or stop.
--      paused   open call steps are cancelled (as after a reply)
--      active   cancelled steps from today on are open again
--      stopped  every open step is cancelled
--    Logged in activities as a system row on the company.
-- ---------------------------------------------------------------------------

create or replace function public.sales_set_enrollment(
  p_enrollment uuid,
  p_status text,
  p_reason text default null,
  p_source text default 'handmatig',
  p_actor uuid default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.sales_actor(p_actor, p_source);
  v_row public.sequence_enrollments;
  v_name text;
begin
  if public.caller_id_for(v_uid) is not null then
    raise exception 'Callers cannot change sequences' using errcode = '42501';
  end if;
  if p_status not in ('active', 'paused', 'stopped') then
    raise exception 'Unknown enrollment status';
  end if;
  select * into v_row from public.sequence_enrollments where id = p_enrollment for update;
  if v_row.id is null then
    raise exception 'Enrollment not found' using errcode = 'P0002';
  end if;
  if v_row.status in ('stopped', 'finished') then
    raise exception 'This enrollment has ended';
  end if;
  if v_row.status = p_status then
    return v_row.status;
  end if;
  select name into v_name from public.sequences where id = v_row.sequence_id;

  if p_status = 'paused' then
    update public.sequence_enrollments
    set status = 'paused', paused_at = now(), pause_reason = left(coalesce(nullif(trim(p_reason), ''), 'Paused by hand'), 500)
    where id = p_enrollment;
    update public.sequence_tasks set status = 'cancelled'
    where enrollment_id = p_enrollment and status = 'open' and channel = 'call';
  elsif p_status = 'active' then
    update public.sequence_enrollments set status = 'active', paused_at = null, pause_reason = null
    where id = p_enrollment;
    update public.sequence_tasks set status = 'open'
    where enrollment_id = p_enrollment and status = 'cancelled' and due_date >= current_date;
    update public.companies set sequence_paused_at = null where id = v_row.company_id;
  else
    update public.sequence_enrollments
    set status = 'stopped', paused_at = coalesce(paused_at, now()),
        pause_reason = left(coalesce(nullif(trim(p_reason), ''), pause_reason, 'Stopped by hand'), 500)
    where id = p_enrollment;
    update public.sequence_tasks set status = 'cancelled'
    where enrollment_id = p_enrollment and status = 'open';
  end if;

  insert into public.activities (company_id, contact_id, channel, type, notes, source, created_by)
  values (
    v_row.company_id, v_row.contact_id, 'system', 'system',
    left(concat_ws(': ',
      case p_status when 'paused' then 'Sequence paused' when 'active' then 'Sequence resumed' else 'Sequence stopped' end
        || ' (' || coalesce(v_name, 'sequence') || ')',
      nullif(trim(p_reason), '')), 5000),
    coalesce(p_source, 'handmatig'), v_uid
  );
  return p_status;
end;
$$;

revoke execute on function public.sales_set_enrollment(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.sales_set_enrollment(uuid, text, text, text, uuid) to authenticated, service_role;

-- An active enrollment without open steps left is finished (the last call on
-- the call screen, or Claude marking the last mail or LinkedIn step done).
create or replace function public.sequence_tasks_finish_enrollment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'open' and old.status = 'open' then
    update public.sequence_enrollments e
    set status = 'finished'
    where e.id = new.enrollment_id and e.status = 'active'
      and not exists (select 1 from public.sequence_tasks t where t.enrollment_id = e.id and t.status = 'open')
      and exists (select 1 from public.sequence_tasks t where t.enrollment_id = e.id and t.status in ('done', 'skipped'));
  end if;
  return null;
end;
$$;

revoke execute on function public.sequence_tasks_finish_enrollment() from public, anon, authenticated;

create trigger sequence_tasks_finish_enrollment after update of status on public.sequence_tasks
  for each row execute function public.sequence_tasks_finish_enrollment();

-- ---------------------------------------------------------------------------
-- 3. Pause a company everywhere, for Claude after a reply it handled outside
--    the portal (the reply trigger does the same for replies logged here).
-- ---------------------------------------------------------------------------

create or replace function public.sales_pause(
  p_company uuid,
  p_reason text default null,
  p_source text default 'handmatig',
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.sales_actor(p_actor, p_source);
  v_enrollments integer;
  v_calls integer;
begin
  if public.caller_id_for(v_uid) is not null then
    raise exception 'Callers cannot pause companies' using errcode = '42501';
  end if;
  if not exists (select 1 from public.companies where id = p_company) then
    raise exception 'Company not found' using errcode = 'P0002';
  end if;
  select count(*) into v_enrollments from public.sequence_enrollments where company_id = p_company and status = 'active';
  select count(*) into v_calls from public.sequence_tasks where company_id = p_company and status = 'open' and channel = 'call';

  perform public.sales_pause_company(p_company, coalesce(nullif(trim(p_reason), ''), 'Paused after a reply'));

  insert into public.activities (company_id, channel, type, notes, source, created_by)
  values (
    p_company, 'system', 'system',
    left('Company paused: ' || coalesce(nullif(trim(p_reason), ''), 'after a reply'), 5000),
    coalesce(p_source, 'handmatig'), v_uid
  );
  return jsonb_build_object('enrollments_paused', v_enrollments, 'call_steps_cancelled', v_calls);
end;
$$;

revoke execute on function public.sales_pause(uuid, text, text, uuid) from public, anon;
grant execute on function public.sales_pause(uuid, text, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Claude's scheduled tasks log their runs as claude-* jobs (job_runs with
--    triggered_by 'claude'). They belong to sales.
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
    else 'recruitment'
  end;
$$;
