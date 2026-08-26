/**
 * Headless match simulator — runs full matches at wall-clock-free speed so the
 * balance can be checked without sitting through 15 minutes of play.
 *
 *   npm run sim            # one match per difficulty
 *   npm run sim -- 5       # 5 matches per difficulty
 */

import { AA, BUILDINGS, MATCH, MISSILES, type Difficulty } from '../src/core/config';
import { defaultMeta } from '../src/core/storage';
import type { SideState } from '../src/core/types';
import { stepMatch } from '../src/game/engine';
import {
  aaCost,
  buildingLimit,
  buyAmmo,
  buyBattery,
  buyBuilding,
  buyMissileUpgrade,
  cityValue,
  createMatch,
  inPeace,
  nextUid,
  type Match,
} from '../src/game/state';

const DT = 1 / 30;

/** A reasonable human-ish player: economy first, then defence, then offence. */
function playPlayer(match: Match, meta: ReturnType<typeof defaultMeta>, acc: { think: number; salvo: number }): void {
  acc.think += DT;
  acc.salvo += DT;
  if (acc.think < 1.5) return;
  acc.think = 0;
  const me: SideState = match.player;

  // Economy: buy the best affordable building under its cap.
  let budget = me.money * (inPeace(match) ? 1 : 0.45);
  for (let guard = 0; guard < 10; guard++) {
    let best = -1;
    let score = -Infinity;
    for (let t = 0; t < BUILDINGS.length; t++) {
      const d = BUILDINGS[t];
      if (d.cost > budget) continue;
      if (me.builtCount[t] >= buildingLimit(match, t)) continue;
      const sc = (d.income / d.cost) * (1 + t * 0.05);
      if (sc > score) {
        score = sc;
        best = t;
      }
    }
    if (best < 0) break;
    if (!buyBuilding(match, me, best)) break;
    budget -= BUILDINGS[best].cost;
  }

  // Defence: free systems, then climb, then keep magazines loaded.
  for (const type of [0, 1]) {
    while (aaCost(me, type) === 0 && me.aaOwned[type] < 2) if (!buyBattery(me, type)) break;
  }
  let def = me.money * 0.4;
  for (let type = 1; type <= 5; type++) {
    while (me.aaOwned[type] < 2 && aaCost(me, type) <= def) {
      const price = aaCost(me, type);
      if (!buyBattery(me, type)) break;
      def -= price;
    }
    if (me.aaOwned[type] > 0 && me.ammo[type] < 12) {
      const n = Math.min(12 - me.ammo[type], Math.floor(def / AA[type].ammoCost));
      if (n > 0) def -= buyAmmo(me, type, n) * AA[type].ammoCost;
    }
  }

  if (inPeace(match)) return;

  // Offence: unlock upward, then fire salvos at their densest block.
  let off = me.money * 0.5;
  for (let tier = 2; tier <= MISSILES.length; tier++) {
    if (me.missileUnlocked[tier - 1]) continue;
    if (MISSILES[tier - 1].unlockCost <= off * 0.8) buyMissileUpgrade(me, tier, meta);
    break;
  }
  if (acc.salvo < 8) return;
  acc.salvo = 0;
  const alive = match.enemy.buildings.filter((b) => !b.destroyed);
  // Fire every unlocked tier in parallel: each has its own launcher, so a mixed
  // salvo forces the defender to have all five batteries loaded at once.
  for (let tier = MISSILES.length; tier >= 1; tier--) {
    const d = MISSILES[tier - 1];
    if (!me.missileUnlocked[tier - 1]) continue;
    if (d.perMatchLimit > 0 && me.shotsUsed[tier - 1] > 0) continue;
    const n = Math.min(2, Math.floor((off * 0.35) / d.cost));
    for (let i = 0; i < n; i++) {
      if (me.money < d.cost) break;
      me.money -= d.cost;
      me.stats.spent += d.cost;
      off -= d.cost;
      const target = alive.length ? alive[Math.floor(Math.random() * alive.length)].x : 600;
      me.pending.push({ uid: nextUid(), tier, x: target + (Math.random() - 0.5) * 40, cost: d.cost });
    }
  }
}

function runOne(difficulty: Difficulty): Record<string, string | number> {
  const meta = defaultMeta();
  const match = createMatch(difficulty, MATCH.durationSeconds);
  const acc = { think: 0, salvo: 0 };
  let steps = 0;
  const maxSteps = Math.ceil((MATCH.durationSeconds + 5) / DT);
  while (match.phase === 'playing' && steps < maxSteps) {
    playPlayer(match, meta, acc);
    stepMatch(match, DT, meta);
    steps++;
  }
  const r = match.result;
  const p = match.player.stats;
  const e = match.enemy.stats;
  return {
    difficulty,
    result: r ? (r.won ? 'WIN' : 'LOSS') : 'TIMEOUT',
    reason: r?.reason ?? '-',
    at: `${Math.floor(match.time / 60)}m${String(Math.floor(match.time % 60)).padStart(2, '0')}s`,
    you: Math.round(cityValue(match.player)),
    them: Math.round(cityValue(match.enemy)),
    'your shots': p.launched,
    'their shots': e.launched,
    'you shot down': p.intercepted,
    'they shot down': e.intercepted,
    'you lost': p.destroyedBuildings,
    'they lost': e.destroyedBuildings,
    stars: r?.stars ?? 0,
  };
}

const runs = Number(process.argv[2] ?? 1);
const rows: Record<string, string | number>[] = [];
for (const d of ['easy', 'medium', 'hard'] as Difficulty[]) {
  for (let i = 0; i < runs; i++) rows.push(runOne(d));
}
console.table(rows);

const summary = (['easy', 'medium', 'hard'] as Difficulty[]).map((d) => {
  const r = rows.filter((x) => x.difficulty === d);
  const wins = r.filter((x) => x.result === 'WIN').length;
  return { difficulty: d, matches: r.length, 'player win rate': `${Math.round((wins / r.length) * 100)}%` };
});
console.table(summary);
