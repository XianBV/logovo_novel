create table if not exists public.novel_chapter_subscriptions (
  user_id bigint not null references public.users(user_id) on delete cascade,
  novel_id bigint not null references public.novels(novel_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, novel_id)
);

create index if not exists novel_chapter_subscriptions_novel_idx
  on public.novel_chapter_subscriptions (novel_id, user_id);

alter table public.novel_chapter_subscriptions enable row level security;
revoke all on public.novel_chapter_subscriptions from public, anon, authenticated;
grant select, insert, delete on public.novel_chapter_subscriptions to service_role;

alter table public.notifications
  add column if not exists chapter_subscription_only boolean not null default false;

create or replace function public.set_novel_chapter_subscription(
  p_user_id bigint, p_novel_id bigint, p_subscribed boolean
) returns void
language plpgsql
set search_path = public
as $$
begin
  if p_subscribed then
    insert into public.novel_chapter_subscriptions (user_id, novel_id)
      values (p_user_id, p_novel_id) on conflict do nothing;

    insert into public.notifications (
      user_id, type, novel_id, chapter_id, title, message, link, is_read,
      available_at, created_at, chapter_subscription_only
    )
    select p_user_id, 'new_chapter', n.novel_id, c.chapter_id,
      'Новая глава: ' || n.title,
      concat('Глава ', c.chapter_number, case when c.chapter_title <> '' then ' — ' || c.chapter_title end),
      null, false, c.publish_at, now(), true
    from public.chapters c
    join public.novels n on n.novel_id = c.novel_id
    where c.novel_id = p_novel_id and c.is_deleted = false and c.publish_at > now()
    on conflict (user_id, type, chapter_id) do nothing;
  else
    delete from public.novel_chapter_subscriptions where user_id = p_user_id and novel_id = p_novel_id;
    delete from public.notifications
      where user_id = p_user_id and novel_id = p_novel_id and chapter_subscription_only
        and available_at > now();
  end if;
end;
$$;

revoke all on function public.set_novel_chapter_subscription(bigint, bigint, boolean) from public, anon, authenticated;
grant execute on function public.set_novel_chapter_subscription(bigint, bigint, boolean) to service_role;
