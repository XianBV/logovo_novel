-- После миграций почты и Telegram. Включать ACCOUNT_LINKING_ENABLED только после проверки.
begin;
create table if not exists public.account_email_links (
  challenge_id uuid primary key,
  user_id bigint not null references public.users(user_id) on delete cascade,
  session_hash text not null check (session_hash ~ '^[a-f0-9]{64}$'),
  email text not null check (length(email) <= 254 and email = lower(email)),
  password_hash text not null check (password_hash ~ '^pbkdf2-sha256\$600000\$[a-f0-9]{32}\$[a-f0-9]{64}$'),
  code_hash text not null check (code_hash ~ '^[a-f0-9]{64}$'),
  original_telegram_id text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  failed_attempts smallint not null default 0 check (failed_attempts between 0 and 5),
  consumed_at timestamptz
);
create index if not exists account_email_links_user_time on public.account_email_links(user_id,created_at desc);
create index if not exists account_email_links_email_time on public.account_email_links(email,created_at desc);
alter table public.account_email_links enable row level security;
revoke all on public.account_email_links from public,anon,authenticated;
grant all on public.account_email_links to service_role;
alter table public.telegram_login_challenges add column if not exists target_user_id bigint references public.users(user_id) on delete cascade;
alter table public.telegram_login_challenges add column if not exists target_session_hash text;

create or replace function public.auth_link_session_valid(p_user_id bigint,p_token text)
returns boolean language sql security definer set search_path = '' as $$
  select p_token is not null and length(p_token) between 1 and 256 and exists(
    select 1 from public.sessions s join public.users u on u.user_id=s.user_id
    where s.user_id=p_user_id and s.token::text=p_token and s.expires_at>now()
      and s.created_at between now()-interval '15 minutes' and now() and not coalesce(u.is_banned,false));
$$;
create or replace function public.auth_link_user_json(p_user_id bigint)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('user_id',user_id,'username',username,'email',email,'telegram_id',telegram_id,
    'role',role,'avatar_url',avatar_url,'bio',bio,'created_at',created_at) from public.users where user_id=p_user_id;
$$;

create or replace function public.auth_begin_email_link(p_challenge_id uuid,p_user_id bigint,p_session_token text,p_session_hash text,p_email text,p_password_hash text,p_code_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user public.users%rowtype; v_last timestamptz;
begin
  select * into v_user from public.users where user_id=p_user_id for update;
  if not found or not public.auth_link_session_valid(p_user_id,p_session_token) then return jsonb_build_object('code','REAUTH_REQUIRED'); end if;
  if v_user.telegram_id is null or v_user.email is not null or v_user.password_hash is not null then return null; end if;
  if p_challenge_id is null or p_session_hash is null or p_session_hash !~ '^[a-f0-9]{64}$'
    or p_email is null or length(p_email)>254 or p_email<>lower(p_email) or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_password_hash is null or p_password_hash !~ '^pbkdf2-sha256\$600000\$[a-f0-9]{32}\$[a-f0-9]{64}$'
    or p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$' then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('email-link:'||p_email,0));
  if exists(select 1 from public.users where lower(email)=p_email) then return jsonb_build_object('code','IDENTITY_IN_USE'); end if;
  select max(created_at) into v_last from public.account_email_links where user_id=p_user_id;
  if v_last>now()-interval '1 minute' then return jsonb_build_object('code','COOLDOWN','retry_after',greatest(1,ceil(extract(epoch from v_last+interval '1 minute'-now())))); end if;
  if (select count(*) from public.account_email_links where (user_id=p_user_id or email=p_email) and created_at>now()-interval '1 hour')>=5
    then return jsonb_build_object('code','COOLDOWN','retry_after',3600); end if;
  delete from public.account_email_links where user_id=p_user_id and expires_at<now()-interval '1 day';
  update public.account_email_links set consumed_at=now() where user_id=p_user_id and consumed_at is null;
  insert into public.account_email_links(challenge_id,user_id,session_hash,email,password_hash,code_hash,original_telegram_id)
    values(p_challenge_id,p_user_id,p_session_hash,p_email,p_password_hash,p_code_hash,v_user.telegram_id);
  return jsonb_build_object('success',true);
end $$;

create or replace function public.auth_finish_email_link(p_challenge_id uuid,p_user_id bigint,p_session_token text,p_session_hash text,p_code_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user public.users%rowtype; v_link public.account_email_links%rowtype;
begin
  select * into v_user from public.users where user_id=p_user_id for update;
  if not found or not public.auth_link_session_valid(p_user_id,p_session_token) then return jsonb_build_object('code','REAUTH_REQUIRED'); end if;
  select * into v_link from public.account_email_links where challenge_id=p_challenge_id for update;
  if not found or v_link.user_id is distinct from p_user_id or v_link.session_hash is distinct from p_session_hash
    or v_link.consumed_at is not null or v_link.expires_at<=now() or v_link.failed_attempts>=5
    or v_user.email is not null or v_user.password_hash is not null or v_link.original_telegram_id is distinct from v_user.telegram_id then return null; end if;
  if v_link.code_hash is distinct from p_code_hash then
    update public.account_email_links set failed_attempts=failed_attempts+1,
      consumed_at=case when failed_attempts>=4 then now() else null end where challenge_id=p_challenge_id;
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('email-link:'||v_link.email,0));
  if exists(select 1 from public.users where lower(email)=v_link.email and user_id<>p_user_id) then
    update public.account_email_links set consumed_at=now() where challenge_id=p_challenge_id;
    return jsonb_build_object('code','IDENTITY_IN_USE');
  end if;
  begin
    update public.users set email=v_link.email,password_hash=v_link.password_hash,email_verified_at=now(),email_verification_required=true where user_id=p_user_id;
  exception when unique_violation then return jsonb_build_object('code','IDENTITY_IN_USE'); end;
  update public.account_email_links set consumed_at=now() where challenge_id=p_challenge_id;
  delete from public.sessions where user_id=p_user_id and token::text<>p_session_token;
  return jsonb_build_object('success',true,'user',public.auth_link_user_json(p_user_id));
end $$;

create or replace function public.auth_begin_telegram_link(p_challenge_id uuid,p_client_id text,p_nonce_hash text,p_proof_hash text,p_user_id bigint,p_session_token text,p_session_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user public.users%rowtype;
begin
  select * into v_user from public.users where user_id=p_user_id for update;
  if not found or not public.auth_link_session_valid(p_user_id,p_session_token) or v_user.telegram_id is not null
    or p_session_hash is null or p_session_hash !~ '^[a-f0-9]{64}$' then return false; end if;
  if (select count(*) from public.telegram_login_challenges where target_user_id=p_user_id and created_at>now()-interval '1 hour')>=10 then return false; end if;
  if not public.auth_begin_telegram_login(p_challenge_id,p_client_id,p_nonce_hash,p_proof_hash) then return false; end if;
  update public.telegram_login_challenges set target_user_id=p_user_id,target_session_hash=p_session_hash where challenge_id=p_challenge_id;
  return true;
end $$;

create or replace function public.auth_finish_telegram_link(p_challenge_id uuid,p_client_id text,p_proof_hash text,p_nonce_hash text,p_telegram_id text,p_user_id bigint,p_session_token text,p_session_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_challenge public.telegram_login_challenges%rowtype; v_user public.users%rowtype;
begin
  if p_telegram_id is null or p_telegram_id !~ '^[1-9][0-9]{0,15}$' then return null; end if;
  select * into v_challenge from public.telegram_login_challenges where challenge_id=p_challenge_id for update;
  if not found or v_challenge.target_user_id is distinct from p_user_id or v_challenge.target_session_hash is distinct from p_session_hash
    or v_challenge.consumed_at is not null or v_challenge.expires_at<=now() or v_challenge.client_id is distinct from p_client_id
    or v_challenge.proof_hash is distinct from p_proof_hash or v_challenge.nonce_hash is distinct from p_nonce_hash then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('telegram-login:'||p_telegram_id,0));
  select * into v_user from public.users where user_id=p_user_id for update;
  if not found or not public.auth_link_session_valid(p_user_id,p_session_token) then return jsonb_build_object('code','REAUTH_REQUIRED'); end if;
  if v_user.telegram_id is not null then return null; end if;
  if exists(select 1 from public.users where telegram_id=p_telegram_id and user_id<>p_user_id) then
    update public.telegram_login_challenges set consumed_at=now() where challenge_id=p_challenge_id;
    return jsonb_build_object('code','IDENTITY_IN_USE');
  end if;
  begin
    update public.users set telegram_id=p_telegram_id where user_id=p_user_id;
  exception when unique_violation then return jsonb_build_object('code','IDENTITY_IN_USE'); end;
  update public.telegram_login_challenges set consumed_at=now() where challenge_id=p_challenge_id;
  delete from public.sessions where user_id=p_user_id and token::text<>p_session_token;
  return jsonb_build_object('success',true,'user',public.auth_link_user_json(p_user_id));
end $$;

-- Обычный вход не должен принимать запрос, выданный для привязки аккаунта.
create or replace function public.auth_finish_telegram_login(p_challenge_id uuid,p_client_id text,p_proof_hash text,p_nonce_hash text,p_telegram_id text,p_username text,p_session_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_challenge public.telegram_login_challenges%rowtype; v_user public.users%rowtype; v_session public.sessions%rowtype;
begin
  if p_telegram_id is null or p_telegram_id !~ '^[1-9][0-9]{0,15}$' or p_username is null or length(p_username) not between 1 and 100
    or p_session_token is null or p_session_token !~ '^[a-f0-9-]{36}$' then return null; end if;
  select * into v_challenge from public.telegram_login_challenges where challenge_id=p_challenge_id for update;
  if not found or v_challenge.target_user_id is not null or v_challenge.consumed_at is not null or v_challenge.expires_at<=now()
    or v_challenge.client_id is distinct from p_client_id or v_challenge.proof_hash is distinct from p_proof_hash
    or v_challenge.nonce_hash is distinct from p_nonce_hash then return null; end if;
  -- Сериализуем два одновременных первых входа одного Telegram ID.
  perform pg_advisory_xact_lock(hashtextextended('telegram-login:' || p_telegram_id,0));
  select * into v_user from public.users where telegram_id=p_telegram_id for update;
  if not found then
    insert into public.users(telegram_id,username,role,email,password_hash,email_verification_required,created_at,last_active)
      values(p_telegram_id,p_username,'reader',null,null,false,now(),now()) returning * into v_user;
  end if;
  if coalesce(v_user.is_banned,false) then return null; end if;
  -- Существующие роль, имя, почта и полки не меняются; почта для Telegram не требуется.
  update public.users set last_active=now() where user_id=v_user.user_id;
  select * into v_session from jsonb_populate_record(null::public.sessions,jsonb_build_object(
    'token',p_session_token,'user_id',v_user.user_id,'created_at',now(),'last_used',now(),'expires_at',now()+interval '30 days'));
  insert into public.sessions(token,user_id,created_at,last_used,expires_at)
    values(v_session.token,v_session.user_id,v_session.created_at,v_session.last_used,v_session.expires_at);
  update public.telegram_login_challenges set consumed_at=now() where challenge_id=p_challenge_id;
  return jsonb_build_object('success',true,'user',jsonb_build_object('user_id',v_user.user_id,'username',v_user.username,
    'email',v_user.email,'telegram_id',v_user.telegram_id,'role',v_user.role,'avatar_url',v_user.avatar_url,'bio',v_user.bio,'created_at',v_user.created_at));
end $$;


revoke all on function public.auth_link_session_valid(bigint,text), public.auth_link_user_json(bigint),
  public.auth_begin_email_link(uuid,bigint,text,text,text,text,text),public.auth_finish_email_link(uuid,bigint,text,text,text),
  public.auth_begin_telegram_link(uuid,text,text,text,bigint,text,text),public.auth_finish_telegram_link(uuid,text,text,text,text,bigint,text,text)
  from public,anon,authenticated;
grant execute on function public.auth_link_session_valid(bigint,text),public.auth_link_user_json(bigint),
  public.auth_begin_email_link(uuid,bigint,text,text,text,text,text),public.auth_finish_email_link(uuid,bigint,text,text,text),
  public.auth_begin_telegram_link(uuid,text,text,text,bigint,text,text),public.auth_finish_telegram_link(uuid,text,text,text,text,bigint,text,text)
  to service_role;
commit;
