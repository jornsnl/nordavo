-- English messages (client feedback point 7: everything in English).
--
-- Recreates the functions that raise or store Dutch text, copied from their
-- latest definition with only the text changed. Earlier migrations stay as
-- they are.
--
-- The activity summary is "<record name> <verb>". The portal renders the
-- verb from action and changes (describeActivity) and only takes the record
-- name from the summary; it strips both the old Dutch and the new English
-- verbs, so rows written before this migration still render in English.

-- ---------------------------------------------------------------------------
-- Activity log
-- ---------------------------------------------------------------------------

create or replace function public.log_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity_type text := tg_argv[0];
  v_label text;
  v_row jsonb;
  v_old jsonb;
  v_changes jsonb := '{}';
  v_action text;
  v_summary text;
  v_key text;
  v_entity_id uuid;
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
  else
    v_row := to_jsonb(new);
  end if;
  v_entity_id := (v_row ->> 'id')::uuid;
  v_label := coalesce(v_row ->> 'name', v_row ->> 'title', v_row ->> 'full_name', '');

  if tg_op = 'INSERT' then
    v_action := 'created';
    v_summary := 'created';
  elsif tg_op = 'DELETE' then
    v_action := 'deleted';
    v_summary := 'deleted';
  else
    v_old := to_jsonb(old);
    for v_key in select jsonb_object_keys(v_row) loop
      if v_key not in ('updated_at', 'position', 'created_at')
         and (v_row -> v_key) is distinct from (v_old -> v_key) then
        v_changes := v_changes || jsonb_build_object(
          v_key, jsonb_build_object('from', v_old -> v_key, 'to', v_row -> v_key)
        );
      end if;
    end loop;

    if v_changes = '{}'::jsonb then
      return null; -- only position/updated_at changed, nothing worth logging
    end if;

    if v_changes ? 'stage' then
      v_action := 'stage_changed';
      v_summary := 'stage changed';
    elsif v_changes ? 'status' then
      v_action := 'status_changed';
      v_summary := 'status changed';
    else
      v_action := 'updated';
      v_summary := 'updated';
    end if;
  end if;

  insert into public.activity_log (entity_type, entity_id, action, summary, changes, actor_id)
  values (
    v_entity_type,
    v_entity_id,
    v_action,
    trim(both ' ' from v_label || ' ' || v_summary),
    v_changes,
    (select auth.uid())
  );
  return null;
end;
$$;

create or replace function public.log_manual_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company text;
  v_name text;
begin
  select name into v_company from public.companies where id = new.company_id;
  v_name := nullif(trim(concat_ws(' ', new.first_name, new.last_name)), '');
  v_name := concat_ws(', ', coalesce(v_name, new.email, 'Unknown'), nullif(trim(new.title), ''));

  insert into public.activity_log (entity_type, entity_id, action, summary, changes, actor_id)
  values (
    'company',
    new.company_id,
    'updated',
    trim(both ' ' from coalesce(v_company, '') || ' contact added'),
    jsonb_build_object('contact_added', jsonb_build_object('from', null, 'to', v_name)),
    (select auth.uid())
  );
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Client feedback and roles
-- ---------------------------------------------------------------------------

create or replace function public.client_review_application(
  p_application_id uuid,
  p_decision text,
  p_feedback text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid decision';
  end if;

  update public.applications a
  set client_decision = p_decision,
      client_feedback = nullif(trim(p_feedback), ''),
      client_decided_at = now()
  from public.vacancies v
  where a.id = p_application_id
    and v.id = a.vacancy_id
    and v.client_id = public.current_client_id()
    and a.stage in ('presented', 'final_interview');

  if not found then
    raise exception 'Candidate not found';
  end if;
end;
$$;

create or replace function public.admin_update_profile(
  p_user_id uuid,
  p_role text,
  p_client_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change roles';
  end if;
  if p_role not in ('admin', 'member', 'client', 'external') then
    raise exception 'Invalid role';
  end if;
  if p_role = 'client' and p_client_id is null then
    raise exception 'A client account must be linked to a client';
  end if;
  if p_user_id = (select auth.uid()) and p_role <> 'admin' then
    raise exception 'You cannot remove your own admin role';
  end if;

  update public.profiles
  set role = p_role,
      client_id = case when p_role = 'client' then p_client_id else null end
  where id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- GTM: note on automatic suppression
-- ---------------------------------------------------------------------------

create or replace function public.activities_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.contact_id is not null and new.outcome not in ('notitie', 'bounce') then
    update public.contacts
    set last_contacted_at = greatest(coalesce(last_contacted_at, new.date), new.date)
    where id = new.contact_id;
  end if;

  if new.outcome = 'afgemeld' then
    insert into public.suppression (contact_id, company_id, reason, scope, notes)
    values (
      new.contact_id,
      case when new.contact_id is null then new.company_id end,
      'afgemeld',
      'alle_kanalen',
      'Automatically after unsubscribe via ' || new.source
    );
  end if;

  if new.outcome = 'bounce' and new.contact_id is not null then
    update public.contacts set email_status = 'invalid' where id = new.contact_id;
  end if;
  return null;
end;
$$;
