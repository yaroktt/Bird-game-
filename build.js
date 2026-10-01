// Keeps the client and the solo build in sync with server.js.  Run:  node build.js
//
//  1. Copies the BALANCE table from server.js into index.html (so the menus work before the server answers).
//  2. Generates solo.html: index.html plus the server's match simulation running inside the page.
//
// Edit balance (bird stats, abilities, storm...) in server.js, then run `node build.js`.
'use strict';
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const server = read('server.js');
let client = read('index.html');

// ---- 1. balance table -> index.html
const balStart = server.indexOf('const BALANCE = {');
const balEnd = server.indexOf('\n};\nconst RARITY_KEYS', balStart);
if (balStart < 0 || balEnd < 0) throw new Error('could not find BALANCE in server.js');
const balanceText = server.slice(balStart + 'const BALANCE = '.length, balEnd + 2);
const BALANCE = new Function('process', 'return (' + balanceText + ')')({ env: {} });
const json = JSON.stringify(BALANCE);
client = client.replace(/\/\*BALANCE_START\*\/[\s\S]*?\/\*BALANCE_END\*\//, () => '/*BALANCE_START*/' + json + '/*BALANCE_END*/');
if (!client.includes('/*BALANCE_START*/{"rarities"')) throw new Error('BALANCE markers missing in index.html');
fs.writeFileSync(path.join(__dirname, 'index.html'), client);
console.log(`index.html: balance table updated (${Object.keys(BALANCE.birds).length} birds)`);

// ---- 2. solo.html
const core = server
  .slice(server.indexOf('const BALANCE = {'), server.indexOf('// --- HTTP:'))
  .replace('Number(process.env.LOBBY_COUNTDOWN || 20)', '5')
  .replace("crypto.randomBytes(12).toString('hex')", 'Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)');
const tick = server.slice(server.indexOf('// --- main loop'), server.indexOf('// --- start listening'));
for (const bad of ['process.', 'require(', 'crypto.']) if (core.includes(bad)) throw new Error('Node-only code in solo core: ' + bad);

const localServer = `
/* =============================================================================
   LOCAL SERVER  (solo mode: the match simulation from server.js runs in this page.
   Everything inside is generated from server.js by build.js - do not edit by hand.)
   ============================================================================= */
const LocalServer = (function () {
  const WebSocket = { OPEN: 1 };
  const TICK_RATE = 20;
  const DT = 1 / TICK_RATE;
${core}
${tick}
  return {
    open(onMessage) {
      const ws = { readyState: 1, send(s) { setTimeout(() => onMessage(s), 0); }, close() { ws.readyState = 3; leaveRoom(client); clients.delete(ws); } };
      const client = { id: uid(), ws, room: null, bird: null };
      clients.set(ws, client);
      ws.receive = (s) => { let msg; try { msg = JSON.parse(s); } catch { return; } if (msg && typeof msg.type === 'string') handleMessage(client, msg); };
      return ws;
    },
  };
})();
`;

let solo = client.slice(client.indexOf('<title>'));            // the artifact host supplies the document skeleton
const mustReplace = (a, b) => { if (!solo.includes(a)) throw new Error('solo: pattern not found: ' + a.slice(0, 60)); solo = solo.replace(a, b); };
mustReplace('</head>\n<body>\n', '');
mustReplace('</body>\n</html>\n', '');
mustReplace('<title>Bird Game Ultimate</title>', '<title>Bird Game Solo</title>');
mustReplace('<h1>🐦 BIRD GAME ULTIMATE</h1>', '<h1>🐦 BIRD GAME SOLO</h1>\n    <div id="soloNote">Offline practice: you against 9 bots, right in the browser. For online matches with friends use the server version.</div>');
mustReplace('Match starts in <b id="lobbyCount">20</b>s (empty slots become bots)', 'Match starts in <b id="lobbyCount">5</b>s (the other 9 birds are bots)');

const oldConnect = solo.slice(solo.indexOf('function connect() {'), solo.indexOf('function send(m)'));
mustReplace(oldConnect, `function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  ws = LocalServer.open((s) => { let m; try { m = JSON.parse(s); } catch { return; } handle(m); });
  if (G.pendingJoin) { send(G.pendingJoin); G.pendingJoin = null; }
}
`);
mustReplace('function send(m) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); }',
            'function send(m) { if (ws && ws.readyState === WebSocket.OPEN) ws.receive(JSON.stringify(m)); }');
mustReplace('document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();',
            'document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {});');
mustReplace("import * as THREE from 'three';\n", "import * as THREE from 'three';\n" + localServer);
if (solo.includes('new WebSocket(')) throw new Error('solo still opens a real WebSocket');
fs.writeFileSync(path.join(__dirname, 'solo.html'), solo);
console.log(`solo.html: written (${solo.length} bytes)`);
