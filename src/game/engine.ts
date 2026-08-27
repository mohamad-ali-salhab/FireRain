import { MATCH, META, MISSILES, WORLD } from '../core/config';
import type { MetaSave, SideState } from '../core/types';
import { audio } from '../core/audio';
import { noteIncomingTier, updateBot } from './bot';
import {
  panFor,
  spawnMissile,
  updateBuildingSmoke,
  updateDefences,
  updateInterceptors,
  updateMissiles,
  updateParticles,
} from './combat';
import {
  cityValue,
  difficultyProfile,
  incomePerTick,
  inPeace,
  limitSteps,
  missileReload,
  type Match,
} from './state';

export function stepMatch(match: Match, dt: number, meta: MetaSave): void {
  if (match.phase !== 'playing') return;

  match.time += dt;

  // --- income every 2 seconds -------------------------------------------
  match.incomeAcc += dt;
  while (match.incomeAcc >= MATCH.incomeIntervalSeconds) {
    match.incomeAcc -= MATCH.incomeIntervalSeconds;
    payIncome(match.player, 1);
    payIncome(match.enemy, botIncomeMult(match));
  }

  // --- building cap milestones ------------------------------------------
  const step = limitSteps(match);
  if (step > match.lastLimitStep) {
    match.lastLimitStep = step;
    match.texts.push({
      x: match.player.buildings[0]?.x ?? (WORLD.cityRight.x0 + WORLD.cityRight.x1) / 2,
      y: 300,
      text: 'BUILD LIMIT +1',
      color: '#7de3ff',
      life: 2.6,
      maxLife: 2.6,
    });
    audio.buy();
  }

  // --- peace timer -------------------------------------------------------
  if (!match.peaceAnnounced && !inPeace(match)) {
    match.peaceAnnounced = true;
    audio.alarm();
    match.texts.push({ x: WORLD.width / 2, y: 260, text: 'WEAPONS FREE', color: '#ff6b5e', life: 3, maxLife: 3 });
  }

  // --- launch queues -----------------------------------------------------
  processLaunches(match, match.player, dt, meta);
  processLaunches(match, match.enemy, dt, meta);

  // --- simulation --------------------------------------------------------
  updateMissiles(match, dt);
  updateDefences(match, dt, meta);
  updateInterceptors(match, dt);
  updateBuildingSmoke(match, dt);
  updateParticles(match, dt);
  updateBot(match, dt, meta);

  for (const side of [match.player, match.enemy]) {
    for (const b of side.buildings) {
      if (b.shake > 0) b.shake = Math.max(0, b.shake - dt * 1.6);
      if (b.destroyed && b.collapse < 1) b.collapse = Math.min(1, b.collapse + dt * 1.5);
    }
  }
  match.shake = Math.max(0, match.shake - dt * 26);

  checkEnd(match, dt, meta);
}

function botIncomeMult(match: Match): number {
  return difficultyProfile(match).incomeMult;
}

function payIncome(state: SideState, mult: number): void {
  const gain = incomePerTick(state) * mult;
  if (gain <= 0) return;
  state.money += gain;
  state.stats.earned += gain;
}

function processLaunches(match: Match, state: SideState, dt: number, meta: MetaSave): void {
  for (let i = 0; i < state.launchCooldown.length; i++) {
    if (state.launchCooldown[i] > 0) state.launchCooldown[i] -= dt;
  }
  if (inPeace(match)) return;

  for (let tier = 1; tier <= MISSILES.length; tier++) {
    if (state.launchCooldown[tier - 1] > 0) continue;
    const idx = state.pending.findIndex((q) => q.tier === tier);
    if (idx < 0) continue;
    const [shot] = state.pending.splice(idx, 1);
    const m = spawnMissile(state, tier, shot.x);
    match.missiles.push(m);
    state.launchCooldown[tier - 1] = missileReload(state, tier, meta);
    audio.launch(tier, panFor(match, m.x0));
    if (state.side === 'player') noteIncomingTier(match, tier);
  }
}

function checkEnd(match: Match, dt: number, meta: MetaSave): void {
  // Lose every building and you have MATCH.wipeoutGraceSeconds to put one back up.
  for (const side of [match.player, match.enemy]) {
    const alive = side.buildings.some((b) => !b.destroyed);
    if (!alive && match.time > MATCH.peaceSeconds) side.wipeoutTimer += dt;
    else side.wipeoutTimer = 0;
  }

  const pv = cityValue(match.player);
  const ev = cityValue(match.enemy);

  if (match.player.wipeoutTimer >= MATCH.wipeoutGraceSeconds) return finish(match, false, pv, ev, 'Your city was levelled', meta);
  if (match.enemy.wipeoutTimer >= MATCH.wipeoutGraceSeconds) return finish(match, true, pv, ev, `${match.enemy.name}'s city was levelled`, meta);
  if (isFinite(match.duration) && match.time >= match.duration) {
    const mine = match.player.stats.valueDestroyed;
    const theirs = match.enemy.stats.valueDestroyed;
    const won = mine !== theirs ? mine > theirs : pv > ev;
    return finish(
      match,
      won,
      pv,
      ev,
      won ? 'You did the most damage' : 'They did the most damage',
      meta,
    );
  }
}

function finish(match: Match, won: boolean, pv: number, ev: number, reason: string, meta: MetaSave): void {
  const total = pv + ev;
  const share = total > 0 ? pv / total : 0.5;
  let stars = won ? META.winStars : META.lossStars;
  if (won) stars += Math.round(META.dominanceBonus * Math.max(0, (share - 0.5) * 2));
  match.phase = 'over';
  match.result = { won, stars, playerValue: pv, enemyValue: ev, reason };
  meta.stars += stars;
  if (won) meta.wins++;
  else meta.losses++;
  audio.fanfare(won);
}
