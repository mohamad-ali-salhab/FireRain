-- The game only reads its own profile; opponent display names come from the
-- authenticated matchmaking RPC. Keep other accounts' progression private.
alter policy profiles_read_authenticated on public.profiles
  using ((select auth.uid()) = user_id);

-- Foreign-key lookups used when accounts or matches are removed.
create index if not exists matches_winner_id_idx on public.matches (winner_id);
create index if not exists match_events_player_id_idx on public.match_events (player_id);
create index if not exists match_results_user_id_idx on public.match_results (user_id);

-- These functions are called by triggers, never directly by browser clients.
revoke all on function private.handle_new_user() from public, anon, authenticated;
revoke all on function private.set_updated_at() from public, anon, authenticated;

-- New Supabase projects can omit graphql_public. Only expose schemas that
-- exist, retaining the configured schemas and adding the game's RPC schema.
do $$
declare
  configured text;
  exposed text;
begin
  select substr(setting, length('pgrst.db_schemas=') + 1) into configured
  from pg_roles r, unnest(r.rolconfig) setting
  where r.rolname = 'authenticator' and setting like 'pgrst.db_schemas=%';

  select string_agg(quote_ident(nspname), ',' order by nspname) into exposed
  from pg_namespace
  where nspname = 'api'
    or nspname = any(regexp_split_to_array(coalesce(configured, 'public,graphql_public'), '\s*,\s*'));

  execute format('alter role authenticator set pgrst.db_schemas = %L', exposed);
end;
$$;
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
