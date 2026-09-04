# Final Skyline

A browser clone of the mobile missile-vs-city strategy game: build an economy, screen
it with layered anti-air, and level the other side's skyline before the clock runs out.

Plain TypeScript + Canvas on Vite. No game engine, no image or audio assets — every
building, turret, missile and explosion is drawn procedurally and every sound is
synthesised with the WebAudio API. Supabase provides optional accounts, matchmaking,
persistent progression, and the realtime command stream for online matches.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production bundle into dist/
npm run preview    # serve the production bundle
npm run sim -- 10  # headless balance runs, 10 matches per difficulty
```

## How a match plays

| Phase | What happens |
| --- | --- |
| 0:00 – 2:00 | **Ceasefire.** Nobody can launch. Build economy and air defence. You can already pin targets. |
| every 7 min | Every building cap rises by **+1**, up to four times. (Short matches scale this down so a 5-minute game still gets steps.) |
| every 2 s | Every standing building pays its income. |
| lose everything | With no building standing you have **6 seconds** to put one back up. Fail and you lose. |
| end of clock | In a timed match, whoever destroyed the most enemy build value wins. **Unlimited** matches have no clock — they run until one city is levelled. |

Cities rebuild, so a timed match is scored on damage done rather than the snapshot
at the whistle: both sides usually sit at their build cap by the end.

Win or lose you earn **stars**, which buy permanent upgrades in the main-menu Star Shop.

## The five systems

**Buildings** — nine tiers, `$2`–`$60`. Bigger ones pay more per tick and take far more
punishment, but each type has a cap. Pick a building and **tap its plot yourself**;
short types take the front row and tall ones the back purely so the skyline never
hides itself. A levelled building frees its plot and its slot in the cap, so you can
always rebuild — and rebuilding under fire is the main drain on a losing side's economy.

**Anti-air** — a radar plus five interceptor tiers, max two of each.
A tier `N` battery **only** stops a tier `N` missile, so a mixed salvo forces you to have
all five loaded at once. Each type has its own colour, its own radius ring, and its own
reload. The radar does not shoot: it buys early warning, showing impact markers seconds
sooner and tracking missiles that are off the top of the screen.

You **site each battery yourself**: pick a system, then tap anywhere on your own land. A
dashed ghost shows its coverage before you commit, and turns red where you cannot build
(off your land, or too close to another battery). Batteries are destructible — a direct
hit wrecks one and frees its slot, so suppressing the air defence before a big salvo is a
real tactic, and replacing what you lose is a real cost.

**ABM rounds** — the ammunition. A battery with an empty magazine is scenery. Buy in
×1 / ×5 / ×10 batches.

**In-match upgrades** — paid in cash, reset at the end of the match, priced up 16 % on
every purchase and capped at 8× the opening price so a long match never prices them out
of reach:
- top row: anti-air **radius**
- middle row: anti-air **reload**
- bottom row: **unlock** the next missile tier, then shave its launch reload

**Missiles** — six tiers. Each has its own launcher, so tiers reload in parallel: pin
five tier-I targets on a 5 s reload and one leaves the pad every five seconds. Firing a
mixed salvo across every tier at once is the strongest play, because the defender can
only reload one battery per tier at a time.

Speed climbs steeply with tier — 255 m/s at tier I against 900 m/s at tier V — so the
top of the ladder gives the defence far less time to solve an intercept. Tier VI is the
**Bunker Buster**: $80 a shot, 1500 damage, and nothing can intercept it, but its
launcher takes 40 seconds to reload.

To attack: open **ICBM**, pick a tier, tap their city to pin each target (the cash comes
out as you pin, and **Clear Pins** refunds it), then press **Fight**.

## Hitting the city

A warhead detonates on the first thing its flight path meets, which is usually the
flank of a tower rather than the street behind it. Each frame the missile's movement is
swept against the defender's standing buildings, so a tall block in the front row
genuinely shields what is behind it — aiming past a skyline is a real problem now.

A building that takes a hit loses its upper floors: the silhouette is shortened, the
break is drawn as jagged concrete with bent rebar, the top floors go dark, and it keeps
putting out a smoke plume that thickens as the damage does. **Income is unaffected** —
a half-wrecked tower pays exactly what an intact one does, right up until it is
destroyed. Only the plot going empty costs you anything.

Because the silhouette shrinks with damage, a battered tower stops shielding its
neighbours, so a second salvo into the same block reaches further than the first.
A burst high up a tower also barely troubles the anti-air at street level.

## Why missiles get through

Interception is physical, not a dice roll. A battery solves for where the incoming
warhead will be, and takes the shot only if an interceptor can reach that point *while
it is still high enough* — the intercept must complete above `MIN_INTERCEPT_ALTITUDE`
and before the warhead is 94 % of the way down. So coverage geometry decides everything:
targets at the thinly covered rear of a city, and the fast high tiers, leak through even
against a fully stocked defence. That is the pressure the whole economy sits on.

## Controls

| | |
| --- | --- |
| Drag / swipe | Pan the battlefield |
| Wheel, or the ⊕ button | Zoom between city view and the whole battlefield |
| Tap in ICBM mode | Pin a target |
| `1`–`6` | Select missile tier |
| `Space` | Fight |
| `Z` | Un-pin the last target |
| `Esc` | Cancel placement / close panel / pause |

In the browser console, `__finalSkyline.speed = 8` fast-forwards the clock (handy for the
7-minute cap steps and the day/night cycle), `__finalSkyline.debugState()` dumps the live match,
and `__finalSkyline.damageEnemy(0.3)` batters the other city so the damage rendering can be
inspected without waiting for a bombardment.

## Layout

```
src/core/    config.ts   all balance numbers live here — costs, HP, damage, radii, bot profiles
             audio.ts    synthesised sound
             storage.ts  star/meta persistence in localStorage
src/game/    state.ts    match state, purchases, targeting queue
             combat.ts   ballistics, interception, damage, particles
             bot.ts      easy / medium / hard opponents
             engine.ts   the tick: income, launch queues, win conditions
src/online/  service.ts  Supabase auth, profiles, queue, event subscription
             actions.ts  validated and mirrored online game commands
src/render/  camera.ts   pan/zoom and world↔screen transforms
             scene.ts    everything drawn on the canvas
src/ui/      icons.ts    procedural SVG icons
             game-ui.ts  HUD, dock panels, overlays
tools/player.ts          the scripted stand-in for a competent human
tools/sim.ts             headless balance harness (win rates)
tools/probe.ts           one instrumented match, sampled every 30 s
tools/online-sim.ts      mirror/validation check for online commands
```

Tuning the game means editing `src/core/config.ts` and re-running `npm run sim`.

## Online play

Accounts use Supabase email/password authentication. A profile row tied to the Auth user
stores the public username, wins, losses, stars, and permanent upgrade levels. Queueing
matches players who choose the same 5-, 10-, or 15-minute duration. During a match each
browser simulates its own right-side city while authenticated realtime commands are
mirrored onto the opponent's left side. Online games use an equal base loadout; Star Shop
bonuses remain part of solo progression.

To run online features locally:

```bash
cp .env.example .env.local
npx supabase start
npx supabase db reset
npm run dev
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in Vercel for Production,
Preview, and Development. These are browser-safe project identifiers; never expose the
secret or service-role key. Without them the full bot game still works and the online
card clearly reports that its backend is not connected.

The migration in `supabase/migrations/` creates the account profile, queue, matches,
results, RLS policies, RPC functions, and Realtime publication. It also exposes the
locked-down `api` schema to PostgREST; only the explicitly granted matchmaking/result
functions are callable by authenticated players.

## Balance snapshot

Against the scripted player in `tools/sim.ts`, 10 recent 15-minute matches per level:

| Difficulty | Player win rate |
| --- | --- |
| Easy | 100 % every batch |
| Medium | 80 % |
| Hard | 30 % |

Caveats before you re-tune:

- **The scripted player is an upper bound, not an average human.** It saturates every
  launcher continuously and never fumbles a menu, so all three difficulties play harder
  in the hand than these numbers suggest.
- **Variance is high and medium/hard overlap.** Run at least 20 matches before reading
  anything into a change.
- `npm run probe` prints one instrumented hard match sampled every 30 s — cash, income,
  batteries, magazines, shots fired and intercepted for both sides. That is far more use
  for finding *why* a side collapses than the win-rate table.

## Deploying to Vercel

The production project deploys from `main`. Use `npm run build` with `dist` as the output
directory and Node 22. Add both public Supabase variables before enabling online play.

Pushing a commit to `main` starts a production deployment through the Git integration.

## Current limitations

- Online simulation is client-authoritative beta networking. RLS prevents one player
  from entering another match, but a future competitive/ranked mode should move economy
  and result authority to a trusted server.
- Per-launcher ammunition: rounds are a per-type pool shared by both batteries of a tier.
- Moving or selling a battery once it is sited.
- Taming the medium/hard overlap described above.

Portrait phones work but are cramped — the game is laid out for landscape, and says so
with a chip in the status bar.
