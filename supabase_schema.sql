-- ============================================================
-- FleetLog — Supabase Schema
-- Run this in Supabase → SQL Editor → New Query
-- ============================================================

-- Profiles (auto-created on first Google login)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  full_name text,
  avatar_url text,
  is_admin boolean default false,
  created_at timestamptz default now()
);

-- Cars
create table if not exists public.cars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  name text not null,
  color text default '#22d3ee',
  weekly_rate numeric default 130,
  alerts jsonb default '[]',
  created_at timestamptz default now()
);

-- Weekly entries (km + payment together)
create table if not exists public.weeks (
  id uuid primary key default gen_random_uuid(),
  car_id uuid references public.cars(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  week_start date not null,
  km numeric default 0,
  daily_km jsonb default '[]',
  amount numeric default 0,
  paid boolean default true,
  notes text default '',
  created_at timestamptz default now()
);

-- Costs
create table if not exists public.costs (
  id uuid primary key default gen_random_uuid(),
  car_id uuid references public.cars(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  date date not null,
  amount numeric default 0,
  category text default 'Other',
  notes text default '',
  created_at timestamptz default now()
);

-- Documents (insurance, ZINARA, etc)
create table if not exists public.docs (
  id uuid primary key default gen_random_uuid(),
  car_id uuid references public.cars(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  type text not null,
  expiry date not null,
  notes text default '',
  created_at timestamptz default now()
);

-- ============================================================
-- Row Level Security — users only see their own data
-- ============================================================
alter table public.profiles enable row level security;
alter table public.cars enable row level security;
alter table public.weeks enable row level security;
alter table public.costs enable row level security;
alter table public.docs enable row level security;

-- Profiles
create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);

-- Cars
create policy "Users manage own cars" on public.cars for all using (auth.uid() = user_id);

-- Weeks
create policy "Users manage own weeks" on public.weeks for all using (auth.uid() = user_id);

-- Costs
create policy "Users manage own costs" on public.costs for all using (auth.uid() = user_id);

-- Docs
create policy "Users manage own docs" on public.docs for all using (auth.uid() = user_id);

-- ============================================================
-- Auto-create profile on first Google login
-- ============================================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
