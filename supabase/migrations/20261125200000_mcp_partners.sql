-- Partners in the MCP (feedback Julius, 68123bae "Feedback portal", steps 2 to 4).
--
-- Claude creates and changes partners through one function, like the other
-- sales_* functions: it acts as p_actor (needs the sales module), checks the
-- fields and writes every change to Activities with the given source (claude).
-- Email, phone, LinkedIn and notes are logged as "changed" without their
-- value, so personal data does not end up in the log.
--
-- Idempotent: safe to run again. Nothing here changes what partner_id on a
-- lead means.

create or replace function public.sales_partner_save(
  p_id uuid,
  p_fields jsonb,
  p_source text default 'claude',
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.sales_actor(p_actor, p_source);
  v_allowed text[] := array['name', 'company_name', 'email', 'phone', 'linkedin_url', 'notes', 'status', 'owner_id'];
  v_quiet text[] := array['email', 'phone', 'linkedin_url', 'notes'];
  v_key text;
  v_cols text[];
  v_id uuid := p_id;
  v_old jsonb;
  v_new jsonb;
begin
  if public.caller_id_for(v_uid) is not null then
    raise exception 'Callers cannot change partners' using errcode = '42501';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'Give the fields as an object';
  end if;
  for v_key in select jsonb_object_keys(p_fields) loop
    if not v_key = any (v_allowed) then
      raise exception 'Field % cannot be changed here', v_key;
    end if;
  end loop;

  if p_id is null then
    if nullif(trim(p_fields ->> 'name'), '') is null then
      raise exception 'A partner needs a name';
    end if;
    insert into public.partners (name, company_name, email, phone, linkedin_url, notes, status, owner_id, created_by)
    values (
      trim(p_fields ->> 'name'),
      nullif(trim(p_fields ->> 'company_name'), ''),
      nullif(trim(p_fields ->> 'email'), ''),
      nullif(trim(p_fields ->> 'phone'), ''),
      nullif(trim(p_fields ->> 'linkedin_url'), ''),
      nullif(trim(p_fields ->> 'notes'), ''),
      coalesce(nullif(p_fields ->> 'status', ''), 'active'),
      coalesce(nullif(p_fields ->> 'owner_id', '')::uuid, v_uid),
      v_uid
    )
    returning id into v_id;
    insert into public.activities (partner_id, channel, type, field, old_value, new_value, source, created_by)
    values (v_id, 'system', 'change', 'created', null, to_jsonb(trim(p_fields ->> 'name')), coalesce(p_source, 'claude'), v_uid);
    return v_id;
  end if;

  select to_jsonb(p) into v_old from public.partners p where p.id = p_id;
  if v_old is null then
    raise exception 'Partner not found' using errcode = 'P0002';
  end if;
  if p_fields = '{}'::jsonb then
    return p_id;
  end if;
  if p_fields ? 'name' and nullif(trim(p_fields ->> 'name'), '') is null then
    raise exception 'A partner needs a name';
  end if;

  select array_agg(k order by k) into v_cols from jsonb_object_keys(p_fields) k;
  execute format(
    'update public.partners t set (%s) = (select %s from jsonb_populate_record(null::public.partners, $1) r) where t.id = $2',
    (select string_agg(format('%I', c), ', ') from unnest(v_cols) c),
    (select string_agg(format('r.%I', c), ', ') from unnest(v_cols) c)
  ) using p_fields, p_id;

  select to_jsonb(p) into v_new from public.partners p where p.id = p_id;
  foreach v_key in array v_cols loop
    if (v_new -> v_key) is distinct from (v_old -> v_key) then
      insert into public.activities (partner_id, channel, type, field, old_value, new_value, source, created_by)
      values (
        p_id, 'system', 'change', v_key,
        case when v_key = any (v_quiet) then null else v_old -> v_key end,
        case when v_key = any (v_quiet) then to_jsonb('changed'::text) else v_new -> v_key end,
        coalesce(p_source, 'claude'), v_uid
      );
    end if;
  end loop;
  return p_id;
end;
$$;

revoke execute on function public.sales_partner_save(uuid, jsonb, text, uuid) from public, anon;
grant execute on function public.sales_partner_save(uuid, jsonb, text, uuid) to authenticated, service_role;
