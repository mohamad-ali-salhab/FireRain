import { AA, MISSILES } from './config';
import type { MetaSave } from './types';

const KEY = 'rain-of-fire:meta:v1';

export function defaultMeta(): MetaSave {
  return {
    stars: 0,
    radiusLevel: AA.map(() => 0),
    aaReloadLevel: AA.map(() => 0),
    missileReloadLevel: MISSILES.map(() => 0),
    wins: 0,
    losses: 0,
    muted: false,
    bestDifficulty: null,
  };
}

export function loadMeta(): MetaSave {
  const base = defaultMeta();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<MetaSave>;
    return {
      ...base,
      ...parsed,
      // Guard against a save written by an older build with fewer entries.
      radiusLevel: fit(parsed.radiusLevel, base.radiusLevel),
      aaReloadLevel: fit(parsed.aaReloadLevel, base.aaReloadLevel),
      missileReloadLevel: fit(parsed.missileReloadLevel, base.missileReloadLevel),
    };
  } catch {
    return base;
  }
}

export function saveMeta(meta: MetaSave): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(meta));
  } catch {
    /* private mode / storage disabled — progression just won't persist */
  }
}

function fit(src: number[] | undefined, base: number[]): number[] {
  if (!Array.isArray(src)) return base;
  return base.map((d, i) => (typeof src[i] === 'number' ? src[i] : d));
}
