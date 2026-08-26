/** One instrumented hard match, sampled every 30s, to see where a bot loses. */
import { MATCH } from '../src/core/config';
import { defaultMeta } from '../src/core/storage';
import { stepMatch } from '../src/game/engine';
import { cityValue, countBuildings, createMatch, incomePerTick } from '../src/game/state';
import { BUILDINGS } from '../src/core/config';

// Reuse the scripted player from the sim by importing its module side-effect free copy.
import { playPlayer } from './player';

const DT = 1 / 30;
const meta = defaultMeta();
const match = createMatch('medium', MATCH.durationSeconds);
const acc = { think: 0, salvo: 0 };
let next = 0;
const rows: Record<string, string | number>[] = [];
while (match.phase === 'playing' && match.time < MATCH.durationSeconds) {
  playPlayer(match, meta, acc, DT);
  stepMatch(match, DT, meta);
  if (match.time >= next) {
    next += 30;
    const b = match.enemy;
    rows.push({
      t: `${Math.floor(match.time / 60)}:${String(Math.floor(match.time % 60)).padStart(2, '0')}`,
      botCash: Math.round(b.money),
      botInc: Math.round(incomePerTick(b) * 10) / 10,
      botVal: Math.round(cityValue(b)),
      youVal: Math.round(cityValue(match.player)),
      botBldgs: BUILDINGS.reduce((n, d) => n + countBuildings(b, d.id), 0),
      botAA: b.batteries.length,
      botAmmo: b.ammo.reduce((n, a) => n + a, 0),
      botPend: b.pending.length,
      botFired: b.stats.launched,
      youFired: match.player.stats.launched,
      botIntercepts: b.stats.intercepted,
      youAA: match.player.batteries.length,
      youAmmo: match.player.ammo.reduce((n, a) => n + a, 0),
      youIntercepts: match.player.stats.intercepted,
      youBldgs: BUILDINGS.reduce((n, d) => n + countBuildings(match.player, d.id), 0),
    });
  }
}
console.table(rows);
console.log('result', match.result);
