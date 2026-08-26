import './style.css';
import { MATCH, WORLD } from './core/config';
import { audio } from './core/audio';
import { loadMeta, saveMeta } from './core/storage';
import type { PanelId } from './core/types';
import { stepMatch } from './game/engine';
import {
  buyBattery,
  buyBuilding,
  createMatch,
  hasRadar,
  pinTarget,
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
  duration: MATCH.durationSeconds,
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
  return host.screen === 'game' && !!host.match && host.match.phase === 'playing' && ui.panel === 'icbm';
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
  if (!match || !aimable()) return;
  const worldX = clampTargetX(camera.toWorldX(clientX));
  const shot = pinTarget(match.player, ui.selectedTier, worldX);
  if (shot) {
    audio.pin();
  } else {
    audio.deny();
    const def = match.player.missileUnlocked[ui.selectedTier - 1];
    gameUI.toast(def ? 'Not enough cash for that missile' : 'That missile is still locked');
  }
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  const match = host.match;
  if (e.key === 'Escape') {
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
const debug = { speed: 1 };
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
