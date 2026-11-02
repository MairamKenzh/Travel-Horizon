-- Travel Horizon — Supabase schema. Run once in the Supabase SQL Editor, then run seed.sql.

-- Admins: being logged in is not enough, the account must be listed here.
create table public.admins (
  id bigint generated always as identity,
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'admin' check (role in ('admin'))
);
alter table public.admins enable row level security;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = auth.uid() and role = 'admin');
$$;

create policy "Admins can see their own row" on public.admins
  for select to authenticated using (user_id = auth.uid());

-- Destinations shown on the website.
create table public.places (
  id text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  category text[] not null check (cardinality(category) > 0),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  image text not null,            -- images/x.jpg or a public Storage URL
  photo text not null default '', -- key in js/credits.js (built-in photos)
  credit text not null default '',
  emoji text not null default '',
  sort integer not null default 0,
  texts jsonb not null check (texts -> 'en' ->> 'title' <> ''), -- { "en": { badge, title, description, tags: [] }, ... }
  updated_at timestamptz not null default now()
);
alter table public.places enable row level security;

create policy "Anyone can read places" on public.places
  for select to anon, authenticated using (true);
create policy "Admins can add places" on public.places
  for insert to authenticated with check (public.is_admin());
create policy "Admins can edit places" on public.places
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins can delete places" on public.places
  for delete to authenticated using (public.is_admin());

-- Booking requests. Visitors never write here directly: the server validates each
-- request and inserts it with the secret key, then notifies Telegram.
create table public.bookings (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name text not null,
  email text not null,
  phone text not null default '',
  country text not null default '',
  destination text not null default '',
  arrival date not null,
  days integer not null check (days between 1 and 60),
  travelers integer not null check (travelers between 1 and 30),
  interests text[] not null default '{}',
  budget text not null default '',
  message text not null default '',
  language text not null default 'en',
  status text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  telegram_sent boolean not null default false
);
alter table public.bookings enable row level security;

create policy "Admins can read bookings" on public.bookings
  for select to authenticated using (public.is_admin());
create policy "Admins can edit bookings" on public.bookings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins can delete bookings" on public.bookings
  for delete to authenticated using (public.is_admin());

-- Uploaded place photos: public to view, only admins can change them.
insert into storage.buckets (id, name, public)
values ('place-photos', 'place-photos', true);

create policy "Admins can list place photos" on storage.objects
  for select to authenticated using (bucket_id = 'place-photos' and public.is_admin());
create policy "Admins can upload place photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'place-photos' and public.is_admin());
create policy "Admins can delete place photos" on storage.objects
  for delete to authenticated using (bucket_id = 'place-photos' and public.is_admin());

-- After creating your user in Authentication → Users, make it an admin
-- (replace the email):
--
--   insert into public.admins (user_id, role)
--   select id, 'admin' from auth.users where email = 'you@example.com'
--   on conflict (user_id) do update set role = 'admin';
