-- Поверх 202610280001_account_email.sql. Старые ссылки остаются совместимыми.
begin;
alter table public.account_email_tokens
  add column if not exists challenge_id uuid,
  add column if not exists failed_attempts smallint not null default 0 check (failed_attempts between 0 and 5);
create unique index if not exists account_email_challenge_unique on public.account_email_tokens(challenge_id) where challenge_id is not null;

create or replace function public.auth_issue_confirmation_code(p_user_id bigint, p_token_hash text, p_challenge_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_challenge_id is null then return false; end if;
  -- Общие лимиты 60 секунд и 5 писем в час, блокировка пользователя.
  if not public.auth_issue_email_token(p_user_id, 'email_confirm', p_token_hash) then return false; end if;
  update public.account_email_tokens set challenge_id=p_challenge_id, expires_at=now()+interval '10 minutes'
    where token_hash=p_token_hash;
  return true;
end $$;

create or replace function public.auth_confirm_email_code(p_challenge_id uuid, p_token_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user_id bigint; v_user public.users%rowtype; v_token public.account_email_tokens%rowtype;
begin
  select user_id into v_user_id from public.account_email_tokens where challenge_id=p_challenge_id;
  if not found then return false; end if;
  select * into v_user from public.users where user_id=v_user_id for update;
  if not found or coalesce(v_user.is_banned,false) then return false; end if;
  select * into v_token from public.account_email_tokens where challenge_id=p_challenge_id for update;
  if not found or v_token.purpose <> 'email_confirm' or v_token.consumed_at is not null or v_token.expires_at<=now()
    or v_token.failed_attempts>=5 or v_token.credential_hash is distinct from v_user.password_hash then return false; end if;
  if p_token_hash is null or v_token.token_hash <> p_token_hash then
    update public.account_email_tokens set failed_attempts=failed_attempts+1,
      consumed_at=case when failed_attempts+1>=5 then now() else null end where token_hash=v_token.token_hash;
    return false;
  end if;
  update public.users set email_verified_at=now() where user_id=v_user_id;
  update public.account_email_tokens set consumed_at=now() where user_id=v_user_id and purpose='email_confirm' and consumed_at is null;
  return true;
end $$;
revoke all on function public.auth_issue_confirmation_code(bigint,text,uuid) from public,anon,authenticated;
revoke all on function public.auth_confirm_email_code(uuid,text) from public,anon,authenticated;
grant execute on function public.auth_issue_confirmation_code(bigint,text,uuid) to service_role;
grant execute on function public.auth_confirm_email_code(uuid,text) to service_role;
commit;
