-- BCC logging (docs/mail.md, BCC logging): every sales user has a unique,
-- unguessable address <token>@<MAIL_BCC_DOMAIN>. A mail that user sends with
-- that address in BCC reaches /api/webhooks/inbound-mail and becomes an
-- outbound mail activity (source bcc) on each matched contact and company.
--
--   1  mail_bcc_addresses: one token per user, read by its owner
--   2  mail_bcc_token(): create or regenerate your own token
--   3  activities: source 'bcc' and the mail details (column mail)
--   4  mail_inbound_log: every inbound mail with its status
--   5  mail_bcc_find_contacts(): contacts by exact address, case insensitive

-- ---------------------------------------------------------------------------
-- 1. One address per user
-- ---------------------------------------------------------------------------

create table if not exists public.mail_bcc_addresses (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  token text not null unique check (token ~ '^[a-z0-9]{16,64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.mail_bcc_addresses enable row level security;

drop policy if exists "Users read their own BCC address" on public.mail_bcc_addresses;
create policy "Users read their own BCC address" on public.mail_bcc_addresses
  for select to authenticated using (user_id = (select auth.uid()));

-- Writes only through mail_bcc_token() (and the service role).
revoke insert, update, delete on public.mail_bcc_addresses from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Create or regenerate your own token
-- ---------------------------------------------------------------------------

-- Returns the token of the signed in user, creating it when there is none.
-- p_regenerate replaces it: mail to the old address is ignored from then on.
-- The token is 24 hex characters (96 bits) from gen_random_uuid().
create or replace function public.mail_bcc_token(p_regenerate boolean default false)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token text;
begin
  if v_uid is null or not public.has_module('sales') then
    raise exception 'BCC logging is for team members with the Sales module';
  end if;

  select token into v_token from public.mail_bcc_addresses where user_id = v_uid;
  if v_token is not null and not coalesce(p_regenerate, false) then
    return v_token;
  end if;

  v_token := substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 24);
  insert into public.mail_bcc_addresses (user_id, token)
  values (v_uid, v_token)
  on conflict (user_id) do update set token = excluded.token, updated_at = now();
  return v_token;
end;
$$;

revoke execute on function public.mail_bcc_token(boolean) from public, anon;
grant execute on function public.mail_bcc_token(boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Activities: source bcc and the mail details
-- ---------------------------------------------------------------------------

-- { subject, from, to, cc, message_id, attachments, recipients, provider }
alter table public.activities add column if not exists mail jsonb;

alter table public.activities drop constraint if exists activities_source_check;
alter table public.activities add constraint activities_source_check check (source in (
  'handmatig', 'instantly', 'webpartners', 'calcom', 'onepage', 'import',
  'seleqt', 'system', 'claude', 'apify', 'prospeo', 'bcc'
));

-- ---------------------------------------------------------------------------
-- 4. Inbound mail log
-- ---------------------------------------------------------------------------

create table if not exists public.mail_inbound_log (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  provider text not null default 'generic' check (provider in ('postmark', 'resend', 'generic')),
  status text not null check (status in (
    'logged',          -- activities written
    'no_match',        -- from the owner, but no recipient is a known contact
    'duplicate',       -- this Message-ID was already handled for this user
    'sender_mismatch', -- the sender is not the owner of the BCC address
    'unknown_address', -- no user has this BCC address (or it was regenerated)
    'no_address',      -- no address on the BCC domain in the mail
    'invalid',         -- not a mail we can read
    'failed'           -- an error while writing; the provider retries
  )),
  reason text,
  user_id uuid references public.profiles (id) on delete set null,
  bcc_address text,
  message_id text,
  from_address text,
  to_addresses text[] not null default '{}',
  cc_addresses text[] not null default '{}',
  subject text,
  mail_date timestamptz,
  attachment_names text[] not null default '{}',
  activity_ids uuid[] not null default '{}',
  company_count integer not null default 0
);

create index if not exists mail_inbound_log_received_idx on public.mail_inbound_log (received_at desc);
create index if not exists mail_inbound_log_user_idx on public.mail_inbound_log (user_id, received_at desc);
create index if not exists mail_inbound_log_message_idx on public.mail_inbound_log (user_id, message_id) where message_id is not null;

alter table public.mail_inbound_log enable row level security;

drop policy if exists "Admins read the inbound mail log" on public.mail_inbound_log;
create policy "Admins read the inbound mail log" on public.mail_inbound_log
  for select to authenticated using (public.is_admin());

drop policy if exists "Users read their own inbound mail" on public.mail_inbound_log;
create policy "Users read their own inbound mail" on public.mail_inbound_log
  for select to authenticated using (user_id = (select auth.uid()));

-- Only the webhook (service role) writes.
revoke insert, update, delete on public.mail_inbound_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Contacts by exact address, case insensitive (index on lower(email))
-- ---------------------------------------------------------------------------

create or replace function public.mail_bcc_find_contacts(p_emails text[])
returns table (id uuid, company_id uuid, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.company_id, lower(c.email)
  from public.contacts c
  where c.email is not null
    and lower(c.email) = any (select lower(trim(e)) from unnest(p_emails) e)
  order by c.is_primary desc, c.created_at;
$$;

revoke execute on function public.mail_bcc_find_contacts(text[]) from public, anon, authenticated;
grant execute on function public.mail_bcc_find_contacts(text[]) to service_role;
