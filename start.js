'use strict';
/* One command for a host (Render runs "node start.js"): the table, then the house's three simple players, which join it through
   the public API like anyone else.  The table restarts nothing by itself; if either part stops, the host restarts the whole. */
const { spawn } = require('child_process'), path = require('path');
const PORT = process.env.PORT || '8990';
const run = (args) => { const c = spawn(process.execPath, args, { stdio: 'inherit', env: process.env }); c.on('exit', (code) => { console.error(args[0], 'stopped', code); process.exit(1); }); return c; };
run([path.join(__dirname, 'server.js'), PORT]);
setTimeout(() => run([path.join(__dirname, 'house', 'run-house.js'), 'http://127.0.0.1:' + PORT]), 1500);
