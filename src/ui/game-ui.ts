import {
  AA,
  AA_MAX_PER_TYPE,
  BUILDINGS,
  BOTS,
  MATCH,
  META,
  MISSILES,
  type Difficulty,
} from '../core/config';
import type { MetaSave, PanelId } from '../core/types';
import { audio } from '../core/audio';
import type { OnlineAction } from '../online/actions';
import type { OnlineState } from '../online/service';
import {
  aaCost,
  aaRadius,
  aaReload,
  buildingLimit,
  buyAaRadius,
  buyAaReload,
  buyAmmo,
  buyMissileUpgrade,
  cityValue,
  clearQueue,
  countBuildings,
  commitQueue,
  incomePerTick,
  inPeace,
  missileReload,
  secondsToNextLimit,
  shotsRemaining,
  type Match,
} from '../game/state';
import { nightAmount } from '../render/scene';
import {
  ICON_ABM,
  ICON_BACK,
  ICON_CITY,
  ICON_CLOCK,
  ICON_ICBM,
  ICON_PAUSE,
  ICON_RADIUS,
  ICON_SOUND_OFF,
  ICON_SOUND_ON,
  ICON_STAR,
  ICON_UPGRADE,
  ICON_ZOOM,
  aaIcon,
  abmIcon,
  buildingIcon,
  missileIcon,
} from './icons';

export interface UiState {
  panel: PanelId;
  selectedTier: number;
  ammoMult: 1 | 5 | 10;
  showRings: boolean;
  aimX: number | null;
  difficulty: Difficulty;
  /** Infinity for an unlimited match. */
  duration: number;
  /** Item awaiting a tap on the player's land, or null. */
  placing: { kind: 'building' | 'battery'; type: number } | null;
  /** World x under the cursor while placing. */
  placeX: number | null;
}

export interface UiHost {
  ui: UiState;
  meta: MetaSave;
  match: Match | null;
  online: OnlineState;
  matchMeta(): MetaSave;
  setPanel(panel: PanelId): void;
  startMatch(): void;
  findOnlineMatch(): Promise<void>;
  cancelOnlineQueue(): Promise<void>;
  signUp(username: string, email: string, password: string): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  sendOnlineAction(action: OnlineAction): void;
  saveProgress(): void;
  quitToMenu(): void;
  setPaused(paused: boolean): void;
  toggleZoom(): void;
  openShop(): void;
  closeShop(): void;
  screen: 'menu' | 'shop' | 'game';
}

type CardUpdate = () => void;

const money = (n: number): string => {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

const clock = (s: number): string => {
  const t = Math.max(0, Math.floor(s));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  html?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

export class GameUI {
  private root: HTMLElement;
  private host: UiHost;

  private topbar!: HTMLElement;
  private enemyMoney!: HTMLElement;
  private playerMoney!: HTMLElement;
  private enemyName!: HTMLElement;
  private timeEl!: HTMLElement;
  private redBar!: HTMLElement;
  private statusbar!: HTMLElement;
  private dayIcon!: HTMLElement;
  private ringsBtn!: HTMLButtonElement;

  private dock!: HTMLElement;
  private dockScroll!: HTMLElement;
  private dockBack!: HTMLElement;
  private fightBtn!: HTMLButtonElement;
  private hintEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private overlay!: HTMLElement;

  private cardUpdates: CardUpdate[] = [];
  private builtPanel: PanelId | null = null;
  private overlayKind: 'none' | 'menu' | 'shop' | 'pause' | 'result' | 'upgrades' = 'none';
  private toastTimer = 0;

  constructor(root: HTMLElement, host: UiHost) {
    this.root = root;
    this.host = host;
    this.buildChrome();
  }

  // -------------------------------------------------------------- chrome

  private buildChrome(): void {
    this.root.innerHTML = '';

    // Top bar ------------------------------------------------------------
    this.topbar = el('div', 'topbar');
    const pause = el('button', 'iconbtn', ICON_PAUSE);
    pause.title = 'Pause';
    pause.addEventListener('click', () => {
      if (this.host.match?.mode === 'online') {
        audio.deny();
        this.toast('Online matches cannot be paused');
        return;
      }
      audio.click();
      this.host.setPaused(true);
    });

    const enemyPill = el('div', 'pill enemy');
    enemyPill.innerHTML = `<span class="coin">${ICON_STAR}</span><span></span>`;
    this.enemyMoney = enemyPill.lastElementChild as HTMLElement;

    const score = el('div', 'scorebar');
    score.innerHTML = `<div class="row"><span class="en"></span><span class="time">00:00</span><span>You</span></div>
      <div class="track"><div class="red"></div><div class="blue"></div></div>`;
    this.enemyName = score.querySelector('.en') as HTMLElement;
    this.timeEl = score.querySelector('.time') as HTMLElement;
    this.redBar = score.querySelector('.red') as HTMLElement;

    const zoom = el('button', 'iconbtn', ICON_ZOOM);
    zoom.title = 'Toggle battlefield view';
    zoom.addEventListener('click', () => {
      audio.click();
      this.host.toggleZoom();
    });

    this.ringsBtn = el('button', 'iconbtn', ICON_RADIUS);
    this.ringsBtn.title = 'Show defence radius';
    this.ringsBtn.addEventListener('click', () => {
      audio.click();
      this.host.ui.showRings = !this.host.ui.showRings;
      this.ringsBtn.classList.toggle('on', this.host.ui.showRings);
    });

    this.dayIcon = el('div', 'iconbtn');
    this.dayIcon.style.pointerEvents = 'none';

    const playerPill = el('div', 'pill you');
    playerPill.innerHTML = `<span class="coin">${ICON_STAR}</span><span></span>`;
    this.playerMoney = playerPill.lastElementChild as HTMLElement;

    this.topbar.append(pause, enemyPill, score, zoom, this.ringsBtn, this.dayIcon, playerPill);
    this.root.appendChild(this.topbar);

    // Status chips --------------------------------------------------------
    this.statusbar = el('div', 'statusbar');
    this.root.appendChild(this.statusbar);

    // Dock ----------------------------------------------------------------
    this.dock = el('div', 'dock');
    this.dockScroll = el('div', 'dock-scroll');
    this.dockBack = el('div', 'dock-back');
    const sound = el('button', 'iconbtn');
    sound.style.marginBottom = '22px';
    sound.addEventListener('click', () => {
      const next = !audio.muted;
      audio.setMuted(next);
      this.host.meta.muted = next;
      sound.innerHTML = next ? ICON_SOUND_OFF : ICON_SOUND_ON;
    });
    sound.innerHTML = audio.muted ? ICON_SOUND_OFF : ICON_SOUND_ON;
    this.dock.append(sound, this.dockBack, this.dockScroll);
    this.root.appendChild(this.dock);

    this.fightBtn = el('button', 'fightbtn', 'Fight');
    this.fightBtn.style.display = 'none';
    this.fightBtn.addEventListener('click', () => this.onFight());
    this.root.appendChild(this.fightBtn);

    this.hintEl = el('div', 'hint');
    this.hintEl.style.display = 'none';
    this.root.appendChild(this.hintEl);

    this.toastEl = el('div', 'toast');
    this.root.appendChild(this.toastEl);

    this.overlay = el('div', 'overlay');
    this.overlay.style.display = 'none';
    this.root.appendChild(this.overlay);
  }

  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 1500);
  }

  /** Rebuilds the current overlay after account or queue state changes. */
  refreshOverlay(): void {
    this.overlayKind = 'none';
  }

  // ------------------------------------------------------------ per frame

  sync(): void {
    const { match, ui, meta } = this.host;
    const inGame = this.host.screen === 'game' && match !== null;

    this.topbar.style.display = inGame ? '' : 'none';
    this.statusbar.style.display = inGame ? '' : 'none';
    this.dock.style.display = inGame ? '' : 'none';

    if (inGame && match) {
      this.syncTop(match);
      this.syncStatus(match);
      if (this.builtPanel !== ui.panel) this.buildDock();
      for (const u of this.cardUpdates) u();
      this.syncFightBar(match);
    } else {
      this.fightBtn.style.display = 'none';
      this.hintEl.style.display = 'none';
    }

    this.syncOverlay(inGame ? match : null, meta);
  }

  private syncTop(match: Match): void {
    this.enemyMoney.textContent = money(match.enemy.money);
    this.playerMoney.textContent = money(match.player.money);
    this.enemyName.textContent = match.enemy.name;
    this.timeEl.textContent = isFinite(match.duration)
      ? `${clock(match.time)} / ${clock(match.duration)}`
      : `${clock(match.time)} · ∞`;
    const pv = cityValue(match.player);
    const ev = cityValue(match.enemy);
    const total = pv + ev;
    const redShare = total > 0 ? ev / total : 0.5;
    this.redBar.style.width = `${(redShare * 100).toFixed(1)}%`;

    const night = nightAmount(match);
    this.dayIcon.innerHTML =
      night > 0.5
        ? `<svg viewBox="0 0 64 64"><path d="M40 8 a24 24 0 1 0 16 34 A20 20 0 0 1 40 8 Z" fill="#dfe6f2"/></svg>`
        : `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="13" fill="#ffd447"/>${Array.from(
            { length: 8 },
            (_, i) => {
              const a = (i * Math.PI) / 4;
              const x1 = 32 + Math.cos(a) * 19;
              const y1 = 32 + Math.sin(a) * 19;
              const x2 = 32 + Math.cos(a) * 26;
              const y2 = 32 + Math.sin(a) * 26;
              return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="#ffd447" stroke-width="5" stroke-linecap="round"/>`;
            },
          ).join('')}</svg>`;
  }

  private syncStatus(match: Match): void {
    const chips: string[] = [];
    if (inPeace(match)) {
      chips.push(`<div class="chip peace">CEASEFIRE <b>${clock(MATCH.peaceSeconds - match.time)}</b></div>`);
    } else {
      chips.push(`<div class="chip war">WEAPONS FREE</div>`);
    }
    chips.push(`<div class="chip income">INCOME <b>+${money(incomePerTick(match.player))}</b> / 2s</div>`);
    if (match.mode === 'online') chips.push('<div class="chip"><b>ONLINE</b> · equal base loadout</div>');
    const next = secondsToNextLimit(match);
    if (isFinite(next)) chips.push(`<div class="chip">BUILD LIMIT +1 in <b>${clock(next)}</b></div>`);
    else chips.push(`<div class="chip">BUILD LIMIT MAXED</div>`);
    const incoming = match.missiles.filter((m) => m.side === 'enemy').length;
    if (incoming > 0) chips.push(`<div class="chip war">INCOMING <b>${incoming}</b></div>`);
    if (window.innerHeight > window.innerWidth) {
      chips.push('<div class="chip">↻ Turn your phone sideways for the full battlefield</div>');
    }
    this.statusbar.innerHTML = chips.join('');
  }

  private syncFightBar(match: Match): void {
    const ui = this.host.ui;
    const aiming = ui.panel === 'icbm';
    const queued = match.player.queued.length;
    const pending = match.player.pending.length;
    this.fightBtn.style.display = aiming && ui.placing === null ? '' : 'none';
    this.fightBtn.classList.toggle('dim', queued === 0 || inPeace(match));
    this.fightBtn.textContent = queued > 0 ? `Fight (${queued})` : 'Fight';

    if (ui.placing !== null) {
      this.hintEl.style.display = '';
      if (ui.placing.kind === 'building') {
        const def = BUILDINGS[ui.placing.type];
        this.hintEl.innerHTML = `Tap a free plot on <b>your land</b> to build ${def.name} (<b>$${def.cost}</b>). Tap its card again to cancel.`;
      } else {
        const def = AA[ui.placing.type];
        const price = aaCost(match.player, ui.placing.type);
        this.hintEl.innerHTML = `Tap anywhere on <b>your land</b> to site the ${def.interceptsTier === 0 ? 'radar' : `${def.name} ${def.roman}`} (<b>$${price}</b>). Tap its card again to cancel.`;
      }
      return;
    }

    if (aiming) {
      this.hintEl.style.display = '';
      if (inPeace(match)) {
        this.hintEl.innerHTML = `Ceasefire for <b>${clock(MATCH.peaceSeconds - match.time)}</b> — you can still pin targets now.`;
      } else if (queued === 0 && pending === 0) {
        const def = MISSILES[ui.selectedTier - 1];
        this.hintEl.innerHTML = `Pick a missile, then <b>tap their city</b> to pin a target. ${def.roman} costs <b>$${def.cost}</b> a shot.`;
      } else {
        this.hintEl.innerHTML = `<b>${queued}</b> pinned · <b>${pending}</b> in the tube — press <b>Fight</b> to launch.`;
      }
    } else if (ui.panel === 'none' && match.player.buildings.length === 0) {
      this.hintEl.style.display = '';
      this.hintEl.innerHTML = `Open <b>Buildings</b> and put up your first block — every building pays out every 2 seconds.`;
    } else {
      this.hintEl.style.display = 'none';
    }
  }

  private onFight(): void {
    const match = this.host.match;
    if (!match) return;
    if (match.player.queued.length === 0) {
      audio.deny();
      this.toast('Pin at least one target first');
      return;
    }
    const n = commitQueue(match.player);
    if (n > 0) this.host.sendOnlineAction({ type: 'commit-targets' });
    audio.buy();
    this.toast(`${n} ${n === 1 ? 'missile' : 'missiles'} away`);
  }

  // ----------------------------------------------------------------- dock

  private buildDock(): void {
    const ui = this.host.ui;
    this.builtPanel = ui.panel;
    this.cardUpdates = [];
    this.dockScroll.innerHTML = '';
    this.dockBack.innerHTML = '';
    if (ui.panel !== 'none') this.dockBack.appendChild(this.backCard());

    switch (ui.panel) {
      case 'none':
        this.buildRootPanel();
        break;
      case 'buildings':
        this.buildBuildingsPanel();
        break;
      case 'antiair':
        this.buildAntiAirPanel();
        break;
      case 'abm':
        this.buildAbmPanel();
        break;
      case 'icbm':
        this.buildIcbmPanel();
        break;
      case 'upgrades':
        break;
    }
    this.dockScroll.scrollLeft = 0;
  }

  private card(opts: {
    art: string;
    cost?: string;
    count?: string;
    tier?: string;
    meta?: string;
    delta?: string;
    ring?: string;
    big?: boolean;
    title?: string;
    onClick: () => void;
    update?: (parts: {
      root: HTMLElement;
      cost: HTMLElement;
      count: HTMLElement;
      meta: HTMLElement;
      delta: HTMLElement;
    }) => void;
  }): HTMLElement {
    const root = el('button', `card${opts.big ? ' big' : ''}`);
    if (opts.title) root.title = opts.title;
    const art = el('div', 'art', opts.art);
    const cost = el('div', 'cost', opts.cost ?? '');
    const count = el('div', 'count', opts.count ?? '');
    const metaEl = el('div', 'meta', opts.meta ?? '');
    const delta = el('div', 'delta', opts.delta ?? '');
    root.append(art, metaEl, count, cost, delta);
    if (opts.tier) {
      const t = el('div', 'tier', opts.tier);
      root.appendChild(t);
    }
    if (opts.ring) {
      const r = el('div', 'ring');
      r.style.background = opts.ring;
      root.appendChild(r);
    }
    root.addEventListener('click', opts.onClick);
    if (opts.update) {
      const parts = { root, cost, count, meta: metaEl, delta };
      const fn = () => opts.update!(parts);
      this.cardUpdates.push(fn);
      fn();
    }
    this.dockScroll.appendChild(root);
    return root;
  }

  private backCard(): HTMLElement {
    const b = el('button', 'card');
    b.innerHTML = `<div class="art">${ICON_BACK}</div>`;
    b.title = 'Back';
    b.addEventListener('click', () => {
      audio.click();
      this.host.setPanel('none');
    });
    return b;
  }

  private buildRootPanel(): void {
    const entries: { icon: string; label: string; panel: PanelId }[] = [
      { icon: ICON_UPGRADE, label: 'Upgrades', panel: 'upgrades' },
      { icon: ICON_CITY, label: 'Build', panel: 'buildings' },
      { icon: aaIcon(3), label: 'Anti-Air', panel: 'antiair' },
      { icon: ICON_ABM, label: 'ABM', panel: 'abm' },
      { icon: ICON_ICBM, label: 'ICBM', panel: 'icbm' },
    ];
    for (const e of entries) {
      this.card({
        art: e.icon,
        cost: e.label,
        title: e.label,
        onClick: () => {
          audio.click();
          this.host.setPanel(e.panel);
        },
      });
    }
  }

  private buildBuildingsPanel(): void {
    for (const def of BUILDINGS) {
      this.card({
        art: buildingIcon(def.id),
        cost: `$${def.cost}`,
        title: `${def.name} — +$${def.income}/2s, ${def.hp} HP`,
        onClick: () => {
          const match = this.host.match;
          if (!match) return;
          const ui = this.host.ui;
          if (ui.placing?.kind === 'building' && ui.placing.type === def.id) {
            ui.placing = null;
            ui.placeX = null;
            audio.click();
            return;
          }
          if (countBuildings(match.player, def.id) >= buildingLimit(match, def.id)) {
            audio.deny();
            this.toast('Build limit reached — wait for the next unlock');
            return;
          }
          if (match.player.money < def.cost) {
            audio.deny();
            this.toast('Not enough cash');
            return;
          }
          ui.placing = { kind: 'building', type: def.id };
          ui.placeX = null;
          audio.click();
          this.toast('Tap your land to place it');
        },
        update: ({ root, count }) => {
          const match = this.host.match;
          if (!match) return;
          const limit = buildingLimit(match, def.id);
          const built = countBuildings(match.player, def.id);
          count.textContent = `${built}/${limit}`;
          root.classList.toggle('dim', built >= limit || match.player.money < def.cost);
          root.classList.toggle(
            'sel',
            this.host.ui.placing?.kind === 'building' && this.host.ui.placing.type === def.id,
          );
        },
      });
    }
  }

  private buildAntiAirPanel(): void {
    for (const def of AA) {
      this.card({
        art: aaIcon(def.id),
        tier: def.roman,
        ring: def.color,
        title:
          def.interceptsTier === 0
            ? 'Radar — early warning: impact markers appear seconds sooner and off-screen missiles get tracked'
            : `${def.name} — intercepts tier ${def.roman} missiles only`,
        onClick: () => {
          const match = this.host.match;
          if (!match) return;
          const ui = this.host.ui;
          if (ui.placing?.kind === 'battery' && ui.placing.type === def.id) {
            ui.placing = null;
            ui.placeX = null;
            audio.click();
            return;
          }
          if (match.player.aaOwned[def.id] >= AA_MAX_PER_TYPE) {
            audio.deny();
            this.toast(`Max ${AA_MAX_PER_TYPE} of each system`);
            return;
          }
          const price = aaCost(match.player, def.id);
          if (match.player.money < price) {
            audio.deny();
            this.toast('Not enough cash');
            return;
          }
          ui.placing = { kind: 'battery', type: def.id };
          ui.placeX = null;
          ui.showRings = true;
          this.ringsBtn.classList.add('on');
          audio.click();
          this.toast('Tap your land to place it');
        },
        update: ({ root, count, cost }) => {
          const match = this.host.match;
          if (!match) return;
          const owned = match.player.aaOwned[def.id];
          count.textContent = `${owned}/${AA_MAX_PER_TYPE}`;
          const price = aaCost(match.player, def.id);
          cost.textContent = !isFinite(price) ? 'MAX' : price === 0 ? 'Free +1' : `$${price}`;
          root.classList.toggle('dim', !isFinite(price) || match.player.money < price);
          root.classList.toggle(
            'sel',
            this.host.ui.placing?.kind === 'battery' && this.host.ui.placing.type === def.id,
          );
        },
      });
    }
  }

  private buildAbmPanel(): void {
    const mult = el('button', 'card');
    mult.innerHTML = `<div class="art" style="font-size:26px;font-weight:900;color:#1b2028">x${this.host.ui.ammoMult}</div>`;
    mult.title = 'Rounds bought per tap';
    mult.addEventListener('click', () => {
      audio.click();
      const order: (1 | 5 | 10)[] = [1, 5, 10];
      const i = order.indexOf(this.host.ui.ammoMult);
      this.host.ui.ammoMult = order[(i + 1) % order.length];
      (mult.firstElementChild as HTMLElement).textContent = `x${this.host.ui.ammoMult}`;
    });
    this.dockScroll.appendChild(mult);

    for (const def of AA) {
      if (def.interceptsTier === 0) continue;
      this.card({
        art: abmIcon(def.id),
        tier: def.roman,
        ring: def.color,
        cost: `$${def.ammoCost}`,
        title: `${def.name} rounds — each one can knock down a single tier ${def.roman} missile`,
        onClick: () => {
          const match = this.host.match;
          if (!match) return;
          if (match.player.aaOwned[def.id] === 0) {
            audio.deny();
            this.toast(`Build an ${def.name} launcher first`);
            return;
          }
          const n = buyAmmo(match.player, def.id, this.host.ui.ammoMult);
          if (n > 0) {
            audio.buy();
            this.host.sendOnlineAction({ type: 'buy-ammo', batteryType: def.id, count: n });
          }
          else {
            audio.deny();
            this.toast(match.player.ammo[def.id] >= def.ammoCap ? 'Magazine full' : 'Not enough cash');
          }
        },
        update: ({ root, count }) => {
          const match = this.host.match;
          if (!match) return;
          count.textContent = String(match.player.ammo[def.id]);
          const noLauncher = match.player.aaOwned[def.id] === 0;
          root.classList.toggle('dim', noLauncher || match.player.money < def.ammoCost);
        },
      });
    }
  }

  private buildIcbmPanel(): void {
    const undo = el('button', 'card');
    undo.innerHTML = `<div class="art" style="font-size:12px;font-weight:900;color:#1b2028;text-align:center;line-height:1.2">CLEAR<br>PINS</div>`;
    undo.addEventListener('click', () => {
      const match = this.host.match;
      if (!match) return;
      if (match.player.queued.length === 0) {
        audio.deny();
        return;
      }
      clearQueue(match.player);
      this.host.sendOnlineAction({ type: 'clear-targets' });
      audio.click();
      this.toast('Targets cleared, cash refunded');
    });
    this.dockScroll.appendChild(undo);

    for (const def of MISSILES) {
      this.card({
        art: missileIcon(def.tier),
        tier: def.roman,
        cost: `$${def.cost}`,
        title: `${def.name} — ${def.damage} dmg, ${def.speed} m/s${def.unstoppable ? ', cannot be intercepted' : `, stopped only by anti-air ${def.roman}`}`,
        onClick: () => {
          const match = this.host.match;
          if (!match) return;
          if (!match.player.missileUnlocked[def.tier - 1]) {
            audio.deny();
            this.toast(`Unlock ${def.name} in Upgrades ($${def.unlockCost})`);
            return;
          }
          audio.click();
          this.host.ui.selectedTier = def.tier;
          for (const u of this.cardUpdates) u();
        },
        update: ({ root, count, meta }) => {
          const match = this.host.match;
          if (!match) return;
          const unlocked = match.player.missileUnlocked[def.tier - 1];
          const sel = this.host.ui.selectedTier === def.tier;
          root.classList.toggle('sel', sel && unlocked);
          root.classList.toggle('dim', !unlocked);
          const pinned =
            match.player.queued.filter((q) => q.tier === def.tier).length +
            match.player.pending.filter((q) => q.tier === def.tier).length;
          if (def.perMatchLimit > 0) {
            const left = Math.max(0, shotsRemaining(match.player, def.tier));
            count.textContent = `${left}/${def.perMatchLimit}`;
          } else {
            count.textContent = pinned > 0 ? `+${pinned}` : '';
          }
          const cd = match.player.launchCooldown[def.tier - 1];
          meta.textContent = !unlocked ? '\u{1F512}' : cd > 0.05 ? `${cd.toFixed(1)}s` : '';
        },
      });
    }
  }

  // ------------------------------------------------------------- overlays

  private syncOverlay(match: Match | null, meta: MetaSave): void {
    const want: typeof this.overlayKind =
      this.host.screen === 'menu'
        ? 'menu'
        : this.host.screen === 'shop'
          ? 'shop'
          : match?.phase === 'over'
            ? 'result'
            : match?.phase === 'paused'
              ? 'pause'
              : this.host.ui.panel === 'upgrades'
                ? 'upgrades'
                : 'none';

    if (want !== this.overlayKind) {
      this.overlayKind = want;
      this.overlay.className = `overlay${want === 'upgrades' ? ' upgrades' : ''}`;
      this.overlay.innerHTML = '';
      this.overlay.style.display = want === 'none' ? 'none' : '';
      this.upgradeUpdates = [];
      if (want === 'menu') this.buildMenu(meta);
      else if (want === 'shop') this.buildShop(meta);
      else if (want === 'pause') this.buildPause();
      else if (want === 'result' && match) this.buildResult(match, meta);
      else if (want === 'upgrades' && match) this.buildUpgrades(match);
    }
    if (want === 'upgrades') for (const u of this.upgradeUpdates) u();
  }

  private upgradeUpdates: CardUpdate[] = [];

  private buildMenu(meta: MetaSave): void {
    const ui = this.host.ui;
    const wrap = el('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;width:min(760px,100%);margin:auto 0;';

    wrap.appendChild(el('h1', undefined, 'Final Skyline'));
    const stars = el('div', 'starline', `${ICON_STAR}<span>${meta.stars}</span>`);
    wrap.appendChild(stars);
    wrap.appendChild(
      el(
        'p',
        'sub',
        'Build a city that pays you every two seconds, screen it with layered anti-air, and flatten theirs before the clock runs out. Ceasefire holds for the first two minutes.',
      ),
    );

    const grid = el('div', 'diffgrid');
    (Object.keys(BOTS) as Difficulty[]).forEach((d) => {
      const b = el('button', `diff${ui.difficulty === d ? ' sel' : ''}`);
      b.innerHTML = `<div class="t">${BOTS[d].label}</div><div class="d">${BOTS[d].blurb}</div>`;
      b.addEventListener('click', () => {
        audio.click();
        ui.difficulty = d;
        grid.querySelectorAll('.diff').forEach((n) => n.classList.remove('sel'));
        b.classList.add('sel');
      });
      grid.appendChild(b);
    });
    wrap.appendChild(grid);

    const lenRow = el('div', 'row center');
    lenRow.style.marginTop = '4px';
    const lengths: { label: string; value: number }[] = [
      { label: '5 min', value: 300 },
      { label: '10 min', value: 600 },
      { label: '15 min', value: 900 },
      { label: 'Unlimited', value: Infinity },
    ];
    for (const len of lengths) {
      const b = el('button', 'btn ghost', len.label);
      if (ui.duration === len.value) b.style.borderColor = 'var(--gold)';
      b.addEventListener('click', () => {
        audio.click();
        ui.duration = len.value;
        lenRow.querySelectorAll('button').forEach((n) => ((n as HTMLElement).style.borderColor = ''));
        b.style.borderColor = 'var(--gold)';
      });
      lenRow.appendChild(b);
    }
    wrap.appendChild(lenRow);
    const lenNote = el(
      'p',
      'sub',
      'An unlimited match runs until one city is levelled — lose every building and fail to rebuild within ' +
        `${MATCH.wipeoutGraceSeconds} seconds and it is over.`,
    );
    lenNote.style.margin = '2px 0 0';
    lenNote.style.fontSize = '12px';
    wrap.appendChild(lenNote);

    const actions = el('div', 'row center');
    actions.style.marginTop = '10px';
    const play = el('button', 'btn primary', 'Play');
    play.addEventListener('click', () => {
      audio.init();
      audio.click();
      this.host.startMatch();
    });
    const shop = el('button', 'btn', 'Star Shop');
    shop.addEventListener('click', () => {
      audio.click();
      this.host.openShop();
    });
    actions.append(play, shop);
    wrap.appendChild(actions);

    wrap.appendChild(this.buildOnlineCard());

    const record = el(
      'p',
      'sub',
      `Record: <b style="color:#59e07a">${meta.wins}W</b> / <b style="color:#ff5a4d">${meta.losses}L</b>`,
    );
    record.style.marginTop = '12px';
    wrap.appendChild(record);

    const help = el('details');
    help.style.cssText = 'max-width:620px;color:#aab4c0;font-size:13px;line-height:1.6;margin-top:6px;';
    help.innerHTML = `<summary style="cursor:pointer;font-weight:800;color:#dfe6ee;padding:6px 0">How it works</summary>
      <ul style="padding-left:18px;margin:6px 0">
        <li><b>Buildings</b> pay income every 2 seconds. Pick a type, then tap a free plot on your land to place it. Each type has a cap that rises by one every ${MATCH.limitStepSeconds / 60} minutes; a levelled building frees its slot so you can rebuild.</li>
        <li><b>Anti-air</b> comes in five tiers plus a radar. A tier ${'Ⅰ'}–${'Ⅴ'} battery only stops the matching missile tier — max two of each. Pick a system, then tap your own land to site it wherever you like. Batteries can be bombed, and replaced once they are.</li>
        <li><b>ABM rounds</b> are the ammunition. An empty battery cannot intercept anything.</li>
        <li><b>Upgrades</b> (in-match, paid in cash) widen defence radius, cut anti-air reload, and unlock heavier missiles.</li>
        <li><b>Attacking</b>: open ICBM, pick a tier, tap their city to pin targets, then hit Fight. Each tier launches on its own reload timer.</li>
        <li><b>Stars</b> earned from matches buy permanent radius and reload upgrades in the Star Shop.</li>
      </ul>`;
    wrap.appendChild(help);

    this.overlay.appendChild(wrap);
  }

  private buildOnlineCard(): HTMLElement {
    const state = this.host.online;
    const card = el('section', 'online-card');
    const title = el('div', 'online-title', '<span>Online Match</span><span class="online-beta">BETA</span>');
    card.appendChild(title);

    if (!state.configured || state.phase === 'disabled') {
      card.appendChild(el('p', 'online-message', state.message));
      return card;
    }

    if (!state.username) {
      const fields = el('div', 'auth-fields');
      const username = el('input', 'auth-input');
      username.placeholder = 'Username (for sign up)';
      username.autocomplete = 'username';
      username.maxLength = 20;
      const email = el('input', 'auth-input');
      email.type = 'email';
      email.placeholder = 'Email';
      email.autocomplete = 'email';
      const password = el('input', 'auth-input');
      password.type = 'password';
      password.placeholder = 'Password';
      password.autocomplete = 'current-password';
      fields.append(username, email, password);
      card.appendChild(fields);

      const row = el('div', 'online-actions');
      const signUp = el('button', 'btn primary', 'Create account');
      const signIn = el('button', 'btn ghost', 'Sign in');
      const busy = state.phase === 'loading';
      signUp.disabled = busy;
      signIn.disabled = busy;
      const submit = (action: () => Promise<void>) => {
        audio.init();
        audio.click();
        void action();
      };
      signUp.addEventListener('click', () => submit(() => this.host.signUp(username.value, email.value, password.value)));
      signIn.addEventListener('click', () => submit(() => this.host.signIn(email.value, password.value)));
      password.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') submit(() => this.host.signIn(email.value, password.value));
      });
      row.append(signUp, signIn);
      card.appendChild(row);
    } else {
      const profile = el('div', 'online-profile');
      const name = el('strong');
      name.textContent = state.username;
      const record = el('span');
      record.textContent = `${state.wins}W / ${state.losses}L · ${state.stars} stars`;
      profile.append(name, record);
      card.appendChild(profile);

      const row = el('div', 'online-actions');
      if (state.phase === 'queueing') {
        const cancel = el('button', 'btn ghost', 'Cancel search');
        cancel.addEventListener('click', () => {
          audio.click();
          void this.host.cancelOnlineQueue();
        });
        row.appendChild(cancel);
      } else {
        const duration = [300, 600, 900].includes(this.host.ui.duration) ? this.host.ui.duration : 600;
        const queue = el('button', 'btn primary', `Queue · ${duration / 60} min`);
        queue.disabled = state.phase === 'loading';
        queue.addEventListener('click', () => {
          audio.init();
          audio.click();
          void this.host.findOnlineMatch();
        });
        const signOut = el('button', 'btn ghost', 'Sign out');
        signOut.addEventListener('click', () => {
          audio.click();
          void this.host.signOut();
        });
        row.append(queue, signOut);
      }
      card.appendChild(row);
    }

    const message = el('p', `online-message${state.phase === 'error' ? ' error' : ''}`);
    message.textContent = state.message;
    card.appendChild(message);
    return card;
  }

  private buildShop(meta: MetaSave): void {
    const wrap = el('div');
    wrap.style.cssText = 'width:min(900px,100%);margin:auto 0;';
    const head = el('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;';
    const back = el('button', 'btn ghost', '← Back');
    back.addEventListener('click', () => {
      audio.click();
      this.host.closeShop();
    });
    const starEl = el('div', 'starline', `${ICON_STAR}<span>${meta.stars}</span>`);
    head.append(back, starEl);
    wrap.appendChild(head);
    wrap.appendChild(el('h2', undefined, 'Star Shop'));
    wrap.appendChild(
      el('p', 'sub', 'Permanent upgrades. They carry into every match you play from now on.'),
    );

    const refresh = () => {
      (starEl.lastElementChild as HTMLElement).textContent = String(meta.stars);
      wrap.querySelectorAll<HTMLElement>('.shopcard').forEach((n) => n.dispatchEvent(new CustomEvent('refresh')));
    };

    const section = (title: string, cards: HTMLElement[]) => {
      wrap.appendChild(el('h2', undefined, title));
      const g = el('div', 'shopgrid');
      cards.forEach((c) => g.appendChild(c));
      wrap.appendChild(g);
    };

    const shopCard = (
      icon: string,
      name: string,
      value: () => string,
      level: () => number,
      maxLevel: number,
      price: (lv: number) => number,
      buy: () => void,
    ): HTMLElement => {
      const c = el('button', 'shopcard');
      const ic = el('div', 'ic', icon);
      const txt = el('div', 'txt');
      const n = el('div', 'n', name);
      const v = el('div', 'v');
      txt.append(n, v);
      const p = el('div', 'p');
      c.append(ic, txt, p);
      const update = () => {
        const lv = level();
        const maxed = lv >= maxLevel;
        v.textContent = `${value()} · Lv ${lv}/${maxLevel}`;
        p.innerHTML = maxed ? 'MAX' : `${ICON_STAR}<span>${price(lv)}</span>`;
        c.classList.toggle('dim', maxed || meta.stars < price(lv));
      };
      c.addEventListener('refresh', update);
      c.addEventListener('click', () => {
        const lv = level();
        if (lv >= maxLevel) {
          audio.deny();
          return;
        }
        const cost = price(lv);
        if (meta.stars < cost) {
          audio.deny();
          this.toast('Not enough stars');
          return;
        }
        meta.stars -= cost;
        buy();
        audio.buy();
        this.host.saveProgress();
        refresh();
      });
      update();
      return c;
    };

    section(
      `Defence radius (+${META.radiusStep} m per level)`,
      AA.map((def) =>
        shopCard(
          aaIcon(def.id),
          def.interceptsTier === 0 ? 'Radar' : `${def.name} ${def.roman}`,
          () => `${def.baseRadius + meta.radiusLevel[def.id] * META.radiusStep} m`,
          () => meta.radiusLevel[def.id],
          META.radiusMaxLevel,
          META.radiusCost,
          () => meta.radiusLevel[def.id]++,
        ),
      ),
    );

    section(
      `Anti-air reload (−${META.aaReloadStep}s per level)`,
      AA.filter((d) => d.interceptsTier > 0).map((def) =>
        shopCard(
          abmIcon(def.id),
          `${def.name} ${def.roman}`,
          () =>
            `${Math.max(META.minReload, def.baseReload - meta.aaReloadLevel[def.id] * META.aaReloadStep).toFixed(2)}s`,
          () => meta.aaReloadLevel[def.id],
          META.aaReloadMaxLevel,
          META.aaReloadCost,
          () => meta.aaReloadLevel[def.id]++,
        ),
      ),
    );

    section(
      `Missile reload (−${META.missileReloadStep}s per level)`,
      MISSILES.map((def) =>
        shopCard(
          missileIcon(def.tier),
          `${def.name} ${def.roman}`,
          () =>
            `${Math.max(META.minReload, def.reload - meta.missileReloadLevel[def.tier - 1] * META.missileReloadStep).toFixed(2)}s`,
          () => meta.missileReloadLevel[def.tier - 1],
          META.missileReloadMaxLevel,
          META.missileReloadCost,
          () => meta.missileReloadLevel[def.tier - 1]++,
        ),
      ),
    );

    this.overlay.appendChild(wrap);
  }

  private buildPause(): void {
    const wrap = el('div');
    wrap.style.cssText = 'margin:auto 0;text-align:center;width:min(420px,100%);';
    wrap.appendChild(el('h2', undefined, 'Paused'));
    const row = el('div');
    row.style.cssText = 'display:flex;flex-direction:column;gap:10px;margin-top:10px;';
    const resume = el('button', 'btn primary', 'Resume');
    resume.addEventListener('click', () => {
      audio.click();
      this.host.setPaused(false);
    });
    const soundBtn = el('button', 'btn ghost', audio.muted ? 'Sound: off' : 'Sound: on');
    soundBtn.addEventListener('click', () => {
      const next = !audio.muted;
      audio.setMuted(next);
      this.host.meta.muted = next;
      soundBtn.textContent = next ? 'Sound: off' : 'Sound: on';
    });
    const quit = el('button', 'btn ghost', 'Quit to menu');
    quit.addEventListener('click', () => {
      audio.click();
      this.host.quitToMenu();
    });
    row.append(resume, soundBtn, quit);
    wrap.appendChild(row);
    this.overlay.appendChild(wrap);
  }

  private buildResult(match: Match, meta: MetaSave): void {
    const r = match.result!;
    const wrap = el('div', 'result');
    wrap.style.margin = 'auto 0';
    wrap.appendChild(el('div', `verdict ${r.won ? 'win' : 'loss'}`, r.won ? 'Victory' : 'Defeat'));
    wrap.appendChild(el('p', 'sub', r.reason));

    const stars = el('div', 'starline');
    stars.style.justifyContent = 'center';
    stars.innerHTML = `${ICON_STAR}<span>+${r.stars}</span><span style="font-size:14px;color:#9fb0c4;font-weight:700">(${meta.stars} total)</span>`;
    wrap.appendChild(stars);

    const s = match.player.stats;
    const grid = el('div', 'statgrid');
    const stat = (k: string, v: string) => {
      const d = el('div', 'stat');
      d.innerHTML = `<div class="k">${k}</div><div class="v">${v}</div>`;
      grid.appendChild(d);
    };
    stat('Your city', `$${r.playerValue}`);
    stat('Their city', `$${r.enemyValue}`);
    stat('Missiles fired', String(s.launched));
    stat('Shot down for you', String(s.intercepted));
    stat('Buildings lost', String(s.destroyedBuildings));
    stat('Buildings razed', String(match.enemy.stats.destroyedBuildings));
    wrap.appendChild(grid);

    const row = el('div', 'row center');
    const again = el('button', 'btn primary', match.mode === 'online' ? 'Back to online' : 'Play again');
    again.addEventListener('click', () => {
      audio.click();
      if (match.mode === 'online') this.host.quitToMenu();
      else this.host.startMatch();
    });
    const shop = el('button', 'btn', 'Star Shop');
    shop.addEventListener('click', () => {
      audio.click();
      this.host.openShop();
    });
    const menu = el('button', 'btn ghost', 'Main menu');
    menu.addEventListener('click', () => {
      audio.click();
      this.host.quitToMenu();
    });
    row.append(again, shop, menu);
    wrap.appendChild(row);
    this.overlay.appendChild(wrap);
  }

  private buildUpgrades(match: Match): void {
    const meta = this.host.matchMeta();
    const wrap = el('div');
    wrap.style.cssText = 'width:min(1080px,100%);margin:auto 0;';

    const head = el('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;';
    const back = el('button', 'btn ghost', '← Back');
    back.addEventListener('click', () => {
      audio.click();
      this.host.setPanel('none');
    });
    const cash = el('div', 'starline');
    cash.innerHTML = `${ICON_STAR}<span class="cash"></span>`;
    head.append(back, cash);
    wrap.appendChild(head);
    this.upgradeUpdates.push(() => {
      (cash.querySelector('.cash') as HTMLElement).textContent = money(match.player.money);
    });

    const mkRow = (title: string, cards: HTMLElement[]) => {
      wrap.appendChild(el('h2', undefined, title));
      const row = el('div', 'row center');
      cards.forEach((c) => row.appendChild(c));
      wrap.appendChild(row);
    };

    const upgradeCard = (
      art: string,
      tier: string,
      ring: string,
      head1: () => string,
      price: () => string,
      delta: string,
      canBuy: () => boolean,
      onBuy: () => boolean,
      title: string,
    ): HTMLElement => {
      const root = el('button', 'card split');
      root.title = title;
      const artEl = el('div', 'art', art);
      const metaEl = el('div', 'meta');
      const costEl = el('div', 'cost');
      const deltaEl = el('div', 'delta', delta);
      const tierEl = el('div', 'tier', tier);
      const ringEl = el('div', 'ring');
      ringEl.style.background = ring;
      root.append(artEl, metaEl, tierEl, costEl, deltaEl, ringEl);
      root.addEventListener('click', () => {
        if (!canBuy()) {
          audio.deny();
          this.toast('Not enough cash');
          return;
        }
        if (onBuy()) audio.buy();
        else audio.deny();
      });
      this.upgradeUpdates.push(() => {
        metaEl.textContent = head1();
        costEl.textContent = price();
        root.classList.toggle('dim', !canBuy());
      });
      return root;
    };

    mkRow(
      'Upgrade defence radius',
      AA.map((def) =>
        upgradeCard(
          aaIcon(def.id),
          def.roman,
          def.color,
          () => `${Math.round(aaRadius(match.player, def.id, meta))}m`,
          () => `$${match.player.aaRadiusPrice[def.id]}`,
          `+${def.radiusStep}m`,
          () => match.player.money >= match.player.aaRadiusPrice[def.id],
          () => {
            const bought = buyAaRadius(match.player, def.id);
            if (bought) this.host.sendOnlineAction({ type: 'aa-radius', batteryType: def.id });
            return bought;
          },
          `${def.interceptsTier === 0 ? 'Radar' : def.name} coverage`,
        ),
      ),
    );

    mkRow(
      'Upgrade to reduce anti-air reload',
      AA.filter((d) => d.interceptsTier > 0).map((def) =>
        upgradeCard(
          aaIcon(def.id),
          def.roman,
          def.color,
          () => `${aaReload(match.player, def.id, meta).toFixed(2)}s`,
          () => `$${match.player.aaReloadPrice[def.id]}`,
          `-${def.reloadStep}s`,
          () => match.player.money >= match.player.aaReloadPrice[def.id],
          () => {
            const bought = buyAaReload(match.player, def.id, meta);
            if (bought) this.host.sendOnlineAction({ type: 'aa-reload', batteryType: def.id });
            return bought;
          },
          `${def.name} rate of fire`,
        ),
      ),
    );

    mkRow(
      'Unlock missiles / reduce launch reload',
      MISSILES.map((def) => {
        const i = def.tier - 1;
        return upgradeCard(
          missileIcon(def.tier),
          def.roman,
          def.color,
          () => `${missileReload(match.player, def.tier, meta).toFixed(2)}s`,
          () =>
            match.player.missileUnlocked[i] ? `$${match.player.missileReloadPrice[i]}` : `$${def.unlockCost}`,
          '',
          () =>
            match.player.money >=
            (match.player.missileUnlocked[i] ? match.player.missileReloadPrice[i] : def.unlockCost),
          () => {
            const bought = buyMissileUpgrade(match.player, def.tier, meta) !== false;
            if (bought) this.host.sendOnlineAction({ type: 'missile-upgrade', tier: def.tier });
            return bought;
          },
          `${def.name} — ${def.damage} damage, ${def.speed} m/s`,
        );
      }),
    );

    // The delta labels on the missile row switch between Unlock and -0.1s.
    this.upgradeUpdates.push(() => {
      const rows = wrap.querySelectorAll('.row');
      const missileRow = rows[rows.length - 1];
      missileRow.querySelectorAll('.card').forEach((card, i) => {
        const d = card.querySelector('.delta') as HTMLElement;
        d.textContent = match.player.missileUnlocked[i] ? `-${MISSILES[i].reloadStep}s` : 'Unlock';
        d.style.color = match.player.missileUnlocked[i] ? '#1a9c46' : '#0d7a35';
      });
    });

    const legend = el('div', 'legend');
    legend.innerHTML = AA.map(
      (d) =>
        `<div class="li"><span class="sw" style="background:${d.color}"></span>${d.interceptsTier === 0 ? 'Radar' : `${d.name} ${d.roman}`}</div>`,
    ).join('');
    wrap.appendChild(legend);
    const note = el(
      'p',
      'sub',
      'Anti-air tier ' +
        'Ⅰ–Ⅴ' +
        ' only stops the matching missile tier. Prices rise with every purchase, and everything here resets at the end of the match — permanent upgrades live in the Star Shop.',
    );
    wrap.appendChild(note);

    this.overlay.appendChild(wrap);
  }
}

export { money as formatMoney, clock as formatClock };
export { ICON_CLOCK };
