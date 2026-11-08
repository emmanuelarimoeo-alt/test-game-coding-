'use strict';
const $ = id => document.getElementById(id);
let session = null, state = null, mode = 'create', busy = false, syncing = false, offset = 0;
let sequence = Promise.resolve(), lastChallenge = null, typingStarted = 0, noticeTimer;
let hostAddresses = [];
const arrows = ['↑', '→', '↓', '←'];
const now = () => Date.now() + offset;
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
function notice(message) { $('notice').hidden = false; $('notice').textContent = message; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $('notice').hidden = true, 8000); }
function saveSession() { try { if (session) localStorage.setItem('network-arena-session', JSON.stringify(session)); else localStorage.removeItem('network-arena-session'); } catch {} }
function setMode(next) { mode = next; $('create-tab').classList.toggle('selected', mode === 'create'); $('join-tab').classList.toggle('selected', mode === 'join'); $('code-field').hidden = mode !== 'join'; $('room-code').required = mode === 'join'; $('enter').textContent = mode === 'join' ? 'Join match →' : 'Create match →'; }
$('create-tab').onclick = () => setMode('create'); $('join-tab').onclick = () => setMode('join');
function request(path, data) {
  const call = async () => {
    const headers = {}; if (session) headers.Authorization = 'Bearer ' + session.token;
    if (data !== undefined) headers['Content-Type'] = 'application/json';
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(path, { method: data === undefined ? 'GET' : 'POST', headers, body: data === undefined ? undefined : JSON.stringify(data), signal: controller.signal });
      const result = await response.json();
      if (!response.ok) { const error = new Error(result.error || 'Request failed.'); error.status = response.status; throw error; }
      return result;
    } catch (e) { if (e.name === 'AbortError' || e instanceof TypeError) throw new Error('Cannot reach the host. Keep its server window open and check your connection.'); throw e; }
    finally { clearTimeout(timeout); }
  };
  const result = sequence.then(call, call); sequence = result.catch(() => {}); return result;
}
function apply(s) { state = s; offset = s.serverNow - Date.now(); $('entry').hidden = true; $('match').hidden = false; $('connection').textContent = 'CONNECTED / MATCH ' + s.code; render(); }
$('entry-form').onsubmit = async e => {
  e.preventDefault(); if (busy) return; busy = true; $('enter').disabled = true;
  try {
    const result = await request('/api/' + mode, { name: $('player-name').value, team: $('team').value, code: $('room-code').value.trim().toUpperCase() });
    session = { code: result.code, token: result.token, playerId: result.playerId }; saveSession(); apply(result.state);
    history.replaceState(null, '', '#room=' + result.code);
  } catch (e) { notice(e.message); } finally { busy = false; $('enter').disabled = false; }
};
async function action(path, body = {}) {
  if (!session || busy) return; busy = true;
  const activeSession = session;
  try { const result = await request('/api/' + path, { ...body, code: session.code }); if (session !== activeSession) return; apply(result.state || result); if (result.message) $('mission-message').textContent = result.message; }
  catch (e) { notice(e.message); }
  finally { busy = false; render(); }
}
$('start').onclick = () => action('start'); $('rematch').onclick = () => action('rematch'); $('cancel').onclick = () => action('cancel');
$('exit').onclick = () => { session = null; state = null; saveSession(); $('match').hidden = true; $('entry').hidden = false; $('connection').textContent = 'TWO TEAMS. ONE NETWORK.'; notice('You left the view. Your computer goes offline after 15 seconds. To join again, use a new player name.'); };
$('copy').onclick = async () => { const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname); const origin = local && hostAddresses.length ? hostAddresses[0].url : location.origin; const link = origin + '/#room=' + state.code; try { await navigator.clipboard.writeText(link); notice('Invite copied! Share it with your teammates to join this match.'); } catch { notice('Share this address: ' + link + ' — match code ' + state.code); } };
function begin(mode, targetId) { if (state?.challenge) { notice('Finish or cancel your current challenge first.'); return; } return action('challenge', { mode, targetId, kind: $('challenge-kind').value }); }
function input(value) { if (!state?.challenge || busy) return; return action('input', { challengeId: state.challenge.id, value }); }
document.querySelectorAll('[data-arrow]').forEach(button => button.onclick = () => input(Number(button.dataset.arrow)));
window.addEventListener('keydown', e => { if (!state?.challenge || state.challenge.kind !== 'arrows' || state.phase !== 'running') return; const index = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].indexOf(e.key); if (index !== -1) { e.preventDefault(); if (!e.repeat) input(index); } });
$('typing-game').onsubmit = e => { e.preventDefault(); return input($('typing-answer').value); };
$('typing-answer').addEventListener('paste', e => { e.preventDefault(); notice('Typing sprint: type the passage yourself.'); });
$('typing-answer').addEventListener('input', () => {
  if (!state?.challenge || state.challenge.kind !== 'typing') return;
  if (!typingStarted) typingStarted = Date.now();
  const text = $('typing-answer').value, phrase = state.challenge.phrase;
  let matched = 0; while (matched < text.length && text[matched] === phrase[matched]) matched++;
  $('typing-progress').textContent = matched + '/' + phrase.length + ' characters matched';
  $('typing-progress').className = matched === text.length ? 'typing-match' : 'typing-wrong';
  $('typing-speed').textContent = Math.round((matched / 5) / Math.max((Date.now() - typingStarted) / 60000, 1 / 60)) + ' WPM';
});
function render() {
  if (!state || !session) return;
  const me = state.players.find(p => p.id === state.meId), running = state.phase === 'running', host = me.id === state.hostId;
  $('match-code').textContent = state.code; $('round-label').textContent = '/ ' + String(state.round).padStart(2, '0');
  $('phase').textContent = state.phase === 'lobby' ? 'PRE-MATCH LOBBY' : running ? 'MATCH LIVE' : 'FINAL RESULTS';
  $('cyan-score').textContent = state.scores.cyan.toFixed(2); $('coral-score').textContent = state.scores.coral.toFixed(2);
  $('me-label').textContent = me.name + ' / ' + (me.team === 'cyan' ? 'Cyan' : 'Coral') + (me.infectedBy ? ' / INFECTED' : ' / CLEAN');
  const ready = ['cyan', 'coral'].every(t => state.players.some(p => p.team === t && p.online));
  $('start').hidden = !host || state.phase !== 'lobby'; $('start').disabled = !ready || busy;
  $('rematch').hidden = !host || state.phase !== 'finished'; $('rematch').disabled = busy;
  if (state.phase === 'lobby') { $('match-status').textContent = ready ? 'Both teams are online. Ready when you are.' : 'Waiting for both teams.'; $('match-help').textContent = host ? 'Share the invite, balance your teams, then start the round.' : 'Your host will start the match once both teams are ready.'; }
  else if (running) { $('match-status').textContent = me.infectedBy ? 'Your computer is infected. Fight back.' : 'Your computer is clean. Keep the pressure on.'; $('match-help').textContent = 'Attack opponents or clean teammates. +10 per action, +1 per second of enemy control.'; }
  else { const diff = Math.round(state.scores.cyan * 100) - Math.round(state.scores.coral * 100); $('match-status').textContent = diff === 0 ? 'A perfect draw.' : (diff > 0 ? 'Cyan' : 'Coral') + ' wins the network!'; $('match-help').textContent = host ? 'Open a rematch lobby to play again with these teams.' : 'Wait for your host to open the rematch lobby.'; }
  for (const team of ['cyan', 'coral']) {
    const players = state.players.filter(p => p.team === team), list = $(team + '-roster'); list.replaceChildren();
    $(team + '-count').textContent = players.filter(p => p.online).length + '/' + players.length + ' online';
    if (!players.length) list.append(el('p', 'Waiting for teammates…', 'muted small'));
    for (const p of players) {
      const card = el('article', undefined, 'computer' + (p.infectedBy ? ' infected' : '') + (!p.online ? ' offline' : ''));
      const top = el('div', undefined, 'computer-top'); top.append(el('span', p.name + (p.id === me.id ? ' (you)' : '') + (p.id === state.hostId ? ' · host' : ''), 'computer-name'), el('span', '▣', 'computer-icon')); card.append(top);
      const shield = p.shieldUntil > now();
      card.append(el('div', !p.online ? 'OFFLINE' : p.infectedBy ? 'INFECTED / ' + p.infectedBy.toUpperCase() + ' CONTROL' : shield ? 'CLEAN / SHIELDED' : 'CLEAN / ONLINE', 'computer-status'));
      const own = p.team === me.team, button = el('button', own ? (p.infectedBy ? 'Clean computer' : 'Protected') : (p.infectedBy ? 'Under your control' : shield ? 'Shield active' : 'Attack computer'), own ? 'clean-button' : 'attack-button');
      button.disabled = !running || !p.online || busy || Boolean(state.challenge) || state.cooldownUntil > now() || (own ? !p.infectedBy : Boolean(p.infectedBy) || shield);
      button.onclick = () => begin(own ? 'clean' : 'attack', p.id); card.append(button, el('div', p.attacks + ' attacks · ' + p.cleans + ' cleanups', 'computer-stat')); list.append(card);
    }
  }
  const c = state.challenge;
  $('idle-challenge').hidden = Boolean(c); $('active-challenge').hidden = !c;
  if (c) {
    $('challenge-title').textContent = (c.mode === 'attack' ? 'Attack ' : 'Clean ') + c.targetName;
    $('challenge-instructions').textContent = c.kind === 'arrows' ? 'Round ' + c.round + '/3 — match the arrows left to right.' : 'Type this passage exactly. Include capitals, spaces, and punctuation.';
    $('arrows-game').hidden = c.kind !== 'arrows'; $('typing-game').hidden = c.kind !== 'typing';
    if (lastChallenge !== c.id) { $('typing-answer').value = ''; typingStarted = 0; $('typing-progress').textContent = '0 characters matched'; $('typing-speed').textContent = '0 WPM'; $('mission-message').textContent = ''; if (c.kind === 'typing') setTimeout(() => $('typing-answer').focus(), 0); }
    if (c.kind === 'arrows') { $('sequence').replaceChildren(); c.sequence.forEach((a, i) => $('sequence').append(el('span', arrows[a], i < c.progress ? 'done' : i === c.progress ? 'next' : ''))); }
    else $('typing-prompt').textContent = c.phrase;
  } else if (lastChallenge && running) $('mission-message').textContent = $('mission-message').textContent || 'Challenge ended. Choose your next target.';
  lastChallenge = c?.id || null;
  $('submit-typing').disabled = busy; $('cancel').disabled = busy;
  document.querySelectorAll('[data-arrow]').forEach(button => button.disabled = busy);
  $('feed').replaceChildren(); for (const item of state.logs) { const row = el('div', undefined, 'feed-item'); row.append(el('time', new Date(item.at).toLocaleTimeString()), el('span', item.message)); $('feed').append(row); }
  tick();
}
function tick() {
  if (!state) return;
  const ms = state.phase === 'lobby' ? 180000 : Math.max(0, (state.endsAt || 0) - now()); const seconds = Math.ceil(ms / 1000);
  $('timer').textContent = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
  $('timer-label').textContent = state.phase === 'lobby' ? 'WAITING FOR TEAMS' : state.phase === 'running' ? 'TIME REMAINING' : 'MATCH COMPLETE';
  if (state.challenge) $('challenge-timer').textContent = (Math.max(0, state.challenge.deadline - now()) / 1000).toFixed(1) + 's';
}
async function poll() {
  if (!session || busy || syncing) return; syncing = true; const activeSession = session;
  try { const s = await request('/api/state?room=' + encodeURIComponent(session.code)); if (session !== activeSession) return; apply(s); }
  catch (e) { if (session !== activeSession) return; $('connection').textContent = 'RECONNECTING…'; if (e.status === 401 || e.status === 404) { session = null; state = null; saveSession(); $('match').hidden = true; $('entry').hidden = false; notice(e.message); } }
  finally { syncing = false; }
}
try { const saved = JSON.parse(localStorage.getItem('network-arena-session')); if (saved?.code && saved?.token) session = saved; } catch {}
const invite = new URLSearchParams(location.hash.slice(1)).get('room'); if (invite) { $('room-code').value = invite.toUpperCase(); setMode('join'); if (session && session.code !== invite.toUpperCase()) { session = null; saveSession(); } }
if (session) poll(); setInterval(poll, 900); setInterval(tick, 100);
request('/api/host-info').then(info => hostAddresses = info.addresses).catch(() => {});
