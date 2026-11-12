-- Own columns on the sales tables (feedback Julius, 87399c89 "Sales-tabellen:
-- eigen kolommen toevoegen, vullen en verslepen, zoals Excel").
--
-- The custom fields of 20261108050000_custom_fields_and_extras.sql get two
-- more record types, company (Leads, Pipeline, lead page) and contact
-- (Contacts, call lists). Values live in custom_fields on companies and
-- contacts and are checked by the same validate_custom_fields() trigger.
--
-- Written so it combines with other migrations that add record types: the
-- entity check keeps every value it already allows, and set_custom_field()
-- picks the table by record type for every table that has custom_fields.
--
-- sales_set_custom_field() changes one column for many rows at once (the
-- table, paste and the bulk bar), for the sales module, and logs each change
-- in Activities as field "cf:<key>".

-- ---------------------------------------------------------------------------
-- 1. Record types company and contact
-- ---------------------------------------------------------------------------

do $$
declare
  v_def text;
  v_values text[];
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conrelid = 'public.custom_field_definitions'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%entity%'
    and conname like '%entity%'
  limit 1;

  select array_agg(distinct m[1]) into v_values
  from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') as m;

  v_values := array(
    select distinct x from unnest(
      coalesce(v_values, '{}') || array['candidate', 'vacancy', 'application', 'company', 'contact']
    ) x order by x
  );

  execute 'alter table public.custom_field_definitions drop constraint if exists custom_field_definitions_entity_check';
  execute format(
    'alter table public.custom_field_definitions add constraint custom_field_definitions_entity_check check (entity in (%s))',
    (select string_agg(quote_literal(x), ', ') from unnest(v_values) x)
  );
end;
$$;

alter table public.companies
  add column if not exists custom_fields jsonb not null default '{}'::jsonb
  check (jsonb_typeof(custom_fields) = 'object');
alter table public.contacts
  add column if not exists custom_fields jsonb not null default '{}'::jsonb
  check (jsonb_typeof(custom_fields) = 'object');

comment on column public.companies.custom_fields is 'Values of own columns (custom_field_definitions, entity company), by key.';
comment on column public.contacts.custom_fields is 'Values of own columns (custom_field_definitions, entity contact), by key.';

drop trigger if exists companies_check_custom_fields on public.companies;
create trigger companies_check_custom_fields
  before insert or update of custom_fields on public.companies
  for each row execute function public.check_custom_fields('company');
drop trigger if exists contacts_check_custom_fields on public.contacts;
create trigger contacts_check_custom_fields
  before insert or update of custom_fields on public.contacts
  for each row execute function public.check_custom_fields('contact');

-- ---------------------------------------------------------------------------
-- 2. set_custom_field() for every record type with a custom_fields column
-- ---------------------------------------------------------------------------

create or replace function public.custom_field_table(p_entity text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_entity
    when 'candidate' then 'candidates'
    when 'vacancy' then 'vacancies'
    when 'application' then 'applications'
    when 'company' then 'companies'
    when 'contact' then 'contacts'
    when 'client' then 'clients'
    when 'placement' then 'placements'
    when 'client_contact' then 'client_contacts'
  end;
$$;

-- Runs as the caller: row level security decides which records can change,
-- the trigger checks the value. Empty values (null, "", []) clear it.
create or replace function public.set_custom_field(p_entity text, p_id uuid, p_key text, p_value jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_clear boolean := p_value is null or p_value in ('null'::jsonb, '""'::jsonb, '[]'::jsonb);
  v_table text := public.custom_field_table(p_entity);
  v_result jsonb;
begin
  if not public.is_staff() and (select auth.uid()) is not null then
    raise exception 'Only the Nordavo team can change custom fields' using errcode = '42501';
  end if;
  if p_key is null or p_key !~ '^[a-z][a-z0-9_]{0,39}$' then
    raise exception 'Unknown custom field "%"', p_key using errcode = '22023';
  end if;
  if v_table is null or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = v_table and column_name = 'custom_fields'
  ) then
    raise exception 'Unknown record type "%"', p_entity using errcode = '22023';
  end if;

  execute format(
    'update public.%I set custom_fields = case when $2 then custom_fields - $3 else custom_fields || jsonb_build_object($3, $4) end where id = $1 returning custom_fields',
    v_table
  ) into v_result using p_id, v_clear, p_key, p_value;

  if v_result is null then
    raise exception 'Record not found' using errcode = 'P0002';
  end if;
  return v_result;
end;
$$;

revoke execute on function public.set_custom_field(text, uuid, text, jsonb) from public, anon;
grant execute on function public.set_custom_field(text, uuid, text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. One own column for many companies or contacts, logged
-- ---------------------------------------------------------------------------

create or replace function public.sales_set_custom_field(
  p_entity text,
  p_ids uuid[],
  p_key text,
  p_value jsonb,
  p_source text default 'handmatig',
  p_actor uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.sales_actor(p_actor, p_source);
  v_clear boolean := p_value is null or p_value in ('null'::jsonb, '""'::jsonb, '[]'::jsonb);
  v_row record;
  v_count integer := 0;
begin
  if public.caller_id_for(v_uid) is not null then
    raise exception 'Callers change contacts on the call screen only' using errcode = '42501';
  end if;
  if p_entity not in ('company', 'contact') then
    raise exception 'Unknown record type';
  end if;
  if p_key is null or p_key !~ '^[a-z][a-z0-9_]{0,39}$'
     or not exists (select 1 from public.custom_field_definitions where entity = p_entity and key = p_key) then
    raise exception 'Unknown custom field "%"', p_key using errcode = '22023';
  end if;
  if p_ids is null or cardinality(p_ids) > 5000 then
    raise exception 'Change at most 5000 rows at once';
  end if;

  if p_entity = 'company' then
    for v_row in select id, custom_fields -> p_key as old from public.companies where id = any (p_ids) loop
      if v_row.old is not distinct from (case when v_clear then null else p_value end) then continue; end if;
      update public.companies
      set custom_fields = case when v_clear then custom_fields - p_key else custom_fields || jsonb_build_object(p_key, p_value) end
      where id = v_row.id;
      insert into public.activities (company_id, channel, type, field, old_value, new_value, source, created_by)
      values (v_row.id, 'system', 'change', 'cf:' || p_key, v_row.old, case when v_clear then null else p_value end,
        public.sales_current_source(), v_uid);
      v_count := v_count + 1;
    end loop;
  else
    for v_row in select id, company_id, custom_fields -> p_key as old from public.contacts where id = any (p_ids) loop
      if v_row.old is not distinct from (case when v_clear then null else p_value end) then continue; end if;
      update public.contacts
      set custom_fields = case when v_clear then custom_fields - p_key else custom_fields || jsonb_build_object(p_key, p_value) end
      where id = v_row.id;
      insert into public.activities (company_id, contact_id, channel, type, field, old_value, new_value, source, created_by)
      values (v_row.company_id, v_row.id, 'system', 'change', 'cf:' || p_key, v_row.old, case when v_clear then null else p_value end,
        public.sales_current_source(), v_uid);
      v_count := v_count + 1;
    end loop;
  end if;
  return v_count;
end;
$$;

revoke execute on function public.sales_set_custom_field(text, uuid[], text, jsonb, text, uuid) from public, anon;
grant execute on function public.sales_set_custom_field(text, uuid[], text, jsonb, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Deleting an archived field clears it on every record type, companies
--    and contacts included (same rules as 20261123200000_custom_fields_layouts.sql)
-- ---------------------------------------------------------------------------

create or replace function public.delete_custom_field(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_def public.custom_field_definitions;
  v_table text;
begin
  if (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Only an admin can delete a field' using errcode = '42501';
  end if;
  select * into v_def from public.custom_field_definitions where id = p_id;
  if not found then
    raise exception 'Field not found' using errcode = 'P0002';
  end if;
  if v_def.archived_at is null then
    raise exception 'Archive the field first, then delete it' using errcode = '22023';
  end if;

  v_table := public.custom_field_table(v_def.entity);
  if v_table is not null and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = v_table and column_name = 'custom_fields'
  ) then
    -- Companies and contacts: no change rows for a field that goes away.
    perform set_config('sales.skip_log', 'on', true);
    execute format('update public.%I set custom_fields = custom_fields - $1 where custom_fields ? $1', v_table) using v_def.key;
    perform set_config('sales.skip_log', '', true);
  end if;

  delete from public.custom_field_definitions where id = p_id;
end;
$$;

revoke execute on function public.delete_custom_field(uuid) from public, anon;
grant execute on function public.delete_custom_field(uuid) to authenticated, service_role;
