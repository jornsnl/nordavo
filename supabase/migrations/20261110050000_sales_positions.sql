-- Manual order of rows in the sales tables (feedback Julius, section 2.4
-- point 2): dragging a row stores its position. When a view is put in manual
-- order for the first time every row gets a position in one call.

create or replace function public.sales_set_positions(
  p_entity text,
  p_ids uuid[],
  p_positions double precision[],
  p_actor uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.sales_actor(p_actor, 'handmatig');
  v_count integer;
begin
  if public.caller_id_for(v_uid) is not null then
    raise exception 'Callers cannot change the order of lists' using errcode = '42501';
  end if;
  if coalesce(array_length(p_ids, 1), 0) <> coalesce(array_length(p_positions, 1), 0) then
    raise exception 'Every row needs a position';
  end if;
  if p_entity = 'company' then
    update public.companies c set manual_position = x.pos
    from unnest(p_ids, p_positions) as x(id, pos)
    where c.id = x.id;
  elsif p_entity = 'contact' then
    update public.contacts c set manual_position = x.pos
    from unnest(p_ids, p_positions) as x(id, pos)
    where c.id = x.id;
  else
    raise exception 'Unknown record type';
  end if;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.sales_set_positions(text, uuid[], double precision[], uuid) from public, anon;
grant execute on function public.sales_set_positions(text, uuid[], double precision[], uuid) to authenticated, service_role;

-- The ICP verdict moves the lead status along (section 2.6): GO is Ready,
-- No go is No go, Review waits for the verdict. Only for companies that are
-- not being approached yet, so a verdict never undoes outreach.
create or replace function public.companies_icp_lead_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.icp_decision is distinct from old.icp_decision
     and new.lead_status = old.lead_status
     and new.lead_status in ('new', 'review', 'ready', 'no_go') then
    new.lead_status := case new.icp_decision
      when 'GO' then 'ready'
      when 'NO_GO' then 'no_go'
      when 'REVIEW' then 'review'
      else new.lead_status
    end;
  end if;
  return new;
end;
$$;

-- Runs before companies_track_stage (alphabetical), so the timestamp follows.
create trigger companies_icp_lead_status before update of icp_decision on public.companies
  for each row execute function public.companies_icp_lead_status();
