-- Leads and Contacts: possible duplicates and merging two records
-- (feedback Julius, November 2026).
--
--   1  A name key and a domain stem per company, to warn about a company that
--      is probably already there ("Brightcape" on brightcape.nl and on
--      brightcape.com), and the other domains of a merged company
--   2  sales_similar_companies(): the possible duplicates of a name or domain
--   3  sales_merge_companies() and sales_merge_contacts(): one record keeps
--      everything of both. Every reference moves to the record that stays,
--      empty fields are filled from the other, the other is deleted and its
--      full row is kept in Activities.
--
-- See docs/sales.md, "Dubbelen samenvoegen".

-- ---------------------------------------------------------------------------
-- 1. Keys
-- ---------------------------------------------------------------------------

-- "Brightcape B.V." -> "brightcape"; "The Data Company Nederland" -> "datacompany".
-- Mirrors companyNameKey in src/lib/sales/duplicates.ts.
create or replace function public.company_name_key(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        lower(coalesce(p_name, '')),
        '(^|[^a-z0-9])(b\.?\s?v\.?|n\.?\s?v\.?|v\.?o\.?f\.?|holding|group|groep|nederland|netherlands|benelux|europe|international|nl|the|de|het|gmbh|ltd|limited|inc|llc|bvba|sa|ag)(?=$|[^a-z0-9])',
        ' ', 'g'),
      '[^a-z0-9]+', '', 'g'),
    '');
$$;

-- "app.brightcape.co.uk" -> "brightcape"; "brightcape.nl" -> "brightcape".
-- Mirrors domainStem in src/lib/sales/duplicates.ts.
create or replace function public.domain_stem(p_domain text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_domain is null or p_domain like 'nodomain:%' then null
    else nullif(substring(lower(p_domain) from '([a-z0-9-]+)\.(?:co\.uk|org\.uk|com\.au|co\.nz|com\.br|co\.za|[a-z0-9-]+)$'), '')
  end;
$$;

alter table public.companies
  add column if not exists name_key text generated always as (public.company_name_key(name)) stored,
  add column if not exists domain_stem text generated always as (public.domain_stem(domain)) stored,
  -- The domains of companies merged into this one: an import with one of
  -- them finds this company instead of adding it again.
  add column if not exists alias_domains text[] not null default '{}';

create index if not exists companies_name_key_idx on public.companies (name_key) where name_key is not null;
create index if not exists companies_domain_stem_idx on public.companies (domain_stem) where domain_stem is not null;
create index if not exists companies_alias_domains_idx on public.companies using gin (alias_domains);

-- ---------------------------------------------------------------------------
-- 2. Possible duplicates
-- ---------------------------------------------------------------------------

-- Companies that are probably the same as this name and domain: the same
-- name key, the same domain stem on another domain, or one name key that
-- starts with the other (at least 6 letters). The exact domain itself is
-- not a "possible" duplicate; the add flows refuse that one.
create or replace function public.sales_similar_companies(
  p_name text,
  p_domain text default null,
  p_exclude uuid default null
)
returns table (id uuid, name text, domain text, lead_status text, reason text)
language sql
stable
security invoker
set search_path = ''
as $$
  with k as (
    select public.company_name_key(p_name) as name_key,
           public.domain_stem(public.normalize_domain(p_domain)) as stem,
           public.normalize_domain(p_domain) as domain
  )
  select c.id, c.name, c.domain, c.lead_status,
         case
           when c.name_key = k.name_key then 'same name'
           when c.domain_stem = k.stem then 'same domain name, other extension'
           when k.domain = any (c.alias_domains) then 'merged domain'
           else 'similar name'
         end
  from public.companies c, k
  where c.id is distinct from p_exclude
    and (k.domain is null or c.domain <> k.domain)
    and (
      (k.name_key is not null and char_length(k.name_key) >= 3 and c.name_key = k.name_key)
      or (k.stem is not null and char_length(k.stem) >= 3 and c.domain_stem = k.stem)
      or (k.domain is not null and k.domain = any (c.alias_domains))
      or (char_length(k.name_key) >= 6 and char_length(c.name_key) >= 6
          and (c.name_key like k.name_key || '%' or k.name_key like c.name_key || '%'))
    )
  order by (c.name_key = k.name_key) desc, (c.domain_stem = k.stem) desc, c.name
  limit 10;
$$;

revoke execute on function public.sales_similar_companies(text, text, uuid) from public, anon;
grant execute on function public.sales_similar_companies(text, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Merging
-- ---------------------------------------------------------------------------

-- Point every foreign key to p_from at p_to. A row that would then break a
-- unique rule (the same link twice, for example the same sequence twice for
-- one company) is a duplicate of a row the kept record already has and is
-- removed. Returns the number of rows moved and removed.
create or replace function public.sales_repoint_references(
  p_table regclass,
  p_from uuid,
  p_to uuid,
  p_skip regclass[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_ctid tid;
  v_moved integer := 0;
  v_dropped integer := 0;
  v_count integer;
begin
  for r in
    select con.conrelid::regclass as tbl, att.attname as col
    from pg_constraint con
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
    where con.contype = 'f'
      and con.confrelid = p_table
      and array_length(con.conkey, 1) = 1
      and not (con.conrelid::regclass = any (p_skip))
  loop
    begin
      execute format('update %s set %I = $1 where %I = $2', r.tbl, r.col, r.col) using p_to, p_from;
      get diagnostics v_count = row_count;
      v_moved := v_moved + v_count;
    exception when unique_violation then
      for v_ctid in execute format('select ctid from %s where %I = $1', r.tbl, r.col) using p_from loop
        begin
          execute format('update %s set %I = $1 where ctid = $2', r.tbl, r.col) using p_to, v_ctid;
          v_moved := v_moved + 1;
        exception when unique_violation then
          execute format('delete from %s where ctid = $1', r.tbl) using v_ctid;
          v_dropped := v_dropped + 1;
        end;
      end loop;
    end;
  end loop;
  return jsonb_build_object('moved', v_moved, 'removed_as_duplicate', v_dropped);
end;
$$;

revoke execute on function public.sales_repoint_references(regclass, uuid, uuid, regclass[]) from public, anon, authenticated;

-- The fields of p_from that are empty on p_to, as a patch for p_to.
create or replace function public.sales_fill_patch(p_to jsonb, p_from jsonb, p_fields text[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(f, p_from -> f), '{}'::jsonb)
  from unnest(p_fields) f
  where (p_to -> f is null or p_to -> f in ('null'::jsonb, '""'::jsonb, '[]'::jsonb))
    and p_from -> f is not null
    and p_from -> f not in ('null'::jsonb, '""'::jsonb, '[]'::jsonb);
$$;

-- Merge company p_merge into p_keep. Contacts, activities, signals,
-- meetings, sequences, call steps, vacancies, notes, tasks, attachments and
-- everything else that points at p_merge moves to p_keep; empty fields of
-- p_keep are filled from p_merge; p_merge's domain is kept as an alias;
-- p_merge is deleted and its full row is in Activities on p_keep.
create or replace function public.sales_merge_companies(
  p_keep uuid,
  p_merge uuid,
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
  v_keep public.companies;
  v_merge public.companies;
  v_patch jsonb;
  v_cols text[];
  v_refs jsonb;
  v_moved_contacts integer;
  v_tbl record;
  v_count integer;
  v_linked integer := 0;
begin
  if public.caller_id_for(v_uid) is not null then
    raise exception 'Callers cannot merge companies' using errcode = '42501';
  end if;
  if p_keep is null or p_merge is null or p_keep = p_merge then
    raise exception 'Choose two different companies';
  end if;
  select * into v_keep from public.companies where id = p_keep for update;
  select * into v_merge from public.companies where id = p_merge for update;
  if v_keep.id is null or v_merge.id is null then
    raise exception 'Company not found';
  end if;

  -- Empty fields of the company that stays.
  v_patch := public.sales_fill_patch(to_jsonb(v_keep), to_jsonb(v_merge), array[
    'website', 'legal_form', 'employees', 'sector', 'segment', 'kvk_number', 'linkedin_url', 'city',
    'icp_decision', 'icp_score', 'icp_reason', 'opening_line', 'qualified_at', 'reviewed_by', 'client_id',
    'prio', 'category', 'description', 'general_phone', 'source_note', 'owner_id', 'partner_id',
    'next_action', 'next_action_date', 'pipeline_stage', 'pipeline_stage_changed_at', 'pipeline_entered_at',
    'lost_reason', 'parked_until', 'profiles_due_on', 'source'
  ]);
  -- A stage needs its reason or date, which come along in the same patch.
  if v_patch ? 'pipeline_stage' and v_keep.pipeline_stage is null then
    v_patch := v_patch || jsonb_build_object('lost_reason', v_merge.lost_reason, 'parked_until', v_merge.parked_until);
  end if;
  if v_patch <> '{}'::jsonb then
    select array_agg(k order by k) into v_cols from jsonb_object_keys(v_patch) k;
    execute format(
      'update public.companies t set (%s) = (select %s from jsonb_populate_record(null::public.companies, $1) r) where t.id = $2',
      (select string_agg(format('%I', c), ', ') from unnest(v_cols) c),
      (select string_agg(format('r.%I', c), ', ') from unnest(v_cols) c)
    ) using v_patch, p_keep;
  end if;
  update public.companies c
  set red_flags = array(select distinct unnest(c.red_flags || v_merge.red_flags)),
      sources = array(select distinct unnest(c.sources || v_merge.sources)),
      alias_domains = array(
        select distinct d from unnest(c.alias_domains || v_merge.alias_domains || array[v_merge.domain]) d
        where d is not null and d <> c.domain and d not like 'nodomain:%'
      ),
      client_contact_risk = c.client_contact_risk or v_merge.client_contact_risk
  where c.id = p_keep;

  -- Contacts: one main and one primary contact at the company that stays.
  perform set_config('sales.skip_roles', 'on', true);
  if exists (select 1 from public.contacts where company_id = p_keep and (is_primary or role = 'main')) then
    update public.contacts
    set is_primary = false, role = case when role = 'main' then 'reserve' else role end
    where company_id = p_merge and (is_primary or role = 'main');
  end if;
  update public.contacts set company_id = p_keep where company_id = p_merge;
  get diagnostics v_moved_contacts = row_count;
  perform set_config('sales.skip_roles', 'off', true);

  -- Everything else that points at the company.
  v_refs := public.sales_repoint_references('public.companies'::regclass, p_merge, p_keep, array['public.contacts'::regclass]);

  -- Notes, tasks, attachments and the activity log hang off (entity_type, entity_id).
  for v_tbl in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'entity_type'
      and exists (
        select 1 from information_schema.columns e
        where e.table_schema = 'public' and e.table_name = c.table_name and e.column_name = 'entity_id' and e.data_type = 'uuid'
      )
  loop
    begin
      execute format('update public.%I set entity_id = $1 where entity_type = ''company'' and entity_id = $2', v_tbl.table_name)
        using p_keep, p_merge;
      get diagnostics v_count = row_count;
      v_linked := v_linked + v_count;
    exception when unique_violation or check_violation or raise_exception or insufficient_privilege then
      null;
    end;
  end loop;

  insert into public.activities (company_id, channel, type, field, old_value, new_value, notes, source, created_by)
  values (
    p_keep, 'system', 'system', 'merged_company', to_jsonb(v_merge), v_patch,
    format('Merged %s (%s) into this company', v_merge.name, v_merge.domain),
    public.sales_current_source(), v_uid
  );

  delete from public.companies where id = p_merge;

  return jsonb_build_object(
    'kept', p_keep,
    'merged', p_merge,
    'filled_in', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(v_patch) k),
    'contacts_moved', v_moved_contacts,
    'references_moved', (v_refs ->> 'moved')::integer + v_linked,
    'removed_as_duplicate', (v_refs ->> 'removed_as_duplicate')::integer
  );
end;
$$;

revoke execute on function public.sales_merge_companies(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.sales_merge_companies(uuid, uuid, text, uuid) to authenticated, service_role;

-- Merge contact p_merge into p_keep: activities, meetings, sequences, call
-- steps, suppressions and everything else move to p_keep, empty fields are
-- filled, attempts and dates take the highest, Do not contact wins, the best
-- role wins; p_merge is deleted and its full row is in Activities.
create or replace function public.sales_merge_contacts(
  p_keep uuid,
  p_merge uuid,
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
  v_keep public.contacts;
  v_merge public.contacts;
  v_patch jsonb;
  v_cols text[];
  v_refs jsonb;
  v_role text;
  v_rank constant jsonb := '{"main": 1, "reserve": 2, "extra": 3}';
begin
  if public.caller_id_for(v_uid) is not null then
    raise exception 'Callers cannot merge contacts' using errcode = '42501';
  end if;
  if p_keep is null or p_merge is null or p_keep = p_merge then
    raise exception 'Choose two different contacts';
  end if;
  select * into v_keep from public.contacts where id = p_keep for update;
  select * into v_merge from public.contacts where id = p_merge for update;
  if v_keep.id is null or v_merge.id is null then
    raise exception 'Contact not found';
  end if;

  v_patch := public.sales_fill_patch(to_jsonb(v_keep), to_jsonb(v_merge), array[
    'first_name', 'last_name', 'title', 'tier', 'route', 'linkedin_url', 'linkedin_member_urn',
    'email', 'email_source', 'email_status', 'email_found_at',
    'phone', 'phone_type', 'phone_source', 'phone_found_at',
    'referred_to', 'callback_at', 'assigned_caller_id', 'assigned_until', 'onepage_id', 'source'
  ]);
  -- Both have a note: keep both.
  if v_keep.caller_note is not null and v_merge.caller_note is not null and v_keep.caller_note <> v_merge.caller_note then
    v_patch := v_patch || jsonb_build_object('caller_note', left(v_keep.caller_note || E'\n' || v_merge.caller_note, 5000));
  elsif v_keep.caller_note is null and v_merge.caller_note is not null then
    v_patch := v_patch || jsonb_build_object('caller_note', v_merge.caller_note);
  end if;
  if v_merge.attempts > v_keep.attempts then
    v_patch := v_patch || jsonb_build_object('attempts', v_merge.attempts);
  end if;
  if v_merge.last_attempt_at > coalesce(v_keep.last_attempt_at, '-infinity') then
    v_patch := v_patch || jsonb_build_object('last_attempt_at', v_merge.last_attempt_at);
  end if;
  if v_merge.last_contacted_at > coalesce(v_keep.last_contacted_at, '-infinity') then
    v_patch := v_patch || jsonb_build_object('last_contacted_at', v_merge.last_contacted_at);
  end if;
  if v_merge.status = 'do_not_contact' or (v_keep.status = 'new' and v_merge.status <> 'new') then
    v_patch := v_patch || jsonb_build_object('status', v_merge.status);
  end if;

  -- The unique links leave the merged contact first.
  update public.contacts set linkedin_url = null, linkedin_member_urn = null, onepage_id = null where id = p_merge;

  if v_patch <> '{}'::jsonb then
    select array_agg(k order by k) into v_cols from jsonb_object_keys(v_patch) k;
    execute format(
      'update public.contacts t set (%s) = (select %s from jsonb_populate_record(null::public.contacts, $1) r) where t.id = $2',
      (select string_agg(format('%I', c), ', ') from unnest(v_cols) c),
      (select string_agg(format('r.%I', c), ', ') from unnest(v_cols) c)
    ) using v_patch, p_keep;
  end if;
  update public.contacts c
  set sources = array(select distinct unnest(c.sources || v_merge.sources))
  where c.id = p_keep;

  v_refs := public.sales_repoint_references('public.contacts'::regclass, p_merge, p_keep);

  -- The better role of the two (main before backup before extra).
  v_role := case
    when (v_rank ->> v_merge.role)::integer < (v_rank ->> v_keep.role)::integer
      and v_merge.company_id = v_keep.company_id then v_merge.role
    else v_keep.role
  end;
  insert into public.activities (company_id, contact_id, channel, type, field, old_value, new_value, notes, source, created_by)
  values (
    v_keep.company_id, p_keep, 'system', 'system', 'merged_contact', to_jsonb(v_merge), v_patch,
    format('Merged contact %s into this contact', coalesce(v_merge.full_name, v_merge.email, v_merge.id::text)),
    public.sales_current_source(), v_uid
  );
  delete from public.contacts where id = p_merge;
  if v_role <> v_keep.role or (v_merge.is_primary and not v_keep.is_primary and v_merge.company_id = v_keep.company_id) then
    update public.contacts set role = 'main' where id = p_keep and (v_role = 'main' or v_merge.is_primary);
  end if;

  return jsonb_build_object(
    'kept', p_keep,
    'merged', p_merge,
    'filled_in', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(v_patch) k),
    'references_moved', (v_refs ->> 'moved')::integer,
    'removed_as_duplicate', (v_refs ->> 'removed_as_duplicate')::integer
  );
end;
$$;

revoke execute on function public.sales_merge_contacts(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.sales_merge_contacts(uuid, uuid, text, uuid) to authenticated, service_role;
