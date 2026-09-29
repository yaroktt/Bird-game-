# Bird Game Ultimate

A 3D mobile battle royale for 10 birds. Three.js client in a single `index.html`, authoritative Node.js + `ws` server in `server.js`.

## Two ways to play

- **Solo (no server):** open `solo.html` in any browser, or via the published artifact link. You play against 9 bots; the match simulation runs inside the page. Nothing to install. Good for practice and for iPads/phones with no computer around.
- **Online multiplayer (the app version):** `server.js` + `index.html`, below. Real players from any device join the same lobby.

`solo.html` is generated from the other two files and carries the same game code; it does not affect the app version.

## Run the app version

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
