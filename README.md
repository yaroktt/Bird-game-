# Bird Game Ultimate

A 3D mobile battle royale for 10 birds. Three.js client in a single `index.html`, authoritative Node.js + `ws` server in `server.js`.

## Run it

```bash
npm install
node server.js
```

The server prints its LAN address, e.g. `http://192.168.1.23:3000`. Open that on each phone (same Wi-Fi), turn the phone sideways, pick a bird, tap PLAY.
On a computer open `http://localhost:3000`.

The match starts when 10 players join or the 20-second lobby countdown ends; empty slots are filled by bots.
For faster testing: `LOBBY_COUNTDOWN=3 node server.js`.

## Controls

| Phone (landscape) | Desktop |
| --- | --- |
| Left stick: walk / fly | WASD: move |
| FLY UP / LAND button | Space: fly / land |
| ▲ ▼ (while flying): altitude | Q / E: down / up |
| Right stick: aim + auto-fire | Hold left mouse: shoot at cursor |
| SUPER button | F: super ability |
| Drag empty screen: rotate camera | Right-drag or arrow keys: rotate camera |

## Editing balance

All stats, cooldowns, storm phases and pickup values are in the `BALANCE` table at the top of `server.js`.
The terrain and movement code is shared: the block marked "SHARED WORLD CODE" must stay identical in `server.js` and `index.html`.
