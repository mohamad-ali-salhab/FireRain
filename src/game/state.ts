import {
  AA,
  AA_MAX_PER_TYPE,
  BUILDINGS,
  BOTS,
  BOT_NAMES,
  MATCH,
  META,
  MISSILES,
  WORLD,
  type Difficulty,
} from '../core/config';
import type {
  AaBattery,
  Building,
  FloatingText,
  Interceptor,
  MetaSave,
  Missile,
  Particle,
  Phase,
  QueuedShot,
  Side,
  SideState,
} from '../core/types';

let uidCounter = 1;
export const nextUid = (): number => uidCounter++;

export interface Match {
  phase: Phase;
  difficulty: Difficulty;
  /** Seconds elapsed since the match started. */
  time: number;
  duration: number;
  /** Seconds between building-cap increases, scaled to the match length. */
  limitStep: number;
  /** Accumulator for the 2-second income tick. */
  incomeAcc: number;
  player: SideState;
  enemy: SideState;
  missiles: Missile[];
  interceptors: Interceptor[];
  particles: Particle[];
  texts: FloatingText[];
  /** Screen shake magnitude, decays every frame. */
  shake: number;
  /** Bot bookkeeping. */
  botThinkAcc: number;
  botSalvoAcc: number;
  result: null | {
    won: boolean;
    stars: number;
    playerValue: number;
    enemyValue: number;
    reason: string;
  };
  /** Set once the peace-timer siren has played. */
  peaceAnnounced: boolean;
  lastLimitStep: number;
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

/** Deterministic pseudo-random in [0,1) from an integer seed. */
export function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const SLOTS_PER_LAYER = 40;

/**
 * Candidate x positions for one layer of a city, ordered from the front line
 * (facing the enemy) to the rear. `rear` runs 0 → 1 going away from the enemy.
 */
function citySlots(side: Side, layer: 0 | 1): { x: number; rear: number }[] {
  const zone = side === 'player' ? WORLD.cityRight : WORLD.cityLeft;
  const width = zone.x1 - zone.x0;
  const step = width / SLOTS_PER_LAYER;
  const offset = layer === 0 ? step * 0.5 : 0;
  const out: { x: number; rear: number }[] = [];
  for (let i = 0; i < SLOTS_PER_LAYER; i++) {
    const f = i / (SLOTS_PER_LAYER - 1);
    // Player city sits on the right, so "rear" means larger x. Mirrored for the enemy.
    const x = zone.x0 + offset + (side === 'player' ? f : 1 - f) * (width - offset);
    out.push({ x, rear: f });
  }
  return out;
}

const AA_SLOT_COUNT = 12;

function batterySlots(side: Side): number[] {
  const zone = side === 'player' ? WORLD.cityRight : WORLD.cityLeft;
  const width = zone.x1 - zone.x0;
  const out: number[] = [];
  for (let i = 0; i < AA_SLOT_COUNT; i++) {
    const f = (i + 0.5) / AA_SLOT_COUNT;
    // Batteries hug the front two thirds of the city.
    const d = f * width * 0.78;
    out.push(side === 'player' ? zone.x0 + d : zone.x1 - d);
  }
  return out;
}

function layerFor(type: number): 0 | 1 {
  return type >= 4 ? 0 : 1;
}

/** Picks the nicest free slot for a new building, keeping tall towers to the rear. */
function pickSlot(state: SideState, type: number): { x: number; layer: 0 | 1 } {
  const layer = layerFor(type);
  const slots = citySlots(state.side, layer);
  const taken = new Set(state.buildings.filter((b) => b.layer === layer).map((b) => Math.round(b.x)));
  const minType = layer === 0 ? 4 : 0;
  const maxType = layer === 0 ? 8 : 3;
  const ideal = (type - minType) / Math.max(1, maxType - minType);
  const ranked = slots
    .map((s, i) => ({
      ...s,
      score: Math.abs(s.rear - ideal) + hash01(i * 7 + type * 31 + (state.side === 'player' ? 0 : 500)) * 0.22,
    }))
    .sort((a, b) => a.score - b.score);
  for (const s of ranked) {
    if (!taken.has(Math.round(s.x))) return { x: s.x, layer };
  }
  return { x: ranked[0].x, layer };
}

function pickBatterySlot(state: SideState): number {
  const slots = batterySlots(state.side);
  const taken = new Set(state.batteries.map((b) => Math.round(b.x)));
  for (const x of slots) if (!taken.has(Math.round(x))) return x;
  return slots[slots.length - 1];
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

function makeSide(side: Side, name: string): SideState {
  return {
    side,
    name,
    money: MATCH.startingMoney,
    buildings: [],
    batteries: [],
    aaOwned: AA.map(() => 0),
    ammo: AA.map(() => 0),
    aaRadiusBonus: AA.map(() => 0),
    aaReloadBonus: AA.map(() => 0),
    aaRadiusPrice: AA.map((d) => d.radiusUpgradeCost),
    aaReloadPrice: AA.map((d) => d.reloadUpgradeCost),
    missileUnlocked: MISSILES.map((m) => m.unlockCost === 0),
    missileReloadBonus: MISSILES.map(() => 0),
    missileReloadPrice: MISSILES.map((m) => m.reloadUpgradeCost),
    launchCooldown: MISSILES.map(() => 0),
    shotsUsed: MISSILES.map(() => 0),
    builtCount: BUILDINGS.map(() => 0),
    pending: [],
    queued: [],
    wipeoutTimer: 0,
    stats: { launched: 0, intercepted: 0, hits: 0, destroyedBuildings: 0, spent: 0, earned: 0 },
  };
}

export function createMatch(difficulty: Difficulty, durationSeconds: number): Match {
  const botName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
  return {
    phase: 'playing',
    difficulty,
    time: 0,
    duration: durationSeconds,
    limitStep: MATCH.limitStepFor(durationSeconds),
    incomeAcc: 0,
    player: makeSide('player', 'You'),
    enemy: makeSide('enemy', botName),
    missiles: [],
    interceptors: [],
    particles: [],
    texts: [],
    shake: 0,
    botThinkAcc: 0,
    botSalvoAcc: 0,
    result: null,
    peaceAnnounced: false,
    lastLimitStep: 0,
  };
}

// ---------------------------------------------------------------------------
// Derived values (meta upgrades only ever apply to the human player)
// ---------------------------------------------------------------------------

export function buildingLimit(match: Match, type: number): number {
  return BUILDINGS[type].baseLimit + limitSteps(match);
}

export function limitSteps(match: Match): number {
  return Math.min(MATCH.maxLimitSteps, Math.floor(match.time / match.limitStep));
}

export function secondsToNextLimit(match: Match): number {
  const steps = Math.floor(match.time / match.limitStep);
  if (steps >= MATCH.maxLimitSteps) return Infinity;
  return (steps + 1) * match.limitStep - match.time;
}

export function aaRadius(state: SideState, type: number, meta: MetaSave): number {
  const bonus = state.side === 'player' ? meta.radiusLevel[type] * META.radiusStep : 0;
  return AA[type].baseRadius + state.aaRadiusBonus[type] + bonus;
}

export function aaReload(state: SideState, type: number, meta: MetaSave): number {
  const bonus = state.side === 'player' ? meta.aaReloadLevel[type] * META.aaReloadStep : 0;
  return Math.max(META.minReload, AA[type].baseReload - state.aaReloadBonus[type] - bonus);
}

export function missileReload(state: SideState, tier: number, meta: MetaSave): number {
  const i = tier - 1;
  const bonus = state.side === 'player' ? meta.missileReloadLevel[i] * META.missileReloadStep : 0;
  return Math.max(META.minReload, MISSILES[i].reload - state.missileReloadBonus[i] - bonus);
}

/** Sum of the build cost of every standing building — drives the health bar. */
export function cityValue(state: SideState): number {
  let v = 0;
  for (const b of state.buildings) if (!b.destroyed) v += BUILDINGS[b.type].cost;
  return v;
}

export function incomePerTick(state: SideState): number {
  let v = 0;
  for (const b of state.buildings) if (!b.destroyed) v += BUILDINGS[b.type].income;
  return v;
}

export function aaCost(state: SideState, type: number): number {
  const owned = state.aaOwned[type];
  if (owned >= AA_MAX_PER_TYPE) return Infinity;
  return AA[type].costs[Math.min(owned, AA[type].costs.length - 1)];
}

export function hasRadar(state: SideState): boolean {
  return state.aaOwned[0] > 0;
}

// ---------------------------------------------------------------------------
// Purchases — all return true when the money actually changed hands
// ---------------------------------------------------------------------------

export function buyBuilding(match: Match, state: SideState, type: number): boolean {
  const def = BUILDINGS[type];
  if (state.builtCount[type] >= buildingLimit(match, type)) return false;
  if (state.money < def.cost) return false;
  state.money -= def.cost;
  state.stats.spent += def.cost;
  state.builtCount[type]++;
  const slot = pickSlot(state, type);
  const b: Building = {
    uid: nextUid(),
    type,
    side: state.side,
    x: slot.x,
    layer: slot.layer,
    hp: def.hp,
    maxHp: def.hp,
    destroyed: false,
    collapse: 0,
    shake: 0,
    seed: Math.floor(Math.random() * 100000),
  };
  state.buildings.push(b);
  // Keep back-layer buildings first so painting order stays correct.
  state.buildings.sort((p, q) => p.layer - q.layer);
  return true;
}

export function buyBattery(state: SideState, type: number): boolean {
  const cost = aaCost(state, type);
  if (!isFinite(cost) || state.money < cost) return false;
  state.money -= cost;
  state.stats.spent += cost;
  state.aaOwned[type]++;
  const battery: AaBattery = {
    uid: nextUid(),
    type,
    side: state.side,
    x: pickBatterySlot(state),
    cooldown: 0,
    aim: state.side === 'player' ? -Math.PI * 0.72 : -Math.PI * 0.28,
    recoil: 0,
    seed: Math.floor(Math.random() * 100000),
  };
  state.batteries.push(battery);
  return true;
}

export function buyAmmo(state: SideState, type: number, count: number): number {
  const def = AA[type];
  if (def.interceptsTier === 0) return 0;
  let bought = 0;
  for (let i = 0; i < count; i++) {
    if (state.ammo[type] >= def.ammoCap) break;
    if (state.money < def.ammoCost) break;
    state.money -= def.ammoCost;
    state.stats.spent += def.ammoCost;
    state.ammo[type]++;
    bought++;
  }
  return bought;
}

export function buyAaRadius(state: SideState, type: number): boolean {
  const price = state.aaRadiusPrice[type];
  if (state.money < price) return false;
  state.money -= price;
  state.stats.spent += price;
  state.aaRadiusBonus[type] += AA[type].radiusStep;
  state.aaRadiusPrice[type] = Math.ceil(price * 1.35);
  return true;
}

export function buyAaReload(state: SideState, type: number, meta: MetaSave): boolean {
  if (AA[type].interceptsTier === 0) return false;
  if (aaReload(state, type, meta) <= META.minReload) return false;
  const price = state.aaReloadPrice[type];
  if (state.money < price) return false;
  state.money -= price;
  state.stats.spent += price;
  state.aaReloadBonus[type] += AA[type].reloadStep;
  state.aaReloadPrice[type] = Math.ceil(price * 1.35);
  return true;
}

/** Unlocks the tier if locked, otherwise buys a reload reduction. */
export function buyMissileUpgrade(state: SideState, tier: number, meta: MetaSave): 'unlock' | 'reload' | false {
  const i = tier - 1;
  const def = MISSILES[i];
  if (!state.missileUnlocked[i]) {
    if (state.money < def.unlockCost) return false;
    state.money -= def.unlockCost;
    state.stats.spent += def.unlockCost;
    state.missileUnlocked[i] = true;
    return 'unlock';
  }
  if (missileReload(state, tier, meta) <= META.minReload) return false;
  const price = state.missileReloadPrice[i];
  if (state.money < price) return false;
  state.money -= price;
  state.stats.spent += price;
  state.missileReloadBonus[i] += def.reloadStep;
  state.missileReloadPrice[i] = Math.ceil(price * 1.35);
  return 'reload';
}

// ---------------------------------------------------------------------------
// Targeting queue
// ---------------------------------------------------------------------------

export function shotsRemaining(state: SideState, tier: number): number {
  const def = MISSILES[tier - 1];
  if (def.perMatchLimit === 0) return Infinity;
  const committed = state.queued.filter((q) => q.tier === tier).length + state.pending.filter((q) => q.tier === tier).length;
  return def.perMatchLimit - state.shotsUsed[tier - 1] - committed;
}

export function pinTarget(state: SideState, tier: number, x: number): QueuedShot | null {
  const def = MISSILES[tier - 1];
  if (!state.missileUnlocked[tier - 1]) return null;
  if (shotsRemaining(state, tier) <= 0) return null;
  if (state.money < def.cost) return null;
  state.money -= def.cost;
  state.stats.spent += def.cost;
  const shot: QueuedShot = { uid: nextUid(), tier, x, cost: def.cost };
  state.queued.push(shot);
  return shot;
}

export function unpinLast(state: SideState, tier?: number): boolean {
  for (let i = state.queued.length - 1; i >= 0; i--) {
    if (tier === undefined || state.queued[i].tier === tier) {
      const [shot] = state.queued.splice(i, 1);
      state.money += shot.cost;
      state.stats.spent -= shot.cost;
      return true;
    }
  }
  return false;
}

export function clearQueue(state: SideState): void {
  for (const q of state.queued) {
    state.money += q.cost;
    state.stats.spent -= q.cost;
  }
  state.queued.length = 0;
}

/** Commits every pinned target; they then launch as each tier's launcher reloads. */
export function commitQueue(state: SideState): number {
  const n = state.queued.length;
  state.pending.push(...state.queued);
  state.queued.length = 0;
  return n;
}

// ---------------------------------------------------------------------------
// Match-level helpers
// ---------------------------------------------------------------------------

export function inPeace(match: Match): boolean {
  return match.time < MATCH.peaceSeconds;
}

export function opposing(match: Match, side: Side): SideState {
  return side === 'player' ? match.enemy : match.player;
}

export function ownSide(match: Match, side: Side): SideState {
  return side === 'player' ? match.player : match.enemy;
}

/** x of the launch pad for a side — just outside its own city. */
export function launchPadX(side: Side): number {
  return side === 'player' ? WORLD.cityRight.x0 - 90 : WORLD.cityLeft.x1 + 90;
}

export function difficultyProfile(match: Match) {
  return BOTS[match.difficulty];
}
