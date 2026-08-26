import { AA, BUILDINGS, MISSILES } from '../core/config';

const VB = 'viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"';

/** Silhouette of a building type, scaled so every tier reads at a glance. */
export function buildingIcon(type: number): string {
  const def = BUILDINGS[type];
  const maxH = BUILDINGS[BUILDINGS.length - 1].h;
  const h = 12 + (def.h / maxH) * 44;
  const w = 14 + (def.w / 50) * 16;
  const x = 32 - w / 2;
  const y = 60 - h;
  const rows = Math.min(9, def.windowRows);
  const cols = Math.min(4, def.windowCols);
  let windows = '';
  const cw = (w - 6) / cols;
  const ch = (h - 8) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const wx = x + 3 + c * cw + cw * 0.18;
      const wy = y + 5 + r * ch + ch * 0.18;
      windows += `<rect x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="${(cw * 0.6).toFixed(1)}" height="${(ch * 0.55).toFixed(1)}" fill="#cfe0f5" opacity="0.75"/>`;
    }
  }
  let roof = '';
  if (def.roof === 'spire') roof = `<path d="M${32 - w * 0.22} ${y} L${32 + w * 0.22} ${y} L32 ${y - 9} Z" fill="#2b323c"/><rect x="31.4" y="${y - 15}" width="1.2" height="7" fill="#2b323c"/>`;
  else if (def.roof === 'antenna') roof = `<rect x="31.2" y="${y - 10}" width="1.6" height="10" fill="#2b323c"/>`;
  else if (def.roof === 'step') roof = `<rect x="${32 - w * 0.3}" y="${y - 4}" width="${w * 0.6}" height="4" fill="#2b323c"/>`;
  else if (def.roof === 'slant') roof = `<path d="M${x} ${y} L${x + w} ${y - 5} L${x + w} ${y} Z" fill="#2b323c"/>`;
  return `<svg ${VB}>
    <rect x="4" y="58" width="56" height="3" rx="1.5" fill="#39404a" opacity="0.6"/>
    ${roof}
    <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#2b323c"/>
    <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(w * 0.16).toFixed(1)}" height="${h.toFixed(1)}" fill="#39414d"/>
    ${windows}
  </svg>`;
}

/** Radar dish for index 0, otherwise a launcher with one barrel per tier. */
export function aaIcon(type: number): string {
  const def = AA[type];
  if (def.interceptsTier === 0) {
    return `<svg ${VB}>
      <rect x="16" y="46" width="32" height="8" rx="2" fill="#39414d"/>
      <circle cx="22" cy="55" r="3.5" fill="#252b34"/><circle cx="32" cy="55" r="3.5" fill="#252b34"/><circle cx="42" cy="55" r="3.5" fill="#252b34"/>
      <rect x="30" y="30" width="4" height="18" fill="#4d5663"/>
      <g transform="translate(32 26) rotate(-28)">
        <ellipse cx="0" cy="0" rx="16" ry="9" fill="${def.color}" opacity="0.9"/>
        <ellipse cx="0" cy="0" rx="11" ry="6" fill="#2b323c"/>
        <rect x="-1.5" y="-1.5" width="3" height="12" fill="#4d5663"/>
      </g>
    </svg>`;
  }
  const barrels = Math.min(5, def.interceptsTier + 1);
  let tubes = '';
  const span = 22;
  for (let i = 0; i < barrels; i++) {
    const bx = 32 - span / 2 + (i * span) / Math.max(1, barrels - 1);
    tubes += `<rect x="${(bx - 1.8).toFixed(1)}" y="14" width="3.6" height="22" rx="1.4" fill="#4d5663"/>
              <rect x="${(bx - 1.8).toFixed(1)}" y="14" width="3.6" height="4" fill="${def.color}"/>`;
  }
  return `<svg ${VB}>
    <rect x="14" y="46" width="36" height="8" rx="2" fill="#39414d"/>
    <circle cx="21" cy="55" r="3.5" fill="#252b34"/><circle cx="32" cy="55" r="3.5" fill="#252b34"/><circle cx="43" cy="55" r="3.5" fill="#252b34"/>
    <rect x="22" y="38" width="20" height="9" rx="2" fill="#5a636f"/>
    <g transform="rotate(-14 32 40)">${tubes}<rect x="20" y="34" width="24" height="7" rx="2" fill="#39414d"/></g>
  </svg>`;
}

/** Launch vehicle for the attack tiers. */
export function missileIcon(tier: number): string {
  const def = MISSILES[tier - 1];
  const len = 22 + tier * 4;
  return `<svg ${VB}>
    <g transform="rotate(-32 32 34)">
      <rect x="${32 - len / 2}" y="30" width="${len}" height="9" rx="4.5" fill="${def.color}"/>
      <path d="M${32 + len / 2} 30 L${32 + len / 2 + 8} 34.5 L${32 + len / 2} 39 Z" fill="#c9503a"/>
      <path d="M${32 - len / 2} 30 L${32 - len / 2 - 6} 24 L${32 - len / 2 + 4} 30 Z" fill="#3b424c"/>
      <path d="M${32 - len / 2} 39 L${32 - len / 2 - 6} 45 L${32 - len / 2 + 4} 39 Z" fill="#3b424c"/>
      <rect x="${32 - len / 2 + 5}" y="32.5" width="4" height="4" fill="#2b323c" opacity="0.6"/>
    </g>
    <rect x="12" y="46" width="40" height="9" rx="2.5" fill="#39414d"/>
    <circle cx="19" cy="56" r="3.6" fill="#252b34"/><circle cx="32" cy="56" r="3.6" fill="#252b34"/><circle cx="45" cy="56" r="3.6" fill="#252b34"/>
  </svg>`;
}

/** Slim interceptor round, coloured to match its battery. */
export function abmIcon(type: number): string {
  const def = AA[type];
  return `<svg ${VB}>
    <g transform="rotate(-38 32 32)">
      <path d="M32 8 L37 20 L37 46 L27 46 L27 20 Z" fill="#dfe4ea"/>
      <path d="M32 8 L37 20 L27 20 Z" fill="${def.color}"/>
      <path d="M27 40 L20 52 L27 50 Z" fill="#3b424c"/>
      <path d="M37 40 L44 52 L37 50 Z" fill="#3b424c"/>
      <rect x="27" y="30" width="10" height="3" fill="#9aa3ae"/>
      <path d="M27 46 L32 58 L37 46 Z" fill="#ff8a3d" opacity="0.85"/>
    </g>
  </svg>`;
}

export const ICON_BACK = `<svg ${VB}><g transform="translate(64 0) scale(-1 1)"><path d="M40 18 H28 a14 14 0 1 0 0 28 h4" stroke="#2b323c" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M42 8 L54 18 L42 28 Z" fill="#2b323c"/></g></svg>`;

export const ICON_UPGRADE = `<svg ${VB}>
  <path d="M32 8 L46 26 H37 v18 h-10 V26 h-9 Z" fill="#4ec5ff"/>
  <rect x="18" y="48" width="28" height="8" rx="3" fill="#4ec5ff" opacity="0.75"/>
</svg>`;

export const ICON_CITY = `<svg ${VB}>
  <rect x="8" y="34" width="12" height="22" fill="#2b323c"/>
  <rect x="22" y="22" width="13" height="34" fill="#39414d"/>
  <rect x="37" y="14" width="11" height="42" fill="#2b323c"/>
  <rect x="50" y="30" width="8" height="26" fill="#39414d"/>
  <g fill="#cfe0f5" opacity="0.8">
    <rect x="11" y="38" width="3" height="3"/><rect x="16" y="38" width="3" height="3"/>
    <rect x="25" y="27" width="3" height="3"/><rect x="30" y="27" width="3" height="3"/>
    <rect x="40" y="19" width="3" height="3"/><rect x="44" y="19" width="3" height="3"/>
  </g>
</svg>`;

export const ICON_ABM = `<svg ${VB}>
  <circle cx="32" cy="34" r="20" fill="none" stroke="#4ec5ff" stroke-width="4" opacity="0.5"/>
  <circle cx="32" cy="34" r="11" fill="none" stroke="#4ec5ff" stroke-width="4"/>
  <path d="M32 6 L36 18 L28 18 Z" fill="#ff8a3d"/>
  <rect x="29" y="18" width="6" height="12" fill="#dfe4ea"/>
</svg>`;

export const ICON_ICBM = `<svg ${VB}>
  <path d="M32 4 L40 22 L40 46 L24 46 L24 22 Z" fill="#c9503a"/>
  <path d="M24 46 L14 58 L24 54 Z" fill="#3b424c"/>
  <path d="M40 46 L50 58 L40 54 Z" fill="#3b424c"/>
  <path d="M24 46 L32 62 L40 46 Z" fill="#ffb03a"/>
  <rect x="27" y="26" width="10" height="4" fill="#2b323c" opacity="0.5"/>
</svg>`;

export const ICON_STAR = `<svg ${VB}><path d="M32 6 L39 24 L58 26 L44 38 L48 57 L32 47 L16 57 L20 38 L6 26 L25 24 Z" fill="#ffd447" stroke="#b8860b" stroke-width="2"/></svg>`;

export const ICON_PAUSE = `<svg ${VB}><rect x="18" y="14" width="10" height="36" rx="3" fill="currentColor"/><rect x="36" y="14" width="10" height="36" rx="3" fill="currentColor"/></svg>`;

export const ICON_ZOOM = `<svg ${VB}><circle cx="28" cy="28" r="16" fill="none" stroke="currentColor" stroke-width="5"/><path d="M28 20 v16 M20 28 h16" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M40 40 L54 54" stroke="currentColor" stroke-width="6" stroke-linecap="round"/></svg>`;

export const ICON_SOUND_ON = `<svg ${VB}><path d="M14 26 h10 l12 -10 v32 l-12 -10 h-10 Z" fill="currentColor"/><path d="M42 24 a12 12 0 0 1 0 16" stroke="currentColor" stroke-width="4" fill="none" stroke-linecap="round"/></svg>`;

export const ICON_SOUND_OFF = `<svg ${VB}><path d="M14 26 h10 l12 -10 v32 l-12 -10 h-10 Z" fill="currentColor"/><path d="M42 24 L56 40 M56 24 L42 40" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>`;

export const ICON_RADIUS = `<svg ${VB}>
  <path d="M6 50 A26 26 0 0 1 58 50" fill="none" stroke="#ffd447" stroke-width="4"/>
  <path d="M16 50 A16 16 0 0 1 48 50" fill="none" stroke="#ffd447" stroke-width="3" opacity="0.6"/>
  <rect x="26" y="46" width="12" height="8" rx="2" fill="#39414d"/>
</svg>`;

export const ICON_CLOCK = `<svg ${VB}><circle cx="32" cy="32" r="22" fill="none" stroke="#59e07a" stroke-width="5"/><path d="M32 18 v15 l10 7" stroke="#59e07a" stroke-width="5" fill="none" stroke-linecap="round"/></svg>`;
