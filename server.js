/* =============================================================================
   BIRD GAME ULTIMATE - authoritative game server
   -----------------------------------------------------------------------------
   Sections:
     1. Config & balance table      (edit numbers here)
     2. Shared world code           (terrain + movement; KEEP IN SYNC with index.html)
     3. Room: lobby -> match -> end
     4. Simulation: movement, storm, pickups
     5. Combat: projectiles, damage, abilities
     6. Bots
     7. Networking (HTTP + WebSocket)
   ============================================================================= */
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const TICK_RATE = 20;                 // simulation + snapshot rate (Hz)
const DT = 1 / TICK_RATE;

/* =============================================================================
   1. CONFIG & BALANCE TABLE
   ============================================================================= */
const BALANCE = {
  // Per-rarity stats. hp = max health, speed = ground speed, flySpeed = air speed,
  // damage = per feather shot, fireRate = shots per second, superCooldown = seconds.
  rarities: {
    common:    { name: 'Common',     color: 0x9aa0a6, hp: 100, speed: 11.0, flySpeed: 18, damage: 12, fireRate: 5.0, superCooldown: 12,
                 ability: 'featherBurst',   abilityName: 'Feather Burst',   abilityDesc: 'Fires a wide spread of 7 feathers.' },
    rare:      { name: 'Rare',       color: 0x3b82f6, hp: 120, speed: 12.0, flySpeed: 20, damage: 14, fireRate: 5.5, superCooldown: 11,
                 ability: 'windDash',       abilityName: 'Wind Dash',       abilityDesc: 'Blast forward at high speed, hurting anyone you pass.' },
    superRare: { name: 'Super Rare', color: 0x22c55e, hp: 140, speed: 12.5, flySpeed: 21, damage: 16, fireRate: 6.0, superCooldown: 14,
                 ability: 'healingNest',    abilityName: 'Healing Nest',    abilityDesc: 'Drops a nest that heals every bird inside it for 5s.' },
    epic:      { name: 'Epic',       color: 0xa855f7, hp: 165, speed: 13.0, flySpeed: 22, damage: 18, fireRate: 6.0, superCooldown: 13,
                 ability: 'stormTalons',    abilityName: 'Storm Talons',    abilityDesc: 'Calls lightning down on the nearest enemy, damaging and slowing it.' },
    mythic:    { name: 'Mythic',     color: 0xef4444, hp: 190, speed: 13.5, flySpeed: 23, damage: 21, fireRate: 6.5, superCooldown: 15,
                 ability: 'shadowShield',   abilityName: 'Shadow Shield',   abilityDesc: 'Become invulnerable for 4s and reflect all damage back.' },
    legendary: { name: 'Legendary',  color: 0xf59e0b, hp: 220, speed: 14.0, flySpeed: 24, damage: 24, fireRate: 7.0, superCooldown: 18,
                 ability: 'phoenixRebirth', abilityName: 'Phoenix Rebirth', abilityDesc: 'Huge fire explosion. If you are knocked out afterwards you revive once at half health.' },
  },
  projectile: {
    speed: 70, ttl: 1.1,
    hitRadiusGround: 1.8,   // easier to hit birds on the ground
    hitRadiusFlying: 1.15,  // flying birds are harder to hit
    diveBonus: 1.5,         // damage multiplier for a flying bird shooting down at a ground bird
    diveHeight: 6,          // shooter must be this much higher than the target
  },
  abilities: {
    featherBurst:   { count: 7, spreadDeg: 70, dmgMul: 0.9 },
    windDash:       { speed: 110, duration: 0.35, contactDamage: 22 },
    healingNest:    { radius: 9, duration: 5, healPerSec: 16 },
    stormTalons:    { range: 45, damage: 65, slowDuration: 1.2 },
    shadowShield:   { duration: 4, reflect: 1.0 },
    phoenixRebirth: { radius: 15, damage: 85, reviveHp: 0.5, reviveDelay: 1.5 },
  },
  pickups: {
    count: 44, chests: 8,
    health: 40, bigHealth: 100,
    speedMul: 1.6, speedDuration: 8,
    shieldDuration: 5, bigShieldDuration: 9,
    pickRadius: 2.4, chestRadius: 3.2,
  },
  storm: {
    // Each phase: wait `delay` seconds, then shrink to `radius` over `shrink` seconds.
    phases: [
      { delay: 30, shrink: 20, radius: 200 },
      { delay: 20, shrink: 20, radius: 135 },
      { delay: 20, shrink: 15, radius: 85 },
      { delay: 15, shrink: 15, radius: 45 },
      { delay: 15, shrink: 15, radius: 15 },
      { delay: 10, shrink: 20, radius: 0 },
    ],
    damageBase: 4, damagePerPhase: 3,   // damage per second outside the safe zone
  },
  match: {
    maxPlayers: 10, lobbyCountdown: Number(process.env.LOBBY_COUNTDOWN || 20),
    spawnHeight: 140, fallSpeed: 26, climbSpeed: 12, maxAltitude: 110,
    initialSuperCooldown: 6, endScreenSeconds: 30,
  },
};
const RARITY_KEYS = Object.keys(BALANCE.rarities);
const BOT_NAMES = ['Pecky', 'Skyler', 'Talon', 'Nimbus', 'Robin', 'Zephyr', 'Kiwi', 'Falcon', 'Pip', 'Wren', 'Storm', 'Ash', 'Cinder', 'Gale', 'Echo', 'Blue'];

/* =============================================================================
   2. SHARED WORLD CODE  (identical copy lives in index.html - keep in sync)
   ============================================================================= */
const MAP = {
  radius: 300, islandRadius: 250, waterLevel: 0,
  lakes: [{ x: -90, z: 70, r: 45 }, { x: 120, z: 120, r: 35 }],
  landmarks: { tower: { x: 140, z: -90 }, ruins: { x: -150, z: -60 }, bigTree: { x: 20, z: -20 } },
};
function hash2(x, z) {
  let n = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}
function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, oct) {
  let sum = 0, amp = 1, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { sum += vnoise(x * f, z * f) * amp; norm += amp; amp *= 0.5; f *= 2; }
  return sum / norm;
}
function terrainHeight(x, z) {
  const d = Math.hypot(x, z);
  const edge = 1 - smoothstep(MAP.islandRadius * 0.72, MAP.islandRadius, d);
  let h = fbm(x * 0.006 + 100, z * 0.006 + 100, 4) * 60 - 10;               // rolling hills
  h += smoothstep(0.55, 0.68, vnoise(x * 0.012 + 40, z * 0.012 + 40)) * 18; // cliffs / plateaus
  for (const l of MAP.lakes) h -= 24 * (1 - smoothstep(0, l.r, Math.hypot(x - l.x, z - l.z)));
  return h * edge - (1 - edge) * 25;
}
function groundY(x, z) { return Math.max(terrainHeight(x, z), MAP.waterLevel); }

// Moves one bird for `dt` seconds. inp = {mx,mz,vy,ax,az,fire}, P = per-bird movement params.
function moveBird(b, inp, dt, P) {
  let mx = inp.mx || 0, mz = inp.mz || 0;
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  if (b.dashT > 0) {                       // Wind Dash overrides movement
    b.x += b.dashX * P.dashSpeed * dt; b.z += b.dashZ * P.dashSpeed * dt;
    b.dashT -= dt;
  }
  if (b.mode === 1) {                      // FLYING: smooth glide toward target velocity
    const k = 1 - Math.exp(-4 * dt);
    b.vx += (mx * P.flySpeed - b.vx) * k;
    b.vz += (mz * P.flySpeed - b.vz) * k;
    b.vy += ((inp.vy || 0) * P.climbSpeed - b.vy) * k;
    b.x += b.vx * dt; b.z += b.vz * dt; b.y += b.vy * dt;
    const g = groundY(b.x, b.z) + 1.5;
    if (b.y < g) { b.y = g; if (b.vy < 0) b.vy = 0; }
    if (b.y > P.maxAlt) { b.y = P.maxAlt; if (b.vy > 0) b.vy = 0; }
  } else {                                 // GROUND: walk, and fall if above the terrain
    b.vx = mx * P.speed; b.vz = mz * P.speed;
    b.x += b.vx * dt; b.z += b.vz * dt;
    const g = groundY(b.x, b.z);
    if (b.y > g + 0.05) { b.y = Math.max(g, b.y - P.fallSpeed * dt); b.vy = -P.fallSpeed; }
    else { b.y = g; b.vy = 0; }
  }
  const d = Math.hypot(b.x, b.z);          // keep everyone on the map
  if (d > MAP.radius) { b.x *= MAP.radius / d; b.z *= MAP.radius / d; }
  if (inp.fire && (inp.ax || inp.az)) b.yaw = Math.atan2(inp.ax, inp.az);
  else if (len > 0.1) b.yaw = Math.atan2(mx, mz);
}

/* =============================================================================
   Helpers
   ============================================================================= */
let nextId = 1;
const uid = () => nextId++;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const r2 = (v) => Math.round(v * 100) / 100;
const send = (ws, msg) => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };

// Distance from point c to segment p0-p1 (used for swept projectile hits).
function segDist(p0, p1, c) {
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
  const l2 = dx * dx + dy * dy + dz * dz;
  let t = l2 > 0 ? ((c.x - p0.x) * dx + (c.y - p0.y) * dy + (c.z - p0.z) * dz) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(p0.x + dx * t - c.x, p0.y + dy * t - c.y, p0.z + dz * t - c.z);
}

/* =============================================================================
   3. ROOM
   ============================================================================= */
class Room {
  constructor() {
    this.id = uid();
    this.state = 'lobby';           // lobby | playing | ended
    this.players = new Map();       // playerId -> { id, name, rarity, token, ws }
    this.countdown = BALANCE.match.lobbyCountdown;
    this.birds = new Map();         // birdId -> bird
    this.projectiles = [];
    this.pickups = new Map();
    this.chests = new Map();
    this.nests = [];
    this.events = [];
    this.time = 0;
    this.storm = null;
    this.endTimer = 0;
    this.noHumanTimer = 0;
  }

  /* ---------- lobby ---------- */
  addPlayer(client, name, rarity, token) {
    const p = { id: client.id, name, rarity, token, ws: client.ws };
    this.players.set(p.id, p);
    client.room = this;
    this.broadcastLobby();
    if (this.players.size >= BALANCE.match.maxPlayers) this.start();
  }
  removePlayer(client) {
    this.players.delete(client.id);
    if (this.state === 'lobby') {
      if (this.players.size === 0) this.countdown = BALANCE.match.lobbyCountdown;
      this.broadcastLobby();
    }
  }
  broadcastLobby() {
    const list = [...this.players.values()].map(p => ({ id: p.id, name: p.name, rarity: p.rarity }));
    this.broadcast({ type: 'lobby', players: list, countdown: Math.ceil(this.countdown), max: BALANCE.match.maxPlayers });
  }
  broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) if (p.ws && p.ws.readyState === WebSocket.OPEN) p.ws.send(s);
  }
  humanCount() { let n = 0; for (const p of this.players.values()) if (p.ws && p.ws.readyState === WebSocket.OPEN) n++; return n; }

  /* ---------- match start ---------- */
  makeBird(opts) {
    const st = BALANCE.rarities[opts.rarity];
    return {
      id: uid(), name: opts.name, rarity: opts.rarity, isBot: !!opts.isBot, playerId: opts.playerId || null, token: opts.token || null,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, mode: 0,
      hp: st.hp, maxHp: st.hp, alive: true, kills: 0, placement: 0,
      input: { mx: 0, mz: 0, vy: 0, ax: 0, az: 1, fire: false, flySeq: 0, superSeq: 0 },
      lastFlySeq: 0, lastSuperSeq: 0,
      fireCd: 0, superCd: BALANCE.match.initialSuperCooldown,
      shieldT: 0, invulnT: 0, speedT: 0, stunT: 0, dashT: 0, dashX: 0, dashZ: 0, dashHit: null,
      rebirth: false, reviveT: 0,
      ai: null,
    };
  }
  start() {
    if (this.state !== 'lobby') return;
    this.state = 'playing';
    this.time = 0;
    const n = BALANCE.match.maxPlayers;
    const spawnPoints = [];
    const a0 = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2 + rand(-0.15, 0.15), r = rand(150, 205);
      spawnPoints.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
    }
    let i = 0;
    for (const p of this.players.values()) {
      const b = this.makeBird({ name: p.name, rarity: p.rarity, playerId: p.id, token: p.token });
      this.placeBird(b, spawnPoints[i++]);
      this.birds.set(b.id, b);
      p.birdId = b.id;
    }
    const usedNames = new Set([...this.players.values()].map(p => p.name));
    while (this.birds.size < n) {
      let name; do { name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]; } while (usedNames.has(name));
      usedNames.add(name);
      // Bots lean toward lower rarities so a lobby isn't ten legendaries.
      const r = Math.random();
      const rarity = RARITY_KEYS[r < 0.3 ? 0 : r < 0.55 ? 1 : r < 0.75 ? 2 : r < 0.88 ? 3 : r < 0.96 ? 4 : 5];
      const b = this.makeBird({ name, rarity, isBot: true });
      this.initBotAI(b);
      this.placeBird(b, spawnPoints[i++]);
      this.birds.set(b.id, b);
    }
    this.spawnPickups();
    this.storm = {
      cx: 0, cz: 0, r: MAP.islandRadius + 40, phase: -1, state: 'wait', timer: BALANCE.storm.phases[0].delay,
      nextCx: 0, nextCz: 0, nextR: BALANCE.storm.phases[0].radius, startR: 0, startCx: 0, startCz: 0,
    };
    this.storm.phase = 0;
    this.pickNextCenter();
    this.broadcast(this.startMessage());
  }
  placeBird(b, sp) { b.x = sp.x; b.z = sp.z; b.y = BALANCE.match.spawnHeight; b.yaw = Math.atan2(-sp.x, -sp.z); }
  startMessage() {
    return {
      type: 'start',
      birds: [...this.birds.values()].map(b => ({ id: b.id, name: b.name, rarity: b.rarity, isBot: b.isBot, playerId: b.playerId, maxHp: b.maxHp })),
      pickups: [...this.pickups.values()],
      chests: [...this.chests.values()],
      storm: this.stormSnapshot(),
    };
  }

  /* ---------- pickups ---------- */
  randomLandPoint(margin) {
    for (let tries = 0; tries < 50; tries++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (MAP.islandRadius - (margin || 20));
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (terrainHeight(x, z) > MAP.waterLevel + 1) return { x, z };
    }
    return { x: 0, z: 0 };
  }
  addPickup(type, x, z, big) {
    const p = { id: uid(), type, x: r2(x), z: r2(z), y: r2(groundY(x, z) + 1), big: !!big };
    this.pickups.set(p.id, p);
    return p;
  }
  spawnPickups() {
    const types = ['health', 'health', 'speed', 'shield', 'super'];
    for (let i = 0; i < BALANCE.pickups.count; i++) {
      const pt = this.randomLandPoint();
      this.addPickup(types[i % types.length], pt.x, pt.z, false);
    }
    for (let i = 0; i < BALANCE.pickups.chests; i++) {
      const pt = this.randomLandPoint(40);
      const c = { id: uid(), x: r2(pt.x), z: r2(pt.z), y: r2(groundY(pt.x, pt.z)), opened: false };
      this.chests.set(c.id, c);
    }
  }
  applyPickup(b, p) {
    const P = BALANCE.pickups;
    switch (p.type) {
      case 'health': b.hp = Math.min(b.maxHp, b.hp + (p.big ? P.bigHealth : P.health)); break;
      case 'speed': b.speedT = P.speedDuration * (p.big ? 1.5 : 1); break;
      case 'shield': b.shieldT = p.big ? P.bigShieldDuration : P.shieldDuration; break;
      case 'super': b.superCd = 0; break;
    }
    this.pickups.delete(p.id);
    this.events.push({ type: 'pickup', id: p.id, by: b.id, kind: p.type });
  }
  openChest(b, c) {
    c.opened = true;
    this.events.push({ type: 'chest', id: c.id, by: b.id });
    const drops = ['health', 'shield', ['speed', 'super'][Math.floor(Math.random() * 2)]];
    drops.forEach((t, i) => {
      const a = (i / 3) * Math.PI * 2;
      const p = this.addPickup(t, c.x + Math.cos(a) * 3, c.z + Math.sin(a) * 3, true);
      this.events.push({ type: 'spawnPickup', pickup: p });
    });
  }

  /* =============================================================================
     4. SIMULATION
     ============================================================================= */
  update(dt) {
    if (this.state === 'lobby') {
      if (this.players.size > 0) {
        this.countdown -= dt;
        if (Math.ceil(this.countdown + dt) !== Math.ceil(this.countdown)) this.broadcastLobby();
        if (this.countdown <= 0) this.start();
      }
      return;
    }
    if (this.state === 'ended') { this.endTimer -= dt; return; }

    this.time += dt;
    this.updateStorm(dt);
    for (const b of this.birds.values()) this.updateBird(b, dt);
    this.updateNests(dt);
    this.updateProjectiles(dt);
    this.checkEnd();

    // Bots-only rooms (everyone left) get shut down.
    this.noHumanTimer = this.humanCount() === 0 ? this.noHumanTimer + dt : 0;
    if (this.noHumanTimer > 15) this.state = 'ended', this.endTimer = 0;

    this.broadcast(this.snapshot());
    this.events.length = 0;
  }

  updateBird(b, dt) {
    if (!b.alive) {
      if (b.reviveT > 0) { b.reviveT -= dt; if (b.reviveT <= 0) this.revive(b); }
      return;
    }
    if (b.isBot) this.botThink(b, dt);
    const st = BALANCE.rarities[b.rarity];
    const inp = b.input;

    // timers
    b.shieldT = Math.max(0, b.shieldT - dt); b.invulnT = Math.max(0, b.invulnT - dt);
    b.speedT = Math.max(0, b.speedT - dt); b.stunT = Math.max(0, b.stunT - dt);
    b.fireCd -= dt; b.superCd = Math.max(0, b.superCd - dt);

    // fly / land toggle (edge-triggered by a sequence number so no press is lost)
    if (inp.flySeq !== b.lastFlySeq) {
      b.lastFlySeq = inp.flySeq;
      if (b.stunT <= 0) {
        b.mode = b.mode ? 0 : 1;
        if (b.mode === 1) { b.y = Math.max(b.y, groundY(b.x, b.z) + 1.5); b.vy = 6; }
      }
      this.events.push({ type: 'mode', b: b.id, mode: b.mode });
    }

    // movement
    const slow = b.stunT > 0 ? 0.4 : 1, boost = b.speedT > 0 ? BALANCE.pickups.speedMul : 1;
    moveBird(b, inp, dt, {
      speed: st.speed * boost * slow, flySpeed: st.flySpeed * boost * slow,
      climbSpeed: BALANCE.match.climbSpeed, fallSpeed: BALANCE.match.fallSpeed, maxAlt: BALANCE.match.maxAltitude,
      dashSpeed: BALANCE.abilities.windDash.speed,
    });
    if (b.dashT > 0) this.dashContact(b);

    // firing
    if (inp.fire && b.fireCd <= 0 && b.stunT <= 0) { this.fire(b, null, 1); b.fireCd = 1 / st.fireRate; }

    // super ability
    if (inp.superSeq !== b.lastSuperSeq) {
      b.lastSuperSeq = inp.superSeq;
      if (b.superCd <= 0 && b.stunT <= 0 && this.useAbility(b)) b.superCd = st.superCooldown;
    }

    // storm damage
    const S = this.storm;
    if (Math.hypot(b.x - S.cx, b.z - S.cz) > S.r) {
      this.applyDamage(b, (BALANCE.storm.damageBase + BALANCE.storm.damagePerPhase * S.phase) * dt, null, 'storm', true);
      if (!b.alive) return;
    }

    // pickups & chests
    for (const p of this.pickups.values()) {
      if (Math.abs(p.x - b.x) < 3 && Math.abs(p.z - b.z) < 3 && dist3(p, b) < BALANCE.pickups.pickRadius) { this.applyPickup(b, p); break; }
    }
    for (const c of this.chests.values()) {
      if (!c.opened && b.mode === 0 && dist2(c, b) < BALANCE.pickups.chestRadius) { this.openChest(b, c); break; }
    }
  }

  updateStorm(dt) {
    const S = this.storm, phases = BALANCE.storm.phases;
    S.timer -= dt;
    if (S.state === 'wait') {
      if (S.timer <= 0) {
        S.state = 'shrink'; S.timer = phases[S.phase].shrink;
        S.startR = S.r; S.startCx = S.cx; S.startCz = S.cz;
      }
    } else {
      const ph = phases[S.phase], t = 1 - clamp(S.timer / ph.shrink, 0, 1);
      S.r = S.startR + (S.nextR - S.startR) * t;
      S.cx = S.startCx + (S.nextCx - S.startCx) * t;
      S.cz = S.startCz + (S.nextCz - S.startCz) * t;
      if (S.timer <= 0) {
        S.r = S.nextR; S.cx = S.nextCx; S.cz = S.nextCz;
        if (S.phase < phases.length - 1) {
          S.phase++; S.state = 'wait'; S.timer = phases[S.phase].delay;
          this.pickNextCenter();
        } else { S.state = 'done'; S.timer = 0; }
      }
    }
  }
  pickNextCenter() {
    const S = this.storm, ph = BALANCE.storm.phases[S.phase];
    S.nextR = ph.radius;
    const a = Math.random() * Math.PI * 2, d = Math.random() * Math.max(0, S.r - ph.radius) * 0.8;
    S.nextCx = S.cx + Math.cos(a) * d; S.nextCz = S.cz + Math.sin(a) * d;
    const lim = MAP.islandRadius - 30 - ph.radius;      // keep the zone on the island
    const dc = Math.hypot(S.nextCx, S.nextCz);
    if (lim > 0 && dc > lim) { S.nextCx *= lim / dc; S.nextCz *= lim / dc; }
  }
  stormSnapshot() {
    const S = this.storm;
    return { cx: r2(S.cx), cz: r2(S.cz), r: r2(S.r), phase: S.phase, state: S.state, timer: r2(S.timer), nextCx: r2(S.nextCx), nextCz: r2(S.nextCz), nextR: S.nextR };
  }

  updateNests(dt) {
    for (let i = this.nests.length - 1; i >= 0; i--) {
      const n = this.nests[i]; n.t -= dt;
      for (const b of this.birds.values()) {
        if (b.alive && dist3(n, b) < BALANCE.abilities.healingNest.radius) b.hp = Math.min(b.maxHp, b.hp + BALANCE.abilities.healingNest.healPerSec * dt);
      }
      if (n.t <= 0) this.nests.splice(i, 1);
    }
  }

  /* =============================================================================
     5. COMBAT
     ============================================================================= */
  aimDir(b) {
    let ax = b.input.ax, az = b.input.az;
    const l = Math.hypot(ax, az);
    if (l < 0.01) { ax = Math.sin(b.yaw); az = Math.cos(b.yaw); } else { ax /= l; az /= l; }
    return { x: ax, z: az };
  }
  // Fires one feather. dirOverride = horizontal direction (for spread shots).
  fire(b, dirOverride, dmgMul) {
    const st = BALANCE.rarities[b.rarity], PR = BALANCE.projectile;
    const aim = dirOverride || this.aimDir(b);
    const origin = { x: b.x + aim.x * 1.2, y: b.y + 0.7, z: b.z + aim.z * 1.2 };
    // Auto vertical aim: pick the nearest enemy roughly in the joystick direction and pitch toward it.
    let dir = { x: aim.x, y: 0, z: aim.z }, best = null, bestD = 75;
    for (const o of this.birds.values()) {
      if (o === b || !o.alive) continue;
      const dx = o.x - b.x, dz = o.z - b.z, d = Math.hypot(dx, dz);
      if (d > bestD || d < 0.5) continue;
      if ((dx * aim.x + dz * aim.z) / d < Math.cos(0.45)) continue;  // ~26 degree cone
      best = o; bestD = d;
    }
    if (best) {
      const dx = best.x - origin.x, dy = best.y + 0.5 - origin.y, dz = best.z - origin.z, l = Math.hypot(dx, dy, dz);
      // keep the player's horizontal aim, borrow the pitch from the target
      const pitch = dy / l, hl = Math.sqrt(Math.max(0.05, 1 - pitch * pitch));
      dir = { x: aim.x * hl, y: pitch, z: aim.z * hl };
    }
    const p = { id: uid(), owner: b.id, x: origin.x, y: origin.y, z: origin.z, vx: dir.x * PR.speed, vy: dir.y * PR.speed, vz: dir.z * PR.speed, ttl: PR.ttl, dmg: st.damage * (dmgMul || 1) };
    this.projectiles.push(p);
    this.events.push({ type: 'shot', id: p.id, o: b.id, x: r2(p.x), y: r2(p.y), z: r2(p.z), vx: r2(p.vx), vy: r2(p.vy), vz: r2(p.vz) });
  }
  updateProjectiles(dt) {
    const PR = BALANCE.projectile;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const prev = { x: p.x, y: p.y, z: p.z };
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.ttl -= dt;
      let dead = p.ttl <= 0 || p.y < groundY(p.x, p.z);
      if (!dead) {
        const owner = this.birds.get(p.owner);
        for (const b of this.birds.values()) {
          if (!b.alive || b.id === p.owner) continue;
          const radius = b.mode === 1 ? PR.hitRadiusFlying : PR.hitRadiusGround;
          if (segDist(prev, p, { x: b.x, y: b.y + 0.6, z: b.z }) < radius) {
            let dmg = p.dmg, dive = false;
            if (owner && owner.mode === 1 && b.mode === 0 && owner.y - b.y > PR.diveHeight && p.vy < -8) { dmg *= PR.diveBonus; dive = true; }
            this.applyDamage(b, dmg, owner, 'shot', false, { pid: p.id, dive });
            dead = true; break;
          }
        }
      }
      if (dead) { this.projectiles.splice(i, 1); this.events.push({ type: 'pdead', id: p.id }); }
    }
  }
  // silent = no per-hit event (storm ticks). info = { pid, dive, reflect }
  applyDamage(target, dmg, attacker, cause, silent, info) {
    if (!target.alive || dmg <= 0) return;
    info = info || {};
    if (target.invulnT > 0) {
      if (attacker && attacker.alive && attacker !== target && !info.reflect) {
        this.applyDamage(attacker, dmg * BALANCE.abilities.shadowShield.reflect, target, 'reflect', false, { reflect: true });
      }
      if (!silent) this.events.push({ type: 'hit', t: target.id, d: 0, blocked: true, pid: info.pid });
      return;
    }
    if (target.shieldT > 0) { if (!silent) this.events.push({ type: 'hit', t: target.id, d: 0, blocked: true, pid: info.pid }); return; }
    target.hp -= dmg;
    if (!silent) this.events.push({ type: 'hit', t: target.id, d: Math.round(dmg), dive: !!info.dive, pid: info.pid, by: attacker ? attacker.id : null });
    if (target.hp <= 0) this.kill(target, attacker, cause);
  }
  kill(victim, killer, cause) {
    victim.hp = 0; victim.alive = false; victim.mode = 0; victim.dashT = 0;
    const rebirth = victim.rebirth;
    if (rebirth) { victim.rebirth = false; victim.reviveT = BALANCE.abilities.phoenixRebirth.reviveDelay; }
    if (killer && killer !== victim) killer.kills++;
    this.events.push({ type: 'kill', v: victim.id, k: killer ? killer.id : null, cause, rebirth });
    if (!rebirth) {
      victim.placement = this.aliveBirds().length + 1;
      const client = this.clientForBird(victim);
      if (client) send(client.ws, { type: 'eliminated', placement: victim.placement, killer: killer ? killer.name : null, cause, kills: victim.kills });
    }
  }
  revive(b) {
    b.alive = true; b.hp = b.maxHp * BALANCE.abilities.phoenixRebirth.reviveHp; b.invulnT = 1.5;
    b.y = groundY(b.x, b.z) + 6;
    this.events.push({ type: 'revive', b: b.id });
  }
  aliveBirds() { return [...this.birds.values()].filter(b => b.alive || b.reviveT > 0); }
  clientForBird(b) {
    if (!b.playerId) return null;
    const p = this.players.get(b.playerId);
    return p && p.ws ? { ws: p.ws } : null;
  }

  /* ---------- abilities ---------- */
  useAbility(b) {
    const st = BALANCE.rarities[b.rarity], A = BALANCE.abilities, aim = this.aimDir(b);
    const ev = { type: 'ability', b: b.id, kind: st.ability, x: r2(b.x), y: r2(b.y), z: r2(b.z) };
    switch (st.ability) {
      case 'featherBurst': {
        const base = Math.atan2(aim.x, aim.z), spread = A.featherBurst.spreadDeg * Math.PI / 180;
        for (let i = 0; i < A.featherBurst.count; i++) {
          const a = base - spread / 2 + spread * (i / (A.featherBurst.count - 1));
          this.fire(b, { x: Math.sin(a), z: Math.cos(a) }, A.featherBurst.dmgMul);
        }
        break;
      }
      case 'windDash':
        b.dashT = A.windDash.duration; b.dashX = aim.x; b.dashZ = aim.z; b.dashHit = new Set();
        ev.dx = r2(aim.x); ev.dz = r2(aim.z);
        break;
      case 'healingNest':
        this.nests.push({ x: b.x, y: b.y, z: b.z, t: A.healingNest.duration, owner: b.id });
        break;
      case 'stormTalons': {
        let best = null, bd = A.stormTalons.range;
        for (const o of this.birds.values()) { if (o !== b && o.alive) { const d = dist3(o, b); if (d < bd) { bd = d; best = o; } } }
        if (!best) return false;                 // nothing in range: keep the super ready
        ev.target = best.id; ev.tx = r2(best.x); ev.ty = r2(best.y); ev.tz = r2(best.z);
        this.events.push(ev);
        this.applyDamage(best, A.stormTalons.damage, b, 'lightning');
        if (best.alive) best.stunT = A.stormTalons.slowDuration;
        return true;
      }
      case 'shadowShield':
        b.invulnT = A.shadowShield.duration;
        break;
      case 'phoenixRebirth': {
        this.events.push(ev);
        for (const o of this.birds.values()) {
          if (o === b || !o.alive) continue;
          const d = dist3(o, b);
          if (d < A.phoenixRebirth.radius) this.applyDamage(o, A.phoenixRebirth.damage * (1 - 0.5 * d / A.phoenixRebirth.radius), b, 'phoenix');
        }
        b.rebirth = true;
        return true;
      }
    }
    this.events.push(ev);
    return true;
  }
  dashContact(b) {
    for (const o of this.birds.values()) {
      if (o === b || !o.alive || b.dashHit.has(o.id)) continue;
      if (dist3(o, b) < 2.6) { b.dashHit.add(o.id); this.applyDamage(o, BALANCE.abilities.windDash.contactDamage, b, 'dash'); }
    }
  }

  /* =============================================================================
     6. BOTS
     ============================================================================= */
  initBotAI(b) {
    b.isBot = true;
    b.ai = { thinkT: Math.random() * 0.3, target: null, goal: null, wanderT: 0, flyT: rand(3, 10), strafe: Math.random() < 0.5 ? 1 : -1, strafeT: 0, aimErr: 0 };
  }
  botThink(b, dt) {
    const ai = b.ai, inp = b.input, S = this.storm, st = BALANCE.rarities[b.rarity];
    ai.thinkT -= dt; ai.flyT -= dt; ai.strafeT -= dt;
    if (ai.thinkT > 0) return;
    ai.thinkT = 0.2;
    if (ai.strafeT <= 0) { ai.strafe = -ai.strafe; ai.strafeT = rand(1.5, 4); }

    // nearest enemy
    let target = null, td = 70;
    for (const o of this.birds.values()) { if (o !== b && o.alive) { const d = dist3(o, b); if (d < td) { td = d; target = o; } } }
    ai.target = target;

    // where to go
    let goal = null;
    const lowHp = b.hp < b.maxHp * 0.45;
    if (lowHp) {
      let best = null, bd = 45;
      for (const p of this.pickups.values()) if (p.type === 'health') { const d = dist2(p, b); if (d < bd) { bd = d; best = p; } }
      if (best) goal = { x: best.x, z: best.z };
    }
    const zoneR = S.state === 'shrink' ? S.nextR : S.r, zx = S.state === 'shrink' ? S.nextCx : S.cx, zz = S.state === 'shrink' ? S.nextCz : S.cz;
    const dz = Math.hypot(b.x - zx, b.z - zz);
    if (!goal && dz > zoneR - 12) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * Math.max(0, zoneR - 15) * 0.6;
      goal = { x: zx + Math.cos(a) * r, z: zz + Math.sin(a) * r };
    }
    if (!goal && target) {
      const dx = b.x - target.x, dzz = b.z - target.z, d = Math.hypot(dx, dzz) || 1;
      const want = 18, push = td > want + 4 ? -1 : td < want - 4 ? 1 : 0;      // approach / back off
      goal = { x: b.x + (dx / d) * push * 10 + (-dzz / d) * ai.strafe * 8, z: b.z + (dzz / d) * push * 10 + (dx / d) * ai.strafe * 8 };
    }
    if (!goal) {
      ai.wanderT -= 0.2;
      if (!ai.goal || ai.wanderT <= 0 || dist2(ai.goal, b) < 6) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * Math.max(10, zoneR - 15);
        ai.goal = { x: zx + Math.cos(a) * r, z: zz + Math.sin(a) * r }; ai.wanderT = 8;
      }
      goal = ai.goal;
    }
    const gx = goal.x - b.x, gz = goal.z - b.z, gl = Math.hypot(gx, gz) || 1;
    inp.mx = gx / gl; inp.mz = gz / gl;
    if (gl < 1.5) { inp.mx = 0; inp.mz = 0; }

    // shooting (with a bit of aim error so bots aren't perfect)
    if (target && td < 60) {
      const ang = Math.atan2(target.x - b.x, target.z - b.z) + rand(-0.12, 0.12);
      inp.ax = Math.sin(ang); inp.az = Math.cos(ang); inp.fire = true;
    } else inp.fire = false;

    // flying decisions
    if (b.mode === 0) {
      const wantFly = (lowHp && target && Math.random() < 0.5) || (target && target.mode === 1 && Math.random() < 0.25) || (ai.flyT <= 0 && Math.random() < 0.3);
      if (wantFly) { inp.flySeq++; ai.flyT = rand(6, 14); }
    } else {
      const g = groundY(b.x, b.z);
      let desired = g + (target ? rand(10, 18) : 14);
      if (target && target.mode === 0 && td < 30 && b.y - target.y > 8 && Math.random() < 0.5) desired = target.y + 4; // dive-bomb
      inp.vy = clamp((desired - b.y) * 0.25, -1, 1);
      if (ai.flyT <= 0 && Math.random() < 0.35 && !target) { inp.flySeq++; ai.flyT = rand(6, 14); }
    }

    // super ability
    if (b.superCd <= 0) {
      const wants = (st.ability === 'healingNest' && b.hp < b.maxHp * 0.55) ||
                    (st.ability === 'shadowShield' && target && td < 25 && b.hp < b.maxHp * 0.7) ||
                    (target && td < 22 && st.ability !== 'healingNest');
      if (wants) inp.superSeq++;
    }
  }

  /* ---------- end of match ---------- */
  checkEnd() {
    const alive = this.aliveBirds();
    if (alive.length > 1) return;
    this.state = 'ended'; this.endTimer = BALANCE.match.endScreenSeconds;
    const w = alive[0] || null;
    const rows = [...this.birds.values()].sort((a, b2) => (a.alive ? 0 : a.placement) - (b2.alive ? 0 : b2.placement));
    this.broadcast({ type: 'end', winner: w ? { id: w.id, name: w.name, rarity: w.rarity, kills: w.kills } : null,
      board: rows.map(b => ({ id: b.id, name: b.name, rarity: b.rarity, kills: b.kills, placement: b.alive ? 1 : b.placement })) });
  }

  /* ---------- snapshot ---------- */
  snapshot() {
    const birds = [];
    for (const b of this.birds.values()) {
      const flags = (b.shieldT > 0 ? 1 : 0) | (b.invulnT > 0 ? 2 : 0) | (b.speedT > 0 ? 4 : 0) | (b.dashT > 0 ? 8 : 0) | (b.stunT > 0 ? 16 : 0) | (b.input.fire ? 32 : 0) | (b.rebirth ? 64 : 0);
      birds.push([b.id, r2(b.x), r2(b.y), r2(b.z), r2(b.yaw), Math.round(b.hp), b.mode, flags, b.alive ? 1 : 0, r2(b.superCd), b.kills]);
    }
    return { type: 'state', t: r2(this.time), birds, storm: this.stormSnapshot(), ev: this.events, alive: this.aliveBirds().length };
  }
}

/* =============================================================================
   7. NETWORKING
   ============================================================================= */
const rooms = new Map();
const clients = new Map();   // ws -> client

function findLobbyRoom() {
  for (const r of rooms.values()) if (r.state === 'lobby' && r.players.size < BALANCE.match.maxPlayers) return r;
  const r = new Room(); rooms.set(r.id, r); return r;
}
function leaveRoom(client) {
  const room = client.room;
  if (!room) return;
  if (room.state === 'playing') {
    // Hand the bird over to a bot; the player can reconnect with their token.
    const p = room.players.get(client.id);
    if (p) { p.ws = null; const b = room.birds.get(p.birdId); if (b && b.alive && !b.isBot) { room.initBotAI(b); room.events.push({ type: 'botTakeover', b: b.id }); } }
  } else {
    room.removePlayer(client);
  }
  client.room = null; client.bird = null;
  if (room.players.size === 0 || (room.state === 'ended' && room.humanCount() === 0)) rooms.delete(room.id);
}
function tryReconnect(client, token) {
  if (!token) return false;
  for (const room of rooms.values()) {
    if (room.state !== 'playing') continue;
    for (const p of room.players.values()) {
      if (p.token !== token) continue;
      const b = room.birds.get(p.birdId);
      if (!b || (!b.alive && b.reviveT <= 0)) return false;   // nothing to come back to
      // move player entry to the new client id
      room.players.delete(p.id);
      p.id = client.id; p.ws = client.ws; room.players.set(p.id, p);
      b.playerId = client.id; client.room = room; client.bird = b;
      if (b.alive && b.isBot) { b.isBot = false; b.ai = null; b.input = { mx: 0, mz: 0, vy: 0, ax: 0, az: 1, fire: false, flySeq: b.lastFlySeq, superSeq: b.lastSuperSeq }; }
      send(client.ws, { type: 'welcome', id: client.id, token, balance: BALANCE, birdId: b.id, name: p.name, rarity: p.rarity, reconnected: true });
      send(client.ws, room.startMessage());
      return true;
    }
  }
  return false;
}

function handleMessage(client, msg) {
  switch (msg.type) {
    case 'join': {
      const name = String(msg.name || 'Bird').replace(/[^\w \-]/g, '').trim().slice(0, 14) || 'Bird';
      const rarity = RARITY_KEYS.includes(msg.rarity) ? msg.rarity : 'common';
      const token = typeof msg.token === 'string' && msg.token.length <= 48 ? msg.token : null;
      leaveRoom(client);
      if (!msg.fresh && tryReconnect(client, token)) return;
      const newToken = crypto.randomBytes(12).toString('hex');
      const room = findLobbyRoom();
      send(client.ws, { type: 'welcome', id: client.id, token: newToken, balance: BALANCE, name, rarity });
      room.addPlayer(client, name, rarity, newToken);
      break;
    }
    case 'input': {
      const room = client.room;
      if (!room || room.state !== 'playing') return;
      const p = room.players.get(client.id);
      const b = p && room.birds.get(p.birdId);
      if (!b || b.isBot) return;
      const i = b.input;
      i.mx = clamp(+msg.mx || 0, -1, 1); i.mz = clamp(+msg.mz || 0, -1, 1); i.vy = clamp(+msg.vy || 0, -1, 1);
      i.ax = clamp(+msg.ax || 0, -1, 1); i.az = clamp(+msg.az || 0, -1, 1);
      i.fire = !!msg.fire; i.flySeq = msg.flySeq | 0; i.superSeq = msg.superSeq | 0;
      break;
    }
    case 'resume': {   // page reloaded mid-match: rejoin the same bird if it is still in play
      if (client.room) return;
      if (!tryReconnect(client, typeof msg.token === 'string' ? msg.token : null)) send(client.ws, { type: 'noResume' });
      break;
    }
    case 'ping': send(client.ws, { type: 'pong', t: msg.t }); break;
    case 'leave': leaveRoom(client); break;
  }
}

// --- HTTP: serves index.html; everything else 404
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/index.html') || req.url.startsWith('/?')) {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) { res.writeHead(500); res.end('index.html missing'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  } else { res.writeHead(404); res.end('Not found'); }
});

const wss = new WebSocket.Server({ server });
wss.on('connection', (ws) => {
  const client = { id: uid(), ws, room: null, bird: null };
  clients.set(ws, client);
  ws.on('message', (data) => {
    let msg; try { msg = JSON.parse(data); } catch { return; }
    if (msg && typeof msg.type === 'string') { try { handleMessage(client, msg); } catch (e) { console.error('handler error', e); } }
  });
  ws.on('close', () => { leaveRoom(client); clients.delete(ws); });
  ws.on('error', () => {});
});

// --- main loop
setInterval(() => {
  for (const room of rooms.values()) {
    try { room.update(DT); } catch (e) { console.error('room error', e); }
    if (room.state === 'ended' && room.endTimer <= 0) {
      for (const p of room.players.values()) if (p.ws) { const c = clients.get(p.ws); if (c && c.room === room) { c.room = null; c.bird = null; } }
      rooms.delete(room.id);
    }
  }
}, 1000 / TICK_RATE);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Bird Game Ultimate server running on port ${PORT}`);
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) for (const i of ifaces[name]) {
    if (i.family === 'IPv4' && !i.internal) console.log(`  open on your phone:  http://${i.address}:${PORT}`);
  }
});
