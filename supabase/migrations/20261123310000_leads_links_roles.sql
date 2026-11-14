-- Leads and Contacts: LinkedIn links, contact roles and tiers, call notes
-- (feedback Julius, November 2026).
--
--   1  LinkedIn links kept exactly as given (case of the path), always with
--      https://, and a separate lowercase key for duplicate matching
--   2  The LinkedIn member id (the ACwAA... id of Apify links) next to the
--      normal profile link, so the same person is found with either
--   3  Contact roles: one main contact per company, then backup, then extra,
--      and a tier from the job title
--   4  Opening line, red flags and general number out of "What they do"
--
-- See docs/sales.md, "Contacten" and "LinkedIn".

-- ---------------------------------------------------------------------------
-- 1. LinkedIn links
-- ---------------------------------------------------------------------------

-- "nl.linkedin.com/in/ACwAAB12Cd/?trk=x" -> "https://www.linkedin.com/in/ACwAAB12Cd"
-- Host and the first path segment (in, company) lowercase, the rest as given:
-- the ACwAA ids of Apify are case sensitive, lowercased they do not open.
-- Anything that is not a LinkedIn link only gets https:// in front.
create or replace function public.linkedin_clean_url(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := nullif(trim(coalesce(p_value, '')), '');
  v_path text;
begin
  if v is null then
    return null;
  end if;
  if v ~* '^([a-z][a-z0-9+.-]*://)?([a-z]{2,3}\.|www\.)?linkedin\.com(/|$|\?|#)' then
    v_path := regexp_replace(v, '^([a-z][a-z0-9+.-]*://)?[^/?#]*', '', 'i');
    v_path := regexp_replace(v_path, '[?#].*$', '');
    v_path := regexp_replace(v_path, '/+$', '');
    v_path := regexp_replace(v_path, '//+', '/', 'g');
    -- The kind of page (in, company, school, showcase, pub) in lowercase.
    if v_path ~ '^/[^/]+' then
      v_path := '/' || lower(substring(v_path from '^/([^/]+)')) || coalesce(substring(v_path from '^/[^/]+(/.*)$'), '');
    end if;
    return 'https://www.linkedin.com' || v_path;
  end if;
  if v !~* '^[a-z][a-z0-9+.-]*://' then
    return 'https://' || v;
  end if;
  return v;
end;
$$;

-- The member id in an Apify or Sales Navigator link ("ACwAAB12Cd" from
-- linkedin.com/in/ACwAAB12Cd), or null for a normal profile link.
create or replace function public.linkedin_member_urn(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when trim(coalesce(p_value, '')) ~* '^AC[a-z]AA[a-z0-9_-]{6,}$' then trim(p_value)
    else substring(coalesce(p_value, '') from '(?i)linkedin\.com/(?:in|sales/lead|sales/people)/(AC[a-z]AA[a-z0-9_-]{6,})')
  end;
$$;

-- Contacts: the link as given, and the lowercase key that must be unique.
alter table public.contacts drop constraint if exists contacts_linkedin_url_check;
alter table public.contacts drop constraint if exists contacts_linkedin_url_key;
alter table public.contacts
  add column if not exists linkedin_member_urn text,
  add column if not exists linkedin_key text generated always as (public.normalize_linkedin(linkedin_url)) stored;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contacts_linkedin_url_length') then
    alter table public.contacts add constraint contacts_linkedin_url_length check (char_length(linkedin_url) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contacts_linkedin_member_urn_check') then
    alter table public.contacts add constraint contacts_linkedin_member_urn_check
      check (char_length(linkedin_member_urn) <= 200 and linkedin_member_urn !~ '\s');
  end if;
end;
$$;

create unique index if not exists contacts_linkedin_key_key on public.contacts (linkedin_key);
create unique index if not exists contacts_linkedin_member_urn_key on public.contacts (lower(linkedin_member_urn));

-- Companies: the same, without the uniqueness (two leads may share a page
-- until someone merges them).
alter table public.companies
  add column if not exists linkedin_key text generated always as (public.normalize_linkedin(linkedin_url)) stored;
create index if not exists companies_linkedin_key_idx on public.companies (linkedin_key) where linkedin_key is not null;

create or replace function public.contacts_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_urn text;
begin
  new.linkedin_url := public.linkedin_clean_url(new.linkedin_url);
  -- A member id given as a link is stored as the id.
  if new.linkedin_member_urn is not null then
    new.linkedin_member_urn := coalesce(public.linkedin_member_urn(new.linkedin_member_urn), nullif(trim(new.linkedin_member_urn), ''));
  end if;
  v_urn := public.linkedin_member_urn(new.linkedin_url);
  if v_urn is not null then
    -- An Apify link carries the member id; a better cased one replaces a
    -- lowercased one.
    if new.linkedin_member_urn is null or lower(new.linkedin_member_urn) = lower(v_urn) and v_urn <> lower(v_urn) then
      new.linkedin_member_urn := v_urn;
    end if;
    -- Repair: the link lowercased, the id known with its case.
    if v_urn = lower(v_urn) and lower(new.linkedin_member_urn) = lower(v_urn) and new.linkedin_member_urn <> v_urn then
      new.linkedin_url := 'https://www.linkedin.com/in/' || new.linkedin_member_urn;
    end if;
  end if;
  new.email := nullif(lower(trim(new.email)), '');
  return new;
end;
$$;

create or replace function public.companies_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.domain is null or new.domain not like 'nodomain:%' then
    new.domain := public.normalize_domain(new.domain);
  end if;
  new.linkedin_url := public.linkedin_clean_url(new.linkedin_url);
  if new.client_contact_risk then
    new.icp_decision := 'NO_GO'; -- rule 9
  end if;
  return new;
end;
$$;

-- Existing links: https:// in front, query strings off. No change log for
-- this clean up (it is not an edit by anyone). Member ids from the Apify
-- links that are already there (lowercased; the case comes back when Apify
-- delivers the link again, see docs/sales.md). Then repair the case where
-- another table kept the link as it was typed: a candidate, a client
-- contact or a partner with the same profile.
do $$
begin
perform set_config('sales.skip_log', 'on', true);
perform set_config('sales.skip_roles', 'on', true);

update public.contacts
set linkedin_url = public.linkedin_clean_url(linkedin_url)
where linkedin_url is not null and linkedin_url is distinct from public.linkedin_clean_url(linkedin_url);

update public.companies
set linkedin_url = public.linkedin_clean_url(linkedin_url)
where linkedin_url is not null and linkedin_url is distinct from public.linkedin_clean_url(linkedin_url);

update public.contacts
set linkedin_member_urn = public.linkedin_member_urn(linkedin_url)
where linkedin_member_urn is null and public.linkedin_member_urn(linkedin_url) is not null;

with originals as (
  select distinct on (public.normalize_linkedin(x.url)) public.normalize_linkedin(x.url) as key, public.linkedin_clean_url(x.url) as url
  from (
    select linkedin_url as url from public.candidates where linkedin_url ~ '[A-Z]'
    union all
    select linkedin_url from public.client_contacts where linkedin_url ~ '[A-Z]'
    union all
    select linkedin_url from public.partners where linkedin_url ~ '[A-Z]'
  ) x
  where public.normalize_linkedin(x.url) like 'linkedin.com/in/%'
)
update public.contacts c
set linkedin_url = o.url, linkedin_member_urn = coalesce(public.linkedin_member_urn(o.url), c.linkedin_member_urn)
from originals o
where c.linkedin_key = o.key
  and c.linkedin_url = lower(c.linkedin_url)
  and o.url <> c.linkedin_url;

perform set_config('sales.skip_log', 'off', true);
perform set_config('sales.skip_roles', 'off', true);
end;
$$;

-- Contacts whose link was lowercased and cannot be repaired from here: an
-- Apify member id (ACwAA...) with only lowercase letters. The app shows a
-- warning and Claude can list them (list_contacts linkedin_broken).
create or replace function public.linkedin_link_broken(p_url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(public.linkedin_member_urn(p_url) = lower(public.linkedin_member_urn(p_url)), false);
$$;

-- ---------------------------------------------------------------------------
-- 3. Contact roles and tiers
-- ---------------------------------------------------------------------------

-- The decision maker tier of a job title (mirrors tierForTitle in
-- src/lib/gtm/signals.ts): 1 CTO and heads of engineering or data, 2 owner
-- or director, 3 recruiter or HR.
create or replace function public.contact_tier_for_title(p_title text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when v is null or v = '' then null
    when v ~ '\mcto\M'
      or v ~ '\mchief (technology|technical|data) officer\M'
      or v ~ '\mhead of (engineering|data|development|software|technology|tech)\M'
      or v ~ '\mv\.?p\.? (of )?(engineering|technology)\M'
      or v ~ '\mvice president (of )?engineering\M'
      or v ~ '\mengineering manager\M'
      or v ~ '\m(director|directeur) (of )?(engineering|technology|data)\M'
      or v ~ '\mtechnisch directeur\M'
      or v ~ '\mhoofd (ontwikkeling|engineering|data|software)' then 1
    when v ~ '\mrecruit' or v ~ '\mhr\M' or v ~ '\mhuman resources\M' or v ~ '\mtalent\M' or v ~ '\mp&o\M' then 3
    when v ~ '\mowner\M'
      or v ~ '\m(co[ -]?)?founder\M'
      or v ~ '\moprichter\M'
      or v ~ '\meigenaar\M'
      or v ~ '\mdirecteur\M'
      or v ~ '\mceo\M'
      or v ~ '\mchief executive\M'
      or v ~ '\mmanaging (director|partner)\M' then 2
    else null
  end
  from (select lower(regexp_replace(trim(coalesce(p_title, '')), '\s+', ' ', 'g')) as v) t;
$$;

-- One main contact per company, and it is the primary contact (the one a
-- sequence picks). A second contact added as main becomes the backup
-- (reserve) when there is none yet, else extra. Making someone main (or
-- primary) by hand moves the old main to backup. A new contact without a
-- tier gets the tier of its job title.
create or replace function public.contacts_roles()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 or coalesce(current_setting('sales.skip_roles', true), '') = 'on' then
    return new;
  end if;
  if new.tier is null and (tg_op = 'INSERT' or new.title is distinct from old.title) then
    new.tier := public.contact_tier_for_title(new.title);
  end if;

  if tg_op = 'INSERT' then
    if new.is_primary then
      new.role := 'main';
    elsif new.role = 'main' and exists (
      select 1 from public.contacts c where c.company_id = new.company_id and c.role = 'main'
    ) then
      new.role := case
        when exists (select 1 from public.contacts c where c.company_id = new.company_id and c.role = 'reserve') then 'extra'
        else 'reserve'
      end;
    end if;
    if new.role = 'main' then
      new.is_primary := true;
    end if;
  else
    if new.is_primary and not old.is_primary then
      new.role := 'main';
    elsif new.role = 'main' and old.role <> 'main' then
      new.is_primary := true;
    elsif old.role = 'main' and new.role <> 'main' then
      new.is_primary := false;
    elsif old.is_primary and not new.is_primary and new.role = 'main' then
      new.role := 'reserve';
    end if;
  end if;

  if new.role = 'main' and (tg_op = 'INSERT' or old.role <> 'main' or old.company_id <> new.company_id) then
    update public.contacts c
    set role = 'reserve', is_primary = false
    where c.company_id = new.company_id and c.id <> new.id and (c.role = 'main' or c.is_primary);
  end if;
  return new;
end;
$$;

drop trigger if exists contacts_roles on public.contacts;
create trigger contacts_roles before insert or update of role, is_primary, title, tier, company_id on public.contacts
  for each row execute function public.contacts_roles();

-- Existing contacts: everyone was Main without a tier. Tier from the title;
-- then per company the primary contact (else the best tier with a phone
-- number) is main, the next one backup and the rest extra. Companies where
-- the team already chose roles (only one main) are left alone.
do $$
begin
perform set_config('sales.skip_log', 'on', true);
perform set_config('sales.skip_roles', 'on', true);

update public.contacts
set tier = public.contact_tier_for_title(title)
where tier is null and public.contact_tier_for_title(title) is not null;

with ranked as (
  select c.id,
         row_number() over (
           partition by c.company_id
           order by c.is_primary desc, coalesce(c.tier, 9), (c.phone is null), c.created_at, c.id
         ) as n
  from public.contacts c
  where c.company_id in (
    select company_id from public.contacts group by company_id
    having count(*) filter (where role = 'main') <> 1
  )
)
update public.contacts c
set role = case when r.n = 1 then 'main' when r.n = 2 then 'reserve' else 'extra' end,
    is_primary = (r.n = 1)
from ranked r
where r.id = c.id
  and (c.role is distinct from case when r.n = 1 then 'main' when r.n = 2 then 'reserve' else 'extra' end
       or c.is_primary is distinct from (r.n = 1));

perform set_config('sales.skip_log', 'off', true);
perform set_config('sales.skip_roles', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Opening line, red flags and general number out of "What they do"
-- ---------------------------------------------------------------------------

-- Claude could not fill these fields, so they ended up in the description as
-- "OPENING LINE: ...", "RED FLAGS: ...", "GENERAL NUMBER: ...". Mirrors
-- extractLeadNotes in src/lib/gtm/lead-notes.ts.
create or replace function public.sales_extract_lead_notes(p_text text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_markers constant text := '(opening ?line|openingszin|opener|red ?flags?|rode vlaggen|general (phone )?number|algemeen (telefoon)?nummer|hoofdnummer|main number)';
  v_text text;
  v_line text;
  v_section text := 'description';
  v_label text;
  v_parts jsonb := '{"description": [], "opening_line": [], "red_flags": [], "general_phone": []}';
  v_flags text[] := '{}';
  v_flag text;
begin
  if p_text is null or p_text !~* (v_markers || '\s*\**\s*[:]') then
    return null;
  end if;
  -- Every marker on its own line.
  v_text := regexp_replace(p_text, '(\*\*|__)?\m' || v_markers || '(\*\*|__)?\s*:', E'\n\\&', 'gi');
  foreach v_line in array regexp_split_to_array(v_text, E'\n') loop
    v_label := lower(substring(v_line from '(?i)^[\s*#>_-]*' || v_markers || '[\s*_]*:'));
    if v_label is not null then
      v_section := case
        when v_label ~ '^(opening|opener)' then 'opening_line'
        when v_label ~ '^(red|rode)' then 'red_flags'
        else 'general_phone'
      end;
      v_line := regexp_replace(v_line, '(?i)^[\s*#>_-]*' || v_markers || '[\s*_]*:[\s*_]*', '');
    end if;
    v_parts := jsonb_set(v_parts, array[v_section], (v_parts -> v_section) || to_jsonb(v_line));
  end loop;

  foreach v_flag in array regexp_split_to_array(
    -- No red flags section: string_agg gives null and FOREACH can't loop over null.
    coalesce((select string_agg(x, E'\n') from jsonb_array_elements_text(v_parts -> 'red_flags') x), ''), E'\\s*[;,\\n]\\s*'
  ) loop
    v_flag := trim(both ' -*•.' from coalesce(v_flag, ''));
    if v_flag <> '' and lower(v_flag) not in ('none', 'geen', 'n/a', '-') then
      v_flags := v_flags || v_flag;
    end if;
  end loop;

  return jsonb_build_object(
    'description', nullif(trim(both E' \n' from regexp_replace(
      (select string_agg(x, E'\n') from jsonb_array_elements_text(v_parts -> 'description') x), E'\\n{3,}', E'\n\n', 'g')), ''),
    'opening_line', nullif(trim(both E' \n' from (select string_agg(x, ' ') from jsonb_array_elements_text(v_parts -> 'opening_line') x)), ''),
    'red_flags', to_jsonb(v_flags),
    'general_phone', nullif(trim(both E' \n.' from (select string_agg(x, ' ') from jsonb_array_elements_text(v_parts -> 'general_phone') x)), '')
  );
end;
$$;

-- Move them into their own fields where those are still empty. A company
-- where a field is already filled with something else keeps its text. These
-- are logged as changes with source system, so the old text is in Activities.
do $$
begin
perform set_config('sales.source', 'system', true);

with parsed as (
  select c.id, c.opening_line, c.red_flags, c.general_phone, public.sales_extract_lead_notes(c.description) as n
  from public.companies c
  where c.description is not null
)
update public.companies c
set description = p.n ->> 'description',
    opening_line = coalesce(c.opening_line, p.n ->> 'opening_line'),
    red_flags = case
      when cardinality(c.red_flags) = 0 then array(select jsonb_array_elements_text(p.n -> 'red_flags'))
      else c.red_flags
    end,
    general_phone = coalesce(c.general_phone, left(p.n ->> 'general_phone', 50))
from parsed p
where p.id = c.id
  and p.n is not null
  and (p.n ->> 'opening_line' is null or c.opening_line is null or c.opening_line = p.n ->> 'opening_line')
  and (jsonb_array_length(p.n -> 'red_flags') = 0 or cardinality(c.red_flags) = 0)
  and (p.n ->> 'general_phone' is null or c.general_phone is null or c.general_phone = p.n ->> 'general_phone')
  and coalesce(char_length(p.n ->> 'general_phone'), 0) <= 50;

perform set_config('sales.source', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Writing the LinkedIn link and member id of a contact
-- ---------------------------------------------------------------------------

-- sales_update writes linkedin_url; the member id is not one of its fields.
-- This sets both (either may be null to leave it), with the same rights and
-- the same change log as sales_update.
create or replace function public.sales_set_contact_linkedin(
  p_contact uuid,
  p_linkedin_url text default null,
  p_member_urn text default null,
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
  v_row public.contacts;
begin
  if public.caller_id_for(v_uid) is not null then
    raise exception 'Callers change contacts on the call screen only' using errcode = '42501';
  end if;
  update public.contacts c
  set linkedin_url = coalesce(nullif(trim(p_linkedin_url), ''), c.linkedin_url),
      linkedin_member_urn = coalesce(nullif(trim(p_member_urn), ''), c.linkedin_member_urn)
  where c.id = p_contact
  returning * into v_row;
  if v_row.id is null then
    raise exception 'Contact not found';
  end if;
  return jsonb_build_object('id', v_row.id, 'linkedin_url', v_row.linkedin_url, 'linkedin_member_urn', v_row.linkedin_member_urn);
end;
$$;

revoke execute on function public.sales_set_contact_linkedin(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.sales_set_contact_linkedin(uuid, text, text, text, uuid) to authenticated, service_role;
