create table if not exists public.free_ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default current_date,
  count integer not null default 0 check (count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);

alter table public.free_ai_usage enable row level security;

create policy "Users can read their own free AI usage"
  on public.free_ai_usage
  for select
  using (auth.uid() = user_id);

create index if not exists idx_free_ai_usage_usage_date
  on public.free_ai_usage (usage_date);

create or replace function public.increment_free_ai_usage(
  p_user_id uuid,
  p_usage_date date default current_date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_count integer;
begin
  insert into public.free_ai_usage (user_id, usage_date, count)
  values (p_user_id, p_usage_date, 1)
  on conflict (user_id, usage_date)
  do update set
    count = public.free_ai_usage.count + 1,
    updated_at = now()
  returning count into next_count;

  return next_count;
end;
$$;

revoke all on function public.increment_free_ai_usage(uuid, date) from public;
grant execute on function public.increment_free_ai_usage(uuid, date) to service_role;
