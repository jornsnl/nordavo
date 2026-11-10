-- ---------------------------------------------------------------------------
-- OAuth 2.1 for the MCP server at /api/mcp (docs/mcp.md, "Koppelen met OAuth").
--
-- Claude (claude.ai connectors, Claude Code, Claude Desktop) registers itself
-- (dynamic client registration), sends the team member to a consent page in
-- the portal where they choose read or read and write, and gets an access
-- token plus a refresh token. Personal tokens (mcp_tokens) keep working.
--
-- Only SHA-256 hashes of codes and tokens are stored. All writes go through
-- the secret key on the server; signed-in users only read and revoke their
-- own connections.
-- ---------------------------------------------------------------------------

-- Registered OAuth clients (RFC 7591). Public clients only: PKCE, no secret.
create table if not exists public.oauth_clients (
  id uuid primary key default gen_random_uuid(),
  client_id text not null unique,
  client_name text not null check (char_length(client_name) between 1 and 120),
  client_uri text,
  redirect_uris text[] not null check (cardinality(redirect_uris) between 1 and 10),
  created_at timestamptz not null default now()
);

alter table public.oauth_clients enable row level security;

-- The team sees the names of the apps in their list of connections.
create policy "OAuth clients are readable by staff"
  on public.oauth_clients for select
  to authenticated
  using ((select public.is_staff()));

-- One-time authorization codes, valid for 10 minutes. Server only (no policies).
create table if not exists public.oauth_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  client_id text not null references public.oauth_clients (client_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  access text not null check (access in ('read', 'write')),
  resource text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index if not exists oauth_codes_expires_at_idx on public.oauth_codes (expires_at);

alter table public.oauth_codes enable row level security;

-- A connection: one approval of one client by one user. Holds the current
-- access token (1 hour) and refresh token (rotated on every use).
create table if not exists public.oauth_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null references public.oauth_clients (client_id) on delete cascade,
  access text not null check (access in ('read', 'write')),
  access_token_hash text not null unique,
  access_expires_at timestamptz not null,
  refresh_token_hash text not null unique,
  refresh_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists oauth_grants_user_id_idx on public.oauth_grants (user_id);

alter table public.oauth_grants enable row level security;

create policy "OAuth grants are readable by their owner"
  on public.oauth_grants for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "OAuth grants are revocable by their owner"
  on public.oauth_grants for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Hashes are never readable from the browser; revoking only sets revoked_at.
revoke select, update on public.oauth_grants from authenticated;
grant select (id, user_id, client_id, access, created_at, last_used_at, revoked_at, refresh_expires_at)
  on public.oauth_grants to authenticated;
grant update (revoked_at) on public.oauth_grants to authenticated;
