import assert from 'node:assert/strict';
import { WORLD } from '../src/core/config';
import { defaultMeta } from '../src/core/storage';
import {
  buyAaRadius,
  buyAmmo,
  buyBattery,
  buyBuilding,
  buyMissileUpgrade,
  commitQueue,
  createOnlineMatch,
  pinTarget,
} from '../src/game/state';
import { applyRemoteAction, parseOnlineAction, type OnlineAction } from '../src/online/actions';

const alice = createOnlineMatch('Bob', 600);
const bob = createOnlineMatch('Alice', 600);
const fairMeta = defaultMeta();
for (const side of [alice.player, alice.enemy, bob.player, bob.enemy]) side.money = 500;

function fromAlice(local: () => boolean, action: OnlineAction): void {
  assert.equal(local(), true, `Alice could not apply ${action.type} locally`);
  assert.equal(applyRemoteAction(bob, fairMeta, action), true, `Bob could not mirror ${action.type}`);
}

function fromBob(local: () => boolean, action: OnlineAction): void {
  assert.equal(local(), true, `Bob could not apply ${action.type} locally`);
  assert.equal(applyRemoteAction(alice, fairMeta, action), true, `Alice could not mirror ${action.type}`);
}

fromAlice(
  () => buyBuilding(alice, alice.player, 0, 2500),
  { type: 'build-building', buildingType: 0, x: 2500 },
);
fromBob(
  () => buyBuilding(bob, bob.player, 5, 2660),
  { type: 'build-building', buildingType: 5, x: 2660 },
);
fromAlice(
  () => buyBattery(alice.player, 1, 2750),
  { type: 'build-battery', batteryType: 1, x: 2750 },
);

const boughtAmmo = buyAmmo(alice.player, 1, 5);
assert.equal(boughtAmmo, 5);
assert.equal(applyRemoteAction(bob, fairMeta, { type: 'buy-ammo', batteryType: 1, count: boughtAmmo }), true);

fromAlice(
  () => buyAaRadius(alice.player, 1),
  { type: 'aa-radius', batteryType: 1 },
);
fromAlice(
  () => buyMissileUpgrade(alice.player, 2, fairMeta) !== false,
  { type: 'missile-upgrade', tier: 2 },
);
fromAlice(
  () => pinTarget(alice.player, 1, 500) !== null,
  { type: 'pin-target', tier: 1, x: 500 },
);
fromAlice(
  () => commitQueue(alice.player) > 0,
  { type: 'commit-targets' },
);

assert.equal(Math.round(bob.enemy.buildings[0].x), Math.round(WORLD.width - alice.player.buildings[0].x));
assert.equal(Math.round(alice.enemy.buildings[0].x), Math.round(WORLD.width - bob.player.buildings[0].x));
assert.equal(Math.round(bob.enemy.batteries[0].x), Math.round(WORLD.width - alice.player.batteries[0].x));
assert.equal(bob.enemy.ammo[1], alice.player.ammo[1]);
assert.equal(bob.enemy.aaRadiusBonus[1], alice.player.aaRadiusBonus[1]);
assert.equal(bob.enemy.missileUnlocked[1], alice.player.missileUnlocked[1]);
assert.equal(bob.enemy.pending.length, 1);
assert.equal(Math.round(bob.enemy.pending[0].x), WORLD.width - 500);
assert.equal(parseOnlineAction({ type: 'build-building', buildingType: 99, x: 2500 }), null);
assert.equal(parseOnlineAction({ type: 'pin-target', tier: 1, x: Number.NaN }), null);

console.log('Online mirror test passed: build, defence, ammo, upgrades, targeting, and validation stay in sync.');
