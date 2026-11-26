'use strict';
/* The house's own players, each an ordinary client of the public API (no back door): they register, wait for their turn and send
   one target height a ball, exactly as any outside player does.     node house/run-house.js [http://127.0.0.1:8990]
     Written rule     exact arithmetic: a shot the other cannot reach if there is one, else close to the far wall
     Follow the ball  meets the ball with the middle of its paddle
     Corner pin       exact arithmetic: lands the ball exactly in a corner, where the other paddle cannot choose its angle */
const fs = require('fs'), path = require('path');
const { RULES, arriveAt, clampPaddle, moveToward } = require('../engine/game.js');
const BASE = process.argv[2] || 'http://127.0.0.1:8990', H = RULES.paddleHalf, TOKENS = path.join(__dirname, '.tokens.json');

function rule(v) {
  const T = RULES.length / v.speed, yc = arriveAt(v.y0, v.slope), reach = RULES.paddleSpeed * T, T1 = RULES.length / Math.min(RULES.maxSpeed, v.speed * RULES.speedUp);
  const other = moveToward(v.other, 0.5, RULES.paddleSpeed * T), wall = other > 0.5 ? 0.04 : 0.96; let kill = null, near = null;
  for (let k = -45; k <= 45; k++) {
    const yp = clampPaddle(yc - (k / 50) * H); if (Math.abs(yp - v.me) > reach + 1e-9) continue;
    const lands = arriveAt(yc, (yc - yp) / H), spare = Math.abs(lands - other) - (RULES.paddleSpeed * T1 + H), dw = Math.abs(lands - wall);
    if (spare > 0.01 && (!kill || spare > kill.spare)) kill = { spare, yp };
    if (!near || dw < near.dw) near = { dw, yp };
  }
  return kill ? kill.yp : near ? near.yp : yc;
}
const follow = (v) => arriveAt(v.y0, v.slope);
function pin(v) {
  const T = RULES.length / v.speed, yc = arriveAt(v.y0, v.slope), reach = RULES.paddleSpeed * T, T1 = RULES.length / Math.min(RULES.maxSpeed, v.speed * RULES.speedUp);
  const other = moveToward(v.other, 0.5, RULES.paddleSpeed * T), cover = RULES.paddleSpeed * T1 + H, cands = [];
  for (const R of [-1.0003, -0.0003, 1.0003, 2.0003]) cands.push(yc - H * ((R - yc) / RULES.length));
  for (let k = -48; k <= 48; k++) cands.push(yc - (k / 50) * H);
  let best = null;
  for (const raw of cands) { const yp = clampPaddle(raw); if (Math.abs(yp - v.me) > reach + 1e-9 || Math.abs(yc - yp) > H * 0.975) continue; const lands = arriveAt(yc, (yc - yp) / H), spare = Math.abs(lands - other) - cover, val = spare > 0.01 ? 10 + spare : -Math.min(lands, 1 - lands); if (!best || val > best.val) best = { val, yp }; }
  return best ? best.yp : yc;
}
const BOTS = [['Written rule', rule], ['Follow the ball', follow], ['Corner pin', pin]];

async function api(p, opts, token) { const r = await fetch(BASE + p, Object.assign({ headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}) }, opts)); return r.json(); }
async function register(name, tokens) {
  const r = await api('/api/register', { method: 'POST', body: JSON.stringify({ name }) });
  if (!r.token) throw new Error(name + ': ' + JSON.stringify(r));
  tokens[name] = r.token; fs.writeFileSync(TOKENS, JSON.stringify(tokens, null, 1));
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function run(name, decide, tokens) {
  for (;;) {
    try {
      if (!tokens[name]) await register(name, tokens);
      const m = await api('/api/next', {}, tokens[name]);
      if (m.type === 'decide') await api('/api/decide', { method: 'POST', body: JSON.stringify({ match: m.match, turn: m.turn, target: decide(m.view) }) }, tokens[name]);
      else if (m.error === 'Unknown token.') delete tokens[name];                 // the table started afresh: register again
      else if (m.error) await pause(3000);
    } catch (e) { await pause(3000); }
  }
}
(async () => {
  let tokens = {}; try { tokens = JSON.parse(fs.readFileSync(TOKENS, 'utf8')); } catch (e) { /* first run */ }
  for (const [name, f] of BOTS) run(name, f, tokens).catch((e) => console.error(e.message));
  console.log('house players at the table:', BOTS.map((b) => b[0]).join(', '));
})();
