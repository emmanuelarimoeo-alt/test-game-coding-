import { randomBytes, randomInt } from 'node:crypto';

const ONLINE_MS = 15000;
const TEAM_NAMES = { cyan: 'Cyan', coral: 'Coral' };
const PHRASES = [
  'Bright signals cross the midnight grid while our team holds the line.',
  'Protect the core and restore each node before the final second falls.',
  'A steady hand and a clear mind can turn the tide of this digital duel.',
  'Follow the signal through the network and bring the system back online.'
];
export class GameError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const fail = (message, status) => { throw new GameError(message, status); };
const token = () => randomBytes(24).toString('hex');
const teamOf = value => TEAM_NAMES[value] ? value : fail('Choose Cyan or Coral.');
const nameOf = value => {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 20) fail('Use a player name between 1 and 20 characters.');
  return name;
};

// All gameplay changes and challenge validation happen here, on the host.
export class Arena {
  constructor(now = () => Date.now()) { this.now = now; this.rooms = new Map(); }
  create(name, team) {
    this.sweep();
    if (this.rooms.size >= 100) fail('The host is full. Try again later.', 503);
    let code;
    do { code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join(''); } while (this.rooms.has(code));
    const room = { code, phase: 'lobby', players: new Map(), host: null, scores: { cyan: 0, coral: 0 },
      startedAt: null, endsAt: null, scoredAt: null, touched: this.now(), logs: [], round: 1 };
    const player = this.addPlayer(room, name, team);
    room.host = player.id;
    this.rooms.set(code, room);
    this.log(room, `${player.name} created the match.`);
    return this.credentials(room, player);
  }
  sweep() {
    const now = this.now();
    for (const [code, room] of this.rooms) if (now - room.touched > 2 * 60 * 60 * 1000) this.rooms.delete(code);
  }
  room(code) {
    const room = this.rooms.get(String(code ?? '').toUpperCase());
    if (!room) fail('Match not found. Check the six-character code.', 404);
    this.advance(room); return room;
  }
  player(room, secret) {
    const player = [...room.players.values()].find(p => p.token === secret);
    if (!player) fail('Your player session is missing. Rejoin the match.', 401);
    room.touched = this.now();
    player.seen = this.now(); return player;
  }
  addPlayer(room, name, team) {
    name = nameOf(name); team = teamOf(team);
    if ([...room.players.values()].filter(p => p.team === team).length >= 12) fail('That team is full (12 players).');
    if ([...room.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase())) fail('That name is already in use. Try another.');
    const p = { id: randomBytes(8).toString('hex'), token: token(), name, team, infectedBy: null,
      shieldUntil: 0, seen: this.now(), challenge: null, cooldownUntil: 0, attacks: 0, cleans: 0 };
    room.players.set(p.id, p); return p;
  }
  credentials(room, player) { return { code: room.code, token: player.token, playerId: player.id, state: this.snapshot(room, player) }; }
  join(code, name, team) {
    const room = this.room(code);
    if (room.phase !== 'lobby') fail('This match has already started. Join after the host opens a rematch.');
    const p = this.addPlayer(room, name, team);
    this.log(room, `${p.name} joined ${TEAM_NAMES[p.team]}.`);
    room.touched = this.now(); return this.credentials(room, p);
  }
  log(room, message) { room.logs.unshift({ at: this.now(), message }); room.logs = room.logs.slice(0, 35); }
  online(p) { return this.now() - p.seen < ONLINE_MS; }
  advance(room) {
    if (room.phase !== 'running') return;
    const until = Math.min(this.now(), room.endsAt);
    // Integrate hold time, including the exact cutoff when a player goes offline.
    for (const p of room.players.values()) if (p.infectedBy) {
      const activeUntil = Math.min(until, p.seen + ONLINE_MS);
      room.scores[p.infectedBy] += Math.max(0, activeUntil - room.scoredAt) / 1000;
    }
    room.scoredAt = until;
    if (this.now() >= room.endsAt) {
      room.phase = 'finished';
      for (const p of room.players.values()) p.challenge = null;
      const diff = Math.round(room.scores.cyan * 100) - Math.round(room.scores.coral * 100);
      this.log(room, diff === 0 ? 'Match ended in a draw.' : `${diff > 0 ? 'Cyan' : 'Coral'} wins the match!`);
    }
  }
  snapshot(room, me) {
    return { code: room.code, phase: room.phase, serverNow: this.now(), startedAt: room.startedAt, endsAt: room.endsAt,
      round: room.round, hostId: room.host, meId: me.id,
      scores: { cyan: Number(room.scores.cyan.toFixed(2)), coral: Number(room.scores.coral.toFixed(2)) },
      players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, infectedBy: p.infectedBy,
        shieldUntil: p.shieldUntil, online: this.online(p), attacks: p.attacks, cleans: p.cleans })),
      cooldownUntil: me.cooldownUntil, challenge: me.challenge ? this.publicChallenge(me.challenge) : null, logs: room.logs };
  }
  publicChallenge(c) {
    return { id: c.id, mode: c.mode, kind: c.kind, targetId: c.targetId, targetName: c.targetName,
      deadline: c.deadline, sequence: c.sequence, progress: c.progress, round: c.round, phrase: c.phrase };
  }
  read(code, secret) {
    const room = this.room(code), me = this.player(room, secret);
    if (me.challenge && this.now() >= me.challenge.deadline) me.challenge = null;
    return this.snapshot(room, me);
  }
  start(code, secret) {
    const room = this.room(code), me = this.player(room, secret);
    if (me.id !== room.host) fail('Only the host can start the match.', 403);
    if (room.phase !== 'lobby') fail('The match is not in the lobby.');
    const active = [...room.players.values()].filter(p => this.online(p));
    if (!['cyan', 'coral'].every(t => active.some(p => p.team === t))) fail('At least one online player must join each team.');
    room.phase = 'running'; room.startedAt = this.now(); room.endsAt = this.now() + 180000; room.scoredAt = this.now();
    this.log(room, 'Match started! 3 minutes on the clock.');
    return this.snapshot(room, me);
  }
  rematch(code, secret) {
    const room = this.room(code), me = this.player(room, secret);
    if (me.id !== room.host) fail('Only the host can open a rematch.', 403);
    if (room.phase !== 'finished') fail('Wait for the current match to finish.');
    room.phase = 'lobby'; room.round++; room.scores = { cyan: 0, coral: 0 }; room.startedAt = room.endsAt = room.scoredAt = null;
    for (const p of room.players.values()) Object.assign(p, { infectedBy: null, shieldUntil: 0, challenge: null, cooldownUntil: 0, attacks: 0, cleans: 0 });
    this.log(room, 'Rematch lobby opened. New players can join.');
    return this.snapshot(room, me);
  }
  target(room, me, mode, targetId) {
    const target = room.players.get(targetId);
    if (!target || !this.online(target)) fail('That computer is offline. Choose an online target.');
    if (mode === 'attack') {
      if (target.team === me.team) fail('Attack an opposing team computer.');
      if (target.infectedBy) fail('That target is already infected.');
      if (target.shieldUntil > this.now()) fail('That computer has a short cleanup shield.');
    } else if (mode === 'clean') {
      if (target.team !== me.team) fail('Clean your own computer or a teammate.');
      if (!target.infectedBy) fail('That computer is already clean.');
    } else fail('Choose attack or clean.');
    return target;
  }
  newChallenge(code, secret, mode, targetId, kind) {
    const room = this.room(code), me = this.player(room, secret);
    if (room.phase !== 'running') fail('Start a match before playing a challenge.');
    if (me.cooldownUntil > this.now()) fail('Your next action is ready in a moment.');
    if (me.challenge && this.now() < me.challenge.deadline) fail('Finish or cancel your current challenge first.');
    const target = this.target(room, me, mode, targetId);
    if (!['arrows', 'typing'].includes(kind)) fail('Choose arrows or typing.');
    me.challenge = { id: token(), mode, kind, targetId, targetName: target.name, deadline: this.now() + 25000,
      round: 1, progress: 0, sequence: kind === 'arrows' ? Array.from({ length: 4 }, () => randomInt(4)) : null,
      phrase: kind === 'typing' ? PHRASES[randomInt(PHRASES.length)] : null };
    return { state: this.snapshot(room, me), message: 'Challenge started. 25 seconds!' };
  }
  cancel(code, secret) {
    const room = this.room(code), me = this.player(room, secret); me.challenge = null;
    return { state: this.snapshot(room, me), message: 'Challenge cancelled. No computer changed.' };
  }
  input(code, secret, challengeId, value) {
    const room = this.room(code), me = this.player(room, secret), c = me.challenge;
    if (room.phase !== 'running') fail('This match has ended.');
    if (!c || c.id !== challengeId) fail('Challenge expired or was cancelled. Start another.');
    if (this.now() >= c.deadline) { me.challenge = null; return { state: this.snapshot(room, me), message: 'Time up! No computer changed.' }; }
    if (c.kind === 'arrows') {
      if (!Number.isInteger(value) || value < 0 || value > 3) fail('Invalid arrow input.');
      if (value !== c.sequence[c.progress]) {
        c.progress = 0; c.deadline -= 2000;
        if (this.now() >= c.deadline) me.challenge = null;
        return { state: this.snapshot(room, me), message: me.challenge ? 'Wrong arrow! 2 seconds lost. Restart the sequence.' : 'Time up! No computer changed.' };
      }
      c.progress++;
      if (c.progress < c.sequence.length) return { state: this.snapshot(room, me), message: 'Signal matched.' };
      if (c.round < 3) {
        c.round++; c.progress = 0; c.sequence = Array.from({ length: c.round + 3 }, () => randomInt(4));
        return { state: this.snapshot(room, me), message: 'Sequence complete. Next round!' };
      }
    } else if (value !== c.phrase) {
      c.deadline -= 2000;
      if (this.now() >= c.deadline) me.challenge = null;
      return { state: this.snapshot(room, me), message: me.challenge ? 'Text does not match. 2 seconds lost. Check punctuation and spacing.' : 'Time up! No computer changed.' };
    }
    me.challenge = null;
    let target;
    try { target = this.target(room, me, c.mode, c.targetId); }
    catch (error) { return { state: this.snapshot(room, me), message: `Target changed while you played. ${error.message} No points awarded.` }; }
    if (c.mode === 'attack') {
      target.infectedBy = me.team; me.attacks++; room.scores[me.team] += 10;
      this.log(room, `${me.name} infected ${target.name}. +10 ${TEAM_NAMES[me.team]}.`);
    } else {
      target.infectedBy = null; target.shieldUntil = this.now() + 6000; me.cleans++; room.scores[me.team] += 10;
      this.log(room, `${me.name} cleaned ${target.name}. +10 ${TEAM_NAMES[me.team]}; 6-second shield.`);
    }
    me.cooldownUntil = this.now() + 2000;
    return { state: this.snapshot(room, me), message: c.mode === 'attack' ? 'Attack landed! +10 points. Earn 1 more per second while the target stays infected and online.' : 'Cleanup complete! +10 points and a 6-second shield for your teammate.' };
  }
}
