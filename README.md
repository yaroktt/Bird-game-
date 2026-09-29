# Bird Game (Roblox)

Fly around as a bird. Collect seeds, grab golden seeds on floating islands, and fly through pink rings for bonus points. Your seed count shows on the leaderboard and saves between sessions.

## Controls

| Action | Keyboard | Gamepad | Mobile |
| --- | --- | --- | --- |
| Take off / flap | Jump, then **Space** in the air | A | Jump button in the air |
| Steer | WASD + camera | Left stick | Thumbstick |
| Dive (faster, drops quickly) | Hold **Shift** | L2 | — |
| Land | Touch the ground or any surface | | |

Each flap uses stamina (the bar at the bottom of the screen). Stamina refills quickly on the ground and slowly while gliding.

## Scoring

- Seed: 1
- Golden seed (on floating islands): 5
- Flying through a ring: 10 (each ring has a 5-second cooldown per player)

Seeds come back 20 seconds after someone collects them. You can change all these values in `src/shared/Config.luau`.

## Project layout

```
default.project.json                 Rojo project file
src/shared/Config.luau               Tuning values  -> ReplicatedStorage.Shared.Config
src/server/GameServer.server.luau    World, rewards, saving -> ServerScriptService
src/client/BirdController.client.luau Flight + HUD  -> StarterPlayerScripts
```

The server script builds the whole map when the game starts, so you don't need to place anything by hand.

## Running it

### Option A: Rojo (recommended)

1. Install [Rojo](https://rojo.space/) and its Roblox Studio plugin.
2. Run `rojo serve` in this folder.
3. In Studio, open a new Baseplate, delete the `Baseplate` part, click **Connect** in the Rojo plugin, and press **Play**.

To build a place file without Studio running: `rojo build -o BirdGame.rbxlx`.

### Option B: Copy and paste into Studio

1. In **ReplicatedStorage**, add a Folder named `Shared`. Inside it, add a **ModuleScript** named `Config` and paste in `src/shared/Config.luau`.
2. In **ServerScriptService**, add a **Script** and paste in `src/server/GameServer.server.luau`.
3. In **StarterPlayer > StarterPlayerScripts**, add a **LocalScript** and paste in `src/client/BirdController.client.luau`.
4. Delete the default `Baseplate` and press **Play**.

### Saving

Seed counts save with DataStores. They work once the place is published and **Game Settings > Security > Enable Studio Access to API Services** is on. If that setting is off, the game still runs but doesn't save.
