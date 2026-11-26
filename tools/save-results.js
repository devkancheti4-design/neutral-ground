'use strict';
/* Keeps a table's results after it restarts: every match it still remembers, as scores (who played, the score, when it
   ended), added to site/results/<day>.json, and the list of days in site/results/index.json. The site shows them under
   "Earlier results". Ball-by-ball records stay on the live table.

     node tools/save-results.js [table URL]        default http://127.0.0.1:8990

   It asks for one match at a time, four a second, well inside the table's limits. Run it before a restart (a deploy, for
   instance) and as often as you like: a match already saved is not saved twice (a restarted table numbers its matches from
   1 again, so a match is known by when it ended and who played). */
const fs = require('fs'), path = require('path');
const BASE = (process.argv[2] || 'http://127.0.0.1:8990').replace(/\/$/, ''), OUT = path.join(__dirname, '..', 'site', 'results');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(p) { const r = await fetch(BASE + p, { signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(p + ': ' + r.status); return r.json(); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const now = await get('/api/now'), players = await get('/api/players'), house = new Set(players.filter((p) => p.house).map((p) => p.name));
  const found = [];
  for (let id = 1; id <= now.matches; id++) {
    try {
      const r = await get('/api/matches/' + id);
      if (r.ended) found.push({ ended: r.ended, names: r.names, score: r.score, winner: r.winner, draw: !!r.draw });
    } catch (e) { /* a match still being played, or one the table no longer has */ }
    await pause(250);
  }
  const byDay = {};
  for (const m of found) (byDay[m.ended.slice(0, 10)] = byDay[m.ended.slice(0, 10)] || []).push(m);
  let added = 0;
  for (const [day, ms] of Object.entries(byDay)) {
    const f = path.join(OUT, day + '.json');
    const old = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { day, table: BASE, matches: [], house: [] };
    const key = (m) => m.ended + '|' + m.names.join('|'), have = new Set(old.matches.map(key));
    for (const m of ms) if (!have.has(key(m))) { old.matches.push(m); have.add(key(m)); added++; }
    old.matches.sort((a, b) => a.ended.localeCompare(b.ended));
    old.house = [...new Set([...(old.house || []), ...[...house].filter((n) => old.matches.some((m) => m.names.includes(n)))])].sort();
    old.saved = new Date().toISOString();
    fs.writeFileSync(f, JSON.stringify(old, null, 1) + '\n');
  }
  const days = fs.readdirSync(OUT).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().reverse()
    .map((n) => { const d = JSON.parse(fs.readFileSync(path.join(OUT, n), 'utf8')); return { day: d.day, file: n, matches: d.matches.length }; });
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ days }, null, 1) + '\n');
  console.log(`${found.length} matches read from ${BASE}, ${added} new; days kept: ${days.map((d) => d.day + ' (' + d.matches + ')').join(', ')}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
