-- Final Skyline online accounts, persistent progression, matchmaking, and
-- realtime match commands. This migration is intended for a dedicated
-- Supabase project, not a shared database.

create schema if not exists private;
create schema if not exists api;

revoke all on schema private from public, anon, authenticated;
grant usage on schema api to authenticated;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  stars integer not null default 0 check (stars >= 0),
  radius_level smallint[] not null default array[0, 0, 0, 0, 0, 0]::smallint[],
  aa_reload_level smallint[] not null default array[0, 0, 0, 0, 0, 0]::smallint[],
  missile_reload_level smallint[] not null default array[0, 0, 0, 0, 0, 0]::smallint[],
  best_difficulty text check (best_difficulty is null or best_difficulty in ('easy', 'medium', 'hard')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_upgrade_shapes check (
    cardinality(radius_level) = 6
    and cardinality(aa_reload_level) = 6
    and cardinality(missile_reload_level) = 6
    and array_position(radius_level, null) is null
    and array_position(aa_reload_level, null) is null
    and array_position(missile_reload_level, null) is null
  ),
  constraint profile_upgrade_ranges check (
    0 <= all(radius_level) and 20 >= all(radius_level)
    and 0 <= all(aa_reload_level) and 12 >= all(aa_reload_level)
    and 0 <= all(missile_reload_level) and 12 >= all(missile_reload_level)
  )
);

create unique index profiles_username_lower_key on public.profiles (lower(username));

create table public.matchmaking_queue (
  user_id uuid primary key references auth.users(id) on delete cascade,
  duration_seconds integer not null check (duration_seconds in (300, 600, 900)),
  joined_at timestamptz not null default now()
);

create index matchmaking_queue_search_idx
  on public.matchmaking_queue (duration_seconds, joined_at);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  player_one uuid not null references auth.users(id) on delete cascade,
  player_two uuid not null references auth.users(id) on delete cascade,
  duration_seconds integer not null check (duration_seconds in (300, 600, 900)),
  status text not null default 'playing' check (status in ('playing', 'completed', 'abandoned')),
  seed bigint not null default floor(random() * 2147483647)::bigint,
  winner_id uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint matches_two_players check (player_one <> player_two),
  constraint winner_is_participant check (winner_id is null or winner_id in (player_one, player_two))
);

create index matches_player_one_status_idx on public.matches (player_one, status, started_at desc);
create index matches_player_two_status_idx on public.matches (player_two, status, started_at desc);

create table public.match_events (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches(id) on delete cascade,
  player_id uuid not null references auth.users(id) on delete cascade,
  action jsonb not null check (
    jsonb_typeof(action) = 'object'
    and action ? 'type'
    and octet_length(action::text) <= 2048
  ),
  created_at timestamptz not null default now()
);

create index match_events_match_order_idx on public.match_events (match_id, id);

create table public.match_results (
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  won boolean not null,
  stars smallint not null check (stars between 1 and 6),
  created_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested text := trim(coalesce(new.raw_user_meta_data ->> 'username', ''));
  candidate text;
begin
  if requested ~ '^[A-Za-z0-9_]{3,20}$' then
    candidate := requested;
  else
    candidate := 'pilot_' || left(replace(new.id::text, '-', ''), 8);
  end if;

  -- A duplicate requested name gets a stable short suffix instead of making
  -- email confirmation fail with an opaque database error.
  if exists (select 1 from public.profiles p where lower(p.username) = lower(candidate)) then
    candidate := left(candidate, 15) || '_' || left(replace(new.id::text, '-', ''), 4);
  end if;

  insert into public.profiles (user_id, username) values (new.id, candidate);
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

alter table public.profiles enable row level security;
alter table public.matchmaking_queue enable row level security;
alter table public.matches enable row level security;
alter table public.match_events enable row level security;
alter table public.match_results enable row level security;

create policy profiles_read_authenticated
on public.profiles for select to authenticated
using (true);

create policy profiles_update_own
on public.profiles for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy queue_read_own
on public.matchmaking_queue for select to authenticated
using ((select auth.uid()) = user_id);

create policy queue_insert_own
on public.matchmaking_queue for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy queue_update_own
on public.matchmaking_queue for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy queue_delete_own
on public.matchmaking_queue for delete to authenticated
using ((select auth.uid()) = user_id);

create policy matches_read_participants
on public.matches for select to authenticated
using ((select auth.uid()) in (player_one, player_two));

create policy match_events_read_participants
on public.match_events for select to authenticated
using (
  exists (
    select 1
    from public.matches m
    where m.id = match_events.match_id
      and (select auth.uid()) in (m.player_one, m.player_two)
  )
);

create policy match_events_insert_own
on public.match_events for insert to authenticated
with check (
  (select auth.uid()) = player_id
  and exists (
    select 1
    from public.matches m
    where m.id = match_events.match_id
      and m.status = 'playing'
      and (select auth.uid()) in (m.player_one, m.player_two)
  )
);

create policy match_results_read_participants
on public.match_results for select to authenticated
using (
  exists (
    select 1
    from public.matches m
    where m.id = match_results.match_id
      and (select auth.uid()) in (m.player_one, m.player_two)
  )
);

create or replace function api.join_queue(p_duration_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  opponent uuid;
  made public.matches%rowtype;
  opponent_name text;
begin
  if caller is null then
    raise exception 'Sign in before joining the queue';
  end if;
  if p_duration_seconds not in (300, 600, 900) then
    raise exception 'Online matches must be 5, 10, or 15 minutes';
  end if;

  -- Serialize queue joins within a duration bucket. Without this, two players
  -- arriving on the same millisecond can both miss each other and both wait.
  perform pg_catalog.pg_advisory_xact_lock(p_duration_seconds::bigint);

  delete from public.matchmaking_queue where joined_at < now() - interval '10 minutes';
  delete from public.matchmaking_queue where user_id = caller;

  select q.user_id
  into opponent
  from public.matchmaking_queue q
  where q.user_id <> caller and q.duration_seconds = p_duration_seconds
  order by q.joined_at
  for update skip locked
  limit 1;

  if opponent is null then
    insert into public.matchmaking_queue (user_id, duration_seconds)
    values (caller, p_duration_seconds);
    return null;
  end if;

  delete from public.matchmaking_queue where user_id in (caller, opponent);
  insert into public.matches (player_one, player_two, duration_seconds)
  values (opponent, caller, p_duration_seconds)
  returning * into made;

  select p.username into opponent_name from public.profiles p where p.user_id = opponent;
  return jsonb_build_object(
    'matchId', made.id,
    'durationSeconds', made.duration_seconds,
    'seed', made.seed,
    'startedAt', made.started_at,
    'opponentId', opponent,
    'opponentUsername', opponent_name
  );
end;
$$;

create or replace function api.queue_status()
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  found public.matches%rowtype;
  opponent uuid;
  opponent_name text;
begin
  if caller is null then
    raise exception 'Sign in before checking the queue';
  end if;
  if exists (select 1 from public.matchmaking_queue q where q.user_id = caller) then
    return null;
  end if;

  select m.* into found
  from public.matches m
  where caller in (m.player_one, m.player_two)
    and m.status = 'playing'
  order by m.started_at desc
  limit 1;
  if found.id is null then return null; end if;

  opponent := case when found.player_one = caller then found.player_two else found.player_one end;
  select p.username into opponent_name from public.profiles p where p.user_id = opponent;
  return jsonb_build_object(
    'matchId', found.id,
    'durationSeconds', found.duration_seconds,
    'seed', found.seed,
    'startedAt', found.started_at,
    'opponentId', opponent,
    'opponentUsername', opponent_name
  );
end;
$$;

create or replace function api.leave_queue()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.matchmaking_queue where user_id = (select auth.uid());
$$;

create or replace function api.report_match_result(
  p_match_id uuid,
  p_won boolean,
  p_stars integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  inserted_count integer;
begin
  if caller is null then raise exception 'Not signed in'; end if;
  if p_stars not between 1 and 6 then raise exception 'Invalid star award'; end if;
  if not exists (
    select 1 from public.matches m
    where m.id = p_match_id and caller in (m.player_one, m.player_two)
  ) then
    raise exception 'Match not found';
  end if;

  insert into public.match_results (match_id, user_id, won, stars)
  values (p_match_id, caller, p_won, p_stars)
  on conflict (match_id, user_id) do nothing;
  get diagnostics inserted_count = row_count;

  if inserted_count = 1 then
    update public.profiles
    set wins = wins + case when p_won then 1 else 0 end,
        losses = losses + case when p_won then 0 else 1 end,
        stars = stars + p_stars
    where user_id = caller;
  end if;

  update public.matches
  set status = 'completed',
      winner_id = case when p_won then coalesce(winner_id, caller) else winner_id end,
      completed_at = coalesce(completed_at, now())
  where id = p_match_id;
end;
$$;

revoke all on public.profiles from anon;
revoke all on public.matchmaking_queue from anon;
revoke all on public.matches from anon;
revoke all on public.match_events from anon;
revoke all on public.match_results from anon;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.matchmaking_queue to authenticated;
grant select on public.matches to authenticated;
grant select, insert on public.match_events to authenticated;
grant usage, select on sequence public.match_events_id_seq to authenticated;
grant select on public.match_results to authenticated;

revoke all on function api.join_queue(integer) from public, anon;
revoke all on function api.queue_status() from public, anon;
revoke all on function api.leave_queue() from public, anon;
revoke all on function api.report_match_result(uuid, boolean, integer) from public, anon;
grant execute on function api.join_queue(integer) to authenticated;
grant execute on function api.queue_status() to authenticated;
grant execute on function api.leave_queue() to authenticated;
grant execute on function api.report_match_result(uuid, boolean, integer) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.match_events;
exception
  when duplicate_object then null;
end;
$$;

-- PostgREST must expose the deliberately isolated api schema for RPC calls.
-- Only the four explicitly granted functions above are callable by players.
alter role authenticator set pgrst.db_schemas = 'public,graphql_public,api';
notify pgrst, 'reload config';
