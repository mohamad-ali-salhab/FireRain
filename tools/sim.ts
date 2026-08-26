/**
 * Headless match simulator — runs full matches at wall-clock-free speed so the
 * balance can be checked without sitting through 15 minutes of play.
 *
 *   npm run sim            # one match per difficulty
 *   npm run sim -- 5       # 5 matches per difficulty
 */

import { MATCH, type Difficulty } from '../src/core/config';
import { defaultMeta } from '../src/core/storage';
import { stepMatch } from '../src/game/engine';
import { cityValue, createMatch } from '../src/game/state';
import { playPlayer } from './player';

const DT = 1 / 30;

function runOne(difficulty: Difficulty): Record<string, string | number> {
  const meta = defaultMeta();
  const match = createMatch(difficulty, MATCH.durationSeconds);
  const acc = { think: 0, salvo: 0 };
  let steps = 0;
  const maxSteps = Math.ceil((MATCH.durationSeconds + 5) / DT);
  while (match.phase === 'playing' && steps < maxSteps) {
    playPlayer(match, meta, acc, DT);
    stepMatch(match, DT, meta);
    steps++;
  }
  const r = match.result;
  const p = match.player.stats;
  const e = match.enemy.stats;
  return {
    difficulty,
    result: r ? (r.won ? 'WIN' : 'LOSS') : 'TIMEOUT',
    reason: r?.reason ?? '-',
    at: `${Math.floor(match.time / 60)}m${String(Math.floor(match.time % 60)).padStart(2, '0')}s`,
    you: Math.round(cityValue(match.player)),
    them: Math.round(cityValue(match.enemy)),
    'your shots': p.launched,
    'their shots': e.launched,
    'you shot down': p.intercepted,
    'they shot down': e.intercepted,
    'you lost': p.destroyedBuildings,
    'they lost': e.destroyedBuildings,
    'your AA lost': p.destroyedBatteries,
    'their AA lost': e.destroyedBatteries,
    'you rebuilt': p.destroyedBuildings > 0 ? 'yes' : 'no',
    stars: r?.stars ?? 0,
  };
}

const runs = Number(process.argv[2] ?? 1);
const rows: Record<string, string | number>[] = [];
for (const d of ['easy', 'medium', 'hard'] as Difficulty[]) {
  for (let i = 0; i < runs; i++) rows.push(runOne(d));
}
console.table(rows);

const summary = (['easy', 'medium', 'hard'] as Difficulty[]).map((d) => {
  const r = rows.filter((x) => x.difficulty === d);
  const wins = r.filter((x) => x.result === 'WIN').length;
  return { difficulty: d, matches: r.length, 'player win rate': `${Math.round((wins / r.length) * 100)}%` };
});
console.table(summary);
