-- Компактные пользовательские настройки отображения профиля.
-- Одна строка на пользователя; таблица не хранит изображения или историю действий.

create table if not exists public.profile_preferences (
  user_id bigint primary key references public.users(user_id) on delete cascade,
  shelf_nav_width smallint not null default 180
    check (shelf_nav_width between 64 and 320),
  updated_at timestamptz not null default now()
);

alter table public.profile_preferences enable row level security;
grant select, insert, update on public.profile_preferences to service_role;

comment on table public.profile_preferences is
  'Небольшие синхронизируемые настройки внешнего вида профиля.';
comment on column public.profile_preferences.shelf_nav_width is
  'Ширина панели книжных полок в пикселях.';
