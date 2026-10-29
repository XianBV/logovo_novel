-- Применять после резервной копии базы и до AUTH_EMAIL_ENABLED=true.
-- Существующим аккаунтам подтверждение принудительно не назначается.
begin;

-- Новый формат длиннее старого; расширение не меняет существующие значения.
alter table public.users alter column password_hash type text;

alter table public.users
  add column if not exists email_verified_at timestamptz,
  add column if not exists email_verification_required boolean not null default false;

create table if not exists public.account_email_tokens (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  user_id bigint not null references public.users(user_id) on delete cascade,
  purpose text not null check (purpose in ('email_confirm', 'password_reset')),
  credential_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create index if not exists account_email_tokens_user_time on public.account_email_tokens(user_id, purpose, created_at desc);
create table if not exists public.account_login_limits (
  key_hash text primary key,
  attempts integer not null,
  expires_at timestamptz not null
);
create index if not exists account_login_limits_expiry on public.account_login_limits(expires_at);
alter table public.account_email_tokens enable row level security;
alter table public.account_login_limits enable row level security;
revoke all on public.account_email_tokens, public.account_login_limits from public, anon, authenticated;
grant all on public.account_email_tokens, public.account_login_limits to service_role;

create or replace function public.auth_take_login_attempt(p_key_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_attempts integer;
begin
  if p_key_hash is null or p_key_hash !~ '^[a-f0-9]{64}$' then return false; end if;
  delete from public.account_login_limits where key_hash in
    (select key_hash from public.account_login_limits where expires_at < now() - interval '1 day' limit 100);
  insert into public.account_login_limits(key_hash, attempts, expires_at)
    values (p_key_hash, 1, now() + interval '1 minute')
  on conflict (key_hash) do update set
    attempts = case when public.account_login_limits.expires_at <= now() then 1 else public.account_login_limits.attempts + 1 end,
    expires_at = case when public.account_login_limits.expires_at <= now() then now() + interval '1 minute' else public.account_login_limits.expires_at end
  returning attempts into v_attempts;
  return v_attempts <= 10;
end $$;

create or replace function public.auth_issue_email_token(p_user_id bigint, p_purpose text, p_token_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user public.users%rowtype;
begin
  if p_purpose is null or p_token_hash is null or p_purpose not in ('email_confirm', 'password_reset') or p_token_hash !~ '^[a-f0-9]{64}$' then return false; end if;
  select * into v_user from public.users where user_id = p_user_id for update;
  if not found or coalesce(v_user.is_banned, false) or v_user.password_hash is null then return false; end if;
  if p_purpose = 'email_confirm' and (not v_user.email_verification_required or v_user.email_verified_at is not null) then return false; end if;
  if exists(select 1 from public.account_email_tokens where user_id = p_user_id and purpose = p_purpose and created_at > now() - interval '1 minute') then return false; end if;
  if (select count(*) from public.account_email_tokens where user_id = p_user_id and purpose = p_purpose and created_at > now() - interval '1 hour') >= 5 then return false; end if;
  delete from public.account_email_tokens where user_id = p_user_id and expires_at < now() - interval '1 day';
  update public.account_email_tokens set consumed_at = now() where user_id = p_user_id and purpose = p_purpose and consumed_at is null;
  insert into public.account_email_tokens(token_hash, user_id, purpose, credential_hash, expires_at)
    values (p_token_hash, p_user_id, p_purpose, v_user.password_hash,
      now() + case when p_purpose = 'password_reset' then interval '15 minutes' else interval '24 hours' end);
  return true;
end $$;

create or replace function public.auth_consume_email_token(p_token_hash text, p_purpose text, p_password_hash text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user_id bigint; v_user public.users%rowtype; v_token public.account_email_tokens%rowtype;
begin
  if p_purpose is null or p_purpose not in ('email_confirm', 'password_reset') then return false; end if;
  select user_id into v_user_id from public.account_email_tokens where token_hash = p_token_hash;
  if not found then return false; end if;
  -- Один порядок блокировок при выдаче, использовании токена и создании сессии.
  select * into v_user from public.users where user_id = v_user_id for update;
  if not found or coalesce(v_user.is_banned, false) then return false; end if;
  select * into v_token from public.account_email_tokens where token_hash = p_token_hash for update;
  if not found or v_token.purpose <> p_purpose or v_token.consumed_at is not null or v_token.expires_at <= now() then return false; end if;
  if v_token.credential_hash is distinct from v_user.password_hash then return false; end if;
  if p_purpose = 'password_reset' then
    if p_password_hash is null or p_password_hash !~ '^pbkdf2-sha256\$600000\$[a-f0-9]{32}\$[a-f0-9]{64}$' then return false; end if;
    update public.users set password_hash = p_password_hash, email_verified_at = coalesce(email_verified_at, now()) where user_id = v_user_id;
    delete from public.sessions where user_id = v_user_id;
    update public.account_email_tokens set consumed_at = now() where user_id = v_user_id and consumed_at is null;
  else
    update public.users set email_verified_at = now() where user_id = v_user_id;
    update public.account_email_tokens set consumed_at = now() where token_hash = p_token_hash;
  end if;
  return true;
end $$;

create or replace function public.auth_create_email_session(p_user_id bigint, p_password_hash text, p_token text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user public.users%rowtype; v_session public.sessions%rowtype;
begin
  select * into v_user from public.users where user_id = p_user_id for update;
  if not found or coalesce(v_user.is_banned, false) or v_user.password_hash is distinct from p_password_hash
     or (v_user.email_verification_required and v_user.email_verified_at is null) then return false; end if;
  if p_password_hash is null or p_token is null or p_token !~ '^[a-f0-9-]{36}$' then return false; end if;
  -- jsonb_populate_record сохраняет реальные типы token/user_id существующей таблицы.
  select * into v_session from jsonb_populate_record(null::public.sessions,
    jsonb_build_object('token', p_token, 'user_id', p_user_id, 'created_at', now(), 'last_used', now(), 'expires_at', now() + interval '30 days'));
  insert into public.sessions(token, user_id, created_at, last_used, expires_at)
    values(v_session.token, v_session.user_id, v_session.created_at, v_session.last_used, v_session.expires_at);
  return true;
end $$;

revoke all on function public.auth_take_login_attempt(text) from public, anon, authenticated;
revoke all on function public.auth_issue_email_token(bigint, text, text) from public, anon, authenticated;
revoke all on function public.auth_consume_email_token(text, text, text) from public, anon, authenticated;
revoke all on function public.auth_create_email_session(bigint, text, text) from public, anon, authenticated;
grant execute on function public.auth_take_login_attempt(text) to service_role;
grant execute on function public.auth_issue_email_token(bigint, text, text) to service_role;
grant execute on function public.auth_consume_email_token(text, text, text) to service_role;
grant execute on function public.auth_create_email_session(bigint, text, text) to service_role;

commit;
