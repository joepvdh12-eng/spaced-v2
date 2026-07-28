-- Trainify v2 — B2C AI Coaching Platform
-- Run this in Supabase SQL Editor

-- 1. Athlete profiles
create table if not exists athlete_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade unique not null,
  full_name text,
  sport text not null default 'hyrox', -- hyrox | running | functional_fitness | cycling | triathlon
  goal text not null default 'race', -- race | fitness | weight_loss | strength
  level text not null default 'intermediate', -- beginner | intermediate | advanced
  weekly_days integer not null default 4, -- how many days/week available
  equipment text, -- full_gym | home_basic | bodyweight | outdoor
  injuries text[] not null default '{}', -- e.g. knee, shoulder, lower_back
  preferred_days text[] not null default '{}', -- e.g. mon, wed, fri, sat
  race_date date,
  subscription_status text not null default 'trial', -- LEGACY/UNUSED: the app's actual pricing model is paid-entry with no free trial (see README).
                                                       -- The real source of truth for billing status is the `user_subscriptions` table, kept in
                                                       -- sync by the Stripe webhook. Nothing in the app writes to this column after signup.
  subscription_id text, -- Stripe subscription ID
  trial_ends_at timestamptz default (now() + interval '14 days'), -- LEGACY/UNUSED, see subscription_status note above
  onboarded boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. Training plans (AI-generated)
create table if not exists training_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  week_number integer not null,
  phase text, -- base | build | peak | taper
  plan_json jsonb not null default '{}',
  ai_notes text,
  generated_at timestamptz default now(),
  created_at timestamptz default now()
);

-- 3. Individual workouts (derived from plan)
create table if not exists workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  plan_id uuid references training_plans(id) on delete cascade,
  scheduled_date date not null,
  type text not null, -- strength | cardio | intervals | race_sim | recovery | technique
  title text not null,
  description text,
  duration_minutes integer,
  exercises_json jsonb not null default '[]',
  completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz default now()
);

-- 4. Workout logs (when athlete marks done + adds data)
create table if not exists workout_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  workout_id uuid references workouts(id) on delete cascade not null,
  actual_duration_minutes integer,
  perceived_effort integer check (perceived_effort between 1 and 10),
  notes text,
  metrics_json jsonb default '{}', -- heart rate, pace, etc.
  logged_at timestamptz default now()
);

-- 5. AI Coach messages
create table if not exists coach_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  attachment_url text, -- path within the coach-uploads storage bucket
  attachment_type text, -- mime type
  attachment_name text, -- original filename
  created_at timestamptz default now()
);

-- 6. Athlete stats (weekly snapshots for progress charts)
create table if not exists athlete_stats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  week_start date not null,
  total_workouts integer default 0,
  completed_workouts integer default 0,
  total_minutes integer default 0,
  avg_effort numeric(3,1),
  created_at timestamptz default now(),
  unique(user_id, week_start)
);

-- 7. User subscriptions (managed by Stripe webhook)
create table if not exists user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade unique not null,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text,
  status text not null default 'inactive', -- inactive | active | past_due | canceled
  billing_interval text, -- month | year
  current_period_end timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS policies
alter table athlete_profiles enable row level security;
alter table user_subscriptions enable row level security;
alter table training_plans enable row level security;
alter table workouts enable row level security;
alter table workout_logs enable row level security;
alter table coach_messages enable row level security;
alter table athlete_stats enable row level security;

-- Each user sees only their own data
create policy "own_profile" on athlete_profiles for all using (auth.uid() = user_id);
create policy "own_plans" on training_plans for all using (auth.uid() = user_id);
create policy "own_workouts" on workouts for all using (auth.uid() = user_id);
create policy "own_logs" on workout_logs for all using (auth.uid() = user_id);
create policy "own_messages" on coach_messages for all using (auth.uid() = user_id);
create policy "own_stats" on athlete_stats for all using (auth.uid() = user_id);
-- user_subscriptions: users can read their own; only service_role can write (via webhook)
create policy "own_subscription_read" on user_subscriptions for select using (auth.uid() = user_id);

-- Updated_at trigger
create or replace function update_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger athlete_profiles_updated_at
  before update on athlete_profiles
  for each row execute function update_updated_at();

-- Storage bucket for coach chat attachments (private, per-user folders: {user_id}/{filename})
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('coach-uploads', 'coach-uploads', false, 10485760, array['image/jpeg','image/png','image/webp','image/gif','application/pdf'])
on conflict (id) do nothing;

create policy "coach_uploads_own_read" on storage.objects
  for select using (bucket_id = 'coach-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "coach_uploads_own_insert" on storage.objects
  for insert with check (bucket_id = 'coach-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "coach_uploads_own_delete" on storage.objects
  for delete using (bucket_id = 'coach-uploads' and (storage.foldername(name))[1] = auth.uid()::text);
