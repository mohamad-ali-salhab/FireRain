import assert from 'node:assert/strict';
import { defaultMeta } from '../src/core/storage';
import { initialOnlineState, OnlineService, type OnlineMatchTicket } from '../src/online/service';

// Run with esbuild --define:import.meta.env={} so this uses only the mock
// transport and never needs real credentials, a browser, or a remote database.
const timers = new Map<number, { fn: () => void; delay: number }>();
const intervals = new Map<number, () => void>();
let timerId = 0;
Object.assign(globalThis, {
  window: {
    setTimeout(fn: () => void, delay = 0) { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout(id: number) { timers.delete(id); },
    setInterval(fn: () => void) { intervals.set(++timerId, fn); return timerId; },
    clearInterval(id: number) { intervals.delete(id); },
  },
  localStorage: {
    getItem() { return '1'; },
    setItem() {},
  },
});

const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
async function runTimer(delay: number): Promise<void> {
  const entry = [...timers.entries()].find(([, timer]) => timer.delay === delay);
  assert(entry, `Expected a retry timer after ${delay}ms`);
  timers.delete(entry[0]);
  entry[1].fn();
  await flush();
}

interface Row { id: number; player_id: string; action: { type: 'pin-target'; tier: number; x: number } }
interface Page { data: Row[] | null; error: { message: string } | null }
const row = (id: number): Row => ({ id, player_id: 'opponent', action: { type: 'pin-target', tier: 1, x: id } });
const ticket = (id: string): OnlineMatchTicket => ({
  matchId: id, durationSeconds: 600, seed: 1, startedAt: new Date().toISOString(),
  opponentId: 'opponent', opponentUsername: 'Opponent',
});

class Channel {
  event = (_payload: { new: Row }) => {};
  status = (_status: string) => {};
  on(_type: string, _filter: unknown, callback: Channel['event']) { this.event = callback; return this; }
  subscribe(callback: Channel['status']) { this.status = callback; return this; }
  emit(value: Row) { this.event({ new: value }); }
}

function fixture() {
  const state = { ...initialOnlineState(), configured: true };
  const actions: number[] = [];
  const rows = new Map<string, Row[]>();
  const queries: { matchId: string; cursor: number }[] = [];
  const channels: Channel[] = [];
  let authCallback = (_event: string, _session: unknown) => {};
  let nextTicket: OnlineMatchTicket | null = null;
  let read: ((matchId: string, cursor: number) => Promise<Page>) | null = null;
  let profileLoads = 0;
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'me' } } }, error: null }),
      onAuthStateChange(callback: typeof authCallback) { authCallback = callback; },
    },
    schema() {
      return { rpc: async () => ({ data: nextTicket, error: null }) };
    },
    channel() { const channel = new Channel(); channels.push(channel); return channel; },
    removeChannel: async () => 'ok',
    from(table: string) {
      let matchId = '';
      let cursor = 0;
      const query = {
        select() { return query; },
        eq(_column: string, value: string) { matchId = value; return query; },
        gt(_column: string, value: number) { cursor = value; return query; },
        order() { return query; },
        async limit(_count: number): Promise<Page> {
          assert.equal(table, 'match_events');
          queries.push({ matchId, cursor });
          if (read) return read(matchId, cursor);
          // A deliberately lower server max verifies that short pages are
          // not mistaken for the end of the stream.
          return { data: (rows.get(matchId) ?? []).filter((r) => r.id > cursor).slice(0, 200), error: null };
        },
        async single() {
          profileLoads++;
          return { data: {
            user_id: 'me', username: 'Pilot', wins: 0, losses: 0, stars: 0,
            radius_level: Array(6).fill(0), aa_reload_level: Array(6).fill(0),
            missile_reload_level: Array(6).fill(0), best_difficulty: null,
          }, error: null };
        },
      };
      return query;
    },
  };
  const service = new OnlineService(state, defaultMeta(), {
    changed() {}, matched() {},
    action(action) { if (action.type === 'pin-target') actions.push(action.x); },
  });
  (service as unknown as { client: unknown }).client = client;
  return {
    service, state, actions, rows, queries, channels,
    auth(event: string, id: string | null) { authCallback(event, id ? { user: { id } } : null); },
    setTicket(value: OnlineMatchTicket | null) { nextTicket = value; },
    setRead(value: typeof read) { read = value; },
    get profileLoads() { return profileLoads; },
  };
}

const match = fixture();
await match.service.init();
await match.service.joinQueue(600);
assert.equal(match.state.phase, 'queueing');
for (const event of ['SIGNED_IN', 'TOKEN_REFRESHED']) {
  match.auth(event, 'me');
  await runTimer(0);
  assert.equal(match.state.phase, 'queueing', `${event} must preserve the queue`);
}
assert.equal(match.profileLoads, 1, 'Same-user auth events must not reload progress');
await match.service.cancelQueue();
match.setTicket(ticket('match-a'));
match.rows.set('match-a', Array.from({ length: 1505 }, (_, i) => row(i + 1)));
await match.service.joinQueue(600);
const channel = match.channels[0];
channel.status('SUBSCRIBED');
channel.emit(row(1505));
await flush();
assert.deepEqual(match.actions, Array.from({ length: 1505 }, (_, i) => i + 1), 'Paginate all events and deduplicate buffered live delivery');
assert(match.queries.length > 2, 'The history must span more than the default 1000-row API max');
match.auth('TOKEN_REFRESHED', 'me');
await runTimer(0);
assert.equal(match.state.phase, 'matched', 'Refreshing auth must preserve the match');

channel.status('CHANNEL_ERROR');
match.rows.get('match-a')!.push(row(1506), row(1507));
channel.emit(row(1507));
const beforeReconnect = match.queries.length;
channel.status('SUBSCRIBED');
await flush();
assert.equal(match.queries[beforeReconnect].cursor, 1505, 'Reconnect should fetch only after the last consumed event');
assert.deepEqual(match.actions.slice(-2), [1506, 1507], 'Catch-up must precede buffered live events');
assert.equal(match.actions.length, 1507, 'Reconnect must not replay previous commands');
await match.service.disconnectMatch();
channel.emit(row(1508));
assert.equal(match.actions.length, 1507, 'Disconnected channel callbacks must be ignored');

const retry = fixture();
await retry.service.init();
retry.setTicket(ticket('retry'));
retry.rows.set('retry', [row(1), row(2)]);
retry.setRead(async () => ({ data: null, error: { message: 'Temporary network failure' } }));
await retry.service.joinQueue(600);
retry.channels[0].status('SUBSCRIBED');
retry.channels[0].emit(row(2));
await flush();
assert.deepEqual(retry.actions, [], 'Keep commands buffered until catch-up succeeds');
retry.setRead(null);
await runTimer(1000);
assert.deepEqual(retry.actions, [1, 2], 'A successful retry should recover history and buffered commands once');

retry.channels[0].status('CHANNEL_ERROR');
retry.setRead(async () => ({ data: null, error: { message: 'Offline' } }));
retry.channels[0].status('SUBSCRIBED');
await flush();
for (const delay of [1000, 2000, 4000]) await runTimer(delay);
assert.equal(timers.size, 0, 'Retries must stop after the bounded retry limit');
assert.match(retry.state.message, /Match sync failed/);
retry.channels[0].status('SUBSCRIBED');
await flush();
assert.equal(timers.size, 1);
await retry.service.disconnectMatch();
assert.equal(timers.size, 0, 'Disconnect must clear a scheduled backlog retry');

const stale = fixture();
await stale.service.init();
stale.setTicket(ticket('old'));
let finishPage: (value: Page) => void = () => {};
stale.setRead(() => new Promise((resolve) => { finishPage = resolve; }));
await stale.service.joinQueue(600);
const oldChannel = stale.channels[0];
oldChannel.status('SUBSCRIBED');
await flush();
await stale.service.disconnectMatch();
stale.setRead(null);
stale.setTicket(ticket('new'));
stale.rows.set('new', [row(10)]);
await stale.service.joinQueue(600);
stale.channels[1].status('SUBSCRIBED');
await flush();
finishPage({ data: [row(1)], error: null });
oldChannel.emit(row(2));
oldChannel.status('CHANNEL_ERROR');
await flush();
assert.deepEqual(stale.actions, [10], 'An old request/channel must not send actions into a new match');
assert.equal(stale.state.message, 'Match connected', 'An old channel must not overwrite the new connection state');
stale.auth('SIGNED_OUT', null);
await runTimer(0);
stale.channels[1].emit(row(11));
assert.deepEqual(stale.actions, [10], 'Signing out must invalidate match callbacks');
assert.equal(stale.state.phase, 'signed-out');

console.log('PASS: same-user auth, paginated catch-up, reconnect ordering/deduplication, bounded retry recovery, and stale match cleanup.');
