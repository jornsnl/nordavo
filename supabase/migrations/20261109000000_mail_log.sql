-- Mail log: every mail the portal tries to send through Resend (docs/mail.md).
-- Written by the server with the secret key, read by admins in Settings > Mail log.
-- Rows older than 180 days are removed when new mail is logged.

create table public.mail_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  category text not null default 'other',
  status text not null check (status in ('sent', 'failed', 'not_configured')),
  from_address text,
  to_addresses text[] not null default '{}',
  cc_addresses text[] not null default '{}',
  reply_to text,
  subject text not null,
  html text,
  text_body text,
  resend_id text,
  error text
);

create index mail_log_created_at_idx on public.mail_log (created_at desc);
create index mail_log_status_idx on public.mail_log (status, created_at desc);
create index mail_log_category_idx on public.mail_log (category, created_at desc);

alter table public.mail_log enable row level security;

create policy "Admins read the mail log" on public.mail_log
  for select to authenticated using (public.is_admin());

-- No insert, update or delete policies: only the service role writes.
revoke insert, update, delete on public.mail_log from anon, authenticated;
