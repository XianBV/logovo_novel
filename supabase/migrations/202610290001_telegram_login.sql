-- Новый Telegram Login: сервер проверяет JWT, база одноразово создаёт сеанс.
begin;
create table if not exists public.telegram_login_challenges (
  challenge_id uuid primary key,
  client_id text not null,
  nonce_hash text not null check (nonce_hash ~ '^[a-f0-9]{64}$'),
  proof_hash text not null check (proof_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  consumed_at timestamptz
);
create index if not exists telegram_login_challenges_expiry on public.telegram_login_challenges(expires_at);
alter table public.telegram_login_challenges enable row level security;
revoke all on public.telegram_login_challenges from public,anon,authenticated;
grant all on public.telegram_login_challenges to service_role;

create or replace function public.auth_begin_telegram_login(p_challenge_id uuid,p_client_id text,p_nonce_hash text,p_proof_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_challenge_id is null or p_client_id is null or p_client_id !~ '^[1-9][0-9]{0,15}$'
    or p_nonce_hash is null or p_nonce_hash !~ '^[a-f0-9]{64}$' or p_proof_hash is null or p_proof_hash !~ '^[a-f0-9]{64}$' then return false; end if;
  -- Ограничиваем накопление анонимных запросов, в том числе при конкурентной выдаче.
  perform pg_advisory_xact_lock(hashtextextended('telegram-challenges:' || p_client_id,0));
  delete from public.telegram_login_challenges where challenge_id in
    (select challenge_id from public.telegram_login_challenges where expires_at <= now() limit 100);
  if (select count(*) from (select 1 from public.telegram_login_challenges where expires_at>now() limit 10000) pending)>=10000 then return false; end if;
  insert into public.telegram_login_challenges(challenge_id,client_id,nonce_hash,proof_hash)
    values(p_challenge_id,p_client_id,p_nonce_hash,p_proof_hash);
  return true;
end $$;

create or replace function public.auth_finish_telegram_login(p_challenge_id uuid,p_client_id text,p_proof_hash text,p_nonce_hash text,p_telegram_id text,p_username text,p_session_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_challenge public.telegram_login_challenges%rowtype; v_user public.users%rowtype; v_session public.sessions%rowtype;
begin
  if p_telegram_id is null or p_telegram_id !~ '^[1-9][0-9]{0,15}$' or p_username is null or length(p_username) not between 1 and 100
    or p_session_token is null or p_session_token !~ '^[a-f0-9-]{36}$' then return null; end if;
  select * into v_challenge from public.telegram_login_challenges where challenge_id=p_challenge_id for update;
  if not found or v_challenge.consumed_at is not null or v_challenge.expires_at<=now()
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
revoke all on function public.auth_begin_telegram_login(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.auth_finish_telegram_login(uuid,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.auth_begin_telegram_login(uuid,text,text,text) to service_role;
grant execute on function public.auth_finish_telegram_login(uuid,text,text,text,text,text,text) to service_role;
commit;
