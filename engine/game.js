'use strict';
/* The game, and nothing else. No player is in this file. The referee runs this file, and the site sends the same file to every
   browser (/engine/game.js), so anyone can replay a published match with the very code that refereed it.

   The table is 1 high and 1.4 long. Each player guards one end line with a paddle that covers 0.09 above and below its centre.
   A ball leaves a line at height y0 with a slope (rise per unit of travel) and bounces off the top and bottom walls.
   If it meets the paddle it goes back: the slope is set by where on the paddle it landed (middle = straight, edges = steep)
   and it gets 1.35 times faster, up to 6. If it misses the paddle the other player scores. First to 5 wins. Serves alternate.
   A paddle moves towards its player's latest target at up to 0.9 per second. Both paddles go to the middle before a serve.
   A rally of 200 returns is a let (served again, no point); 3 lets in a row end the match as a draw. */
(function () {
const RULES = Object.freeze({ length: 1.4, paddleHalf: 0.09, paddleSpeed: 0.9, serveSpeed: 1.1, speedUp: 1.35, maxSpeed: 6, serveSlope: 0.6, winAt: 5, rallyCap: 200, letsToDraw: 3 });
const fold = (y) => { y = ((y % 2) + 2) % 2; return y > 1 ? 2 - y : y; };                       // a height after bouncing between the walls
const arriveAt = (y0, slope) => fold(y0 + slope * RULES.length);                                 // where a ball reaches the other line
const heightAt = (y0, slope, progress) => fold(y0 + slope * RULES.length * progress);            // where it is part of the way across
const clampPaddle = (p) => Math.max(RULES.paddleHalf, Math.min(1 - RULES.paddleHalf, p));
const moveToward = (p, target, dist) => { const t = clampPaddle(Number.isFinite(target) ? target : p), d = t - p; return Math.abs(d) <= dist ? t : p + Math.sign(d) * dist; };
function makeRng(seed) { let a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* One match between player 0 (left) and player 1 (right). */
class Match {
  constructor(seed) { this.rng = makeRng(seed); this.score = [0, 0]; this.paddle = [0.5, 0.5]; this.clock = 0; this.winner = null; this.server = this.rng() < 0.5 ? 0 : 1; this.serve(); }
  serve() {
    this.paddle[0] = 0.5; this.paddle[1] = 0.5; this.rally = 0; this.pointTo = null;
    this.ball = { to: 1 - this.server, y0: 0.5, slope: (this.rng() * 2 - 1) * RULES.serveSlope, speed: RULES.serveSpeed, progress: 0, serve: true };
  }
  nextPoint() { if (this.winner === null) { this.server = 1 - this.server; this.serve(); } }
  /* What player i is shown. Heights run from 0 (bottom) to 1 (top) and are the same for both players. */
  view(i) {
    const b = this.ball;
    return { clock: this.clock, toMe: b.to === i, y0: b.y0, slope: b.slope, speed: b.speed, progress: b.progress, height: heightAt(b.y0, b.slope, b.progress),
      me: this.paddle[i], other: this.paddle[1 - i], rally: this.rally, myScore: this.score[i], otherScore: this.score[1 - i] };
  }
  /* Move the game on by dt seconds of game time. targets = where each player wants its paddle. Returns what happened. */
  step(dt, targets) {
    const events = [];
    while (dt > 1e-12 && this.pointTo === null) {
      const b = this.ball, T = RULES.length / b.speed, h = Math.min(dt, (1 - b.progress) * T), d = RULES.paddleSpeed * h;
      this.paddle[0] = moveToward(this.paddle[0], targets[0], d); this.paddle[1] = moveToward(this.paddle[1], targets[1], d);
      b.progress += h / T; this.clock += h; dt -= h;
      if (b.progress >= 1 - 1e-12) events.push(this.land());
    }
    return events;
  }
  land() {
    const b = this.ball, at = arriveAt(b.y0, b.slope), r = b.to, p = this.paddle[r], crossing = { y0: b.y0, slope: b.slope, at };
    if (Math.abs(at - p) <= RULES.paddleHalf) {
      const slope = (at - p) / RULES.paddleHalf, ev = { type: 'hit', by: r, at, slope, rallyBefore: this.rally, paddle: [this.paddle[0], this.paddle[1]], crossing };
      this.rally++; this.ball = { to: 1 - r, y0: at, slope, speed: Math.min(RULES.maxSpeed, b.speed * RULES.speedUp), progress: 0, serve: false };
      return ev;
    }
    const w = 1 - r; this.score[w]++; this.pointTo = w; b.progress = 1; if (this.score[w] >= RULES.winAt) this.winner = w;
    return { type: 'point', to: w, at, missedBy: Math.abs(at - p) - RULES.paddleHalf, score: [this.score[0], this.score[1]], crossing };
  }
}

/* Replay a published match record with these rules and say whether it holds. Every serve must come from the seed, every ball
   from the shot before it and the targets the players sent, every point from where the ball met or missed the paddle, and the
   final score must follow. Records marked v3 keep every number at full precision and must match exactly; older v2 records were
   rounded to 6 decimals, so there each ball is taken from the record and checked to 1e-4. Returns { ok, balls, score, problems }. */
function replay(rec) {
  const exact = rec.rules === 'v3', tol = exact ? 0 : 1e-4, problems = [], m = new Match(rec.seed >>> 0), targets = [0.5, 0.5], balls = rec.balls || [];
  const off = (a, b) => !(Math.abs(a - b) <= tol);
  let k = 0, ballRef = null, lets = 0, draw = false;
  while (m.winner === null && problems.length < 5) {
    if (m.ball !== ballRef && m.pointTo === null) {                        // a ball starts towards a player
      ballRef = m.ball; const i = m.ball.to, r = balls[k++];
      if (!r) { problems.push('the record stops before the match is over'); break; }
      targets[1 - i] = 0.5;
      if (r.to !== i || off(r.y0, m.ball.y0) || off(r.slope, m.ball.slope) || off(r.speed, m.ball.speed) || off(r.paddle[0], m.paddle[0]) || off(r.paddle[1], m.paddle[1]))
        problems.push('ball ' + k + ' is not the ball the rules and the seed give');
      if (!exact) { m.ball.y0 = r.y0; m.ball.slope = r.slope; m.ball.speed = r.speed; m.paddle[0] = r.paddle[0]; m.paddle[1] = r.paddle[1]; }
      targets[i] = r.target;
    }
    const ev = m.step((1 - m.ball.progress) * RULES.length / m.ball.speed, targets), last = balls[k - 1];
    for (const e of ev) {
      const said = last.result === 'point' ? 'point' : 'returned';
      if ((e.type === 'hit' ? 'returned' : 'point') !== said || (e.type === 'point' && last.pointTo !== e.to) || off(last.at, e.at)) problems.push('ball ' + k + ' did not end the way the record says');
    }
    if (m.pointTo === null && m.rally >= RULES.rallyCap) {
      lets++; if (last.result !== 'let') problems.push('ball ' + k + ' should be a let');
      if (lets >= RULES.letsToDraw) { draw = true; break; }
      m.serve(); continue;
    }
    if (m.pointTo !== null) { lets = 0; if (m.winner === null) m.nextPoint(); }
  }
  if (k !== balls.length) problems.push('the record has ' + balls.length + ' balls; the rules give ' + k);
  if (rec.score && (rec.score[0] !== m.score[0] || rec.score[1] !== m.score[1])) problems.push('the record says ' + rec.score.join(':') + '; the rules give ' + m.score.join(':'));
  if (!!rec.draw !== draw) problems.push('the record and the rules disagree on a draw');
  return { ok: problems.length === 0, balls: k, score: [m.score[0], m.score[1]], exact, problems };
}

/* The lock shown before a match: SHA-256 of "<salt>:<seed>". Revealed after the match, it proves the seed was fixed first. */
const lockText = (salt, seed) => salt + ':' + (seed >>> 0);

const NG = { RULES, fold, arriveAt, heightAt, clampPaddle, moveToward, makeRng, Match, replay, lockText };
if (typeof module === 'object' && module.exports) module.exports = NG; else globalThis.NG = NG;
})();
