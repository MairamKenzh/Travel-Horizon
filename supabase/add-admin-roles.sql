-- Adds id and role to the admins table. Run this once if you already ran the earlier schema.sql.
-- Safe to run again.
alter table public.admins
  add column if not exists id bigint generated always as identity,
  add column if not exists role text not null default 'admin';

alter table public.admins drop constraint if exists admins_role_check;
alter table public.admins add constraint admins_role_check check (role in ('admin'));

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = auth.uid() and role = 'admin');
$$;
