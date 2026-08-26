import { WORLD } from '../core/config';

export type ZoomMode = 'city' | 'wide';

/** How much world width fills the canvas in each zoom mode. */
const SPAN = { city: 1300, wide: WORLD.width + 260 };
/** Portrait screens are narrow, so the city view zooms in to keep towers legible. */
const PORTRAIT_CITY_SPAN = 820;

export class Camera {
  /** World x at the centre of the view. */
  x = WORLD.cityRight.x0 + 200;
  scale = 1;
  mode: ZoomMode = 'city';
  private targetX = this.x;
  private targetSpan = SPAN.city;
  private span = SPAN.city;
  /** Pixels from the bottom of the canvas to the ground line. */
  bottomInset = 150;
  viewW = 800;
  viewH = 600;
  /** Set while the player is dragging, which suspends auto-follow. */
  manual = false;
  private portrait = false;

  resize(w: number, h: number, bottomInset: number): void {
    this.viewW = w;
    this.viewH = h;
    this.bottomInset = bottomInset;
    const portrait = h > w;
    if (portrait !== this.portrait) {
      this.portrait = portrait;
      this.setMode(this.mode);
    }
  }

  private spanFor(mode: ZoomMode): number {
    if (mode === 'city' && this.portrait) return PORTRAIT_CITY_SPAN;
    return SPAN[mode];
  }

  setMode(mode: ZoomMode): void {
    this.mode = mode;
    this.targetSpan = this.spanFor(mode);
    if (mode === 'wide') {
      this.targetX = WORLD.width / 2;
      this.manual = false;
    }
  }

  /** Smoothly move the view to a world x without changing zoom. */
  focus(x: number): void {
    this.targetX = x;
    this.manual = false;
  }

  snapTo(x: number): void {
    this.targetX = x;
    this.x = x;
    this.manual = false;
  }

  /** Drift towards x, but never fight a player who is panning by hand. */
  follow(x: number): void {
    if (this.manual) return;
    this.targetX = x;
  }

  /** Free zoom, used by the mouse wheel. */
  zoomBy(factor: number): void {
    const min = 420;
    const max = SPAN.wide;
    this.targetSpan = Math.max(min, Math.min(max, this.targetSpan * factor));
    this.mode = this.targetSpan > (this.spanFor('city') + SPAN.wide) / 2 ? 'wide' : 'city';
    this.manual = true;
  }

  panBy(dxScreen: number): void {
    this.manual = true;
    this.targetX -= dxScreen / this.scale;
    this.clampTarget();
  }

  private clampTarget(): void {
    const half = this.span / 2;
    const min = Math.min(half, WORLD.width / 2);
    const max = Math.max(WORLD.width - half, WORLD.width / 2);
    this.targetX = Math.max(min, Math.min(max, this.targetX));
  }

  update(dt: number): void {
    const k = Math.min(1, dt * 6);
    this.span += (this.targetSpan - this.span) * k;
    this.scale = this.viewW / this.span;
    this.clampTarget();
    this.x += (this.targetX - this.x) * k;
  }

  toScreenX(worldX: number): number {
    return (worldX - this.x) * this.scale + this.viewW / 2;
  }

  toScreenY(worldY: number): number {
    return this.groundScreenY() - (WORLD.groundY - worldY) * this.scale;
  }

  toWorldX(screenX: number): number {
    return (screenX - this.viewW / 2) / this.scale + this.x;
  }

  groundScreenY(): number {
    return this.viewH - this.bottomInset;
  }

  /** Inclusive world-x range currently visible, with a margin. */
  visibleRange(margin = 200): [number, number] {
    const half = this.span / 2;
    return [this.x - half - margin, this.x + half + margin];
  }
}
