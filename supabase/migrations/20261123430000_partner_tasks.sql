-- Partners get tasks and a next action with a date, like a lead (feedback
-- Julius, 6fc01216 "Partners: taken en volgende actie met datum").
--
--   * partners.next_action and next_action_date, edited on the partner page;
--   * partner is a record type for notes, attachments and Work tasks, so the
--     partner page shows the same tasks panel as the lead page (EntityExtras).
--     Access follows the sales module, like leads.
--
-- The entity checks keep every value they already allow, so this combines
-- with other migrations that add record types.

alter table public.partners
  add column if not exists next_action text check (char_length(next_action) <= 500),
  add column if not exists next_action_date date;

create index if not exists partners_next_action_idx on public.partners (next_action_date) where next_action_date is not null;

-- ---------------------------------------------------------------------------
-- 1. partner in the entity_type checks
-- ---------------------------------------------------------------------------

do $$
declare
  v_table text;
  v_con record;
  v_values text[];
begin
  foreach v_table in array array['notes', 'attachments', 'work_task_links'] loop
    if to_regclass(format('public.%I', v_table)) is null then
      continue;
    end if;
    for v_con in
      select conname, pg_get_constraintdef(oid) as def
      from pg_constraint
      where conrelid = format('public.%I', v_table)::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) like '%entity_type%'
        and pg_get_constraintdef(oid) like '%''company''%'
    loop
      select array_agg(distinct m[1]) into v_values
      from regexp_matches(v_con.def, '''([a-z_]+)''', 'g') as m;
      if 'partner' = any (v_values) then
        continue;
      end if;
      v_values := array(select distinct x from unnest(v_values || array['partner']) x order by x);
      execute format('alter table public.%I drop constraint %I', v_table, v_con.conname);
      execute format(
        'alter table public.%I add constraint %I check (entity_type in (%s))',
        v_table, v_con.conname, (select string_agg(quote_literal(x), ', ') from unnest(v_values) x)
      );
    end loop;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Access: partners follow the sales module
-- ---------------------------------------------------------------------------

create or replace function public.can_access_entity(p_entity_type text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_entity_type is null then public.is_staff()
    when p_entity_type in ('company', 'partner') then public.has_module('sales')
    when p_entity_type = 'client' then public.has_module('clients')
    when p_entity_type in ('vacancy', 'candidate', 'application', 'placement') then public.has_module('recruitment')
    when p_entity_type = 'academy' then public.has_module('academy')
    else public.is_staff()
  end;
$$;

revoke execute on function public.can_access_entity(text) from public, anon;
grant execute on function public.can_access_entity(text) to authenticated, service_role;

create or replace function work_private.can_link(p_user uuid, p_entity_type text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when p.role = 'admin' then true
      when p.role <> 'member' then false
      when p_entity_type in ('company', 'partner') then 'sales' = any (p.modules)
      when p_entity_type = 'client' then 'clients' = any (p.modules)
      when p_entity_type in ('vacancy', 'candidate', 'application', 'placement') then 'recruitment' = any (p.modules)
      else false
    end
    from public.profiles p
    where p.id = p_user
  ), false);
$$;

create or replace function work_private.check_record(p_entity_type text, p_entity_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_found boolean;
begin
  v_found := case p_entity_type
    when 'client' then exists (select 1 from public.clients where id = p_entity_id)
    when 'vacancy' then exists (select 1 from public.vacancies where id = p_entity_id)
    when 'candidate' then exists (select 1 from public.candidates where id = p_entity_id)
    when 'application' then exists (select 1 from public.applications where id = p_entity_id)
    when 'placement' then exists (select 1 from public.placements where id = p_entity_id)
    when 'company' then exists (select 1 from public.companies where id = p_entity_id)
    when 'partner' then exists (select 1 from public.partners where id = p_entity_id)
    else false
  end;
  if not v_found then
    raise exception 'Record not found' using errcode = 'P0002';
  end if;
end;
$$;

drop trigger if exists partners_work_tasks on public.partners;
create trigger partners_work_tasks after delete on public.partners
  for each row execute function work_private.record_deleted('partner');

-- ---------------------------------------------------------------------------
-- 3. The next action is in the change log of the partner
-- ---------------------------------------------------------------------------

create or replace function public.partners_log_next_action()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.next_action is distinct from old.next_action or new.next_action_date is distinct from old.next_action_date then
    insert into public.activities (partner_id, channel, type, field, old_value, new_value, source, created_by)
    values (
      new.id, 'system', 'change', 'next_action',
      jsonb_build_object('text', old.next_action, 'date', old.next_action_date),
      jsonb_build_object('text', new.next_action, 'date', new.next_action_date),
      public.sales_current_source(), public.sales_current_actor()
    );
  end if;
  return null;
end;
$$;

revoke execute on function public.partners_log_next_action() from public, anon, authenticated;

drop trigger if exists partners_log_next_action on public.partners;
create trigger partners_log_next_action after update of next_action, next_action_date on public.partners
  for each row execute function public.partners_log_next_action();
