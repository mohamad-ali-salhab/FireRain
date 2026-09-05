import assert from 'node:assert/strict';
import { BOTS, BUILDINGS, MATCH, META, MISSILES, WORLD, type Difficulty } from '../src/core/config';
import { defaultMeta } from '../src/core/storage';
import { updateBot } from '../src/game/bot';
import { missileAt, spawnMissile, updateDefences, updateInterceptors, updateMissiles } from '../src/game/combat';
import { stepMatch } from '../src/game/engine';
import { AA_MIN_SPACING, buyBattery, buyBuilding, buyMissileUpgrade, canDeployAt, createMatch, missileReload, pinTarget, commitQueue } from '../src/game/state';

const meta = defaultMeta();
const spacing = createMatch('easy', 300);
spacing.player.money = 1000;
assert(buyBattery(spacing.player, 0, 2600));
for (const x of [2600, 2634, 2600 + AA_MIN_SPACING - 0.01, NaN, Infinity]) {
  assert.equal(canDeployAt(spacing.player, x), false, `Reject overlapping/invalid site ${x}`);
  assert.equal(buyBattery(spacing.player, 0, x), false);
}
assert.equal(spacing.player.money, 1000, 'Rejected placements must not charge cash');
assert(buyBattery(spacing.player, 0, 2600 + AA_MIN_SPACING));
assert.equal(spacing.player.money, 970);
assert.equal(buyBattery(spacing.player, 1, 2600), false, 'Spacing applies across system types');

const reload = createMatch('easy', 300);
reload.player.money = 100000;
assert.equal(buyMissileUpgrade(reload.player, 6, meta), 'unlock');
assert.equal(reload.player.money, 100000 - 600);
assert.equal(missileReload(reload.player, 6, meta), 5);
assert.equal(reload.player.missileReloadPrice[5], 300);
assert.equal(buyMissileUpgrade(reload.player, 6, meta), 'reload');
assert.equal(missileReload(reload.player, 6, meta), 4.9);
assert(reload.player.missileReloadPrice[5] > 300);
for (let i = 0; i < 100; i++) buyMissileUpgrade(reload.player, 6, meta);
assert(missileReload(reload.player, 6, meta) >= META.minReload);

const launch = createMatch('easy', 300);
launch.player.money = 10000;
buyBuilding(launch, launch.player, 8);
buyBuilding(launch, launch.enemy, 0);
buyMissileUpgrade(launch.player, 6, meta);
pinTarget(launch.player, 6, 500);
pinTarget(launch.player, 6, 500);
commitQueue(launch.player);
launch.time = MATCH.peaceSeconds;
stepMatch(launch, 0.01, meta);
assert.equal(launch.player.stats.launched, 1);
for (let i = 0; i < 49; i++) stepMatch(launch, 0.1, meta);
assert.equal(launch.player.stats.launched, 1);
stepMatch(launch, 0.11, meta);
assert.equal(launch.player.stats.launched, 2, 'Second Bunker Buster launches after five seconds');

// Aim beyond a tall skyline from both cities. Normal frames and one full-flight
// frame must reach the marked x, including a mark near the edge of a roof.
for (const attackingSide of ['player', 'enemy'] as const) {
  for (const tier of MISSILES.map((missile) => missile.tier)) {
    for (const aim of ['roof', 'street'] as const) {
      for (const frameMode of ['normal', 'full-flight'] as const) {
        const match = createMatch('easy', 300);
        const attacker = match[attackingSide];
        const defender = attackingSide === 'player' ? match.enemy : match.player;
        const mirrorX = (x: number) => attackingSide === 'player' ? x : WORLD.width - x;
        defender.money = 10000;
        for (const x of [1200, 850, 300]) assert(buyBuilding(match, defender, 8, mirrorX(x)));
        const [front, middle, rear] = defender.buildings;
        const targetX = aim === 'roof' ? rear.x + BUILDINGS[rear.type].w / 2 - 1 : mirrorX(145);
        const missile = spawnMissile(attacker, tier, targetX);
        match.missiles.push(missile);
        const early = missileAt(missile, 0.03);
        assert.equal(early.x, missile.x0, 'Missiles launch straight up');
        assert(early.y < missile.y0 - 40, 'Missiles climb immediately');
        assert(missileAt(missile, 0.5).y <= 120, 'Crossing stays near the top of the battlefield');
        const late = missileAt(missile, 0.94);
        assert.equal(late.x, targetX, 'Terminal descent is vertically above the exact pin');
        assert(missileAt(missile, 0.97).y > late.y, 'Terminal descent moves downward');
        assert.deepEqual(missileAt(missile, 1), { x: targetX, y: WORLD.groundY });
        const zone = defender.side === 'enemy' ? WORLD.cityLeft : WORLD.cityRight;
        for (let step = 0; step <= 200; step++) {
          const point = missileAt(missile, step / 200);
          if (point.x >= zone.x0 && point.x <= zone.x1 && Math.abs(point.x - targetX) > 0.001) {
            assert(point.y < WORLD.groundY - BUILDINGS[8].h, 'Clear every intervening tower before diving');
          }
        }
        const dt = frameMode === 'normal' ? 1 / 30 : missile.flightTime * 1.1;
        for (let elapsed = 0; !missile.dead && elapsed < missile.flightTime + dt; elapsed += dt) {
          updateMissiles(match, dt);
        }
        assert(missile.dead, `${attackingSide} tier ${tier} must complete ${frameMode} flight`);
        assert.equal(attacker.stats.hits, 1, 'Exactly one impact per missile');
        assert.equal(missile.x, targetX, 'The impact keeps the exact marked x');
        assert.equal(front.hp, front.maxHp, 'The front tower does not steal the impact');
        assert.equal(middle.hp, middle.maxHp, 'The middle tower does not steal the impact');
        if (aim === 'roof') {
          assert.equal(rear.hp, Math.max(0, rear.maxHp - missile.damage), 'Selected footprint takes the direct hit');
          const roofY = WORLD.groundY - BUILDINGS[rear.type].h;
          assert(missile.y >= roofY && missile.y <= roofY + 6, 'Impact occurs at the selected roof');
        } else {
          assert.equal(missile.y, WORLD.groundY, 'An empty street pin lands on the ground');
          assert.equal(rear.hp, rear.maxHp, 'A tower before the street pin stays intact');
        }
      }
    }
  }
}

// The interceptor predictor must follow the same overhead route and vertical dive.
for (const attackingSide of ['player', 'enemy'] as const) {
  const match = createMatch('easy', 300);
  const defender = attackingSide === 'player' ? match.enemy : match.player;
  const targetX = attackingSide === 'player' ? 500 : WORLD.width - 500;
  assert(buyBattery(defender, 1, targetX));
  defender.ammo[1] = 5;
  const missile = spawnMissile(match[attackingSide], 1, targetX);
  match.missiles.push(missile);
  for (let elapsed = 0; !missile.dead && elapsed < missile.flightTime + 1; elapsed += 1 / 60) {
    updateDefences(match, 1 / 60, meta);
    updateInterceptors(match, 1 / 60);
    updateMissiles(match, 1 / 60);
  }
  assert.equal(defender.stats.intercepted, 1, 'A loaded battery can intercept the new terminal descent');
  assert.equal(match[attackingSide].stats.hits, 0, 'Intercepted rockets never impact');
}

const random = Math.random;
const rows: Record<string, number | string>[] = [];
try {
  for (const difficulty of ['easy', 'medium', 'hard'] as Difficulty[]) {
    for (let seed = 1; seed <= 3; seed++) {
      let state = seed;
      Math.random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
      const match = createMatch(difficulty, 300);
      match.player.money = 10000;
      buyBuilding(match, match.player, 8);
      // Keep a passive target alive while measuring normal bot income and spending.
      match.player.buildings[0].hp = match.player.buildings[0].maxHp = 1e9;
      let first = 0;
      let last = 0;
      let maxGap = 0;
      let previousShots = 0;
      for (let frame = 0; frame < 300 * 20; frame++) {
        const before = match.enemy.buildings.length + match.enemy.batteries.length;
        stepMatch(match, 0.05, meta);
        const after = match.enemy.buildings.length + match.enemy.batteries.length;
        assert(after - before <= 1, `${difficulty} must construct at most one unit per frame`);
        if (match.enemy.stats.launched > previousShots) {
          if (!first) first = match.time;
          if (last) maxGap = Math.max(maxGap, match.time - last);
          last = match.time;
          previousShots = match.enemy.stats.launched;
        }
      }
      assert(first <= MATCH.peaceSeconds + BOTS[difficulty].firstStrikeDelay + 0.2, `${difficulty} first strike at ${first}`);
      assert(first >= MATCH.peaceSeconds, 'No attacks during ceasefire');
      assert(maxGap <= BOTS[difficulty].salvoGap + 0.2, `${difficulty} attack gap was ${maxGap}`);
      assert(match.enemy.stats.launched >= 18, `${difficulty} should attack regularly`);
      rows.push({ difficulty, seed, first: first.toFixed(1), maxGap: maxGap.toFixed(1), shots: match.enemy.stats.launched });
    }
  }

  // Even a completely fumbled economy tick must not fumble a funded attack.
  const match = createMatch('easy', 300);
  match.time = MATCH.peaceSeconds + BOTS.easy.firstStrikeDelay;
  match.enemy.money = 100;
  Math.random = () => 0.99;
  updateBot(match, BOTS.easy.salvoGap, meta);
  assert.equal(match.enemy.pending.length, 1);
} finally {
  Math.random = random;
}
console.table(rows);
console.log('PASS: placement clearance, purchase costs, reload floor, five-second launches, precise overhead trajectories, interception, single construction, and regular attacks.');
