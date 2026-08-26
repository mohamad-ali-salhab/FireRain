import {
  AA,
  BUILDINGS,
  INTERCEPTOR_MIN_SPEED,
  INTERCEPTOR_SPEED_FACTOR,
  MIN_INTERCEPT_ALTITUDE,
  MISSILES,
  WORLD,
} from '../core/config';
import type { Building, Interceptor, MetaSave, Missile, Particle, SideState } from '../core/types';
import { audio } from '../core/audio';
import { aaRadius, aaReload, hash01, launchPadX, nextUid, type Match } from './state';

// ---------------------------------------------------------------------------
// Ballistics
// ---------------------------------------------------------------------------

/** Peak height of the flight arc for a given ground distance. */
function arcHeight(dist: number): number {
  return Math.min(430, 110 + dist * 0.15);
}

export function missileAt(m: Missile, t: number): { x: number; y: number } {
  const c = Math.max(0, Math.min(1, t));
  const x = m.x0 + (m.tx - m.x0) * c;
  const base = m.y0 + (m.ty - m.y0) * c;
  const y = base - arcHeight(Math.abs(m.tx - m.x0)) * Math.sin(Math.PI * c);
  return { x, y };
}

export function spawnMissile(state: SideState, tier: number, targetX: number): Missile {
  const def = MISSILES[tier - 1];
  const x0 = launchPadX(state.side);
  const y0 = WORLD.groundY - 14;
  const ty = WORLD.groundY;
  const dist = Math.abs(targetX - x0);
  const flightTime = (dist + 1.9 * arcHeight(dist)) / def.speed;
  const m: Missile = {
    uid: nextUid(),
    side: state.side,
    tier,
    x: x0,
    y: y0,
    vx: 0,
    vy: 0,
    x0,
    y0,
    tx: targetX,
    ty,
    t: 0,
    flightTime,
    speed: def.speed,
    damage: def.damage,
    blast: def.blast,
    dead: false,
    targetedBy: 0,
    trail: [],
  };
  state.stats.launched++;
  state.shotsUsed[tier - 1]++;
  return m;
}

// ---------------------------------------------------------------------------
// Interception
// ---------------------------------------------------------------------------

/**
 * Solves for the moment an interceptor launched now would meet `m`.
 * Returns null when the missile lands before the interceptor can reach it.
 */
function solveIntercept(m: Missile, bx: number, by: number, speed: number): { t: number; x: number; y: number } | null {
  let tau = 0.35;
  for (let i = 0; i < 6; i++) {
    const future = m.t + tau / m.flightTime;
    if (future >= 1) return null;
    const p = missileAt(m, future);
    const d = Math.hypot(p.x - bx, p.y - by);
    const next = d / speed;
    if (Math.abs(next - tau) < 0.01) {
      tau = next;
      break;
    }
    tau = next;
  }
  const future = m.t + tau / m.flightTime;
  if (future >= 0.94) return null;
  const p = missileAt(m, future);
  // Too low to be worth a shot — the warhead is already on top of the city.
  if (p.y > WORLD.groundY - MIN_INTERCEPT_ALTITUDE) return null;
  return { t: tau, x: p.x, y: p.y };
}

function spawnInterceptor(
  match: Match,
  state: SideState,
  type: number,
  bx: number,
  by: number,
  target: Missile,
  speed: number,
  aimX: number,
  aimY: number,
): void {
  const ang = Math.atan2(aimY - by, aimX - bx);
  const it: Interceptor = {
    uid: nextUid(),
    side: state.side,
    type,
    x: bx,
    y: by,
    vx: Math.cos(ang) * speed,
    vy: Math.sin(ang) * speed,
    speed,
    targetUid: target.uid,
    life: 9,
    dead: false,
    trail: [],
  };
  match.interceptors.push(it);
  target.targetedBy++;
  state.ammo[type]--;
}

export function updateDefences(match: Match, dt: number, meta: MetaSave): void {
  for (const state of [match.player, match.enemy]) {
    for (const b of state.batteries) {
      const def = AA[b.type];
      if (b.cooldown > 0) b.cooldown -= dt;
      if (b.recoil > 0) b.recoil = Math.max(0, b.recoil - dt * 3.2);
      if (def.interceptsTier === 0) continue; // radar never fires

      const radius = aaRadius(state, b.type, meta);
      const by = WORLD.groundY - 16;

      // Keep the barrel tracking the nearest threat even while reloading.
      let best: { m: Missile; sol: { t: number; x: number; y: number } } | null = null;
      for (const m of match.missiles) {
        if (m.dead || m.side === state.side) continue;
        if (m.tier !== def.interceptsTier) continue;
        if (MISSILES[m.tier - 1].unstoppable) continue;
        if (m.targetedBy > 0) continue;
        const speed = Math.max(INTERCEPTOR_MIN_SPEED, m.speed * INTERCEPTOR_SPEED_FACTOR);
        const sol = solveIntercept(m, b.x, by, speed);
        if (!sol) continue;
        if (Math.hypot(sol.x - b.x, sol.y - by) > radius) continue;
        if (!best || sol.t < best.sol.t) best = { m, sol };
      }

      if (best) {
        b.aim = Math.atan2(best.sol.y - by, best.sol.x - b.x);
        if (b.cooldown <= 0 && state.ammo[b.type] > 0) {
          const speed = Math.max(INTERCEPTOR_MIN_SPEED, best.m.speed * INTERCEPTOR_SPEED_FACTOR);
          spawnInterceptor(match, state, b.type, b.x, by, best.m, speed, best.sol.x, best.sol.y);
          b.cooldown = aaReload(state, b.type, meta);
          b.recoil = 1;
          audio.interceptorLaunch(panFor(match, b.x));
          puff(match, b.x, by, def.color);
        }
      } else {
        // Idle sweep, so batteries never look frozen.
        const rest = state.side === 'player' ? -Math.PI * 0.72 : -Math.PI * 0.28;
        const sweep = Math.sin(match.time * 0.6 + hash01(b.seed) * 6.28) * 0.16;
        b.aim += (rest + sweep - b.aim) * Math.min(1, dt * 2.4);
      }
    }
  }
}

export function updateInterceptors(match: Match, dt: number): void {
  for (const it of match.interceptors) {
    if (it.dead) continue;
    it.life -= dt;
    if (it.life <= 0) {
      it.dead = true;
      continue;
    }
    const target = match.missiles.find((m) => m.uid === it.targetUid && !m.dead);
    if (!target) {
      // Its quarry is already gone; let it burn out with a small flourish.
      it.life = Math.min(it.life, 0.35);
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      pushTrail(it.trail, it.x, it.y, 10);
      continue;
    }

    // Re-lead every frame so a fast missile still gets tracked.
    const sol = solveIntercept(target, it.x, it.y, it.speed);
    const aimX = sol ? sol.x : target.x;
    const aimY = sol ? sol.y : target.y;
    const ang = Math.atan2(aimY - it.y, aimX - it.x);
    const turn = 7.5 * dt;
    const cur = Math.atan2(it.vy, it.vx);
    let delta = ang - cur;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const na = cur + Math.max(-turn, Math.min(turn, delta));
    it.vx = Math.cos(na) * it.speed;
    it.vy = Math.sin(na) * it.speed;
    it.x += it.vx * dt;
    it.y += it.vy * dt;
    pushTrail(it.trail, it.x, it.y, 12);

    if (Math.hypot(target.x - it.x, target.y - it.y) < 16 + it.speed * dt) {
      it.dead = true;
      target.dead = true;
      const owner = it.side === 'player' ? match.player : match.enemy;
      owner.stats.intercepted++;
      interceptBurst(match, target.x, target.y, AA[it.type].color);
      audio.intercept(panFor(match, target.x));
      match.shake = Math.max(match.shake, 3);
    }

    if (it.y > WORLD.groundY || it.x < -200 || it.x > WORLD.width + 200) it.dead = true;
  }
  match.interceptors = match.interceptors.filter((i) => !i.dead);
}

// ---------------------------------------------------------------------------
// Missile flight + impact
// ---------------------------------------------------------------------------

export function updateMissiles(match: Match, dt: number): void {
  for (const m of match.missiles) {
    if (m.dead) continue;
    const prev = missileAt(m, m.t);
    m.t += dt / m.flightTime;
    const now = missileAt(m, Math.min(1, m.t));
    m.vx = (now.x - prev.x) / dt;
    m.vy = (now.y - prev.y) / dt;
    m.x = now.x;
    m.y = now.y;
    pushTrail(m.trail, m.x, m.y, 26);
    // Engine smoke for the heavier tiers.
    if (m.tier >= 3 && Math.random() < dt * 26) {
      match.particles.push(smoke(m.x, m.y, 4 + m.tier));
    }
    if (m.t >= 1) {
      m.dead = true;
      impact(match, m);
    }
  }
  match.missiles = match.missiles.filter((m) => !m.dead);
}

function impact(match: Match, m: Missile): void {
  const defender = m.side === 'player' ? match.enemy : match.player;
  const attacker = m.side === 'player' ? match.player : match.enemy;
  attacker.stats.hits++;

  const power = 0.35 + m.tier * 0.3;
  audio.explosion(power, panFor(match, m.tx));
  explosionBurst(match, m.tx, WORLD.groundY, m.blast, m.tier);
  match.shake = Math.max(match.shake, 5 + m.tier * 3.5);

  let killed = 0;
  for (const b of defender.buildings) {
    if (b.destroyed) continue;
    const def = BUILDINGS[b.type];
    const half = def.w / 2;
    const dx = Math.max(0, Math.abs(b.x - m.tx) - half);
    if (dx > m.blast) continue;
    const falloff = dx <= 0 ? 1 : 1 - dx / m.blast;
    const dmg = m.damage * (0.35 + 0.65 * falloff);
    b.hp -= dmg;
    b.shake = Math.max(b.shake, 0.35 + falloff * 0.5);
    if (b.hp <= 0) {
      b.hp = 0;
      b.destroyed = true;
      b.collapse = 0;
      killed++;
      defender.stats.destroyedBuildings++;
      collapseBurst(match, b);
    }
  }
  if (killed > 0) {
    audio.collapse(panFor(match, m.tx));
    match.shake = Math.max(match.shake, 9);
  }

  match.texts.push({
    x: m.tx,
    y: WORLD.groundY - 60,
    text: killed > 0 ? `-${killed} ${killed === 1 ? 'building' : 'buildings'}` : `${MISSILES[m.tier - 1].roman} hit`,
    color: killed > 0 ? '#ff6b5e' : '#ffd980',
    life: 1.6,
    maxLife: 1.6,
  });
}

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------

function pushTrail(trail: { x: number; y: number; a: number }[], x: number, y: number, max: number): void {
  trail.push({ x, y, a: 1 });
  if (trail.length > max) trail.shift();
  for (let i = 0; i < trail.length; i++) trail[i].a = i / trail.length;
}

function smoke(x: number, y: number, size: number): Particle {
  return {
    kind: 'smoke',
    x,
    y,
    vx: (Math.random() - 0.5) * 22,
    vy: (Math.random() - 0.5) * 18 - 6,
    life: 1.1 + Math.random() * 0.7,
    maxLife: 1.8,
    size,
    color: 'rgba(190,196,205,1)',
    gravity: -6,
  };
}

function puff(match: Match, x: number, y: number, color: string): void {
  for (let i = 0; i < 10; i++) {
    match.particles.push({
      kind: 'spark',
      x,
      y,
      vx: (Math.random() - 0.5) * 130,
      vy: -Math.random() * 120,
      life: 0.3 + Math.random() * 0.25,
      maxLife: 0.55,
      size: 2 + Math.random() * 2,
      color,
      gravity: 240,
    });
  }
  match.particles.push({ kind: 'flash', x, y, vx: 0, vy: 0, life: 0.12, maxLife: 0.12, size: 26, color, gravity: 0 });
}

function interceptBurst(match: Match, x: number, y: number, color: string): void {
  match.particles.push({ kind: 'ring', x, y, vx: 0, vy: 0, life: 0.5, maxLife: 0.5, size: 8, color, gravity: 0 });
  match.particles.push({ kind: 'flash', x, y, vx: 0, vy: 0, life: 0.16, maxLife: 0.16, size: 46, color: '#ffffff', gravity: 0 });
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 60 + Math.random() * 220;
    match.particles.push({
      kind: 'spark',
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: 0.35 + Math.random() * 0.5,
      maxLife: 0.85,
      size: 1.6 + Math.random() * 2.4,
      color: i % 3 === 0 ? '#fff2c4' : color,
      gravity: 210,
    });
  }
  for (let i = 0; i < 8; i++) match.particles.push(smoke(x, y, 5 + Math.random() * 6));
}

function explosionBurst(match: Match, x: number, y: number, blast: number, tier: number): void {
  const n = 26 + tier * 14;
  match.particles.push({ kind: 'flash', x, y: y - 10, vx: 0, vy: 0, life: 0.2, maxLife: 0.2, size: blast * 1.5, color: '#fff6d2', gravity: 0 });
  match.particles.push({ kind: 'ring', x, y: y - 6, vx: 0, vy: 0, life: 0.6, maxLife: 0.6, size: blast * 0.4, color: '#ffb03a', gravity: 0 });
  for (let i = 0; i < n; i++) {
    const a = -Math.PI * 0.5 + (Math.random() - 0.5) * Math.PI * 1.5;
    const s = 60 + Math.random() * (140 + tier * 90);
    match.particles.push({
      kind: 'fire',
      x: x + (Math.random() - 0.5) * blast * 0.5,
      y: y - Math.random() * 14,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: 0.4 + Math.random() * 0.7,
      maxLife: 1.1,
      size: 4 + Math.random() * (6 + tier * 2.5),
      color: pick(['#ffe07a', '#ffa22b', '#ff5f2e', '#d43a1a']),
      gravity: 190,
    });
  }
  for (let i = 0; i < 12 + tier * 5; i++) {
    match.particles.push({
      kind: 'debris',
      x,
      y: y - 8,
      vx: (Math.random() - 0.5) * (220 + tier * 90),
      vy: -80 - Math.random() * (200 + tier * 80),
      life: 0.8 + Math.random() * 0.9,
      maxLife: 1.7,
      size: 2 + Math.random() * 4,
      color: '#4a4f57',
      gravity: 520,
      rot: Math.random() * 6.28,
      vrot: (Math.random() - 0.5) * 14,
    });
  }
  for (let i = 0; i < 16 + tier * 6; i++) match.particles.push(smoke(x + (Math.random() - 0.5) * blast, y - Math.random() * 40, 8 + Math.random() * 14));
}

function collapseBurst(match: Match, b: Building): void {
  const def = BUILDINGS[b.type];
  for (let i = 0; i < 14 + def.h / 8; i++) {
    match.particles.push({
      kind: 'debris',
      x: b.x + (Math.random() - 0.5) * def.w,
      y: WORLD.groundY - Math.random() * def.h,
      vx: (Math.random() - 0.5) * 160,
      vy: -Math.random() * 130,
      life: 1 + Math.random(),
      maxLife: 2,
      size: 2 + Math.random() * 5,
      color: pick(['#3c424b', '#525a64', '#2c3138']),
      gravity: 560,
      rot: Math.random() * 6.28,
      vrot: (Math.random() - 0.5) * 12,
    });
  }
  for (let i = 0; i < 18; i++) {
    match.particles.push({
      kind: 'smoke',
      x: b.x + (Math.random() - 0.5) * def.w * 1.4,
      y: WORLD.groundY - Math.random() * def.h * 0.7,
      vx: (Math.random() - 0.5) * 40,
      vy: -10 - Math.random() * 30,
      life: 1.4 + Math.random() * 1.4,
      maxLife: 2.8,
      size: 10 + Math.random() * 18,
      color: 'rgba(150,155,163,1)',
      gravity: -14,
    });
  }
}

export function updateParticles(match: Match, dt: number): void {
  for (const p of match.particles) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += p.gravity * dt;
    if (p.kind === 'debris') {
      p.vx *= 1 - dt * 0.6;
      if (p.rot !== undefined && p.vrot !== undefined) p.rot += p.vrot * dt;
      if (p.y > WORLD.groundY) {
        p.y = WORLD.groundY;
        p.vy *= -0.28;
        p.vx *= 0.55;
        if (p.vrot !== undefined) p.vrot *= 0.5;
      }
    }
    if (p.kind === 'smoke') {
      p.vx *= 1 - dt * 0.8;
      p.size += dt * 12;
    }
  }
  match.particles = match.particles.filter((p) => p.life > 0);
  if (match.particles.length > 1600) match.particles.splice(0, match.particles.length - 1600);

  for (const t of match.texts) {
    t.life -= dt;
    t.y -= dt * 26;
  }
  match.texts = match.texts.filter((t) => t.life > 0);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Stereo pan from a world x, relative to the middle of the battlefield. */
export function panFor(_match: Match, x: number): number {
  return Math.max(-1, Math.min(1, (x / WORLD.width) * 2 - 1)) * 0.7;
}
