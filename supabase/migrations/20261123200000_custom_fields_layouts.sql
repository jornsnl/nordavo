-- Custom fields everywhere and page layouts you set up yourself (feedback
-- Julius, round 3: "Blokken en velden zelf toevoegen, verwijderen,
-- verplaatsen en hernoemen"). Builds on 20261108050000_custom_fields_and_extras.sql.
--
-- 1. Custom fields on clients and placements too (entity client, placement),
--    with the same check trigger and set_custom_field().
-- 2. custom_field_definitions.block_key: the block of the record page a
--    field is shown in ("custom" is the default block "Custom fields").
-- 3. record_layouts: per record type the blocks of its page (label, order,
--    hidden, tab, column) and overrides of the fixed fields (label, hidden,
--    order). Read by every staff member, changed by every staff member, like
--    the field definitions. The app checks the shape (src/lib/custom-fields/layout.ts);
--    the database only checks it is an object of limited size.
-- 4. delete_custom_field(): admins remove an archived field for good, with
--    its values on every record.
--
-- Client portal users read clients and placements only through the portal_*
-- functions, which do not return custom_fields, so these values stay internal.

-- ---------------------------------------------------------------------------
-- 1. Clients and placements
-- ---------------------------------------------------------------------------

alter table public.custom_field_definitions drop constraint if exists custom_field_definitions_entity_check;
alter table public.custom_field_definitions
  add constraint custom_field_definitions_entity_check
  check (entity in ('candidate', 'vacancy', 'application', 'client', 'placement'));

alter table public.clients
  add column if not exists custom_fields jsonb not null default '{}'::jsonb
  check (jsonb_typeof(custom_fields) = 'object');
alter table public.placements
  add column if not exists custom_fields jsonb not null default '{}'::jsonb
  check (jsonb_typeof(custom_fields) = 'object');

comment on column public.clients.custom_fields is 'Values of custom fields (custom_field_definitions, entity client), by key.';
comment on column public.placements.custom_fields is 'Values of custom fields (custom_field_definitions, entity placement), by key.';

drop trigger if exists clients_check_custom_fields on public.clients;
create trigger clients_check_custom_fields
  before insert or update of custom_fields on public.clients
  for each row execute function public.check_custom_fields('client');
drop trigger if exists placements_check_custom_fields on public.placements;
create trigger placements_check_custom_fields
  before insert or update of custom_fields on public.placements
  for each row execute function public.check_custom_fields('placement');

create or replace function public.set_custom_field(p_entity text, p_id uuid, p_key text, p_value jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_clear boolean := p_value is null or p_value in ('null'::jsonb, '""'::jsonb, '[]'::jsonb);
  v_result jsonb;
begin
  if not public.is_staff() and (select auth.uid()) is not null then
    raise exception 'Only the Nordavo team can change custom fields' using errcode = '42501';
  end if;
  if p_key is null or p_key !~ '^[a-z][a-z0-9_]{0,39}$' then
    raise exception 'Unknown custom field "%"', p_key using errcode = '22023';
  end if;

  if p_entity = 'candidate' then
    update public.candidates
    set custom_fields = case when v_clear then custom_fields - p_key else custom_fields || jsonb_build_object(p_key, p_value) end
    where id = p_id
    returning custom_fields into v_result;
  elsif p_entity = 'vacancy' then
    update public.vacancies
    set custom_fields = case when v_clear then custom_fields - p_key else custom_fields || jsonb_build_object(p_key, p_value) end
    where id = p_id
    returning custom_fields into v_result;
  elsif p_entity = 'application' then
    update public.applications
    set custom_fields = case when v_clear then custom_fields - p_key else custom_fields || jsonb_build_object(p_key, p_value) end
    where id = p_id
    returning custom_fields into v_result;
  elsif p_entity = 'client' then
    update public.clients
    set custom_fields = case when v_clear then custom_fields - p_key else custom_fields || jsonb_build_object(p_key, p_value) end
    where id = p_id
    returning custom_fields into v_result;
  elsif p_entity = 'placement' then
    update public.placements
    set custom_fields = case when v_clear then custom_fields - p_key else custom_fields || jsonb_build_object(p_key, p_value) end
    where id = p_id
    returning custom_fields into v_result;
  else
    raise exception 'Unknown record type "%"', p_entity using errcode = '22023';
  end if;

  if v_result is null then
    raise exception 'Record not found' using errcode = 'P0002';
  end if;
  return v_result;
end;
$$;

revoke execute on function public.set_custom_field(text, uuid, text, jsonb) from public, anon;
grant execute on function public.set_custom_field(text, uuid, text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The block a field is shown in
-- ---------------------------------------------------------------------------

alter table public.custom_field_definitions
  add column if not exists block_key text not null default 'custom'
  check (block_key ~ '^[a-z][a-z0-9_]{0,39}$');

comment on column public.custom_field_definitions.block_key is 'Block of the record page the field is shown in (record_layouts). "custom" is the default block "Custom fields"; a block that no longer exists falls back to it.';

-- ---------------------------------------------------------------------------
-- 3. Page layouts
-- ---------------------------------------------------------------------------

create table if not exists public.record_layouts (
  entity text primary key check (entity in ('candidate', 'vacancy', 'client', 'placement')),
  config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(config) = 'object' and pg_column_size(config) < 65536),
  updated_by uuid references public.profiles (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

comment on table public.record_layouts is 'Layout of a record page: blocks (label, order, hidden, tab, column) and fixed field overrides (label, hidden, order). Shape checked by the app, src/lib/custom-fields/layout.ts.';

create or replace function public.record_layouts_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if (select auth.uid()) is not null then
    new.updated_by := (select auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists record_layouts_touch on public.record_layouts;
create trigger record_layouts_touch
  before insert or update on public.record_layouts
  for each row execute function public.record_layouts_touch();

alter table public.record_layouts enable row level security;

drop policy if exists "Staff read layouts" on public.record_layouts;
create policy "Staff read layouts" on public.record_layouts
  for select to authenticated using (public.is_staff());
drop policy if exists "Staff add layouts" on public.record_layouts;
create policy "Staff add layouts" on public.record_layouts
  for insert to authenticated with check (public.is_staff());
drop policy if exists "Staff change layouts" on public.record_layouts;
create policy "Staff change layouts" on public.record_layouts
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "Admins reset layouts" on public.record_layouts;
create policy "Admins reset layouts" on public.record_layouts
  for delete to authenticated using (public.is_admin());

revoke all on public.record_layouts from anon;
grant select, insert, update, delete on public.record_layouts to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Delete an archived field for good
-- ---------------------------------------------------------------------------

-- Admins only, and only an archived field, so nothing disappears by one
-- click. Removes the key from every record of that type, then the definition.
create or replace function public.delete_custom_field(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_def public.custom_field_definitions;
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

  if v_def.entity = 'candidate' then
    update public.candidates set custom_fields = custom_fields - v_def.key where custom_fields ? v_def.key;
  elsif v_def.entity = 'vacancy' then
    update public.vacancies set custom_fields = custom_fields - v_def.key where custom_fields ? v_def.key;
  elsif v_def.entity = 'application' then
    update public.applications set custom_fields = custom_fields - v_def.key where custom_fields ? v_def.key;
  elsif v_def.entity = 'client' then
    update public.clients set custom_fields = custom_fields - v_def.key where custom_fields ? v_def.key;
  elsif v_def.entity = 'placement' then
    update public.placements set custom_fields = custom_fields - v_def.key where custom_fields ? v_def.key;
  end if;

  delete from public.custom_field_definitions where id = p_id;
end;
$$;

revoke execute on function public.delete_custom_field(uuid) from public, anon;
grant execute on function public.delete_custom_field(uuid) to authenticated, service_role;
