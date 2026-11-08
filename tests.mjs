import test from 'node:test';
import assert from 'node:assert/strict';
import { Arena } from './engine.mjs';
import { handler, makeServer } from './server.mjs';
import { Readable } from 'node:stream';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

function setup() {
  let clock = 100000;
  const a = new Arena(() => clock);
  const cyan = a.create('Alpha', 'cyan'), coral = a.join(cyan.code, 'Bravo', 'coral');
  const ally = a.join(cyan.code, 'Charlie', 'cyan');
  return { a, cyan, coral, ally, advance(ms) { clock += ms; }, time: () => clock };
}
function start(f) { return f.a.start(f.cyan.code, f.cyan.token); }
function solve(f, actor, target, mode = 'attack', kind = 'typing') {
  const result = f.a.newChallenge(actor.code, actor.token, mode, target.playerId, kind);
  let c = result.state.challenge;
  if (kind === 'typing') return f.a.input(actor.code, actor.token, c.id, c.phrase);
  let r;
  while (c) { r = f.a.input(actor.code, actor.token, c.id, c.sequence[c.progress]); c = r.state.challenge; }
  return r;
}

test('room codes, sessions, names, and host-only start', () => {
  const f = setup();
  assert.match(f.cyan.code, /^[A-Z2-9]{6}$/);
  assert.throws(() => f.a.join(f.cyan.code, 'Alpha', 'coral'), /already in use/);
  assert.throws(() => f.a.read(f.cyan.code, 'wrong-token'), /session/);
  assert.throws(() => f.a.start(f.coral.code, f.coral.token), /Only the host/);
  const s = start(f); assert.equal(s.phase, 'running'); assert.equal(s.endsAt - s.startedAt, 180000);
  assert.throws(() => f.a.join(f.cyan.code, 'Late', 'cyan'), /already started/);
  assert.equal(JSON.stringify(s).includes(f.coral.token), false);
});
test('a match needs an online player on both teams', () => {
  let clock = 100000; const a = new Arena(() => clock), host = a.create('Solo', 'cyan');
  assert.throws(() => a.start(host.code, host.token), /each team/);
  a.join(host.code, 'Opponent', 'coral'); clock += 16000;
  assert.throws(() => a.start(host.code, host.token), /each team/);
});
test('typing win attacks, hold time scores exactly, cleaning awards shield', () => {
  const f = setup(); start(f);
  const attack = solve(f, f.cyan, f.coral);
  assert.equal(attack.state.players.find(p => p.id === f.coral.playerId).infectedBy, 'cyan');
  assert.equal(attack.state.scores.cyan, 10);
  f.advance(5000);
  const after = f.a.read(f.coral.code, f.coral.token); assert.equal(after.scores.cyan, 15);
  const clean = solve(f, f.coral, f.coral, 'clean'); assert.equal(clean.state.scores.coral, 10);
  const restored = clean.state.players.find(p => p.id === f.coral.playerId);
  assert.equal(restored.infectedBy, null); assert.equal(restored.shieldUntil - f.time(), 6000);
  assert.throws(() => f.a.newChallenge(f.cyan.code, f.cyan.token, 'attack', f.coral.playerId, 'typing'), /shield/);
  f.advance(6001); solve(f, f.cyan, f.coral);
  assert.equal(f.a.read(f.cyan.code, f.cyan.token).scores.cyan, 25);
});
test('arrows require three complete sequences; wrong input costs time and resets progress', () => {
  const f = setup(); start(f);
  let r = f.a.newChallenge(f.cyan.code, f.cyan.token, 'attack', f.coral.playerId, 'arrows'), c = r.state.challenge;
  r = f.a.input(f.cyan.code, f.cyan.token, c.id, c.sequence[0]);
  assert.equal(r.state.challenge.progress, 1);
  c = r.state.challenge;
  r = f.a.input(f.cyan.code, f.cyan.token, c.id, (c.sequence[1] + 1) % 4);
  assert.equal(r.state.challenge.progress, 0); assert.equal(r.state.challenge.deadline, c.deadline - 2000);
  let moves = 0;
  while ((c = r.state.challenge)) { r = f.a.input(f.cyan.code, f.cyan.token, c.id, c.sequence[c.progress]); moves++; }
  assert.equal(moves, 15); assert.equal(r.state.scores.cyan, 10);
});
test('expired, wrong, cancelled, and replayed challenges do not apply an action', () => {
  const f = setup(); start(f);
  let c = f.a.newChallenge(f.cyan.code, f.cyan.token, 'attack', f.coral.playerId, 'typing').state.challenge;
  const wrong = f.a.input(f.cyan.code, f.cyan.token, c.id, 'wrong'); assert.equal(wrong.state.scores.cyan, 0);
  assert.equal(wrong.state.challenge.deadline, c.deadline - 2000);
  f.advance(24000);
  const expired = f.a.input(f.cyan.code, f.cyan.token, c.id, c.phrase);
  assert.equal(expired.state.challenge, null); assert.equal(expired.state.scores.cyan, 0);
  f.a.read(f.coral.code, f.coral.token);
  c = f.a.newChallenge(f.cyan.code, f.cyan.token, 'attack', f.coral.playerId, 'typing').state.challenge;
  f.a.cancel(f.cyan.code, f.cyan.token);
  assert.throws(() => f.a.input(f.cyan.code, f.cyan.token, c.id, c.phrase), /expired or was cancelled/);
  c = f.a.newChallenge(f.cyan.code, f.cyan.token, 'attack', f.coral.playerId, 'typing').state.challenge;
  f.a.input(f.cyan.code, f.cyan.token, c.id, c.phrase);
  assert.throws(() => f.a.input(f.cyan.code, f.cyan.token, c.id, c.phrase), /expired or was cancelled/);
  assert.equal(f.a.read(f.cyan.code, f.cyan.token).scores.cyan, 10);
});
test('team boundaries, clean-only-infected, cooldown, and concurrent target changes', () => {
  const f = setup(); start(f);
  assert.throws(() => f.a.newChallenge(f.cyan.code, f.cyan.token, 'attack', f.ally.playerId, 'typing'), /opposing/);
  assert.throws(() => f.a.newChallenge(f.cyan.code, f.cyan.token, 'clean', f.coral.playerId, 'typing'), /teammate/);
  assert.throws(() => f.a.newChallenge(f.cyan.code, f.cyan.token, 'clean', f.ally.playerId, 'typing'), /already clean/);
  const stale = f.a.newChallenge(f.ally.code, f.ally.token, 'attack', f.coral.playerId, 'typing').state.challenge;
  solve(f, f.cyan, f.coral);
  assert.throws(() => f.a.newChallenge(f.cyan.code, f.cyan.token, 'attack', f.coral.playerId, 'typing'), /ready in a moment/);
  const race = f.a.input(f.ally.code, f.ally.token, stale.id, stale.phrase);
  assert.match(race.message, /Target changed/); assert.equal(race.state.scores.cyan, 10);
});
test('offline targets stop hold scoring, reconnecting does not backfill offline time', () => {
  const f = setup(); start(f); solve(f, f.cyan, f.coral);
  f.advance(30000);
  const offline = f.a.read(f.cyan.code, f.cyan.token);
  assert.equal(offline.scores.cyan, 25); assert.equal(offline.players.find(p => p.id === f.coral.playerId).online, false);
  f.a.read(f.coral.code, f.coral.token); f.advance(2000);
  assert.equal(f.a.read(f.cyan.code, f.cyan.token).scores.cyan, 27);
});
test('end of match closes challenges, freezes score, then rematch resets players', () => {
  const f = setup(); start(f); solve(f, f.cyan, f.coral);
  f.advance(179000); f.a.read(f.coral.code, f.coral.token);
  const late = f.a.newChallenge(f.coral.code, f.coral.token, 'clean', f.coral.playerId, 'typing').state.challenge;
  f.advance(2000);
  assert.throws(() => f.a.input(f.coral.code, f.coral.token, late.id, late.phrase), /ended/);
  const ended = f.a.read(f.cyan.code, f.cyan.token); assert.equal(ended.phase, 'finished'); assert.equal(ended.scores.cyan, 26);
  f.advance(50000); assert.equal(f.a.read(f.cyan.code, f.cyan.token).scores.cyan, 26);
  assert.throws(() => f.a.rematch(f.coral.code, f.coral.token), /Only the host/);
  const rematch = f.a.rematch(f.cyan.code, f.cyan.token);
  assert.equal(rematch.phase, 'lobby'); assert.equal(rematch.round, 2); assert.equal(rematch.scores.cyan, 0);
  assert.ok(rematch.players.every(p => !p.infectedBy));
});

// HTTP handler tests use actual request streams without requiring a network socket.
async function call(path, data, secret, extraHeaders = {}) {
  const req = Readable.from(data === undefined ? [] : [JSON.stringify(data)]);
  req.url = path; req.method = data === undefined ? 'GET' : 'POST';
  req.socket = { remoteAddress: 'test', localPort: 8787 }; req.headers = { ...extraHeaders, authorization: secret ? 'Bearer ' + secret : '' };
  let status = 200, raw, headers = {};
  const res = { setHeader(k, v) { headers[k] = v; }, writeHead(s, h) { status = s; Object.assign(headers, h); }, end(body) { raw = String(body); } };
  await handler(req, res); return { status, headers, raw, data: headers['Content-Type']?.includes('json') ? JSON.parse(raw) : null };
}
test('HTTP flow: two independent clients create/join/start/attack/clean with private sessions', async () => {
  const host = await call('/api/create', { name: 'Host', team: 'cyan' }); assert.equal(host.status, 200);
  const h = host.data;
  const guest = await call('/api/join', { code: h.code, name: 'Guest', team: 'coral' }); assert.equal(guest.status, 200);
  const g = guest.data;
  assert.equal((await call('/api/start', { code: h.code }, g.token)).status, 403);
  assert.equal((await call('/api/start', { code: h.code }, h.token)).data.phase, 'running');
  const challenge = await call('/api/challenge', { code: h.code, mode: 'attack', targetId: g.playerId, kind: 'typing' }, h.token);
  const c = challenge.data.state.challenge;
  const hit = await call('/api/input', { code: h.code, challengeId: c.id, value: c.phrase }, h.token);
  assert.equal(hit.data.state.scores.cyan, 10);
  const view = await call('/api/state?room=' + h.code, undefined, g.token);
  assert.equal(view.data.players.find(p => p.id === g.playerId).infectedBy, 'cyan');
  const cc = (await call('/api/challenge', { code: h.code, mode: 'clean', targetId: g.playerId, kind: 'arrows' }, g.token)).data.state.challenge;
  let current = cc;
  while (current) { const r = await call('/api/input', { code: h.code, challengeId: current.id, value: current.sequence[current.progress] }, g.token); current = r.data.state.challenge; }
  const cleanView = await call('/api/state?room=' + h.code, undefined, h.token);
  assert.equal(cleanView.data.players.find(p => p.id === g.playerId).infectedBy, null);
  assert.equal(cleanView.data.scores.coral, 10);
  assert.equal(cleanView.raw.includes(g.token), false);
  assert.equal((await call('/api/state?room=' + h.code)).status, 401);
  assert.equal((await call('/api/create', { name: 'Cross', team: 'cyan' }, null, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await call('/../../engine.mjs')).status, 404);
  const page = await call('/'); assert.equal(page.status, 200); assert.match(page.raw, /NETWORK/);
  assert.match(page.headers['Content-Security-Policy'], /script-src 'self'/);
});

test('real loopback HTTP server responds when socket access is available', async t => {
  const server = makeServer();
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`, { signal: AbortSignal.timeout(4000) });
    assert.equal(response.status, 200); assert.match(await response.text(), /Network Arena/);
  } catch (e) {
    if (['EPERM', 'EACCES'].includes(e.code) || ['EPERM', 'EACCES'].includes(e.cause?.code) || e.name === 'TimeoutError') t.skip('Local network access is restricted in this execution environment.');
    else throw e;
  } finally { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
});

test('browser client flow against the HTTP handler: lobby, attack, cleanup, and resume', async () => {
  const source = await readFile(new URL('./public/app.js', import.meta.url), 'utf8');
  function client(saved = null) {
    const elements = new Map(), store = new Map(); if (saved) store.set('network-arena-session', saved);
    function element(tag = 'div') {
      return { tag, value: '', textContent: '', hidden: false, disabled: false, children: [], dataset: {}, className: '',
        classList: { toggle() {} }, append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; }, addEventListener() {}, focus() {} };
    }
    const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
    const buttons = [0, 1, 2, 3].map(n => { const e = element('button'); e.dataset.arrow = String(n); return e; });
    get('team').value = 'cyan'; get('challenge-kind').value = 'typing';
    const context = vm.createContext({
      document: { getElementById: get, createElement: element, querySelectorAll: () => buttons }, window: { addEventListener() {} },
      localStorage: { getItem: k => store.get(k), setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
      location: { origin: 'http://localhost:8787', hostname: 'localhost', hash: '' }, history: { replaceState() {} }, navigator: {},
      URLSearchParams, AbortController, setTimeout: () => 1, clearTimeout() {}, setInterval() {}, console,
      fetch: async (path, options = {}) => {
        const headers = Object.fromEntries(Object.entries(options.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
        const r = await call(path, options.body ? JSON.parse(options.body) : undefined, headers.authorization?.replace('Bearer ', ''));
        return { ok: r.status < 400, status: r.status, json: async () => r.data };
      }
    });
    vm.runInContext(source, context);
    return { get, store, context, async enter(name, team, code) {
      get('player-name').value = name; get('team').value = team;
      if (code) { get('room-code').value = code; vm.runInContext("setMode('join')", context); }
      await get('entry-form').onsubmit({ preventDefault() {} });
    }, async poll() { await vm.runInContext('poll()', context); } };
  }
  const a = client(), b = client(); await a.enter('Browser Alpha', 'cyan');
  const code = a.get('match-code').textContent; assert.match(code, /^[A-Z2-9]{6}$/);
  await b.enter('Browser Bravo', 'coral', code); await a.poll();
  assert.equal(a.get('start').disabled, false); await a.get('start').onclick(); await b.poll();
  assert.equal(b.get('phase').textContent, 'MATCH LIVE');
  const attackButton = a.get('coral-roster').children[0].children.find(e => e.tag === 'button');
  assert.equal(attackButton.disabled, false); await attackButton.onclick();
  assert.equal(a.get('typing-game').hidden, false);
  a.get('typing-answer').value = a.get('typing-prompt').textContent;
  await a.get('typing-game').onsubmit({ preventDefault() {} });
  await b.poll();
  assert.match(b.get('me-label').textContent, /INFECTED/);
  const cleanButton = b.get('coral-roster').children[0].children.find(e => e.tag === 'button');
  assert.equal(cleanButton.disabled, false); await cleanButton.onclick();
  b.get('typing-answer').value = b.get('typing-prompt').textContent;
  await b.get('typing-game').onsubmit({ preventDefault() {} });
  await a.poll();
  assert.equal(a.get('coral-score').textContent, '10.00');
  const resumed = client(a.store.get('network-arena-session'));
  await vm.runInContext('sequence', resumed.context); await new Promise(setImmediate);
  assert.equal(resumed.get('match-code').textContent, code);
  assert.match(resumed.get('me-label').textContent, /Browser Alpha/);
});

test('online hosting health check and private network addresses', async () => {
  const health = await call('/healthz'); assert.equal(health.status, 200); assert.equal(health.data.status, 'ok');
  const info = await call('/api/host-info', undefined, undefined, { host: 'network-arena.onrender.com' });
  assert.deepEqual(info.data.addresses, []);
});
test('proxy-sharing players have separate request allowances', async () => {
  const first = (await call('/api/create', { name: 'Rate Alpha', team: 'cyan' })).data;
  const second = (await call('/api/join', { code: first.code, name: 'Rate Bravo', team: 'coral' })).data;
  let response;
  for (let i = 0; i < 1601; i++) response = await call('/api/state?room=' + first.code, undefined, first.token);
  assert.equal(response.status, 429);
  assert.equal((await call('/api/state?room=' + first.code, undefined, second.token)).status, 200);
});
