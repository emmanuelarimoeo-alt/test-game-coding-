import http from 'node:http';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { Arena, GameError } from './engine.mjs';

export const arena = new Arena();
export function localAddresses(port) {
  const found = [];
  for (const [adapter, entries] of Object.entries(networkInterfaces())) for (const n of entries || []) {
    if (n.family === 'IPv4' && !n.internal) found.push({ adapter, url: `http://${n.address}:${port}` });
  }
  return found.sort((a, b) => Number(/virtual|vmware|vethernet|wsl|vpn/i.test(a.adapter)) - Number(/virtual|vmware|vethernet|wsl|vpn/i.test(b.adapter)));
}
const root = new URL('./public/', import.meta.url);
const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
const buckets = new Map();
function limit(key) {
  const now = Date.now(); let b = buckets.get(key);
  if (!b || now - b.at > 60000) { b = { at: now, n: 0 }; buckets.set(key, b); }
  if (++b.n > 1600) throw new GameError('Too many requests. Please wait a minute.', 429);
  if (buckets.size > 2000) for (const [k, v] of buckets) if (now - v.at > 60000) buckets.delete(k);
}
async function body(req) {
  let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 8192) throw new GameError('Request too large.', 413); }
  try { return JSON.parse(raw || '{}'); } catch { throw new GameError('Invalid request.', 400); }
}
export async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'self'; base-uri 'none'");
  const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  try {
    const url = new URL(req.url, 'http://arena.local');
    if (req.method === 'GET' && assets[url.pathname]) {
      const [name, type] = assets[url.pathname]; res.writeHead(200, { 'Content-Type': type }); return res.end(await fs.readFile(new URL(name, root)));
    }
    if (req.method === 'GET' && url.pathname === '/healthz') return json(200, { status: 'ok' });
    if (!url.pathname.startsWith('/api/')) return json(404, { error: 'Not found.' });
    const secret = String(req.headers.authorization || '').replace(/^Bearer /, '');
    // Online hosts place all players behind a proxy. Limit by session so one
    // busy player cannot exhaust every teammate's allowance through that proxy.
    limit(/^[a-f0-9]{48}$/.test(secret) ? `session:${secret}` : `address:${req.socket.remoteAddress || 'local'}`);
    if (req.headers['sec-fetch-site'] === 'cross-site') throw new GameError('Cross-site requests are not allowed.', 403);
    if (req.method === 'GET' && url.pathname === '/api/host-info') {
      const hostname = String(req.headers.host || '').split(':')[0];
      return json(200, { addresses: ['localhost', '127.0.0.1'].includes(hostname) ? localAddresses(req.socket.localPort || Number(process.env.PORT || 8787)) : [] });
    }
    if (req.method === 'GET' && url.pathname === '/api/state') return json(200, arena.read(url.searchParams.get('room'), secret));
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    const b = await body(req);
    let result;
    switch (url.pathname) {
      case '/api/create': result = arena.create(b.name, b.team); break;
      case '/api/join': result = arena.join(b.code, b.name, b.team); break;
      case '/api/start': result = arena.start(b.code, secret); break;
      case '/api/rematch': result = arena.rematch(b.code, secret); break;
      case '/api/challenge': result = arena.newChallenge(b.code, secret, b.mode, b.targetId, b.kind); break;
      case '/api/input': result = arena.input(b.code, secret, b.challengeId, b.value); break;
      case '/api/cancel': result = arena.cancel(b.code, secret); break;
      default: return json(404, { error: 'Not found.' });
    }
    return json(200, result);
  } catch (e) { if (!(e instanceof GameError)) console.error('Arena error:', e.message); json(e.status || 500, { error: e instanceof GameError ? e.message : 'Host error. Try again.' }); }
}
export function makeServer() { return http.createServer(handler); }
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 8787);
  const server = makeServer();
  server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Close the other server or choose another PORT.` : `Could not start: ${e.message}`); process.exitCode = 1; });
  server.listen(port, '0.0.0.0', () => {
    console.log('\nNETWORK ARENA - host is running\n');
    console.log(`On this laptop: http://localhost:${port}`);
    for (const entries of Object.values(networkInterfaces())) for (const n of entries || []) if (n.family === 'IPv4' && !n.internal) console.log(`Other laptops on your Wi-Fi: http://${n.address}:${port}`);
    console.log('\nShare the Wi-Fi address, then the six-character match code.\nKeep this window open. Ctrl+C stops the host and clears matches.\n');
  });
  setInterval(() => arena.sweep(), 60000).unref();
}
