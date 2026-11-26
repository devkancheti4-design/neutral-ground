'use strict';
/* The game, and nothing else. No player is in this file.

   The table is 1 high and 1.4 long. Each player guards one end line with a paddle that covers 0.09 above and below its centre.
   A ball leaves a line at height y0 with a slope (rise per unit of travel) and bounces off the top and bottom walls.
   If it meets the paddle it goes back: the slope is set by where on the paddle it landed (middle = straight, edges = steep)
   and it gets 1.35 times faster, up to 6. If it misses the paddle the other player scores. First to 5 wins. Serves alternate.
   A paddle moves towards its player's latest target at up to 0.9 per second. Both paddles go to the middle before a serve. */
const RULES = Object.freeze({ length: 1.4, paddleHalf: 0.09, paddleSpeed: 0.9, serveSpeed: 1.1, speedUp: 1.35, maxSpeed: 6, serveSlope: 0.6, winAt: 5 });
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
module.exports = { RULES, fold, arriveAt, heightAt, clampPaddle, moveToward, makeRng, Match };
