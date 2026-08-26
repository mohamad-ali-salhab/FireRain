import { AA, AA_MAX_PER_TYPE, BUILDINGS, MATCH, MISSILES, WORLD, type BotProfile } from '../core/config';
import type { MetaSave, QueuedShot } from '../core/types';
import {
  aaCost,
  buildingLimit,
  buyAaRadius,
  buyAaReload,
  buyAmmo,
  buyBattery,
  buyBuilding,
  buyMissileUpgrade,
  difficultyProfile,
  inPeace,
  nextUid,
  type Match,
} from './state';

/** Tiers the bot has actually seen the player launch, so it can counter them. */
const seenTiers = new WeakMap<Match, Set<number>>();

export function noteIncomingTier(match: Match, tier: number): void {
  let s = seenTiers.get(match);
  if (!s) {
    s = new Set();
    seenTiers.set(match, s);
  }
  s.add(tier);
}

export function updateBot(match: Match, dt: number, meta: MetaSave): void {
  const p = difficultyProfile(match);
  match.botThinkAcc += dt;
  match.botSalvoAcc += dt;
  if (match.botThinkAcc < p.thinkInterval) return;
  match.botThinkAcc = 0;

  economy(match, p);
  defence(match, p, meta);
  offence(match, p, meta);
}

// ---------------------------------------------------------------------------

function economy(match: Match, p: BotProfile): void {
  const bot = match.enemy;
  // Keep a war chest once the peace is nearly over.
  const peaceLeft = MATCH.peaceSeconds - match.time;
  // Never starve the economy: at most half the purse is held back for war.
  const reserveShare = peaceLeft > 45 ? 0 : Math.min(0.55, p.defenceBudget + p.offenceBudget * 0.5);
  let spendable = bot.money * (1 - reserveShare);

  // Greedy: repeatedly take the affordable building with the best income per dollar,
  // with a mild bias towards the biggest thing it can afford.
  for (let guard = 0; guard < 12; guard++) {
    let bestType = -1;
    let bestScore = -Infinity;
    for (let t = 0; t < BUILDINGS.length; t++) {
      const def = BUILDINGS[t];
      if (def.cost > spendable) continue;
      if (bot.builtCount[t] >= buildingLimit(match, t)) continue;
      const score = (def.income / def.cost) * (1 + t * 0.06);
      if (score > bestScore) {
        bestScore = score;
        bestType = t;
      }
    }
    if (bestType < 0) break;
    if (!buyBuilding(match, bot, bestType)) break;
    spendable -= BUILDINGS[bestType].cost;
  }
}

function defence(match: Match, p: BotProfile, meta: MetaSave): void {
  const bot = match.enemy;
  let budget = bot.money * p.defenceBudget;

  // The two free systems are always worth taking.
  for (const type of [0, 1]) {
    while (bot.aaOwned[type] < AA_MAX_PER_TYPE && aaCost(bot, type) === 0) {
      if (!buyBattery(bot, type)) break;
    }
  }

  const threat = seenTiers.get(match) ?? new Set<number>();
  // Priority order: counter what has actually been fired, then climb the tiers.
  const order = [1, 2, 3, 4, 5].sort((a, b) => {
    const ta = threat.has(a) ? 1 : 0;
    const tb = threat.has(b) ? 1 : 0;
    if (ta !== tb) return tb - ta;
    return a - b;
  });

  for (const tier of order) {
    const type = tier; // AA index N intercepts tier N
    if (bot.aaOwned[type] === 0 || (threat.has(tier) && bot.aaOwned[type] < AA_MAX_PER_TYPE)) {
      const cost = aaCost(bot, type);
      if (isFinite(cost) && cost <= budget) {
        if (buyBattery(bot, type)) budget -= cost;
      }
    }
    // Stock interceptors for whatever is already deployed.
    if (bot.aaOwned[type] > 0) {
      const want = p.ammoTarget * bot.aaOwned[type] * (threat.has(tier) ? 1.5 : 0.6);
      const missing = Math.ceil(want - bot.ammo[type]);
      if (missing > 0) {
        const affordable = Math.floor(budget / AA[type].ammoCost);
        const n = Math.min(missing, affordable);
        if (n > 0) budget -= buyAmmo(bot, type, n) * AA[type].ammoCost;
      }
    }
  }

  // Spare defence cash goes into radius and reload.
  if (p.defenceBudget > 0.3) {
    for (const type of [0, 1, 2, 3, 4, 5]) {
      if (bot.aaOwned[type] === 0) continue;
      if (bot.aaRadiusPrice[type] <= budget && Math.random() < 0.5) {
        if (buyAaRadius(bot, type)) budget -= bot.aaRadiusPrice[type];
      }
      if (type > 0 && bot.aaReloadPrice[type] <= budget && Math.random() < 0.4) {
        if (buyAaReload(bot, type, meta)) budget -= bot.aaReloadPrice[type];
      }
    }
  }
}

function offence(match: Match, p: BotProfile, meta: MetaSave): void {
  const bot = match.enemy;
  if (inPeace(match)) return;
  if (match.time < MATCH.peaceSeconds + p.firstStrikeDelay) return;

  let budget = bot.money * p.offenceBudget;

  // Climb the tier ladder when it can comfortably afford it.
  for (let tier = 2; tier <= p.maxTier; tier++) {
    const def = MISSILES[tier - 1];
    if (bot.missileUnlocked[tier - 1]) continue;
    if (def.unlockCost <= budget * 0.8) {
      if (buyMissileUpgrade(bot, tier, meta) === 'unlock') budget -= def.unlockCost;
    }
    break; // only ever unlock one step at a time
  }

  // Occasionally shave reload on its best unlocked tier.
  if (Math.random() < 0.35) {
    const best = bestTier(bot, p);
    if (best > 0 && bot.missileReloadPrice[best - 1] <= budget * 0.4) {
      if (buyMissileUpgrade(bot, best, meta) === 'reload') budget -= bot.missileReloadPrice[best - 1];
    }
  }

  // Salvo pacing: fire in bursts rather than a constant dribble.
  const salvoGap = Math.max(3, 14 - p.salvoMax * 1.4);
  if (match.botSalvoAcc < salvoGap) return;
  if (bot.pending.length > p.salvoMax * 2) return;
  match.botSalvoAcc = 0;

  const tier = chooseAttackTier(match, p, budget);
  if (tier === 0) return;
  const def = MISSILES[tier - 1];
  const count = Math.min(
    p.salvoMin + Math.floor(Math.random() * (p.salvoMax - p.salvoMin + 1)),
    Math.floor(budget / def.cost),
  );
  for (let i = 0; i < count; i++) {
    if (bot.money < def.cost) break;
    if (def.perMatchLimit > 0 && bot.shotsUsed[tier - 1] + bot.pending.filter((q) => q.tier === tier).length >= def.perMatchLimit) break;
    bot.money -= def.cost;
    bot.stats.spent += def.cost;
    const shot: QueuedShot = { uid: nextUid(), tier, x: chooseTarget(match, p), cost: def.cost };
    bot.pending.push(shot);
  }
}

function bestTier(state: Match['enemy'], p: BotProfile): number {
  for (let tier = Math.min(p.maxTier, MISSILES.length); tier >= 1; tier--) {
    if (state.missileUnlocked[tier - 1]) return tier;
  }
  return 0;
}

function chooseAttackTier(match: Match, p: BotProfile, budget: number): number {
  const bot = match.enemy;
  const player = match.player;
  const options: { tier: number; score: number }[] = [];
  for (let tier = 1; tier <= Math.min(p.maxTier, MISSILES.length); tier++) {
    const def = MISSILES[tier - 1];
    if (!bot.missileUnlocked[tier - 1]) continue;
    if (def.cost > budget) continue;
    if (def.perMatchLimit > 0 && bot.shotsUsed[tier - 1] >= def.perMatchLimit) continue;
    // Damage per dollar, boosted when the player has no way to stop this tier.
    let score = def.damage / def.cost;
    const defended = player.aaOwned[tier] > 0 && player.ammo[tier] > 0;
    if (!defended && !def.unstoppable) score *= 1 + p.smartTargeting * 1.6;
    if (def.unstoppable) score *= 1.4;
    score *= 0.8 + Math.random() * 0.4;
    options.push({ tier, score });
  }
  if (!options.length) return 0;
  options.sort((a, b) => b.score - a.score);
  // Weaker bots do not always take the best option.
  const idx = Math.random() < p.smartTargeting ? 0 : Math.floor(Math.random() * options.length);
  return options[idx].tier;
}

function chooseTarget(match: Match, p: BotProfile): number {
  const player = match.player;
  const alive = player.buildings.filter((b) => !b.destroyed);
  const zone = WORLD.cityRight;
  let x: number;
  if (alive.length && Math.random() < p.smartTargeting) {
    // Aim at the densest, most valuable pocket of the skyline.
    let best = alive[0];
    let bestScore = -Infinity;
    for (const b of alive) {
      let score = BUILDINGS[b.type].cost;
      for (const o of alive) {
        if (o === b) continue;
        const d = Math.abs(o.x - b.x);
        if (d < 70) score += BUILDINGS[o.type].cost * (1 - d / 70) * 0.7;
      }
      if (score > bestScore) {
        bestScore = score;
        best = b;
      }
    }
    x = best.x;
  } else if (alive.length) {
    x = alive[Math.floor(Math.random() * alive.length)].x;
  } else {
    x = zone.x0 + Math.random() * (zone.x1 - zone.x0);
  }
  x += (Math.random() - 0.5) * 2 * p.aimError;
  return Math.max(zone.x0 - 60, Math.min(zone.x1 + 60, x));
}
