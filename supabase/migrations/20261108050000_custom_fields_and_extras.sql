-- Custom fields ("flexibility like Airtable", recruitment brief 2.10) and two
-- small follow ups for Work.
--
-- 1. custom_field_definitions: extra fields the team adds to candidates,
--    vacancies and applications themselves (text, long text, number, date,
--    yes/no, single choice, multiple choice, url). Archived, never deleted.
-- 2. custom_fields jsonb on candidates, vacancies and applications, checked
--    against the definitions by a trigger (type, options, archived fields).
-- 3. set_custom_field(): change one value without overwriting the others.
-- 4. Work profiles: the time zone must be one Postgres knows, so the daily
--    jobs that compute "deadline tomorrow" never fail on a typo.
--
-- Who may do what (also in docs/recruitment-extras.md):
--   * every staff member (admin, member) reads the definitions, adds fields,
--     renames them, edits options, order and "show in list";
--   * only admins archive and restore a field;
--   * key, entity and type are fixed once made (text and long text may swap);
--   * clients and Work guests never read the definitions. Values live on the
--     rows, so row level security on candidates, vacancies and applications
--     decides who can read them, exactly like every other column.

-- ---------------------------------------------------------------------------
-- 1. Definitions
-- ---------------------------------------------------------------------------

create table public.custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  entity text not null check (entity in ('candidate', 'vacancy', 'application')),
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null check (char_length(btrim(label)) between 1 and 80),
  field_type text not null check (field_type in (
    'text', 'long_text', 'number', 'date', 'boolean', 'single_choice', 'multi_choice', 'url'
  )),
  options text[] not null default '{}',
  help_text text check (char_length(help_text) <= 300),
  position integer not null default 0,
  show_in_list boolean not null default false,
  archived_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity, key)
);

create index custom_field_definitions_entity_idx on public.custom_field_definitions (entity, position);

comment on table public.custom_field_definitions is 'Extra fields on candidates, vacancies and applications, made by the team. Values are in custom_fields on those tables.';
comment on column public.custom_field_definitions.key is 'Key in the custom_fields jsonb of the record. Fixed once made.';
comment on column public.custom_field_definitions.options is 'Choices of a single_choice or multi_choice field. Empty for other types.';
comment on column public.custom_field_definitions.show_in_list is 'Candidates: show as a column (with filter and sort) on the candidates list.';
comment on column public.custom_field_definitions.archived_at is 'Archived fields are hidden and cannot get new values; stored values are kept.';

create or replace function public.custom_field_definitions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_option text;
  v_clean text[] := '{}';
begin
  new.label := btrim(new.label);
  new.help_text := nullif(btrim(new.help_text), '');

  if new.field_type in ('single_choice', 'multi_choice') then
    foreach v_option in array coalesce(new.options, '{}') loop
      v_option := btrim(v_option);
      if v_option = '' then continue; end if;
      if char_length(v_option) > 80 then
        raise exception 'An option can be at most 80 characters' using errcode = '22023';
      end if;
      if v_option = any (v_clean) then
        raise exception 'Option "%" appears twice', v_option using errcode = '22023';
      end if;
      v_clean := v_clean || v_option;
    end loop;
    if cardinality(v_clean) = 0 then
      raise exception 'A choice field needs at least one option' using errcode = '22023';
    end if;
    if cardinality(v_clean) > 100 then
      raise exception 'A choice field can have at most 100 options' using errcode = '22023';
    end if;
    new.options := v_clean;
  else
    new.options := '{}';
  end if;

  if tg_op = 'UPDATE' then
    if new.entity <> old.entity or new.key <> old.key then
      raise exception 'The key and record type of a field cannot change' using errcode = '22023';
    end if;
    if new.field_type <> old.field_type
       and not (new.field_type in ('text', 'long_text') and old.field_type in ('text', 'long_text')) then
      raise exception 'The type of a field cannot change. Archive it and add a new one.' using errcode = '22023';
    end if;
    -- Archiving and restoring: admins only (the secret key may always).
    if new.archived_at is distinct from old.archived_at
       and (select auth.uid()) is not null and not public.is_admin() then
      raise exception 'Only an admin can archive or restore a field' using errcode = '42501';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
  elsif new.archived_at is not null and (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Only an admin can archive or restore a field' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger custom_field_definitions_guard
  before insert or update on public.custom_field_definitions
  for each row execute function public.custom_field_definitions_guard();

alter table public.custom_field_definitions enable row level security;

-- Staff read, add and edit. No delete policy: fields are archived instead.
create policy "Staff read custom fields" on public.custom_field_definitions
  for select to authenticated using (public.is_staff());
create policy "Staff add custom fields" on public.custom_field_definitions
  for insert to authenticated with check (public.is_staff());
create policy "Staff edit custom fields" on public.custom_field_definitions
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

revoke all on public.custom_field_definitions from anon;
revoke delete, truncate on public.custom_field_definitions from authenticated;

-- ---------------------------------------------------------------------------
-- 2. Values on the records, validated against the definitions
-- ---------------------------------------------------------------------------

alter table public.candidates
  add column custom_fields jsonb not null default '{}'::jsonb
  check (jsonb_typeof(custom_fields) = 'object');
alter table public.vacancies
  add column custom_fields jsonb not null default '{}'::jsonb
  check (jsonb_typeof(custom_fields) = 'object');
alter table public.applications
  add column custom_fields jsonb not null default '{}'::jsonb
  check (jsonb_typeof(custom_fields) = 'object');

comment on column public.candidates.custom_fields is 'Values of custom fields (custom_field_definitions, entity candidate), by key.';
comment on column public.vacancies.custom_fields is 'Values of custom fields (custom_field_definitions, entity vacancy), by key.';
comment on column public.applications.custom_fields is 'Values of custom fields (custom_field_definitions, entity application), by key. General fields across vacancies; per vacancy form answers live with the forms.';

/**
 * Checks new custom field values against the definitions and returns them
 * cleaned up: empty values (null, "", []) are dropped. Values that did not
 * change are kept as they are, so a field archived or an option removed later
 * never blocks an unrelated edit of the record.
 *
 * Per type: text (string, max 500), long_text (string, max 10000), number
 * (json number), date (YYYY-MM-DD, a real date), boolean (true/false),
 * single_choice (one of the options), multi_choice (array of distinct
 * options), url (http or https, max 2000).
 */
create or replace function public.validate_custom_fields(p_entity text, p_new jsonb, p_old jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_out jsonb := '{}'::jsonb;
  v_key text;
  v_val jsonb;
  v_text text;
  v_def public.custom_field_definitions;
  v_item jsonb;
  v_items text[];
begin
  if p_new is null then
    return '{}'::jsonb;
  end if;
  if jsonb_typeof(p_new) <> 'object' then
    raise exception 'Custom fields must be an object' using errcode = '22023';
  end if;
  p_old := coalesce(p_old, '{}'::jsonb);

  for v_key, v_val in select e.key, e.value from jsonb_each(p_new) e loop
    if p_old ? v_key and p_old -> v_key = v_val then
      v_out := v_out || jsonb_build_object(v_key, v_val);
      continue;
    end if;
    if v_val = 'null'::jsonb or v_val = '""'::jsonb or v_val = '[]'::jsonb then
      continue;
    end if;

    select * into v_def
    from public.custom_field_definitions d
    where d.entity = p_entity and d.key = v_key;
    if not found then
      raise exception 'Unknown custom field "%"', v_key using errcode = '22023';
    end if;
    if v_def.archived_at is not null then
      raise exception 'The field "%" is archived', v_def.label using errcode = '22023';
    end if;

    v_text := case when jsonb_typeof(v_val) = 'string' then v_val #>> '{}' end;

    case v_def.field_type
      when 'text' then
        if v_text is null or char_length(v_text) > 500 then
          raise exception '"%" takes text of at most 500 characters', v_def.label using errcode = '22023';
        end if;
      when 'long_text' then
        if v_text is null or char_length(v_text) > 10000 then
          raise exception '"%" takes text of at most 10000 characters', v_def.label using errcode = '22023';
        end if;
      when 'number' then
        if jsonb_typeof(v_val) <> 'number' then
          raise exception '"%" takes a number', v_def.label using errcode = '22023';
        end if;
      when 'date' then
        if v_text is null or v_text !~ '^\d{4}-\d{2}-\d{2}$' then
          raise exception '"%" takes a date (YYYY-MM-DD)', v_def.label using errcode = '22023';
        end if;
        begin
          if to_char(v_text::date, 'YYYY-MM-DD') <> v_text then
            raise exception 'bad date';
          end if;
        exception when others then
          raise exception '"%" takes a date (YYYY-MM-DD)', v_def.label using errcode = '22023';
        end;
      when 'boolean' then
        if jsonb_typeof(v_val) <> 'boolean' then
          raise exception '"%" takes yes or no', v_def.label using errcode = '22023';
        end if;
      when 'single_choice' then
        if v_text is null or not (v_text = any (v_def.options)) then
          raise exception '"%" takes one of its options', v_def.label using errcode = '22023';
        end if;
      when 'multi_choice' then
        if jsonb_typeof(v_val) <> 'array' then
          raise exception '"%" takes a list of its options', v_def.label using errcode = '22023';
        end if;
        v_items := '{}';
        for v_item in select a.value from jsonb_array_elements(v_val) a loop
          if jsonb_typeof(v_item) <> 'string'
             or not ((v_item #>> '{}') = any (v_def.options))
             or (v_item #>> '{}') = any (v_items) then
            raise exception '"%" takes a list of its options, each once', v_def.label using errcode = '22023';
          end if;
          v_items := v_items || (v_item #>> '{}');
        end loop;
      when 'url' then
        if v_text is null or char_length(v_text) > 2000 or v_text !~* '^https?://[^\s/$.?#][^\s]*$' then
          raise exception '"%" takes a link starting with http:// or https://', v_def.label using errcode = '22023';
        end if;
    end case;

    v_out := v_out || jsonb_build_object(v_key, v_val);
  end loop;

  return v_out;
end;
$$;

revoke execute on function public.validate_custom_fields(text, jsonb, jsonb) from public, anon;
grant execute on function public.validate_custom_fields(text, jsonb, jsonb) to authenticated, service_role;

-- Security definer so the check also sees the definitions when the row is
-- written by a function or job that runs as someone else.
create or replace function public.check_custom_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.custom_fields is not distinct from old.custom_fields then
    return new;
  end if;
  new.custom_fields := public.validate_custom_fields(
    tg_argv[0],
    new.custom_fields,
    case when tg_op = 'UPDATE' then old.custom_fields else '{}'::jsonb end
  );
  return new;
end;
$$;

revoke execute on function public.check_custom_fields() from public, anon, authenticated;

create trigger candidates_check_custom_fields
  before insert or update of custom_fields on public.candidates
  for each row execute function public.check_custom_fields('candidate');
create trigger vacancies_check_custom_fields
  before insert or update of custom_fields on public.vacancies
  for each row execute function public.check_custom_fields('vacancy');
create trigger applications_check_custom_fields
  before insert or update of custom_fields on public.applications
  for each row execute function public.check_custom_fields('application');

-- ---------------------------------------------------------------------------
-- 3. Change one value
-- ---------------------------------------------------------------------------

-- Runs as the caller: row level security decides which records can change,
-- the trigger above checks the value. Empty values (null, "", []) clear it.
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
-- 4. Work: time zones Postgres knows
-- ---------------------------------------------------------------------------

-- The app offers the full IANA list (Intl.supportedValuesOf) and checks the
-- choice against it; this is the second line, for the API and old clients.
create or replace function public.check_profile_time_zone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.time_zone is distinct from old.time_zone
     and not exists (select 1 from pg_catalog.pg_timezone_names where name = new.time_zone) then
    raise exception 'Unknown time zone "%"', new.time_zone using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger profiles_check_time_zone
  before update of time_zone on public.profiles
  for each row execute function public.check_profile_time_zone();
