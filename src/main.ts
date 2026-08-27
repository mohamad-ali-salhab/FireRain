import './style.css';
import { AA, MATCH, MISSILES, WORLD } from './core/config';
import { audio } from './core/audio';
import { loadMeta, saveMeta } from './core/storage';
import type { PanelId } from './core/types';
import { stepMatch } from './game/engine';
import {
  aaRadius,
  buyAaRadius,
  buyBattery,
  buyBuilding,
  canDeployAt,
  createMatch,
  deployZone,
  hasRadar,
  pinTarget,
  shotsRemaining,
  unpinLast,
  type Match,
} from './game/state';
import { Camera } from './render/camera';
import { drawScene } from './render/scene';
import { GameUI, type UiHost, type UiState } from './ui/game-ui';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;
const uiRoot = document.getElementById('ui') as HTMLElement;

const meta = loadMeta();
audio.setMuted(meta.muted);

const ui: UiState = {
  panel: 'none',
  selectedTier: 1,
  ammoMult: 1,
  showRings: false,
  aimX: null,
  difficulty: 'easy',
  duration: Infinity,
  placing: null,
  placeX: null,
};

const camera = new Camera();

/** Default framing: the front half of your own city, where the first blocks go up. */
const HOME_VIEW_X = WORLD.cityRight.x0 + 400;
const ENEMY_VIEW_X = WORLD.cityLeft.x1 - 400;

const host: UiHost = {
  ui,
  meta,
  match: null,
  screen: 'menu',
  setPanel(panel: PanelId) {
    ui.panel = panel;
    ui.placing = null;
    ui.placeX = null;
    camera.manual = false;
    if (panel === 'icbm') {
      camera.setMode('city');
      camera.focus(ENEMY_VIEW_X);
      ui.showRings = false;
    } else {
      ui.aimX = null;
      camera.focus(HOME_VIEW_X);
      if (panel === 'antiair' || panel === 'abm') ui.showRings = true;
    }
  },
  startMatch() {
    host.match = createMatch(ui.difficulty, ui.duration);
    host.screen = 'game';
    ui.panel = 'none';
    ui.selectedTier = 1;
    ui.aimX = null;
    ui.placing = null;
    ui.placeX = null;
    camera.setMode('city');
    camera.snapTo(HOME_VIEW_X);
  },
  quitToMenu() {
    host.match = null;
    host.screen = 'menu';
    ui.panel = 'none';
    saveMeta(meta);
  },
  setPaused(paused: boolean) {
    const m = host.match;
    if (!m || m.phase === 'over') return;
    m.phase = paused ? 'paused' : 'playing';
  },
  toggleZoom() {
    camera.manual = false;
    camera.setMode(camera.mode === 'city' ? 'wide' : 'city');
    if (camera.mode === 'city') {
      camera.focus(
        ui.panel === 'icbm'
          ? ENEMY_VIEW_X
          : HOME_VIEW_X,
      );
    }
  },
  openShop() {
    host.screen = 'shop';
  },
  closeShop() {
    host.screen = host.match && host.match.phase !== 'over' ? 'game' : 'menu';
    saveMeta(meta);
  },
};

const gameUI = new GameUI(uiRoot, host);

// ---------------------------------------------------------------------------
// Canvas sizing
// ---------------------------------------------------------------------------

function resize(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const dock = uiRoot.querySelector('.dock') as HTMLElement | null;
  const dockH = dock && host.screen === 'game' ? dock.offsetHeight + 26 : Math.max(150, h * 0.24);
  // Portrait screens have far too much sky, so the horizon is pulled down the page.
  const inset = h > w ? Math.max(dockH, h * 0.16) : dockH;
  camera.resize(w, h, Math.min(h * 0.5, inset));
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => window.setTimeout(resize, 120));

// ---------------------------------------------------------------------------
// Pointer input: drag to pan, tap to pin a target
// ---------------------------------------------------------------------------

let dragging = false;
let dragMoved = 0;
let lastX = 0;

function aimable(): boolean {
  return (
    host.screen === 'game' &&
    !!host.match &&
    host.match.phase === 'playing' &&
    ui.panel === 'icbm' &&
    ui.placing === null
  );
}

function placing(): boolean {
  return host.screen === 'game' && !!host.match && host.match.phase === 'playing' && ui.placing !== null;
}

function clampTargetX(x: number): number {
  return Math.max(WORLD.cityLeft.x0 - 200, Math.min(WORLD.cityLeft.x1 + 200, x));
}

canvas.addEventListener('pointerdown', (e) => {
  audio.init();
  dragging = true;
  dragMoved = 0;
  lastX = e.clientX;
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (placing()) ui.placeX = camera.toWorldX(e.clientX);
  if (aimable()) ui.aimX = clampTargetX(camera.toWorldX(e.clientX));
  if (!dragging) return;
  const dx = e.clientX - lastX;
  lastX = e.clientX;
  dragMoved += Math.abs(dx);
  if (dragMoved > 6) camera.panBy(dx);
});

canvas.addEventListener('pointerup', (e) => {
  if (dragging && dragMoved <= 6) handleTap(e.clientX);
  dragging = false;
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
});

canvas.addEventListener('pointercancel', () => {
  dragging = false;
});

canvas.addEventListener('pointerleave', () => {
  ui.aimX = null;
});

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    camera.zoomBy(e.deltaY > 0 ? 1.12 : 1 / 1.12);
  },
  { passive: false },
);

function handleTap(clientX: number): void {
  const match = host.match;
  if (!match) return;

  // Siting a new anti-air battery on your own land.
  if (placing() && ui.placing !== null) {
    const worldX = camera.toWorldX(clientX);
    ui.placeX = worldX;
    const type = ui.placing;
    if (!canDeployAt(match.player, worldX)) {
      audio.deny();
      const zone = deployZone('player');
      gameUI.toast(
        worldX < zone.x0 || worldX > zone.x1 ? 'That is not your land' : 'Too close to another battery',
      );
      return;
    }
    if (buyBattery(match.player, type, worldX)) {
      audio.build();
      ui.placing = null;
      ui.placeX = null;
    } else {
      audio.deny();
      gameUI.toast('Not enough cash');
    }
    return;
  }

  if (!aimable()) return;
  const worldX = clampTargetX(camera.toWorldX(clientX));
  const shot = pinTarget(match.player, ui.selectedTier, worldX);
  if (shot) {
    audio.pin();
    return;
  }
  // Say exactly which of the three reasons stopped the shot.
  audio.deny();
  const def = MISSILES[ui.selectedTier - 1];
  if (!match.player.missileUnlocked[ui.selectedTier - 1]) {
    gameUI.toast(`${def.name} is locked — unlock it in Upgrades ($${def.unlockCost})`);
  } else if (shotsRemaining(match.player, ui.selectedTier) <= 0) {
    gameUI.toast(`No ${def.name} rounds left this match`);
  } else {
    gameUI.toast(`${def.name} costs $${def.cost} — you have $${Math.floor(match.player.money)}`);
  }
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  const match = host.match;
  if (e.key === 'Escape') {
    if (ui.placing !== null) {
      ui.placing = null;
      ui.placeX = null;
      return;
    }
    if (host.screen === 'shop') host.closeShop();
    else if (match && match.phase === 'playing' && ui.panel !== 'none') host.setPanel('none');
    else if (match && match.phase === 'playing') host.setPaused(true);
    else if (match && match.phase === 'paused') host.setPaused(false);
    return;
  }
  if (!match || match.phase !== 'playing') return;
  if (e.key === ' ' && ui.panel === 'icbm') {
    e.preventDefault();
    (uiRoot.querySelector('.fightbtn') as HTMLButtonElement | null)?.click();
  }
  if ((e.key === 'z' || e.key === 'Z') && ui.panel === 'icbm') {
    if (unpinLast(match.player)) audio.click();
  }
  if (e.key >= '1' && e.key <= '6' && ui.panel === 'icbm') {
    const tier = Number(e.key);
    if (match.player.missileUnlocked[tier - 1]) {
      ui.selectedTier = tier;
      audio.click();
    }
  }
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let last = performance.now();
let lastDockH = 0;
let overSaved = false;

/**
 * Debug handle for playtesting: `__rof.speed = 8` in the console fast-forwards
 * the clock so the 7-minute build-limit steps and the day/night cycle can be
 * checked without waiting them out.
 */
const debug = {
  speed: 1,
  /** Snapshot used by the automated checks and handy when playtesting. */
  debugState() {
    const m = host.match;
    if (!m) return null;
    return {
      time: Math.round(m.time),
      duration: m.duration,
      money: Math.round(m.player.money),
      buildingXs: m.player.buildings.filter((b) => !b.destroyed).map((b) => Math.round(b.x)),
      batteries: m.player.batteries.length,
      batteryXs: m.player.batteries.map((b) => Math.round(b.x)),
      batteryHp: m.player.batteries.map((b) => Math.round(b.hp)),
      enemyBuildings: m.enemy.buildings.filter((b) => !b.destroyed).length,
    };
  },
  /** How the price of a repeatable in-match upgrade climbs, for sanity checks. */
  probeUpgradePrices(buys = 12) {
    const m = host.match;
    if (!m) return null;
    const out: number[] = [];
    const before = m.player.money;
    m.player.money = 1e9;
    for (let i = 0; i < buys; i++) {
      out.push(m.player.aaRadiusPrice[0]);
      buyAaRadius(m.player, 0);
    }
    // Undo the probe so it cannot be used to cheat.
    m.player.aaRadiusPrice[0] = out[0];
    m.player.aaRadiusBonus[0] -= AA[0].radiusStep * buys;
    m.player.money = before;
    return out;
  },
  /** Playtesting helper: knock the enemy city down to a given health fraction. */
  damageEnemy(fraction = 0.4) {
    const m = host.match;
    if (!m) return null;
    for (const b of m.enemy.buildings) {
      if (b.destroyed) continue;
      b.hp = Math.max(1, b.maxHp * fraction * (0.4 + Math.random() * 1.2));
      if (b.hp > b.maxHp) b.hp = b.maxHp;
    }
    return m.enemy.buildings.length;
  },
  missileTable() {
    return MISSILES.map((d) => ({ tier: d.roman, cost: d.cost, speed: d.speed, dmg: d.damage, reload: d.reload }));
  },
};
(window as unknown as { __rof: typeof debug }).__rof = debug;

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000) * Math.max(0.1, Math.min(20, debug.speed));
  last = now;

  const match = host.match;
  if (match && host.screen === 'game' && match.phase === 'playing') stepMatch(match, dt, meta);
  if (match?.result) {
    if (!overSaved) {
      overSaved = true;
      saveMeta(meta);
    }
  } else {
    overSaved = false;
  }

  // Keep the view on whatever city the player is looking at as it grows.
  if (match && host.screen === 'game') {
    const watching = ui.panel === 'icbm' ? match.enemy : match.player;
    const alive = watching.buildings.filter((b) => !b.destroyed);
    const fallback = ui.panel === 'icbm' ? ENEMY_VIEW_X : HOME_VIEW_X;
    const centre = alive.length ? alive.reduce((a, b) => a + b.x, 0) / alive.length : fallback;
    camera.follow(centre);
  }

  camera.update(dt);
  ctx.save();
  drawScene(ctx, match ?? idleMatch(), camera, {
    showRings: ui.showRings || ui.panel === 'antiair' || ui.panel === 'abm',
    aiming: ui.panel === 'icbm',
    aimTier: ui.selectedTier,
    aimX: ui.panel === 'icbm' ? ui.aimX : null,
    meta,
    hasRadar: match ? hasRadar(match.player) : true,
    deploy:
      match && ui.placing !== null
        ? {
            type: ui.placing,
            x: ui.placeX,
            valid: ui.placeX !== null && canDeployAt(match.player, ui.placeX),
            radius: aaRadius(match.player, ui.placing, meta),
          }
        : null,
  });
  ctx.restore();

  gameUI.sync();

  // The dock changes height between panels; keep the ground line clear of it.
  const dock = uiRoot.querySelector('.dock') as HTMLElement | null;
  const h = dock && host.screen === 'game' ? dock.offsetHeight : 0;
  if (h !== lastDockH) {
    lastDockH = h;
    resize();
  }

  requestAnimationFrame(frame);
}

/** A frozen, decorative battlefield used as the menu backdrop. */
let idle: Match | null = null;
function idleMatch(): Match {
  if (!idle) {
    idle = createMatch('easy', MATCH.durationSeconds);
    idle.phase = 'paused';
    idle.time = MATCH.durationSeconds * 0.17; // late afternoon
    for (const side of [idle.player, idle.enemy]) {
      side.money = 100000;
      for (const [type, n] of [[0, 5], [1, 4], [2, 4], [3, 3], [4, 3], [5, 2], [6, 2], [7, 1], [8, 1]] as const) {
        for (let i = 0; i < n; i++) buyBuilding(idle, side, type);
      }
      for (const type of [0, 1, 3]) buyBattery(side, type);
      side.money = MATCH.startingMoney;
    }
  }
  return idle;
}

resize();
window.setTimeout(resize, 60);
requestAnimationFrame(frame);

window.addEventListener('beforeunload', () => saveMeta(meta));
