-- 02 Portaal aanpassingen leadregels, punt 11: change the domain of a company.
--
-- The domain is the key of a company (unique, normalised), so it does not go
-- through sales_update. This function does it in one place for the lead page
-- and the MCP (update_companies):
--   * the new domain is normalised (https://www.Example.nl/jobs -> example.nl);
--   * a domain that another company uses, as its domain or as the alias of a
--     merged company, is refused and names that company (merge them instead);
--   * the old domain stays on the company as an alias, so an import with it
--     finds this company and does not add it a second time;
--   * the change lands in Activities with its source and person.

create or replace function public.sales_set_company_domain(
  p_company uuid,
  p_domain text,
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
  v_new text := public.normalize_domain(p_domain);
  v_row public.companies;
  v_other record;
begin
  if public.caller_id_for(v_uid) is not null then
    raise exception 'Callers cannot change this' using errcode = '42501';
  end if;
  if v_new is null or v_new = '' or v_new !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$' then
    raise exception 'Give a domain like example.nl' using errcode = '22023';
  end if;

  select * into v_row from public.companies where id = p_company for update;
  if v_row.id is null then
    raise exception 'Company not found' using errcode = 'P0002';
  end if;
  if v_row.domain = v_new then
    return jsonb_build_object('id', v_row.id, 'domain', v_row.domain, 'changed', false);
  end if;

  select c.id, c.name into v_other
  from public.companies c
  where c.id <> p_company and (c.domain = v_new or v_new = any (c.alias_domains))
  limit 1;
  if v_other.id is not null then
    raise exception 'Another company already uses % (%). Merge the two instead.', v_new, v_other.name using errcode = '23505';
  end if;

  update public.companies c
  set domain = v_new,
      alias_domains = array(
        select distinct d
        from unnest(
          c.alias_domains
          || case when v_row.domain like 'nodomain:%' then '{}'::text[] else array[v_row.domain] end
        ) d
        where d <> v_new
      )
  where c.id = p_company;

  insert into public.activities (company_id, channel, type, field, old_value, new_value, source, created_by, caller_id)
  values (
    p_company, 'system', 'change', 'domain', to_jsonb(v_row.domain), to_jsonb(v_new),
    public.sales_current_source(), public.sales_current_actor(), public.caller_id_for(public.sales_current_actor())
  );

  return jsonb_build_object('id', p_company, 'domain', v_new, 'previous_domain', v_row.domain, 'changed', true);
end;
$$;

revoke execute on function public.sales_set_company_domain(uuid, text, text, uuid) from public, anon;
grant execute on function public.sales_set_company_domain(uuid, text, text, uuid) to authenticated, service_role;
