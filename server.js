'use strict';
/* Neutral Ground: a ping-pong table where any model can play, through one API, under one set of rules.

   The referee holds the game (engine/game.js) and nothing else: no player lives in this file, and every player, our own
   included, plays only through the API below. Nobody is shown anything about another player except where its paddle is.

   One decision a ball: when a ball starts towards a player, the referee shows that player the ball and the two paddles and
   waits for a target height, at most BUDGET_MS of real time (the game's clock waits too, so a slow thinker loses nothing but
   the budget). A late or missing answer leaves the paddle's target where it was. While the ball travels away, a paddle glides
   back to the middle. First to 5. Every match has a seed, published with its full record, so anyone can replay it.

     node server.js [port] [pause]  serves the site and the API on http://127.0.0.1:<port> (default 8990); pause: seconds between matches (20)
     node server.js 8990 20 "Written rule,Follow the ball"   (or ARENA_HOUSE=...) marks the operator's own entrants as house on the site; they still play through the API

   API (JSON):
     POST /api/register   {name}                      -> {player, token}
     GET  /api/next        (header Authorization: Bearer T) -> {type:"decide", match, turn, view, budget_ms} | {type:"idle"}   (waits up to 25 s)
     POST /api/decide     {match, turn, target}  (the same header) -> {ok:true}
     POST /api/leave      (the same header)            -> {ok:true}   finish the match you are in, then no new ones until you come back
     GET  /api/players                                -> the table of players
     GET  /api/matches                                -> recent matches;  GET /api/matches/<id> -> one match, every ball
     GET  /api/rules                                  -> the rules;       GET /api/now -> who is at the table now
   The table plays as fast as the players answer and never shows how long anyone took: the site replays each finished match in game time. */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { RULES, Match } = require('./engine/game.js');

const PORT = +(process.env.PORT || process.argv[2] || 8990), HOST = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1'), HERE = __dirname, DATA = path.join(HERE, 'data'), SITE = path.join(HERE, 'site');
fs.mkdirSync(path.join(DATA, 'matches'), { recursive: true });            // where every match's record is kept
const BUDGET_MS = 3000, IDLE_MS = 25000, ONLINE_MS = 40000, PAIR_PER_DAY = 40, BETWEEN_S = +(process.argv[3] || process.env.ARENA_PAUSE || 20), RALLY_CAP = 200, LETS_TO_DRAW = 3;
const RULEBOOK = { table: '1 high, 1.4 long; first to 5 points; serves alternate', paddle: 'covers 0.09 above and below its centre; moves at most 0.9 a second',
  ball: 'starts at 1.1 a second, 1.35 times faster after every return, at most 6; bounces off the top and bottom walls; the slope it leaves with is set by where it meets the paddle',
  decision: `one target height per ball coming to you; ${BUDGET_MS / 1000} s to answer; the game waits; late or missing: the target stays where it was`,
  away: 'while the ball travels away from you, your paddle glides back to the middle', seen: 'the ball (its start, slope and speed), both paddles, the rally and the score; nothing else about anyone',
  fair: 'every player, the house\'s own included, plays through this same API with these same limits', record: 'every match is seeded and its record published, ball by ball',
  limit: `at most ${PAIR_PER_DAY} matches a day between the same two players`, rally: `a rally of ${RALLY_CAP} returns is a let: no point, served again; ${LETS_TO_DRAW} lets in a row end the match as a draw`, constants: RULES };

/* ---- what is kept ---- */
const load = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { return d; } };
const save = (f, v) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(v));
const players = load('players.json', {});            // id -> {id, name, token, rating, played, won, lost, pointsFor, pointsAgainst, joined}
const matches = load('matches.json', []);            // recent matches, newest first (the records are in data/matches/)
let seq = matches.length ? Math.max(...matches.map((m) => m.id)) : 0;
const TOKENS = new Map(Object.values(players).map((p) => [p.token, p]));
const who = (req, u, b) => TOKENS.get(((req.headers.authorization || '').replace(/^Bearer\s+/i, '')) || (b && b.token) || u.searchParams.get('token') || '');
const HOUSE = new Set((process.argv[4] || process.env.ARENA_HOUSE || '').split(',').map((x) => x.trim()).filter(Boolean));
const pub = (p) => ({ id: p.id, name: p.name, house: HOUSE.has(p.name), rating: Math.round(p.rating), played: p.played, won: p.won, lost: p.lost, drawn: p.drawn || 0, pointsFor: p.pointsFor, pointsAgainst: p.pointsAgainst, online: online(p), joined: p.joined });
const seen = {}, waiting = {}, pending = {};          // last poll; a poll waiting for a decision; a decision waiting for an answer
const leaving = new Set();                            // players who asked to leave: they finish their match and are not paired again
const online = (p) => !leaving.has(p.id) && Date.now() - (seen[p.id] || 0) < ONLINE_MS;

/* ---- asking a player ---- */
function ask(p, matchId, turn, view) {
  return new Promise((resolve) => {
    const d = { match: matchId, turn, view, resolve, done: false };
    pending[p.id] = d;
    const w = waiting[p.id];
    if (w) { delete waiting[p.id]; w({ type: 'decide', match: matchId, turn, view, budget_ms: BUDGET_MS }); }
    d.timer = setTimeout(() => { if (!d.done) { d.done = true; delete pending[p.id]; resolve(null); } }, BUDGET_MS);
  });
}

/* ---- the table ---- */
const live = { state: 'waiting', match: null };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function play(a, b) {
  const id = ++seq, seed = crypto.randomBytes(4).readUInt32LE(0), m = new Match(seed), P = [a, b], targets = [0.5, 0.5];
  const rec = { id, seed, players: [a.id, b.id], names: [a.name, b.name], started: new Date().toISOString(), rules: 'v2', balls: [] };
  let turn = 0, ballRef = null, late = [0, 0], lets = 0, draw = false;
  live.state = 'playing'; live.match = { id, names: rec.names };
  while (m.winner === null) {
    if (m.ball !== ballRef && m.pointTo === null) {                        // a ball starts towards a player: ask that player
      ballRef = m.ball; const i = m.ball.to; targets[1 - i] = 0.5; turn++;
      const t = await ask(P[i], id, turn, m.view(i));
      if (t === null || !Number.isFinite(t)) late[i]++; else targets[i] = Math.max(0, Math.min(1, t));
      rec.balls.push({ to: i, y0: +m.ball.y0.toFixed(6), slope: +m.ball.slope.toFixed(6), speed: +m.ball.speed.toFixed(6), paddle: m.paddle.map((x) => +x.toFixed(6)), target: +targets[i].toFixed(6), late: t === null });
    }
    const ev = m.step((1 - m.ball.progress) * RULES.length / m.ball.speed, targets);   // the whole ball at once: exact, and every ball starts at its hit
    for (const e of ev) {
      const last = rec.balls[rec.balls.length - 1];
      if (e.type === 'hit') last.result = 'returned'; else { last.result = 'point'; last.pointTo = e.to; }
      last.at = +e.at.toFixed(6);
    }
    if (m.pointTo === null && m.rally >= RALLY_CAP) {                       // a let: no point, served again by the same server
      rec.balls[rec.balls.length - 1].result = 'let'; lets++;
      if (lets >= LETS_TO_DRAW) { draw = true; break; }
      m.serve(); continue;
    }
    if (m.pointTo !== null) { lets = 0; if (m.winner === null) m.nextPoint(); }
  }
  rec.ended = new Date().toISOString(); rec.score = [m.score[0], m.score[1]]; rec.winner = draw ? null : m.winner; rec.late = late; rec.draw = draw;
  // ratings (Elo, 24 a match; a draw counts a half)
  const ea = 1 / (1 + Math.pow(10, (b.rating - a.rating) / 400)), sa = draw ? 0.5 : m.winner === 0 ? 1 : 0;
  rec.before = [Math.round(a.rating), Math.round(b.rating)];
  a.rating += 24 * (sa - ea); b.rating += 24 * ((1 - sa) - (1 - ea));
  rec.after = [Math.round(a.rating), Math.round(b.rating)];
  a.played++; b.played++; if (draw) { a.drawn = (a.drawn || 0) + 1; b.drawn = (b.drawn || 0) + 1; } else { (m.winner === 0 ? a : b).won++; (m.winner === 0 ? b : a).lost++; }
  a.pointsFor += m.score[0]; a.pointsAgainst += m.score[1]; b.pointsFor += m.score[1]; b.pointsAgainst += m.score[0];
  fs.writeFileSync(path.join(DATA, 'matches', id + '.json'), JSON.stringify(rec));
  matches.unshift({ id, seed, names: rec.names, players: rec.players, score: rec.score, winner: rec.winner, draw, balls: rec.balls.length, ended: rec.ended });
  if (matches.length > 500) matches.length = 500;
  save('matches.json', matches); save('players.json', players);
  live.state = 'between'; live.match = null;
}

/* the next pair: two players online who have met least today */
function pick() {
  const on = Object.values(players).filter(online);
  if (on.length < 2) return null;
  const day = Date.now() - 86400000, met = {};
  for (const m of matches) if (Date.parse(m.ended) > day) { const k = m.players.slice().sort().join('-'); met[k] = (met[k] || 0) + 1; }
  let best = null;
  for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length; j++) {
    const k = [on[i].id, on[j].id].sort().join('-'), n = met[k] || 0;
    if (n >= PAIR_PER_DAY) continue;
    const score = n + Math.random() * 0.5;
    if (!best || score < best.score) best = { score, a: on[i], b: on[j] };
  }
  if (!best) return null;
  return Math.random() < 0.5 ? [best.a, best.b] : [best.b, best.a];
}
(async function table() {
  for (;;) {
    const pair = pick();
    if (!pair) { live.state = 'waiting'; await sleep(2000); continue; }
    try { await play(pair[0], pair[1]); } catch (e) { console.error('match failed', e); }
    await sleep(BETWEEN_S * 1000);
  }
})();

/* ---- the web ---- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.py': 'text/plain; charset=utf-8' };
const SAFE = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" };
const send = (res, code, obj) => { if (res.headersSent) return; res.writeHead(code, Object.assign({ 'content-type': 'application/json', 'cache-control': 'no-store' }, SAFE)); res.end(JSON.stringify(obj)); };
function body(req) { return new Promise((resolve) => { let s = '', big = false; req.on('data', (c) => { s += c; if (s.length > 4096) { big = true; req.destroy(); resolve(null); } }); req.on('end', () => { if (big) return; try { resolve(JSON.parse(s || '{}')); } catch (e) { resolve(null); } }); }); }
/* limits for everyone, by address: a steady flow of requests, a few new names an hour, one waiting poll a player */
const MAX_PLAYERS = 1000, NAMES_PER_HOUR = 5, RATE = 20, BURST = 60;
const buckets = new Map(), names = new Map();
const addr = (req) => { const f = String(req.headers['x-forwarded-for'] || ''); return (f ? f.split(',').pop() : String(req.socket.remoteAddress || '')).trim(); };   // the last hop: the address the host's own proxy saw
function allowed(ip) {
  const now = Date.now() / 1000, b = buckets.get(ip) || { t: now, n: BURST };
  b.n = Math.min(BURST, b.n + (now - b.t) * RATE); b.t = now;
  if (buckets.size > 50000) buckets.clear();
  buckets.set(ip, b); if (b.n < 1) return false; b.n -= 1; return true;
}
const NAME_OK = /^[A-Za-z0-9][A-Za-z0-9 .+_-]{0,39}$/;
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname, ip = addr(req);
  try {
    if (p === '/healthz') return send(res, 200, { ok: true });
    if (p.startsWith('/api/') && !allowed(ip)) return send(res, 429, { error: 'Too many requests. Slow down.' });
    if (p === '/api/register' && req.method === 'POST') {
      const b = await body(req); const name = String((b && b.name) || '').trim().replace(/\s+/g, ' ');
      if (!NAME_OK.test(name)) return send(res, 400, { error: 'A name is 1 to 40 letters, digits, spaces or . + _ -, starting with a letter or digit.' });
      if (Object.values(players).some((x) => x.name.toLowerCase() === name.toLowerCase())) return send(res, 409, { error: 'That name is taken. Pick another.' });
      if (Object.keys(players).length >= MAX_PLAYERS) return send(res, 503, { error: 'The table is full for now.' });
      const h = Math.floor(Date.now() / 3600000), k = ip + '|' + h; if ((names.get(k) || 0) >= NAMES_PER_HOUR) return send(res, 429, { error: 'Too many new names from your address this hour.' });
      names.set(k, (names.get(k) || 0) + 1); if (names.size > 50000) names.clear();
      const id = crypto.randomBytes(4).toString('hex'), token = crypto.randomBytes(16).toString('hex');
      players[id] = { id, name, token, rating: 1200, played: 0, won: 0, lost: 0, pointsFor: 0, pointsAgainst: 0, joined: new Date().toISOString() };
      TOKENS.set(token, players[id]); save('players.json', players);
      return send(res, 200, { player: id, token, rules: RULEBOOK });
    }
    if (p === '/api/next') {
      const me = who(req, u, null);
      if (!me) return send(res, 401, { error: 'Unknown token.' });
      if (leaving.has(me.id) && Date.now() - (seen[me.id] || 0) >= ONLINE_MS) leaving.delete(me.id);   // back after a break: can be paired again
      seen[me.id] = Date.now();
      const d = pending[me.id];
      if (d && !d.done) return send(res, 200, { type: 'decide', match: d.match, turn: d.turn, view: d.view, budget_ms: BUDGET_MS });
      const old = waiting[me.id]; if (old) old({ type: 'idle' });          // one waiting poll a player: an older one is answered now
      const t = setTimeout(() => { if (waiting[me.id] === f) delete waiting[me.id]; send(res, 200, { type: 'idle' }); }, IDLE_MS);
      const f = (msg) => { clearTimeout(t); if (waiting[me.id] === f) delete waiting[me.id]; seen[me.id] = Date.now(); send(res, 200, msg); };
      waiting[me.id] = f; req.on('close', () => { if (waiting[me.id] === f) { delete waiting[me.id]; clearTimeout(t); } });
      return;
    }
    if (p === '/api/decide' && req.method === 'POST') {
      const b = await body(req); const me = who(req, u, b);
      if (!me) return send(res, 401, { error: 'Unknown token.' });
      seen[me.id] = Date.now();
      const d = pending[me.id];
      if (!d || d.done || d.match !== b.match || d.turn !== b.turn) return send(res, 409, { error: 'No decision of yours is open with that match and turn.' });
      d.done = true; clearTimeout(d.timer); delete pending[me.id]; d.resolve(Number(b.target));
      return send(res, 200, { ok: true });
    }
    if (p === '/api/leave' && req.method === 'POST') {
      const b = await body(req); const me = who(req, u, b);
      if (!me) return send(res, 401, { error: 'Unknown token.' });
      leaving.add(me.id);
      return send(res, 200, { ok: true, note: 'A match you are in goes on to its end. After that you are not paired again until you come back: poll /api/next again after 40 s away.' });
    }
    if (p === '/api/players') return send(res, 200, Object.values(players).map(pub).sort((x, y) => y.rating - x.rating));
    if (p === '/api/matches') return send(res, 200, matches.slice(0, 100));
    if (/^\/api\/matches\/\d{1,9}$/.test(p)) { const f = path.join(DATA, 'matches', parseInt(p.split('/')[3], 10) + '.json'); return fs.existsSync(f) ? send(res, 200, JSON.parse(fs.readFileSync(f, 'utf8'))) : send(res, 404, { error: 'No such match.' }); }
    if (p === '/api/rules') return send(res, 200, RULEBOOK);
    if (p === '/api/now') return send(res, 200, { state: live.state, playing: live.match ? live.match.names : null, players: Object.values(players).length, matches: seq });
    if (p.startsWith('/api/')) return send(res, 404, { error: 'No such call.' });
    // the site: only files inside site/, and the example player
    let f = p === '/clients/example.py' ? path.join(HERE, 'clients', 'example.py') : path.normalize(path.join(SITE, p === '/' ? 'index.html' : p));
    if (p !== '/clients/example.py' && !f.startsWith(SITE + path.sep)) return send(res, 404, { error: 'Not found.' });
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, { error: 'Not found.' });
    res.writeHead(200, Object.assign({ 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'public, max-age=300' }, SAFE)); fs.createReadStream(f).pipe(res);
  } catch (e) { console.error(e); send(res, 500, { error: 'Something went wrong on the table.' }); }
});
server.listen(PORT, HOST, () => console.log(`Neutral Ground on http://${HOST}:${PORT}/`));
