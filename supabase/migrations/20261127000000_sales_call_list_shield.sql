-- Call lists shielded from mail and LinkedIn, and occupancy per company
-- (opdracht Julius, 27 november 2026, deel A).
--
--   1. sales_check_outreach() refuses a company in bucket call with the reason
--      "bellijst <caller or call list>", for its domain and for the mail
--      addresses of its contacts.
--   2. sales_company_occupation (view): per company occupied_by (call,
--      mail_campaign, linkedin_campaign, sequence or null), occupied_label (the
--      caller, call list, campaign or sequence), occupied_since and free.
--   3. sales_is_free(companies): the same free as a computed field, so the MCP
--      can filter list_companies on it in the database.
--
-- Free means what it meant in the portal already (src/lib/sales/triage.ts,
-- isFree): bucket incoming or free and in no running campaign, call list or
-- sequence. A company in the pipeline, parked or no go is not free but not
-- occupied either. sales_triage() already skips a company on a call list
-- unless forced (20261123400000_sales_triage_occupancy.sql); nothing changes
-- there. No data changes.

-- ---------------------------------------------------------------------------
-- 1. The exclusion check
-- ---------------------------------------------------------------------------

create or replace function public.sales_check_outreach(p_items text[], p_actor uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item text;
  v_clean text;
  v_email text;
  v_domain text;
  v_contact public.contacts;
  v_company public.companies;
  v_reasons text[];
  v_out jsonb := '[]';
  v_today date := (now() at time zone 'Europe/Amsterdam')::date;
  v_campaign text;
  v_call_list text;
  v_free boolean;
begin
  if (select auth.role()) <> 'service_role' and not public.has_module('sales') then
    raise exception 'No access to sales' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_items), 0) > 2000 then
    raise exception 'At most 2000 at once';
  end if;

  foreach v_item in array coalesce(p_items, '{}') loop
    v_clean := lower(btrim(coalesce(v_item, '')));
    continue when v_clean = '';
    v_contact := null;
    v_company := null;
    v_email := null;
    v_reasons := '{}';

    if v_clean like '%@%' then
      v_email := regexp_replace(v_clean, '^mailto:', '');
      v_domain := public.normalize_domain(split_part(v_email, '@', 2));
      select * into v_contact from public.contacts where lower(email) = v_email order by created_at limit 1;
      if v_contact.id is not null then
        select * into v_company from public.companies where id = v_contact.company_id;
      end if;
    else
      v_domain := public.normalize_domain(v_clean);
    end if;
    v_free := v_domain ~ '^(gmail|googlemail|hotmail|outlook|live|icloud|me|yahoo|ziggo|kpnmail|kpnplanet|planet|xs4all|home|chello|hetnet|casema|quicknet|upcmail|protonmail|proton)\.';
    if v_company.id is null and v_domain is not null and not v_free then
      select * into v_company from public.companies
      where domain = v_domain or v_domain = any (alias_domains)
      order by (domain = v_domain) desc, created_at
      limit 1;
    end if;

    if v_company.id is null then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'input', v_item, 'allowed', true, 'company_id', null, 'company', null,
        'reasons', jsonb_build_array('not in the portal')));
      continue;
    end if;

    if v_company.own_contact or v_company.client_id is not null or v_company.status = 'klant' then
      v_reasons := v_reasons || coalesce('own contact (' || nullif(v_company.own_contact_reason, '') || ')', 'own contact');
    end if;
    if v_company.pipeline_stage is not null and v_company.pipeline_stage <> 'lost' then
      v_reasons := v_reasons || ('pipeline (' || v_company.pipeline_stage || ')');
    end if;
    if v_company.lead_status = 'do_not_contact'
       or exists (select 1 from public.suppression s where s.company_id = v_company.id and s.scope in ('alle_kanalen', 'alleen_mail'))
       or (v_contact.id is not null and (v_contact.status = 'do_not_contact' or v_contact.no_mail
           or exists (select 1 from public.suppression s where (s.contact_id = v_contact.id or lower(s.email) = v_email) and s.scope in ('alle_kanalen', 'alleen_mail'))))
       or (v_email is not null and exists (select 1 from public.suppression s where lower(s.email) = v_email and s.scope in ('alle_kanalen', 'alleen_mail'))) then
      v_reasons := v_reasons || 'do not contact'::text;
    end if;
    if v_company.lead_status = 'no_go' or v_company.icp_decision = 'NO_GO' then
      v_reasons := v_reasons || coalesce('no go: ' || nullif(btrim(v_company.icp_reason), ''), 'no go');
    end if;
    if v_company.lead_status = 'in_sequence'
       or exists (select 1 from public.sequence_enrollments e where e.company_id = v_company.id and e.status in ('active', 'paused')) then
      v_reasons := v_reasons || 'in sequence'::text;
    end if;
    select c.name into v_campaign
    from public.campaign_members m join public.campaigns c on c.id = m.campaign_id
    where m.company_id = v_company.id and m.status in ('queued', 'active') and c.status in ('active', 'paused', 'draft')
    order by m.added_at desc limit 1;
    if v_campaign is not null then
      v_reasons := v_reasons || ('campagne ' || v_campaign);
    end if;
    -- On a call list (bucket call): the caller or the call list has it, so no
    -- mail or LinkedIn at the same time (20261127000000_sales_call_list_shield.sql).
    if v_company.bucket = 'call' then
      select coalesce(nullif(btrim(cl.name), ''), nullif(btrim(v.name), ''), 'zonder naam') into v_call_list
      from (select 1) x
      left join public.callers cl on cl.id = v_company.bucket_caller_id
      left join public.sales_views v on v.id = v_company.bucket_view_id;
      v_reasons := v_reasons || ('bellijst ' || v_call_list);
    end if;
    if v_company.lead_status = 'nee_geen_interesse' and v_company.recontact_from > v_today then
      v_reasons := v_reasons || ('nee_geen_interesse tot ' || to_char(v_company.recontact_from, 'YYYY-MM-DD'));
    end if;
    if v_company.lead_status = 'nu_niet' and v_company.recontact_from > v_today then
      v_reasons := v_reasons || ('nu_niet tot ' || to_char(v_company.recontact_from, 'YYYY-MM-DD'));
    end if;
    if v_company.lead_status = 'cooled_down' and v_company.recontact_from > v_today then
      v_reasons := v_reasons || 'minder dan 1 week sinds de vorige route zonder nieuw signaal'::text;
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'input', v_item,
      'allowed', cardinality(v_reasons) = 0,
      'company_id', v_company.id,
      'company', v_company.name,
      'contact_id', v_contact.id,
      'lead_status', v_company.lead_status,
      'reasons', to_jsonb(v_reasons)
    ));
  end loop;
  return v_out;
end;
$$;

revoke execute on function public.sales_check_outreach(text[], uuid) from public, anon;
grant execute on function public.sales_check_outreach(text[], uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Occupancy per company
-- ---------------------------------------------------------------------------

-- The first that applies: call list, running campaign, running sequence.
create or replace view public.sales_company_occupation
with (security_invoker = true) as
select
  c.id as company_id,
  c.bucket,
  o.occupied_by,
  o.occupied_label,
  o.occupied_since,
  (c.bucket in ('incoming', 'free') and o.occupied_by is null) as free
from public.companies c
left join lateral (
  select t.occupied_by, t.occupied_label, t.occupied_since
  from (
    select 'call'::text as occupied_by,
      coalesce(nullif(btrim(cl.name), ''), nullif(btrim(v.name), ''), 'Call list') as occupied_label,
      c.bucket_changed_at as occupied_since,
      1 as ord
    from (select 1) x
    left join public.callers cl on cl.id = c.bucket_caller_id
    left join public.sales_views v on v.id = c.bucket_view_id
    where c.bucket = 'call'
    union all
    select case ca.channel when 'linkedin' then 'linkedin_campaign' else 'mail_campaign' end,
      ca.name, m.added_at, 2
    from public.campaign_members m
    join public.campaigns ca on ca.id = m.campaign_id
    where m.company_id = c.id and m.status in ('queued', 'active') and ca.status in ('active', 'paused', 'draft')
    union all
    select 'sequence', s.name, e.started_at, 3
    from public.sequence_enrollments e
    join public.sequences s on s.id = e.sequence_id
    where e.company_id = c.id and e.status in ('active', 'paused')
  ) t
  order by t.ord, t.occupied_since desc nulls last
  limit 1
) o on true;

comment on view public.sales_company_occupation is
  'Per company: occupied_by (call, mail_campaign, linkedin_campaign, sequence or null), occupied_label, occupied_since and free (bucket incoming or free and nowhere in).';

revoke all on public.sales_company_occupation from anon;
grant select on public.sales_company_occupation to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Free as a computed field of companies (PostgREST: ?sales_is_free=is.true)
-- ---------------------------------------------------------------------------

create or replace function public.sales_is_free(p_company public.companies)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_company.bucket in ('incoming', 'free')
    and not exists (
      select 1 from public.campaign_members m
      join public.campaigns ca on ca.id = m.campaign_id
      where m.company_id = p_company.id and m.status in ('queued', 'active') and ca.status in ('active', 'paused', 'draft')
    )
    and not exists (
      select 1 from public.sequence_enrollments e
      where e.company_id = p_company.id and e.status in ('active', 'paused')
    );
$$;

revoke execute on function public.sales_is_free(public.companies) from public, anon;
grant execute on function public.sales_is_free(public.companies) to authenticated, service_role;
