-- Account security: passkeys (WebAuthn) and personal access tokens for the
-- MCP server (Claude Code). Two-factor authentication with an authenticator
-- app (TOTP) uses Supabase Auth's built-in MFA and needs no table here; turn
-- it on under Authentication > Multi-Factor in the Supabase dashboard.

-- ---------------------------------------------------------------------------
-- Passkeys: one row per registered WebAuthn credential.
-- ---------------------------------------------------------------------------

create table if not exists public.passkeys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- base64url encoded credential id and COSE public key, as @simplewebauthn returns them.
  credential_id text not null unique,
  public_key text not null,
  counter bigint not null default 0,
  transports text[] not null default '{}',
  device_type text not null default 'singleDevice'
    check (device_type in ('singleDevice', 'multiDevice')),
  backed_up boolean not null default false,
  aaguid text,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists passkeys_user_id_idx on public.passkeys (user_id);

alter table public.passkeys enable row level security;

create policy "Passkeys are readable by their owner"
  on public.passkeys for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Passkeys are insertable by their owner"
  on public.passkeys for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Passkeys are renamable by their owner"
  on public.passkeys for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Passkeys are removable by their owner"
  on public.passkeys for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Owners may only rename a passkey; the counter and last use are written by
-- the server with the secret key after a successful sign-in.
revoke update on public.passkeys from authenticated;
grant update (name) on public.passkeys to authenticated;

-- ---------------------------------------------------------------------------
-- WebAuthn challenges: single use, short lived. Only the server (secret key)
-- reads and writes them, so there are no policies for authenticated users.
-- ---------------------------------------------------------------------------

create table if not exists public.webauthn_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  challenge text not null,
  kind text not null check (kind in ('registration', 'authentication')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '5 minutes'
);

create index if not exists webauthn_challenges_expires_at_idx
  on public.webauthn_challenges (expires_at);

alter table public.webauthn_challenges enable row level security;

-- ---------------------------------------------------------------------------
-- MCP tokens: personal access tokens for the MCP server at /api/mcp.
-- Only a SHA-256 hash is stored; the token itself is shown once.
-- ---------------------------------------------------------------------------

create table if not exists public.mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  token_hash text not null unique,
  -- First characters of the token, so people can recognise it in the list.
  token_prefix text not null,
  access text not null default 'read' check (access in ('read', 'write')),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists mcp_tokens_user_id_idx on public.mcp_tokens (user_id);

alter table public.mcp_tokens enable row level security;

create policy "MCP tokens are readable by their owner"
  on public.mcp_tokens for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Only the Nordavo team can create tokens, never client portal users.
create policy "MCP tokens are creatable by staff for themselves"
  on public.mcp_tokens for insert
  to authenticated
  with check ((select auth.uid()) = user_id and (select public.is_staff()));

create policy "MCP tokens are revocable by their owner"
  on public.mcp_tokens for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Revoking sets revoked_at; rows are kept so the list shows what was revoked.
revoke update on public.mcp_tokens from authenticated;
grant update (revoked_at) on public.mcp_tokens to authenticated;
