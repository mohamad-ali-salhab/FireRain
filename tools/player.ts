/** The scripted stand-in for a competent human, shared by sim.ts and probe.ts. */
import { AA, BUILDINGS, MISSILES } from '../src/core/config';
import type { defaultMeta } from '../src/core/storage';
import type { SideState } from '../src/core/types';
import {
  aaCost,
  buildingLimit,
  buyAmmo,
  buyBattery,
  buyBuilding,
  buyMissileUpgrade,
  countBuildings,
  inPeace,
  nextUid,
  type Match,
} from '../src/game/state';

export function playPlayer(
  match: Match,
  meta: ReturnType<typeof defaultMeta>,
  acc: { think: number; salvo: number },
  dt: number,
): void {
  acc.think += dt;
  acc.salvo += dt;
  if (acc.think < 1.5) return;
  acc.think = 0;
  const me: SideState = match.player;

  let budget = me.money * (inPeace(match) ? 1 : 0.45);
  for (let guard = 0; guard < 10; guard++) {
    let best = -1;
    let score = -Infinity;
    for (let t = 0; t < BUILDINGS.length; t++) {
      const d = BUILDINGS[t];
      if (d.cost > budget) continue;
      if (countBuildings(me, t) >= buildingLimit(match, t)) continue;
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

  let off = me.money * 0.5;
  for (let tier = 2; tier <= MISSILES.length; tier++) {
    if (me.missileUnlocked[tier - 1]) continue;
    if (MISSILES[tier - 1].unlockCost <= off * 0.8) buyMissileUpgrade(me, tier, meta);
    break;
  }
  if (acc.salvo < 8) return;
  acc.salvo = 0;
  const alive = match.enemy.buildings.filter((b) => !b.destroyed);
  for (let tier = MISSILES.length; tier >= 1; tier--) {
    const d = MISSILES[tier - 1];
    if (!me.missileUnlocked[tier - 1]) continue;
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
