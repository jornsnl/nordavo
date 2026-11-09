-- Gaps in the sales CRM and Work after the audit (feedback Julius):
--   1. client_contacts.linkedin_url: tasks on a client show the LinkedIn of
--      the primary contact (Tasks en Work samenvoegen, point 2).
--   2. contacts.route is a pick list (section 2.3 point 1).
--   3. Every editable column of the sales tables is logged in Activities,
--      the manual order once per drag (section 2.3 point 9, 2.4).
--   4. Activities can belong to a sequence: a concept text Claude writes for
--      a step is logged with source claude (section 2.14).

-- ---------------------------------------------------------------------------
-- 1. LinkedIn of a client contact
-- ---------------------------------------------------------------------------

alter table public.client_contacts
  add column linkedin_url text check (char_length(linkedin_url) <= 500 and linkedin_url ~* '^https?://');

-- ---------------------------------------------------------------------------
-- 2. Route: a fixed list (src/lib/sales/labels.ts, contactRoutes)
-- ---------------------------------------------------------------------------

-- What people typed before becomes one of the routes; anything else is kept
-- in the caller note, so nothing is lost.
update public.contacts c
set route = x.route
from (
  select id,
    case
      when lower(route) ~ '(recept|reception|centrale|front ?desk|doorverbind|switchboard)' then 'Via reception'
      when lower(route) ~ '(linked ?in|^li$|inmail|seleqt)' then 'LinkedIn'
      when lower(route) ~ '(^e-? ?mail|^mail|mailen|instantly)' then 'Mail'
      when lower(route) ~ '(mobi|^06|gsm|cell|direct)' then 'Mobile'
      when lower(route) ~ '(main|algemeen|hoofdnummer|vast|kantoor|bedrijfsnummer|general)' then 'Main number'
      when lower(route) ~ '(bel|call|phone|telefo)' then
        case when phone is not null and regexp_replace(phone, '[^0-9+]', '', 'g') !~ '^(\+316|00316|06)' then 'Main number' else 'Mobile' end
    end as route
  from public.contacts
  where route is not null
    and route not in ('Mobile', 'Main number', 'Via reception', 'LinkedIn', 'Mail')
) x
where c.id = x.id and x.route is not null;

update public.contacts
set caller_note = concat_ws(E'\n', nullif(caller_note, ''), 'Route: ' || route),
    route = null
where route is not null
  and route not in ('Mobile', 'Main number', 'Via reception', 'LinkedIn', 'Mail');

alter table public.contacts drop constraint if exists contacts_route_check;
alter table public.contacts add constraint contacts_route_check
  check (route in ('Mobile', 'Main number', 'Via reception', 'LinkedIn', 'Mail'));

-- ---------------------------------------------------------------------------
-- 3. Activities can belong to a sequence
-- ---------------------------------------------------------------------------

alter table public.activities
  add column sequence_id uuid references public.sequences (id) on delete cascade;

alter table public.activities drop constraint if exists activities_target_check;
alter table public.activities add constraint activities_target_check
  check (contact_id is not null or company_id is not null or partner_id is not null or sequence_id is not null);

create index activities_sequence_idx on public.activities (sequence_id, date desc) where sequence_id is not null;

-- ---------------------------------------------------------------------------
-- 4. The change log covers every column sales_update() may write. Before,
--    segment, icp_reason, icp_score, legal_form, kvk_number, manual_position,
--    phone_type and email_status changed without a trace. last_attempt_at
--    stays out: it moves with every call, which is an activity of its own.
-- ---------------------------------------------------------------------------

create or replace function public.sales_log_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := to_jsonb(old);
  v_key text;
  v_fields text[];
  v_company uuid;
  v_contact uuid;
begin
  if coalesce(current_setting('sales.skip_log', true), '') = 'on' then
    return null;
  end if;
  if tg_table_name = 'companies' then
    v_fields := array[
      'name', 'website', 'prio', 'category', 'description', 'sector', 'employees', 'city',
      'linkedin_url', 'general_phone', 'red_flags', 'opening_line', 'source_note', 'segment',
      'icp_decision', 'icp_reason', 'icp_score', 'lead_status', 'pipeline_stage', 'lost_reason',
      'owner_id', 'partner_id', 'next_action', 'next_action_date', 'pinned_at', 'manual_position',
      'legal_form', 'kvk_number'
    ];
    v_company := new.id;
  else
    v_fields := array[
      'first_name', 'last_name', 'title', 'tier', 'role', 'route', 'phone', 'phone_type', 'email',
      'email_status', 'linkedin_url', 'status', 'attempts', 'callback_at', 'referred_to', 'caller_note',
      'assigned_caller_id', 'assigned_until', 'pinned_at', 'manual_position', 'company_id', 'is_primary'
    ];
    v_company := new.company_id;
    v_contact := new.id;
  end if;

  foreach v_key in array v_fields loop
    if (v_new -> v_key) is distinct from (v_old -> v_key) then
      insert into public.activities (
        company_id, contact_id, channel, type, field, old_value, new_value, source, created_by, caller_id
      ) values (
        v_company, v_contact, 'system', 'change', v_key, v_old -> v_key, v_new -> v_key,
        public.sales_current_source(), public.sales_current_actor(),
        public.caller_id_for(public.sales_current_actor())
      );
    end if;
  end loop;
  return null;
end;
$$;

revoke execute on function public.sales_log_changes() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Dragging rows: one activity per drag, on the dragged row. The first
--    drag in a view numbers every row of it; that is still one activity.
-- ---------------------------------------------------------------------------

drop function if exists public.sales_set_positions(text, uuid[], double precision[], uuid);

create or replace function public.sales_set_positions(
  p_entity text,
  p_ids uuid[],
  p_positions double precision[],
  p_moved uuid default null,
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
  v_moved uuid := coalesce(p_moved, p_ids[1]);
  v_old double precision;
  v_new double precision;
  v_company uuid;
  v_contact uuid;
begin
  if public.caller_id_for(v_uid) is not null then
    raise exception 'Callers cannot change the order of lists' using errcode = '42501';
  end if;
  if coalesce(array_length(p_ids, 1), 0) <> coalesce(array_length(p_positions, 1), 0) then
    raise exception 'Every row needs a position';
  end if;
  if p_entity not in ('company', 'contact') then
    raise exception 'Unknown record type';
  end if;

  if p_entity = 'company' then
    select manual_position, id into v_old, v_company from public.companies where id = v_moved;
  else
    select manual_position, company_id, id into v_old, v_company, v_contact from public.contacts where id = v_moved;
  end if;
  select x.pos into v_new from unnest(p_ids, p_positions) as x(id, pos) where x.id = v_moved;

  -- The rows themselves are not logged one by one.
  perform set_config('sales.skip_log', 'on', true);
  if p_entity = 'company' then
    update public.companies c set manual_position = x.pos
    from unnest(p_ids, p_positions) as x(id, pos)
    where c.id = x.id;
  else
    update public.contacts c set manual_position = x.pos
    from unnest(p_ids, p_positions) as x(id, pos)
    where c.id = x.id;
  end if;
  get diagnostics v_count = row_count;
  perform set_config('sales.skip_log', '', true);

  if v_count > 0 and v_company is not null then
    insert into public.activities (
      company_id, contact_id, channel, type, field, old_value, new_value, notes, source, created_by
    ) values (
      v_company, v_contact, 'system', 'change', 'manual_position', to_jsonb(v_old), to_jsonb(v_new),
      case when v_count > 1 then format('Manual order set for %s rows', v_count) else 'Moved in the manual order' end,
      public.sales_current_source(), v_uid
    );
  end if;
  return v_count;
end;
$$;

revoke execute on function public.sales_set_positions(text, uuid[], double precision[], uuid, uuid) from public, anon;
grant execute on function public.sales_set_positions(text, uuid[], double precision[], uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. A concept text for a sequence step (MCP draft_sequence_text). It waits
--    next to the approved text until Julius approves it; the activity says
--    who wrote it and from where.
-- ---------------------------------------------------------------------------

create or replace function public.sales_draft_step(
  p_step uuid,
  p_subject text default null,
  p_body text default null,
  p_source text default 'handmatig',
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.sales_actor(p_actor, p_source);
  v_step public.sequence_steps;
  v_name text;
  v_id uuid;
begin
  if public.caller_id_for(v_uid) is not null then
    raise exception 'Callers cannot write sequence texts' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_body, '')), '') is null then
    raise exception 'A concept needs a text';
  end if;
  select * into v_step from public.sequence_steps where id = p_step;
  if not found then
    raise exception 'Step not found';
  end if;
  if nullif(trim(coalesce(p_subject, '')), '') is not null and v_step.channel <> 'mail' then
    raise exception 'Only mail steps have a subject';
  end if;

  update public.sequence_steps
  set draft_subject = nullif(trim(coalesce(p_subject, '')), ''),
      draft_body = trim(p_body),
      draft_source = case when coalesce(p_source, 'handmatig') = 'claude' then 'claude' else 'handmatig' end,
      draft_at = now()
  where id = p_step;

  select name into v_name from public.sequences where id = v_step.sequence_id;
  insert into public.activities (
    sequence_id, channel, type, field, old_value, new_value, notes, source, created_by
  ) values (
    v_step.sequence_id, 'system', 'change', 'draft_body',
    to_jsonb(v_step.draft_body), to_jsonb(trim(p_body)),
    format('Concept text for step %s (%s) of %s, waits for approval', v_step.position, v_step.channel, v_name),
    coalesce(p_source, 'handmatig'), v_uid
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.sales_draft_step(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.sales_draft_step(uuid, text, text, text, uuid) to authenticated, service_role;
