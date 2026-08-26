# Rain of Fire

A browser clone of the mobile missile-vs-city strategy game: build an economy, screen
it with layered anti-air, and level the other side's skyline before the clock runs out.

Plain TypeScript + Canvas on Vite. No game engine, no image or audio assets — every
building, turret, missile and explosion is drawn procedurally and every sound is
synthesised with the WebAudio API, so the whole game ships as one ~25 kB gzipped bundle.

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
| end of clock | Whoever holds the larger city by build value wins. A side with no buildings and no money to rebuild loses early. |

Win or lose you earn **stars**, which buy permanent upgrades in the main-menu Star Shop.

## The five systems

**Buildings** — nine tiers, `$2`–`$60`. Bigger ones pay more per tick and take far more
punishment, but each type has a cap. Small blocks go up at the front of your city, towers
towards the rear, which matters because rear buildings are the hardest to defend.

**Anti-air** — a radar plus five interceptor tiers, max two of each.
A tier `N` battery **only** stops a tier `N` missile, so a mixed salvo forces you to have
all five loaded at once. Each type has its own colour, its own radius ring, and its own
reload. The radar does not shoot: it buys early warning, showing impact markers seconds
sooner and tracking missiles that are off the top of the screen.

**ABM rounds** — the ammunition. A battery with an empty magazine is scenery. Buy in
×1 / ×5 / ×10 batches.

**In-match upgrades** — paid in cash, reset at the end of the match, priced up 35 % on
every purchase:
- top row: anti-air **radius**
- middle row: anti-air **reload**
- bottom row: **unlock** the next missile tier, then shave its launch reload

**Missiles** — six tiers. Each has its own launcher, so tiers reload in parallel: pin
five tier-I targets on a 5 s reload and one leaves the pad every five seconds. Tier VI
is a limited, uninterceptable heavy shell — one per match.

To attack: open **ICBM**, pick a tier, tap their city to pin each target (the cash comes
out as you pin, and **Clear Pins** refunds it), then press **Fight**.

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
| `Esc` | Close panel / pause |

`__rof.speed = 8` in the browser console fast-forwards the clock — handy for checking the
7-minute cap steps and the day/night cycle without waiting them out.

## Layout

```
src/core/    config.ts   all balance numbers live here — costs, HP, damage, radii, bot profiles
             audio.ts    synthesised sound
             storage.ts  star/meta persistence in localStorage
src/game/    state.ts    match state, purchases, targeting queue
             combat.ts   ballistics, interception, damage, particles
             bot.ts      easy / medium / hard opponents
             engine.ts   the tick: income, launch queues, win conditions
src/render/  camera.ts   pan/zoom and world↔screen transforms
             scene.ts    everything drawn on the canvas
src/ui/      icons.ts    procedural SVG icons
             game-ui.ts  HUD, dock panels, overlays
tools/sim.ts             headless balance harness
```

Tuning the game means editing `src/core/config.ts` and re-running `npm run sim`.

## Balance snapshot

Against the scripted player in `tools/sim.ts`, 12–20 matches per batch, 15-minute matches:

| Difficulty | Player win rate |
| --- | --- |
| Easy | 100 % every batch |
| Medium | 25–60 % across batches |
| Hard | 20–45 % across batches |

Two caveats worth knowing before you re-tune:

- **Variance is high and medium/hard overlap.** Outcomes are close to bimodal because a
  player who banks cash through the ceasefire, unlocks several tiers at once and unloads
  the moment it lifts can wipe a city inside a minute — while the same opening that misses
  leaves them behind for the rest of the match. Run at least 20 matches before reading
  anything into a change, and expect medium to beat hard in some batches.
- The scripted player fires perfect mixed salvos with no UI overhead, so it is an upper
  bound on human play. Expect each difficulty to feel a step harder in the hand.

## Deploying to Netlify

`netlify.toml` is already set up (`npm run build` → `dist`, SPA redirect, Node 22):

```bash
npx netlify-cli deploy --prod      # after `netlify login` and `netlify link`
```

Or point Netlify at the repo and it will pick the config up on its own.

## Not built yet

- Multiplayer — the bots are stand-ins for real opponents.
- Destructible anti-air batteries: right now a missile only damages buildings.
- Per-launcher ammunition: rounds are a per-type pool shared by both batteries of a tier.
- Taming the ceasefire-rush variance described above.

Portrait phones work but are cramped — the game is laid out for landscape, and says so
with a chip in the status bar.
