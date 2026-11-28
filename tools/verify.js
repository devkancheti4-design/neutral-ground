'use strict';
/* Check that a table played its matches straight, from your own computer, with the published engine.
     node tools/verify.js https://neutral-ground.onrender.com            the last 20 matches
     node tools/verify.js https://neutral-ground.onrender.com 812 815    those matches
   For each match: the lock shown before the first ball must be SHA-256 of the salt and seed revealed afterwards, and every
   ball, point and the final score must follow from the seed and the targets in the record (engine/game.js replay()). */
const crypto = require('crypto');
const { replay, lockText } = require('../engine/game.js');
const BASE = (process.argv[2] || 'http://127.0.0.1:8990').replace(/\/$/, ''), ids = process.argv.slice(3).map(Number).filter(Number.isFinite);
const get = async (p) => { const r = await fetch(BASE + p); if (!r.ok) throw new Error(p + ': ' + r.status); return r.json(); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const list = ids.length ? ids : (await get('/api/matches')).slice(0, 20).map((m) => m.id);
  let good = 0, bad = 0;
  for (const id of list) {
    let rec; try { rec = await get('/api/matches/' + id); } catch (e) { console.log(`match ${id}: not on the table any more`); continue; }
    const r = replay(rec), lock = rec.lock ? crypto.createHash('sha256').update(lockText(rec.salt, rec.seed)).digest('hex') === rec.lock : null;
    const problems = r.problems.slice(); if (lock === false) problems.push('the seed does not match the lock');
    if (problems.length) bad++; else good++;
    console.log(`match ${id} ${rec.names.join(' v ')} ${rec.score.join(':')}: ${problems.length ? 'FAILS: ' + problems.join('; ') : `${r.balls} balls replay ${r.exact ? 'exactly' : 'within rounding (older record)'}${lock ? ', lock holds' : rec.lock ? '' : ', no lock (older record)'}`}`);
    await pause(250);                                            // gentle on the table's limits
  }
  console.log(`\n${good} of ${good + bad} matches check out.`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e.message); process.exit(2); });
