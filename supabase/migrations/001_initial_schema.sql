-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- Profiles (extends Supabase auth.users)
create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  username text unique,
  display_name text,
  avatar_url text,
  primary_player_tag text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Enable RLS
alter table public.profiles enable row level security;
create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);
create policy "Users can insert own profile" on public.profiles for insert with check (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', 'Player'),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Tracked Players (saved player tags)
create table public.tracked_players (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  player_tag text not null,
  player_name text,
  is_primary boolean default false,
  nickname text,
  added_at timestamptz default now(),
  last_synced_at timestamptz,
  unique(user_id, player_tag)
);

alter table public.tracked_players enable row level security;
create policy "Users can manage own tracked players" on public.tracked_players for all using (auth.uid() = user_id);

-- Player Snapshots (daily stat snapshots for trend graphs)
create table public.player_snapshots (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  player_tag text not null,
  snapshot_date date not null default current_date,
  trophies integer,
  best_trophies integer,
  wins integer,
  losses integer,
  battle_count integer,
  three_crown_wins integer,
  challenge_max_wins integer,
  challenge_cards_won integer,
  war_day_wins integer,
  clan_war_trophies integer,
  donations integer,
  donations_received integer,
  total_donations integer,
  cards_found integer,
  arena_name text,
  exp_level integer,
  star_points integer,
  unique(user_id, player_tag, snapshot_date)
);

alter table public.player_snapshots enable row level security;
create policy "Users can manage own snapshots" on public.player_snapshots for all using (auth.uid() = user_id);

-- Create index for efficient time-series queries
create index idx_snapshots_tag_date on public.player_snapshots(player_tag, snapshot_date desc);

-- Battles (persisted battle history beyond 25-game API limit)
create table public.battles (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  player_tag text not null,
  battle_time timestamptz not null,
  battle_type text not null,
  game_mode text,
  arena_name text,
  result text not null check (result in ('victory', 'defeat', 'draw')),
  crowns_earned integer default 0,
  crowns_lost integer default 0,
  trophy_change integer default 0,
  starting_trophies integer,
  opponent_tag text,
  opponent_name text,
  opponent_starting_trophies integer,
  deck jsonb not null default '[]',
  opponent_deck jsonb not null default '[]',
  unique(user_id, player_tag, battle_time)
);

alter table public.battles enable row level security;
create policy "Users can manage own battles" on public.battles for all using (auth.uid() = user_id);

create index idx_battles_tag_time on public.battles(player_tag, battle_time desc);
create index idx_battles_user_time on public.battles(user_id, battle_time desc);

-- Favorite Decks
create table public.favorite_decks (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  name text,
  cards jsonb not null,
  avg_elixir_cost numeric(3,1),
  source text default 'manual' check (source in ('manual', 'battle', 'pro_copy')),
  notes text,
  created_at timestamptz default now()
);

alter table public.favorite_decks enable row level security;
create policy "Users can manage own decks" on public.favorite_decks for all using (auth.uid() = user_id);

-- Deck Stats (aggregated win/loss per deck)
create table public.deck_stats (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  player_tag text not null,
  deck_hash text not null,
  cards jsonb not null,
  game_mode text default 'all',
  wins integer default 0,
  losses integer default 0,
  draws integer default 0,
  total_crowns integer default 0,
  total_trophy_change integer default 0,
  last_used_at timestamptz,
  unique(user_id, player_tag, deck_hash, game_mode)
);

alter table public.deck_stats enable row level security;
create policy "Users can manage own deck stats" on public.deck_stats for all using (auth.uid() = user_id);

create index idx_deck_stats_hash on public.deck_stats(deck_hash);

-- Analysis History (saved AI coaching sessions)
create table public.analysis_history (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  player_tag text not null,
  analysis_type text not null check (analysis_type in ('quick_stats', 'deck_tips', 'battle_summary', 'deep_analysis')),
  prompt text,
  result text not null,
  model text,
  created_at timestamptz default now()
);

alter table public.analysis_history enable row level security;
create policy "Users can manage own analysis" on public.analysis_history for all using (auth.uid() = user_id);

create index idx_analysis_user_time on public.analysis_history(user_id, created_at desc);

-- Updated_at trigger function
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.update_updated_at();
