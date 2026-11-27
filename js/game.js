'use strict';
/* ============================================================
   SPACE GLIDER — game.js
   World, entities, flight model, HUD, screens and the main loop.

   Each sector plays in three beats:
     1. HUNT  — free flight over the grid; destroy the hostile quota
     2. GATE  — a rift gate opens; fly through the ring
     3. RIFT  — dodge barriers down the rift, then destroy the Core
   ============================================================ */

/* ---------------- look ---------------- */
const PALETTES = [
  { name: 'CYAN FLATS',        grid: '#00d8ff', ridge: '#ff2bd6', sun: '#ffb300', sun2: '#ff2bd6', deco: '#3f8cff' },
  { name: 'MAGENTA DUNES',     grid: '#ff2bd6', ridge: '#00e5ff', sun: '#ffe45c', sun2: '#ff7a00', deco: '#b05bff' },
  { name: 'AMBER WASTE',       grid: '#ff9a00', ridge: '#ff3b4d', sun: '#ff3b4d', sun2: '#ffd000', deco: '#ffd000' },
  { name: 'EMERALD DEEP',      grid: '#1dff8e', ridge: '#00a8ff', sun: '#e6ff5c', sun2: '#1dff8e', deco: '#00a8ff' },
  { name: 'ULTRAVIOLET REACH', grid: '#8f5bff', ridge: '#ff2bd6', sun: '#00e5ff', sun2: '#8f5bff', deco: '#ff2bd6' },
];
const COL = {
  white: '#ffffff', laser: '#8ffcff', dart: '#ff4d5e', hunter: '#ff9d2e', crawler: '#ffe94d',
  spire: '#ff3bd0', wisp: '#b88cff', turret: '#ffe94d', core: '#ff3bd0', cell: '#2bff88', barrier: '#ff5a2e',
};
const HUD = '#3dffc5', AMBER = '#ffb300', RED = '#ff3b4d';

/* ---------------- tuning ---------------- */
const BOLT_V = 2600;      // player laser speed
const ASSIST = 0.07;      // aim-assist cone (radians)
const SENS = 0.0022;      // mouse-look radians per pixel
const GS = 160, GN = 14, GP = GN * 2 + 1;   // ground grid: spacing, half-count, points per side
const SC = 720;           // scenery cell size
const RW = 115, RH = 150, RC = 36;          // rift half-width, height, corner chamfer

/* enemy types — hit: [offset along mount normal, radius] */
const ET = {
  dart:    { model: M.dart,    scale: 1.7, hp: 1, score: 150,  color: COL.dart,    air: true, speed: 235, turn: 1.5, drop: 0.14, hit: [[0, 32]] },
  hunter:  { model: M.hunter,  scale: 1.6, hp: 3, score: 400,  color: COL.hunter,  air: true, speed: 265, turn: 1.7, drop: 0.5,  hit: [[0, 46]] },
  crawler: { model: M.crawler, scale: 1.7, hp: 2, score: 100,  color: COL.crawler, drop: 0.2,  hit: [[14, 38]] },
  spire:   { model: M.spire,   scale: 1,   hp: 3, score: 250,  color: COL.spire,   drop: 0.35, hit: [[140, 38], [80, 30], [28, 30]] },
  wisp:    { model: M.wisp,    scale: 1.4, hp: 1, score: 75,   color: COL.wisp,    air: true, drop: 0.1, hit: [[0, 28]] },
  turret:  { model: M.turret,  scale: 1.3, hp: 1, score: 120,  color: COL.turret,  drop: 0, hit: [[10, 28]] },
  core:    { model: M.ico,     scale: 44,  hp: 30, score: 2000, color: COL.core,   drop: 0, hit: [[0, 60]] },
};

/* ---------------- state ---------------- */
const G = {
  state: 'title',        // title | play | dying | gameover | initials
  scene: 'surface',      // surface | rift
  phase: 'hunt',         // hunt | gate | rift | boss | tally
  t: 0, stateT: 0, paused: false,
  sector: 0, score: 0, kills: 0, quota: 0, spawnT: 0,
  gate: null, rift: null, boss: null, tally: null, warp: null,
  banner: null, note: null, cracks: null,
  shake: 0, flash: 0, hurt: 0, good: 0, lowT: 0,
  hi: [], invert: false, crt: true, initials: '', rank: -1,
};
const P = {
  x: 0, y: 130, z: 0, px: 0, py: 130, pz: 0, vx: 0, vy: 0, vz: 0,
  yaw: 0, pitch: 0, roll: 0, yawRate: 0, kyaw: 0, kpitch: 0,
  speed: 180, throttle: 180, shield: 100, energy: 100, missiles: 4,
  fireCd: 0, side: 1, inv: 0, scrapeCd: 0, alive: true, lock: null,
};
const enemies = [], ebolts = [], pbolts = [], missiles = [], pickups = [];
const debris = [], sparks = [], rings = [], floaters = [];

/** Difficulty ramp 0..1 over the first eight sectors. */
const D = () => clamp((G.sector - 1) / 7, 0, 1);
function pal() {
  if (G.state === 'title') return PALETTES[Math.floor(G.t / 12) % PALETTES.length];
  return PALETTES[(Math.max(1, G.sector) - 1) % PALETTES.length];
}

/* ---------------- persistence ---------------- */
const DEFAULT_HI = [
  { n: 'JMP', s: 20000, k: 3 }, { n: 'RAM', s: 15000, k: 2 }, { n: 'ROM', s: 10000, k: 2 },
  { n: 'CPU', s: 6000, k: 1 }, { n: 'BIT', s: 3000, k: 1 },
];
function loadSaved() {
  let t = null, s = null;
  try {
    t = JSON.parse(localStorage.getItem('spaceglider.hiscores'));
    s = JSON.parse(localStorage.getItem('spaceglider.settings'));
  } catch (e) { /* storage unavailable or corrupt: fall back to defaults */ }
  if (!Array.isArray(t)) t = [];
  t = t.filter((r) => r && typeof r.n === 'string' && Number.isFinite(r.s)).slice(0, 5);
  G.hi = t.length ? t : DEFAULT_HI.map((r) => ({ ...r }));
  if (s && typeof s === 'object') {
    G.invert = !!s.invert;
    G.crt = s.crt !== false;
    if (s.sound === 1 || s.sound === 2) Sfx.setMode(s.sound);
  }
  document.body.classList.toggle('nocrt', !G.crt);
}
function saveAll() {
  try {
    localStorage.setItem('spaceglider.hiscores', JSON.stringify(G.hi));
    localStorage.setItem('spaceglider.settings', JSON.stringify({ invert: G.invert, crt: G.crt, sound: Sfx.mode }));
  } catch (e) { /* ignore */ }
}

/* ---------------- messages ---------------- */
function banner(title, sub, dur = 4) { G.banner = { title, sub: sub || '', t: 0, dur }; }
function note(text, color = HUD, dur = 2.2) { G.note = { text, color, t: 0, dur }; }

/* ---------------- effects ---------------- */
function sparksAt(x, y, z, n, color, v, bvx = 0, bvy = 0, bvz = 0) {
  for (let i = 0; i < n && sparks.length < 360; i++) {
    const a = rand(TAU), u = rand(-1, 1), s = Math.sqrt(1 - u * u), sp = v * rand(0.3, 1);
    sparks.push({
      x, y, z, vx: Math.cos(a) * s * sp + bvx, vy: u * sp + bvy, vz: Math.sin(a) * s * sp + bvz,
      life: rand(0.3, 0.9), max: 0.9, color,
    });
  }
}
function ringAt(x, y, z, r, vr, life, color) {
  if (rings.length < 40) rings.push({ x, y, z, r, vr, life, max: life, color });
}
/** Shatter a model into its edges. */
function debrisFrom(m, x, y, z, yaw, pitch, roll, s, color, bvx, bvy, bvz, force) {
  modelEdges(m, x, y, z, yaw, pitch, roll, s, (ax, ay, az, bx, by, bz) => {
    if (debris.length >= 420) return;
    const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
    const ox = mx - x, oy = my - y, oz = mz - z, ol = Math.hypot(ox, oy, oz) || 1;
    const f = force * rand(0.4, 1.2);
    debris.push({
      x: mx, y: my, z: mz, hx: (bx - ax) / 2, hy: (by - ay) / 2, hz: (bz - az) / 2,
      vx: ox / ol * f + bvx + rand(-20, 20), vy: oy / ol * f + bvy + rand(0, 40), vz: oz / ol * f + bvz + rand(-20, 20),
      spin: rand(-6, 6), spin2: rand(-6, 6), life: rand(0.8, 1.6), max: 1.6, color,
    });
  });
}
function blastAt(x, y, z, size, color, vx = 0, vy = 0, vz = 0) {
  sparksAt(x, y, z, 14 * size, COL.white, 220 * size, vx, vy, vz);
  sparksAt(x, y, z, 10 * size, color, 140 * size, vx, vy, vz);
  ringAt(x, y, z, 14 * size, 260 * size, 0.5, COL.white);
  const d = Math.hypot(P.x - x, P.y - y, P.z - z);
  Sfx.boom(size, clamp(1.2 - d / 2200, 0.2, 1));
  if (d < 500) G.shake = Math.max(G.shake, (1 - d / 500) * 0.6 * size);
}
function explode(e) {
  const T = e.T, h = T.hit[0][0];
  const cx = e.x + e.nx * h, cy = e.y + e.ny * h;
  const big = e.type === 'core' ? 3 : (e.type === 'hunter' || e.type === 'spire') ? 1.5 : 1;
  const bx = e.vx * 0.5, by = e.vy * 0.5, bz = e.type === 'core' ? e.vz : e.vz * 0.5;
  debrisFrom(T.model, e.x, e.y, e.z, e.yaw, e.pitch, e.roll, T.scale, T.color, bx, by, bz, 110 * big);
  if (e.type === 'spire') debrisFrom(M.crystal, e.x, 140, e.z, e.age * 2, 0, 0, 15, COL.white, 0, 0, 0, 160);
  if (e.type === 'core') debrisFrom(M.cube, e.x, e.y, e.z, -e.age * 0.5, e.age * 0.35, 0, 36, COL.white, bx, by, bz, 320);
  blastAt(cx, cy, e.z, big, T.color, bx, by, bz);
}
function addScore(n, x, y, z) {
  G.score += n;
  if (x !== undefined && floaters.length < 20) floaters.push({ x, y, z, text: String(n), life: 1.1, max: 1.1 });
}

/* ---------------- player orientation basis ---------------- */
const BX = [1, 0, 0], BY = [0, 1, 0], BZ = [0, 0, 1];
function basis() {
  const cy = Math.cos(P.yaw), sy = Math.sin(P.yaw), cp = Math.cos(P.pitch), sp = Math.sin(P.pitch);
  const cr = Math.cos(P.roll), sr = Math.sin(P.roll);
  const rx = cy, rz = -sy;                         // right (level)
  const ux = -sy * sp, uy = cp, uz = -cy * sp;     // up
  BZ[0] = sy * cp; BZ[1] = sp; BZ[2] = cy * cp;    // forward
  BX[0] = rx * cr + ux * sr; BX[1] = uy * sr; BX[2] = rz * cr + uz * sr;
  BY[0] = -rx * sr + ux * cr; BY[1] = uy * cr; BY[2] = -rz * sr + uz * cr;
}

/* ---------------- game flow ---------------- */
function clearWorld() {
  enemies.length = ebolts.length = pbolts.length = missiles.length = pickups.length = 0;
  debris.length = sparks.length = rings.length = floaters.length = 0;
  P.lock = null;
}
function startGame() {
  Sfx.init();
  Sfx.start();
  G.state = 'play'; G.stateT = 0; G.paused = false;
  G.score = 0; G.sector = 0; G.cracks = null; G.warp = null; G.shake = G.flash = G.hurt = G.good = 0;
  Object.assign(P, { shield: 100, energy: 100, missiles: 4, alive: true, inv: 0, fireCd: 0.3, kyaw: 0, kpitch: 0 });
  nextSector(true);
  requestLock();
}
function nextSector(first) {
  G.sector++;
  G.scene = 'surface'; G.phase = 'hunt';
  G.kills = 0; G.quota = Math.min(8 + G.sector * 2, 20);
  G.gate = G.rift = G.boss = G.tally = null;
  G.spawnT = 2.5;
  clearWorld();
  buildRidge(G.sector);
  Object.assign(P, { x: 0, y: 160, z: 0, yaw: 0, pitch: 0, roll: 0, yawRate: 0, speed: 180, throttle: 180, energy: 100 });
  P.px = P.x; P.py = P.y; P.pz = P.z;
  if (!first) { P.shield = Math.min(100, P.shield + 40); P.missiles = 4; }
  Sfx.setLevel(1);
  banner('SECTOR ' + pad(G.sector, 2), pal().name + ' - DESTROY ' + G.quota + ' HOSTILES', 4.5);
}
function toTitle() {
  G.state = 'title'; G.stateT = 0; G.scene = 'surface'; G.sector = 0; G.paused = false;
  G.gate = G.rift = G.boss = G.tally = G.warp = G.banner = G.note = G.cracks = null;
  clearWorld();
  buildRidge(1);
  Object.assign(P, { y: 120, pitch: 0, roll: 0, alive: true });
  Sfx.setLevel(0);
  Sfx.engine(0, false);
  releaseLock();
}
function setPause(p) {
  if (G.state !== 'play') return;
  G.paused = p;
  if (p) Sfx.engine(0, false); else requestLock();
}
onLockChange = (locked) => { if (!locked && G.state === 'play' && !G.paused) setPause(true); };
window.addEventListener('blur', () => { if (!G.paused) setPause(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden && !G.paused) setPause(true); });

function startWarp(mid) { G.warp = { t: 0, dur: 1.6, mid, done: false }; }

function hurt(dmg) {
  if (!P.alive || P.inv > 0 || G.warp || G.phase === 'tally') return;
  P.shield -= dmg; P.inv = 0.35;
  G.hurt = 1; G.shake = Math.max(G.shake, 0.5 + dmg / 25);
  Sfx.hit();
  if (P.shield <= 0) die();
}
function die() {
  if (!P.alive) return;
  P.alive = false; P.shield = 0; P.lock = null;
  G.state = 'dying'; G.stateT = 0; G.shake = 2; G.flash = 1; G.banner = G.note = null;
  Sfx.bigBoom(); Sfx.setLevel(0); Sfx.engine(0, false);
  // cockpit glass cracks: jagged rays from an impact point (normalised screen coords)
  const ox = rand(0.35, 0.65), oy = rand(0.25, 0.5);
  G.cracks = [];
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * TAU + rand(-0.2, 0.2), pts = [[ox, oy]];
    let r = 0;
    while (r < 1.1) {
      r += rand(0.06, 0.2);
      const j = a + rand(-0.12, 0.12);
      pts.push([ox + Math.cos(j) * r, oy + Math.sin(j) * r]);
    }
    G.cracks.push(pts);
  }
}

/* ---------------- spawning ---------------- */
function makeEnemy(type) {
  const T = ET[type];
  return {
    type, T, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, dx: 0, dy: 0, dz: 1, nx: 0, ny: 1,
    yaw: 0, pitch: 0, roll: 0, hp: T.hp, maxHp: T.hp, cd: rand(1.2, 2.8), burst: 2,
    state: 'attack', timer: 0, tx: 0, ty: 0, tz: 0, flash: 0, age: 0, seed: rand(TAU), dead: false,
  };
}
/** Drop an enemy somewhere ahead of the player, out of sight range. */
function placeEnemy(e) {
  const a = P.yaw + rand(-1.3, 1.3), d = rand(1800, 2600);
  e.x = P.x + Math.sin(a) * d; e.z = P.z + Math.cos(a) * d;
  if (e.T.air) {
    e.y = rand(90, 340);
    const hx = P.x - e.x, hz = P.z - e.z, l = Math.hypot(hx, hz) || 1;
    e.dx = hx / l; e.dy = 0; e.dz = hz / l;
    e.state = 'attack';
  } else {
    e.y = 0; e.yaw = rand(TAU);
  }
}
function spawnEnemy() {
  const s = G.sector, w = [['dart', 5], ['crawler', 3], ['spire', 2]];
  if (s >= 2) w.push(['wisp', 2]);
  if (s >= 3) w.push(['hunter', 1 + Math.min(3, s - 3)]);
  let tot = 0;
  for (const a of w) tot += a[1];
  let r = rand(tot), type = 'dart';
  for (const a of w) { r -= a[1]; if (r < 0) { type = a[0]; break; } }
  const e = makeEnemy(type);
  placeEnemy(e);
  enemies.push(e);
  return e;
}

/* ---------------- the gate ---------------- */
function openGate() {
  if (G.phase !== 'hunt') return;
  G.phase = 'gate';
  const a = P.yaw + rand(-0.5, 0.5), d = 2600;
  G.gate = {
    x: P.x + Math.sin(a) * d, y: 200, z: P.z + Math.cos(a) * d,
    yaw: a, nx: Math.sin(a), nz: Math.cos(a), r: 112, t: 0, side: 0,
  };
  banner('RIFT GATE OPEN', 'FLY THROUGH THE RING', 4);
  Sfx.gate();
}
function updateGate(dt) {
  const g = G.gate;
  g.t += dt;
  const side = (P.x - g.x) * g.nx + (P.z - g.z) * g.nz;
  const s = side >= 0 ? 1 : -1;
  if (g.side !== 0 && s !== g.side) {
    const lat = (P.x - g.x) * g.nz - (P.z - g.z) * g.nx;
    if (Math.hypot(lat, P.y - g.y) < g.r - 6) { enterRift(); return; }
    note('MISSED THE RING - COME AROUND', AMBER, 2.5);
  }
  g.side = s;
}

/* ---------------- the rift ---------------- */
const BARRIER = {
  low:    [[-RW, 0, RW, RH * 0.6]],
  high:   [[-RW, RH * 0.4, RW, RH]],
  left:   [[-RW, 0, RW * 0.2, RH]],
  right:  [[-RW * 0.2, 0, RW, RH]],
  center: [[-RW * 0.36, 0, RW * 0.36, RH]],
  slot:   [[-RW, 0, RW, RH * 0.3], [-RW, RH * 0.7, RW, RH]],
  sides:  [[-RW, 0, -RW * 0.34, RH], [RW * 0.34, 0, RW, RH]],
};
function addTurret(z) {
  const e = makeEnemy('turret');
  const m = pick(['floor', 'floor', 'left', 'right', 'ceil']);
  e.z = z;
  if (m === 'floor') { e.x = rand(-65, 65); e.y = 0; }
  else if (m === 'ceil') { e.x = rand(-65, 65); e.y = RH; e.ny = -1; e.roll = Math.PI; }
  else if (m === 'left') { e.x = -RW; e.y = rand(45, RH - 45); e.nx = 1; e.ny = 0; e.roll = -Math.PI / 2; }
  else { e.x = RW; e.y = rand(45, RH - 45); e.nx = -1; e.ny = 0; e.roll = Math.PI / 2; }
  enemies.push(e);
}
function buildRift() {
  const s = G.sector;
  const R = { len: 4200 + Math.min(s, 7) * 600, barriers: [] };
  const kinds = ['low', 'high', 'left', 'right', 'center'];
  if (s >= 2) kinds.push('slot', 'sides');
  const gap = lerp(640, 460, D());
  let z = 900, last = '';
  while (z < R.len - 300) {
    let k;
    do { k = pick(kinds); } while (k === last);
    last = k;
    R.barriers.push({ z, kind: k, rects: BARRIER[k], passed: false, hit: false });
    if (rand() < 0.5 + 0.4 * D()) addTurret(z + gap * 0.5);
    z += gap * rand(0.9, 1.2);
  }
  G.rift = R;
}
function enterRift() {
  if (G.warp) return;
  Sfx.warp();
  startWarp(() => {
    clearWorld();
    G.scene = 'rift'; G.phase = 'rift'; G.gate = null;
    buildRift();
    Object.assign(P, { x: 0, y: RH / 2, z: 0, yaw: 0, pitch: 0, roll: 0, yawRate: 0, speed: 200, throttle: 200 });
    P.px = P.x; P.py = P.y; P.pz = P.z;
    Sfx.setLevel(2);
    banner('THE RIFT', 'DODGE THE BARRIERS - REACH THE CORE', 4);
  });
}
function shatterBarrier(b) {
  for (const r of b.rects) {
    const cx = clamp(P.x, r[0], r[2]), cy = clamp(P.y, r[1], r[3]);
    sparksAt(cx, cy, b.z + 5, 30, COL.barrier, 260, 0, 0, P.vz);
  }
}
function spawnBoss() {
  G.phase = 'boss';
  const e = makeEnemy('core');
  e.maxHp = e.hp = 30 + G.sector * 10;
  e.x = 0; e.y = RH / 2; e.z = P.z + 1500;
  e.bt = 0; e.volley = 0; e.cd = 2.5;
  enemies.push(e);
  G.boss = e;
  banner('THE CORE', 'DESTROY IT', 3.2);
  Sfx.warn();
}
function updateRift(dt) {
  const R = G.rift;
  for (const b of R.barriers) {
    if (b.passed || P.z < b.z) continue;
    b.passed = true;
    for (const r of b.rects) {
      if (P.x > r[0] + 7 && P.x < r[2] - 7 && P.y > r[1] + 7 && P.y < r[3] - 7) {
        b.hit = true;
        P.inv = 0;                 // a wall always counts
        hurt(18);
        shatterBarrier(b);
        note('BARRIER IMPACT', RED, 1.4);
        break;
      }
    }
    if (!b.hit && P.alive) { G.score += 50; Sfx.tick(); }
  }
  if (G.phase === 'rift' && P.z > R.len) spawnBoss();
}
function coreDestroyed(e) {
  G.phase = 'tally'; G.boss = null;
  for (const b of ebolts) sparksAt(b.x, b.y, b.z, 4, AMBER, 80, 0, 0, P.vz);
  ebolts.length = 0;
  for (const t of enemies) if (t.type === 'turret') t.dead = true;
  G.flash = 1; G.shake = 1.6; G.banner = null;
  Sfx.bigBoom(); Sfx.setLevel(1);
  G.tally = {
    t: 0, added: false, booms: 9, boomT: 0, x: e.x, y: e.y, dz: e.z - P.z,
    lines: [['CORE DESTROYED', ET.core.score * G.sector], ['SHIELD BONUS', Math.round(P.shield) * 10], ['MISSILE BONUS', P.missiles * 150]],
  };
}
function updateTally(dt) {
  const T = G.tally;
  T.t += dt;
  T.boomT -= dt;
  if (T.booms > 0 && T.boomT <= 0) {
    T.booms--; T.boomT = 0.16;
    blastAt(T.x + rand(-60, 60), T.y + rand(-50, 50), P.z + T.dz + rand(-60, 60), rand(1, 2), pick([COL.core, AMBER, COL.white]), 0, 0, P.vz);
  }
  if (!T.added && T.t > 2.9) {
    T.added = true;
    G.score += T.lines[1][1] + T.lines[2][1];
    Sfx.pickup();
  }
  if (!G.warp && (T.t > 7 || (T.t > 3.4 && (pressed.Space || pressed.Enter || mouse.click)))) {
    Sfx.warp();
    startWarp(() => nextSector(false));
  }
}

/* ---------------- damage ---------------- */
function kill(e, noScore) {
  if (e.dead) return;
  e.dead = true;
  const T = e.T;
  explode(e);
  if (!noScore) addScore(T.score * (e.type === 'core' ? G.sector : 1), e.x + e.nx * T.hit[0][0], e.y + e.ny * T.hit[0][0], e.z);
  if (e.type === 'core') { coreDestroyed(e); return; }
  if (e.type !== 'turret' && G.phase === 'hunt') {
    G.kills++;
    if (G.kills >= G.quota) openGate();
  }
  if (rand() < T.drop && pickups.length < 6) {
    pickups.push({ x: e.x, y: Math.max(40, e.y + e.ny * T.hit[0][0]), z: e.z, life: 14, age: 0, dead: false });
  }
}
function damage(e, dmg, hx, hy, hz) {
  if (e.dead) return;
  e.hp -= dmg; e.flash = 0.12;
  sparksAt(hx, hy, hz, 6, COL.white, 130, e.vx, e.vy, e.vz);
  if (e.hp <= 0) kill(e); else Sfx.clank();
}

/* ---------------- enemy fire ---------------- */
/** rel: aim in the player's moving frame (used in the rift so bolts drift in at a readable pace). */
function fireAtPlayer(sx, sy, sz, speed, rel, ox = 0, oy = 0) {
  if (ebolts.length >= 48 || !P.alive) return;
  let tx = P.x + ox, ty = P.y + oy, tz = P.z, vx, vy, vz;
  if (rel) {
    const dx = tx - sx, dy = ty - sy, dz = tz - sz, d = Math.hypot(dx, dy, dz) || 1;
    vx = dx / d * speed + P.vx; vy = dy / d * speed + P.vy; vz = dz / d * speed + P.vz;
  } else {
    const t = Math.hypot(tx - sx, ty - sy, tz - sz) / speed * (0.72 + 0.25 * D()) * rand(0.85, 1.12);   // imperfect lead
    tx += P.vx * t; ty += P.vy * t; tz += P.vz * t;
    const dx = tx - sx, dy = ty - sy, dz = tz - sz, d = Math.hypot(dx, dy, dz) || 1;
    vx = dx / d * speed; vy = dy / d * speed; vz = dz / d * speed;
  }
  ebolts.push({ x: sx, y: sy, z: sz, vx, vy, vz, life: 7, spin: rand(TAU), dead: false });
  Sfx.enemyFire(clamp(1 - Math.hypot(P.x - sx, P.y - sy, P.z - sz) / 1800, 0.15, 1));
}

/* ---------------- enemy AI ---------------- */
function aiFighter(e, dt, dx, dy, dz, dist, fireMul) {
  const T = e.T;
  if (e.state === 'attack') {
    const lead = dist / (T.speed + 220);
    e.tx = P.x + P.vx * lead; e.ty = P.y + P.vy * lead; e.tz = P.z + P.vz * lead;
    if (dist < 270) {
      // overshoot, then swing wide before the next pass
      e.state = 'break'; e.timer = rand(2.2, 3.8);
      const a = rand(TAU);
      e.tx = e.x + e.dx * 1500 + Math.cos(a) * 800;
      e.ty = rand(120, 380);
      e.tz = e.z + e.dz * 1500 + Math.sin(a) * 800;
    }
  } else {
    e.timer -= dt;
    if (e.timer <= 0) e.state = 'attack';
  }
  let ux = e.tx - e.x, uy = e.ty - e.y, uz = e.tz - e.z;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul; uy /= ul; uz /= ul;
  const odx = e.dx, odz = e.dz, k = Math.min(1, T.turn * dt);
  e.dx += (ux - e.dx) * k; e.dy += (uy - e.dy) * k; e.dz += (uz - e.dz) * k;
  if (e.y < 55 && e.dy < 0.25) e.dy += 2.5 * dt;                 // don't plough into the ground
  let l = Math.hypot(e.dx, e.dy, e.dz);
  if (l < 1e-4) { e.dx = odx; e.dy = 0.1; e.dz = odz; l = Math.hypot(e.dx, e.dy, e.dz) || 1; }
  e.dx /= l; e.dy /= l; e.dz /= l;
  const turn = (odz * e.dx - odx * e.dz) / Math.max(dt, 1e-3);   // + = turning right
  e.roll = lerp(e.roll, clamp(-turn * 0.7, -1.2, 1.2), damp(5, dt));
  e.vx = e.dx * T.speed; e.vy = e.dy * T.speed; e.vz = e.dz * T.speed;
  e.x += e.vx * dt; e.y = Math.max(20, e.y + e.vy * dt); e.z += e.vz * dt;
  e.yaw = Math.atan2(e.dx, e.dz); e.pitch = Math.asin(clamp(e.dy, -1, 1));

  e.cd -= dt;
  if (e.state === 'attack' && e.cd <= 0 && dist > 320 && dist < 1500) {
    if ((e.dx * dx + e.dy * dy + e.dz * dz) / dist > 0.9) {
      fireAtPlayer(e.x + e.dx * 20, e.y + e.dy * 20, e.z + e.dz * 20, 430);
      if (e.type === 'hunter' && e.burst > 0) { e.burst--; e.cd = 0.2; }
      else { e.burst = 2; e.cd = rand(1.6, 2.6) * fireMul * (e.type === 'hunter' ? 1.3 : 1); }
    }
  }
  if (P.alive && dist < T.hit[0][1] + 10) { hurt(20); kill(e); }
}
function aiCore(e, dt) {
  const hp = e.hp / e.maxHp, wob = 0.6 + (1 - hp) * 0.7;
  e.bt += dt * wob;
  const nx = Math.sin(e.bt * 0.9) * 62, ny = RH / 2 + Math.sin(e.bt * 1.3 + 1) * 40;
  const nz = lerp(e.z + P.vz * dt, P.z + 560, damp(1.6, dt));
  const idt = 1 / Math.max(dt, 1e-3);
  e.vx = clamp((nx - e.x) * idt, -200, 200); e.vy = clamp((ny - e.y) * idt, -200, 200); e.vz = P.vz;
  e.x = nx; e.y = ny; e.z = nz;
  e.cd -= dt;
  if (e.cd <= 0 && e.z - P.z < 900) {
    const sp = 300 + 70 * D();
    e.volley++;
    if (e.volley % 3 === 0 || (hp < 0.5 && e.volley % 2 === 0)) {
      const horiz = rand() < 0.5, o = 34;
      for (let i = -1; i <= 1; i++) fireAtPlayer(e.x, e.y, e.z - 30, sp, true, horiz ? i * o : 0, horiz ? 0 : i * o);
    } else {
      fireAtPlayer(e.x, e.y, e.z - 30, sp, true, rand(-8, 8), rand(-8, 8));
    }
    e.cd = lerp(0.7, 1.45, hp) * (1 - 0.25 * D());
  }
}
function updateEnemies(dt) {
  const fireMul = 1 - 0.4 * D();
  for (const e of enemies) {
    if (e.dead) continue;
    e.age += dt;
    if (e.flash > 0) e.flash -= dt;
    const dx = P.x - e.x, dy = P.y - e.y, dz = P.z - e.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    switch (e.type) {
      case 'dart':
      case 'hunter':
        aiFighter(e, dt, dx, dy, dz, dist, fireMul);
        break;
      case 'crawler':
        e.yaw += Math.sin(e.age * 0.3 + e.seed) * 0.25 * dt;
        e.vx = Math.sin(e.yaw) * 26; e.vz = Math.cos(e.yaw) * 26;
        e.x += e.vx * dt; e.z += e.vz * dt;
        e.cd -= dt;
        if (e.cd <= 0 && dist < 1400 && dist > 150) { fireAtPlayer(e.x, 22, e.z, 380); e.cd = rand(2.4, 3.6) * fireMul; }
        if (dist > 4600) placeEnemy(e);
        break;
      case 'spire':
        e.cd -= dt;
        if (e.cd <= 0 && dist < 1600) { fireAtPlayer(e.x, 142, e.z, 470); e.cd = rand(1.8, 2.6) * fireMul; }
        if (dist > 4600) placeEnemy(e);
        break;
      case 'wisp': {
        const sp = 150 + 45 * D();
        e.vx = dx / dist * sp; e.vy = dy / dist * sp + Math.sin(e.age * 3 + e.seed) * 30; e.vz = dz / dist * sp;
        e.x += e.vx * dt; e.y = Math.max(25, e.y + e.vy * dt); e.z += e.vz * dt;
        if (P.alive && dist < 30) { hurt(16); kill(e, true); }
        else if (dist > 3800) placeEnemy(e);
        break;
      }
      case 'turret': {
        const rz = e.z - P.z;
        if (rz < -80) { e.dead = true; break; }
        e.cd -= dt;
        if (e.cd <= 0 && rz > 240 && rz < 1500) {
          fireAtPlayer(e.x + e.nx * 24, e.y + e.ny * 24, e.z, 400);
          e.cd = rand(1.5, 2.4) * fireMul;
        }
        break;
      }
      case 'core':
        aiCore(e, dt);
        break;
    }
  }
}

/* ---------------- player weapons ---------------- */
const LOCK = { o: null, x: 0, y: 0, z: 0, r: 0, bolt: false };
/** Nearest thing to the crosshair inside the cone (uses the current camera). */
function findTarget(cone, noBolts) {
  let best = 1e9, found = false;
  for (const e of enemies) {
    if (e.dead) continue;
    const h = e.T.hit[0], hx = e.x + e.nx * h[0], hy = e.y + e.ny * h[0];
    const c = toCam(hx, hy, e.z), z = c[2];
    if (z < 25 || z > 3000) continue;
    const ang = Math.hypot(c[0], c[1]) / z;
    if (ang < cone + h[1] / z && ang < best) {
      best = ang; found = true;
      LOCK.o = e; LOCK.x = hx; LOCK.y = hy; LOCK.z = e.z; LOCK.r = h[1]; LOCK.bolt = false;
    }
  }
  if (!noBolts) {
    for (const b of ebolts) {
      if (b.dead) continue;
      const c = toCam(b.x, b.y, b.z), z = c[2];
      if (z < 25 || z > 1800) continue;
      const ang = Math.hypot(c[0], c[1]) / z;
      if (ang < cone + 14 / z && ang < best) {
        best = ang; found = true;
        LOCK.o = b; LOCK.x = b.x; LOCK.y = b.y; LOCK.z = b.z; LOCK.r = 14; LOCK.bolt = true;
      }
    }
  }
  return found ? LOCK : null;
}
function fireLaser() {
  basis();
  P.fireCd = 0.105; P.energy -= 3.5; P.side = -P.side;
  const mx = P.x + BX[0] * 16 * P.side - BY[0] * 11 + BZ[0] * 6;
  const my = P.y + BX[1] * 16 * P.side - BY[1] * 11 + BZ[1] * 6;
  const mz = P.z + BX[2] * 16 * P.side - BY[2] * 11 + BZ[2] * 6;
  let ax, ay, az;
  const L = P.lock;
  if (L) {
    const t = Math.hypot(L.x - mx, L.y - my, L.z - mz) / BOLT_V;   // lead the target
    ax = L.x + L.o.vx * t; ay = L.y + L.o.vy * t; az = L.z + L.o.vz * t;
  } else {
    ax = P.x + BZ[0] * 1400; ay = P.y + BZ[1] * 1400; az = P.z + BZ[2] * 1400;
  }
  const dx = ax - mx, dy = ay - my, dz = az - mz, l = Math.hypot(dx, dy, dz) || 1;
  pbolts.push({ x: mx, y: my, z: mz, vx: dx / l * BOLT_V, vy: dy / l * BOLT_V, vz: dz / l * BOLT_V, life: 1.15, dead: false });
  Sfx.laser();
}
function fireMissile() {
  if (P.missiles <= 0) { Sfx.deny(); note('NO MISSILES', AMBER, 1.2); return; }
  basis();
  const L = (P.lock && !P.lock.bolt) ? P.lock : findTarget(0.5, true);
  P.missiles--;
  missiles.push({
    x: P.x - BY[0] * 10 + BZ[0] * 8, y: P.y - BY[1] * 10 + BZ[1] * 8, z: P.z - BY[2] * 10 + BZ[2] * 8,
    dx: BZ[0], dy: BZ[1], dz: BZ[2], speed: P.speed + 180, tgt: L ? L.o : null, life: 6, trail: 0, dead: false,
  });
  Sfx.missile();
  note(L ? 'MISSILE AWAY - TRACKING' : 'MISSILE AWAY', HUD, 1.2);
}

/* ---------------- projectiles ---------------- */
function updateBolts(dt) {
  const rift = G.scene === 'rift';
  // player lasers
  for (const b of pbolts) {
    const x0 = b.x, y0 = b.y, z0 = b.z;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    b.life -= dt;
    if (b.life <= 0) { b.dead = true; continue; }
    if (b.y < 0 || (rift && (b.y > RH || Math.abs(b.x) > RW))) {
      sparksAt(b.x, clamp(b.y, 1, 1e6), b.z, 3, COL.laser, 70);
      b.dead = true; continue;
    }
    if (rift) {
      for (const br of G.rift.barriers) {
        if (br.hit || br.z <= z0 || br.z > b.z) continue;
        const t = (br.z - z0) / (b.z - z0), ix = x0 + (b.x - x0) * t, iy = y0 + (b.y - y0) * t;
        for (const r of br.rects) {
          if (ix > r[0] && ix < r[2] && iy > r[1] && iy < r[3]) { b.dead = true; sparksAt(ix, iy, br.z - 2, 4, COL.barrier, 90, 0, 0, P.vz); break; }
        }
        if (b.dead) break;
      }
      if (b.dead) continue;
    }
    for (const e of enemies) {
      if (e.dead) continue;
      const hits = e.T.hit;
      for (let i = 0; i < hits.length; i++) {
        const hx = e.x + e.nx * hits[i][0], hy = e.y + e.ny * hits[i][0];
        if (segSphere(x0, y0, z0, b.x, b.y, b.z, hx, hy, e.z, hits[i][1] * 1.1)) {
          damage(e, 1, hx, hy, e.z);
          b.dead = true;
          break;
        }
      }
      if (b.dead) break;
    }
    if (b.dead) continue;
    for (const eb of ebolts) {
      if (eb.dead) continue;
      if (segSphere(x0, y0, z0, b.x, b.y, b.z, eb.x, eb.y, eb.z, 18)) {
        eb.dead = b.dead = true;
        sparksAt(eb.x, eb.y, eb.z, 8, AMBER, 120, eb.vx * 0.3, eb.vy * 0.3, eb.vz * 0.3);
        addScore(25, eb.x, eb.y, eb.z);
        Sfx.pop();
        break;
      }
    }
  }
  // enemy plasma
  for (const b of ebolts) {
    if (b.dead) continue;
    const x0 = b.x, y0 = b.y, z0 = b.z;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    b.life -= dt; b.spin += dt * 9;
    if (b.life <= 0) { b.dead = true; continue; }
    if (b.y < 0 || (rift && (b.y > RH + 6 || Math.abs(b.x) > RW + 6 || b.z < P.z - 300))) {
      sparksAt(b.x, Math.max(1, b.y), b.z, 3, AMBER, 60);
      b.dead = true; continue;
    }
    // swept test in the player's frame
    if (P.alive && segSphere(x0 - P.px, y0 - P.py, z0 - P.pz, b.x - P.x, b.y - P.y, b.z - P.z, 0, 0, 0, 15)) {
      b.dead = true;
      hurt(10);
    }
  }
}
function updateMissiles(dt) {
  for (const m of missiles) {
    m.life -= dt;
    m.speed = Math.min(950, m.speed + 700 * dt);
    let t = m.tgt;
    if (t && t.dead) t = m.tgt = null;
    if (t) {
      const h = t.T.hit[0];
      let ux = t.x + t.nx * h[0] - m.x, uy = t.y + t.ny * h[0] - m.y, uz = t.z - m.z;
      const ul = Math.hypot(ux, uy, uz) || 1;
      const k = Math.min(1, 5 * dt);
      m.dx += (ux / ul - m.dx) * k; m.dy += (uy / ul - m.dy) * k; m.dz += (uz / ul - m.dz) * k;
      const l = Math.hypot(m.dx, m.dy, m.dz) || 1;
      m.dx /= l; m.dy /= l; m.dz /= l;
    }
    const x0 = m.x, y0 = m.y, z0 = m.z;
    m.x += m.dx * m.speed * dt; m.y += m.dy * m.speed * dt; m.z += m.dz * m.speed * dt;
    m.trail -= dt;
    if (m.trail <= 0) { m.trail = 0.025; sparksAt(m.x, m.y, m.z, 1, AMBER, 25); }
    let boom = m.life <= 0 || m.y < 0 || (G.scene === 'rift' && (m.y > RH || Math.abs(m.x) > RW));
    for (const e of enemies) {
      if (e.dead) continue;
      const h = e.T.hit[0], hx = e.x + e.nx * h[0], hy = e.y + e.ny * h[0];
      if (segSphere(x0, y0, z0, m.x, m.y, m.z, hx, hy, e.z, h[1] + 14)) {
        damage(e, 6, hx, hy, e.z);
        boom = true;
        break;
      }
    }
    if (boom) {
      m.dead = true;
      blastAt(m.x, Math.max(2, m.y), m.z, 1.2, AMBER);
    }
  }
}
function updatePickups(dt) {
  for (const c of pickups) {
    c.life -= dt; c.age += dt;
    if (c.life <= 0) { c.dead = true; continue; }
    const dx = P.x - c.x, dy = P.y - c.y, dz = P.z - c.z, d = Math.hypot(dx, dy, dz) || 1;
    if (d < 800 && P.alive) {          // tractor it in
      const sp = P.speed + 280;
      c.x += dx / d * sp * dt; c.y += dy / d * sp * dt; c.z += dz / d * sp * dt;
      if (d < 34) {
        c.dead = true;
        P.shield = Math.min(100, P.shield + 15);
        G.good = 1;
        Sfx.pickup();
        note('ENERGY CELL - SHIELD +15', COL.cell, 1.8);
      }
    }
  }
}
function updateParticles(dt) {
  for (const d of debris) {
    d.life -= dt;
    d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
    d.vy -= 60 * dt;
    let c = Math.cos(d.spin * dt), s = Math.sin(d.spin * dt);
    const hx = d.hx * c - d.hz * s; d.hz = d.hx * s + d.hz * c; d.hx = hx;
    c = Math.cos(d.spin2 * dt); s = Math.sin(d.spin2 * dt);
    const hy = d.hy * c - d.hz * s; d.hz = d.hy * s + d.hz * c; d.hy = hy;
  }
  for (const p of sparks) {
    p.life -= dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
  }
  for (const r of rings) { r.life -= dt; r.r += r.vr * dt; }
  for (const f of floaters) { f.life -= dt; f.y += 14 * dt; }
}
function prune(arr) {
  let n = 0;
  for (let i = 0; i < arr.length; i++) {
    const o = arr[i];
    if (o.dead || o.life <= 0) continue;
    arr[n++] = o;
  }
  arr.length = n;
}

/* ---------------- scenery ---------------- */
function sceneryAt(cx, cz) {
  const s = Math.max(1, G.sector) * 7 + 3;
  if (hash2(cx, cz, s) > 0.34) return null;
  const d = DECO[Math.floor(hash2(cx, cz, s + 1) * DECO.length)];
  const sc = d.s * (0.7 + hash2(cx, cz, s + 2) * 0.9);
  return {
    m: d.m, s: sc, yaw: hash2(cx, cz, s + 5) * TAU, h: d.h * sc, r: d.r * sc, taper: d.m === M.pyramid,
    x: (cx + 0.2 + 0.6 * hash2(cx, cz, s + 3)) * SC, z: (cz + 0.2 + 0.6 * hash2(cx, cz, s + 4)) * SC,
  };
}
/** Push the player out of an upright solid; true if they were inside. */
function solidHit(ox, oz, r, h, taper) {
  if (P.y > h + 4) return false;
  const rr = (taper ? r * clamp(1 - P.y / h, 0.1, 1) : r) + 6;
  const dx = P.x - ox, dz = P.z - oz, d2 = dx * dx + dz * dz;
  if (d2 > rr * rr) return false;
  const d = Math.sqrt(d2) || 1;
  P.x = ox + dx / d * rr; P.z = oz + dz / d * rr;
  return true;
}
function collideSolids() {
  let hit = false;
  const cx = Math.floor(P.x / SC), cz = Math.floor(P.z / SC);
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const o = sceneryAt(cx + i, cz + j);
    if (o && o.r > 0 && solidHit(o.x, o.z, o.r, o.h, o.taper)) hit = true;
  }
  for (const e of enemies) {
    if (!e.dead && e.type === 'spire' && solidHit(e.x, e.z, 22, 160, false)) hit = true;
  }
  if (hit && P.scrapeCd <= 0) {
    P.scrapeCd = 0.5;
    hurt(12);
    Sfx.scrape();
    sparksAt(P.x + BZ[0] * 12, P.y, P.z + BZ[2] * 12, 14, COL.white, 160, P.vx, P.vy, P.vz);
  }
}

/* ---------------- player ---------------- */
function stickCurve(v) {
  const a = Math.abs(v);
  return a < 0.06 ? 0 : Math.sign(v) * Math.min(1, (a - 0.06) / 0.6);
}
function updatePlayer(dt) {
  const rift = G.scene === 'rift', inv = G.invert ? -1 : 1;
  P.px = P.x; P.py = P.y; P.pz = P.z;

  // steering: keyboard rate + mouse-look (locked) or mouse-position stick (unlocked)
  let ky = 0, kp = 0;
  if (keys.ArrowLeft || keys.KeyA) ky -= 1;
  if (keys.ArrowRight || keys.KeyD) ky += 1;
  if (keys.ArrowUp) kp += 1;
  if (keys.ArrowDown) kp -= 1;
  P.kyaw = lerp(P.kyaw, ky, damp(9, dt));
  P.kpitch = lerp(P.kpitch, kp, damp(9, dt));
  let dyaw = P.kyaw * 1.7 * dt, dpitch = P.kpitch * 1.3 * inv * dt;
  if (mouse.locked) {
    dyaw += mouse.dx * SENS;
    dpitch -= mouse.dy * SENS * inv;
  } else if (mouse.moved) {
    dyaw += stickCurve((mouse.x - 0.5) * 2) * 1.9 * dt;
    dpitch -= stickCurve((mouse.y - 0.45) * 2) * 1.4 * inv * dt;
  }
  dyaw = clamp(dyaw, -3 * dt, 3 * dt);
  dpitch = clamp(dpitch, -2.4 * dt, 2.4 * dt);
  P.yaw += dyaw;
  P.pitch += dpitch;
  if (rift) { P.yaw = clamp(P.yaw, -0.55, 0.55); P.pitch = clamp(P.pitch, -0.5, 0.5); }
  else P.pitch = clamp(P.pitch, -1.25, 1.25);
  P.yawRate = lerp(P.yawRate, dyaw / Math.max(dt, 1e-3), damp(8, dt));
  P.roll = lerp(P.roll, clamp(-P.yawRate * 0.22, -0.5, 0.5), damp(6, dt));

  // throttle
  const smin = rift ? 150 : 90, smax = rift ? 300 : 340;
  P.throttle = clamp(P.throttle + ((keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0)) * 170 * dt, smin, smax);
  P.speed = lerp(P.speed, P.throttle, damp(2.2, dt));

  basis();
  P.vx = BZ[0] * P.speed; P.vy = BZ[1] * P.speed; P.vz = BZ[2] * P.speed;
  P.x += P.vx * dt; P.y += P.vy * dt; P.z += P.vz * dt;

  // world limits
  let scrape = false;
  if (rift) {
    const m = 12;
    if (P.x < -RW + m) { P.x = -RW + m; P.yaw = Math.max(P.yaw, 0.04); scrape = true; }
    if (P.x > RW - m) { P.x = RW - m; P.yaw = Math.min(P.yaw, -0.04); scrape = true; }
    if (P.y < m) { P.y = m; P.pitch = Math.max(P.pitch, 0.04); scrape = true; }
    if (P.y > RH - m) { P.y = RH - m; P.pitch = Math.min(P.pitch, -0.04); scrape = true; }
  } else {
    if (P.y < 10) { P.y = 10; if (P.pitch < -0.12) scrape = true; P.pitch = Math.max(P.pitch, Math.abs(P.pitch) * 0.25); }
    if (P.y > 900) { P.y = 900; P.pitch = Math.min(P.pitch, lerp(P.pitch, 0, damp(4, dt))); }
  }
  if (scrape && P.scrapeCd <= 0) {
    P.scrapeCd = 0.45;
    hurt(6);
    Sfx.scrape();
    sparksAt(P.x + BZ[0] * 15, P.y - 6, P.z + BZ[2] * 15, 10, COL.white, 120, P.vx, P.vy, P.vz);
  }

  P.inv = Math.max(0, P.inv - dt);
  P.scrapeCd = Math.max(0, P.scrapeCd - dt);
  P.fireCd = Math.max(0, P.fireCd - dt);
  P.energy = Math.min(100, P.energy + 22 * dt);
}

/* ---------------- per-state updates ---------------- */
function updatePlay(dt) {
  if (pressed.KeyP) setPause(!G.paused);
  else if (pressed.Escape && !G.paused) setPause(true);
  else if (G.paused && (mouse.click || pressed.Enter)) setPause(false);
  if (G.paused) return;
  if (mouse.click && !mouse.locked) requestLock();
  G.stateT += dt;

  if (G.warp) {
    const w = G.warp;
    w.t += dt;
    if (!w.done && w.t >= w.dur / 2) { w.done = true; w.mid(); }
    if (w.t >= w.dur) G.warp = null;
    updateParticles(dt);
    Sfx.engine(1, true);
    return;
  }

  updatePlayer(dt);
  setCamera(P.x, P.y, P.z, P.yaw, P.pitch, P.roll);
  P.lock = findTarget(ASSIST, false);
  if ((keys.Space || mouse.b0) && P.fireCd <= 0 && P.energy >= 3.5 && G.phase !== 'tally') fireLaser();
  if (pressed.KeyF || mouse.rclick) fireMissile();

  if (G.scene === 'surface') {
    G.spawnT -= dt;
    const cap = G.phase === 'hunt' ? Math.min(3 + G.sector, 8) : 2;
    if (G.spawnT <= 0 && enemies.length < cap) {
      spawnEnemy();
      G.spawnT = rand(1.2, 2.4) * (1 - 0.3 * D());
    }
    collideSolids();
    if (G.gate) updateGate(dt);
  } else if (G.rift) {
    updateRift(dt);
  }

  updateEnemies(dt);
  updateBolts(dt);
  updateMissiles(dt);
  updatePickups(dt);
  updateParticles(dt);
  if (G.tally) updateTally(dt);
  prune(enemies); prune(ebolts); prune(pbolts); prune(missiles); prune(pickups);
  prune(debris); prune(sparks); prune(rings); prune(floaters);

  if (P.alive && P.shield <= 25) {
    G.lowT -= dt;
    if (G.lowT <= 0) { G.lowT = 0.9; Sfx.warn(); }
  }
  Sfx.engine((P.speed - 90) / 250, P.alive);
}
function updateDying(dt) {
  G.stateT += dt;
  P.px = P.x; P.py = P.y; P.pz = P.z;
  P.pitch = lerp(P.pitch, -0.3, damp(0.8, dt));
  P.roll += dt * 0.7;
  P.speed = lerp(P.speed, 40, damp(1, dt));
  basis();
  P.vx = BZ[0] * P.speed; P.vy = BZ[1] * P.speed; P.vz = BZ[2] * P.speed;
  P.x += P.vx * dt; P.z += P.vz * dt;
  P.y = Math.max(8, P.y + P.vy * dt);
  if (G.scene === 'rift') { P.x = clamp(P.x, -RW + 12, RW - 12); P.y = clamp(P.y, 12, RH - 12); }
  if (G.stateT < 1.6 && rand() < dt * 6) {
    blastAt(P.x + BZ[0] * 40 + rand(-25, 25), P.y + rand(-15, 15), P.z + BZ[2] * 40 + rand(-25, 25), rand(0.6, 1.2), pick([AMBER, RED, COL.white]), P.vx, P.vy, P.vz);
  }
  updateEnemies(dt); updateBolts(dt); updateMissiles(dt); updateParticles(dt);
  prune(enemies); prune(ebolts); prune(pbolts); prune(missiles);
  prune(debris); prune(sparks); prune(rings); prune(floaters);
  if (G.stateT > 3.2) { G.state = 'gameover'; G.stateT = 0; releaseLock(); }
}
function drift(dt) {
  P.px = P.x; P.py = P.y; P.pz = P.z;
  P.roll = lerp(P.roll, 0, damp(1, dt));
  P.pitch = lerp(P.pitch, 0, damp(1, dt));
  P.x += Math.sin(P.yaw) * 40 * dt; P.z += Math.cos(P.yaw) * 40 * dt;
  updateParticles(dt);
  prune(debris); prune(sparks); prune(rings); prune(floaters);
}
function updateGameOver(dt) {
  G.stateT += dt;
  drift(dt);
  if ((G.stateT > 1.2 && (pressed.Enter || pressed.Space || mouse.click)) || G.stateT > 9) {
    let rank = G.hi.findIndex((r) => G.score > r.s);
    if (rank < 0 && G.hi.length < 5) rank = G.hi.length;
    if (rank >= 0 && G.score > 0) { G.state = 'initials'; G.stateT = 0; G.initials = ''; G.rank = rank; }
    else toTitle();
  }
}
function commitInitials() {
  const n = (G.initials || 'AAA').padEnd(3, ' ');
  G.hi.splice(G.rank, 0, { n, s: G.score, k: G.sector });
  G.hi.length = Math.min(G.hi.length, 5);
  saveAll();
  Sfx.pickup();
  toTitle();
}
function updateInitials(dt) {
  G.stateT += dt;
  drift(dt);
  for (const k of typed) {
    if (k === 'Backspace') G.initials = G.initials.slice(0, -1);
    else if (k === 'Enter') { if (G.initials.length) { commitInitials(); return; } }
    else if (/^[a-zA-Z0-9]$/.test(k) && G.initials.length < 3) { G.initials += k.toUpperCase(); Sfx.blip(); }
  }
  if (mouse.touch && mouse.click && G.stateT > 1) commitInitials();   // no keyboard on touch
}
function updateTitle(dt) {
  G.stateT += dt;
  // attract mode: a lazy weave over the grid
  const w = Math.sin(G.t * 0.13) * 0.16;
  P.yaw += w * dt;
  P.roll = -w * 1.4;
  P.pitch = Math.sin(G.t * 0.21) * 0.04 - 0.02;
  P.y = 115 + Math.sin(G.t * 0.3) * 40;
  P.x += Math.sin(P.yaw) * 170 * dt; P.z += Math.cos(P.yaw) * 170 * dt;
  if (G.stateT > 0.4 && (pressed.Enter || pressed.Space || mouse.click)) startGame();
}
function update(dt) {
  if (G.state !== 'initials') {
    if (pressed.KeyN) {
      Sfx.init();
      note('SOUND: ' + ['ALL', 'EFFECTS ONLY', 'MUTED'][Sfx.cycleMode()], HUD, 1.5);
      saveAll();
    }
    if (pressed.KeyI) { G.invert = !G.invert; note('PITCH: ' + (G.invert ? 'INVERTED' : 'NORMAL'), HUD, 1.5); saveAll(); }
    if (pressed.KeyC) { G.crt = !G.crt; document.body.classList.toggle('nocrt', !G.crt); saveAll(); }
  }
  switch (G.state) {
    case 'title': updateTitle(dt); break;
    case 'play': updatePlay(dt); break;
    case 'dying': updateDying(dt); break;
    case 'gameover': updateGameOver(dt); break;
    case 'initials': updateInitials(dt); break;
  }
  const frozen = G.state === 'play' && G.paused;
  if (!frozen) {
    G.shake = Math.max(0, G.shake - dt * 2.2);
    G.flash = Math.max(0, G.flash - dt * 1.6);
    G.hurt = Math.max(0, G.hurt - dt * 2.5);
    G.good = Math.max(0, G.good - dt * 2.5);
    if (G.banner && (G.banner.t += dt) > G.banner.dur) G.banner = null;
    if (G.note && (G.note.t += dt) > G.note.dur) G.note = null;
  }
}

/* ============================================================
   RENDERING
   ============================================================ */

/* ---- sky ---- */
const STARS = [];
for (let i = 0; i < 180; i++) {
  const y = rand(0.02, 1), a = rand(TAU), r = Math.sqrt(1 - y * y);
  STARS.push({ x: Math.cos(a) * r, y, z: Math.sin(a) * r, b: rand(0.3, 1), s: rand(0.7, 1.7), tw: rand(1, 4), ph: rand(TAU) });
}
const RN = 120;
const RIDGE = new Float32Array((RN + 1) * 3), HORIZ = new Float32Array((RN + 1) * 3), rcam = new Float32Array((RN + 1) * 3);
function buildRidge(seed) {
  for (let i = 0; i <= RN; i++) {
    const k = i % RN, a = (k / RN) * TAU;
    const h = 0.008 + 0.085 * Math.abs(Math.sin(a * 2 + seed) * Math.sin(a * 5 + seed * 2.3)) * (0.4 + 0.9 * hash2(k, seed, 77));
    RIDGE[i * 3] = HORIZ[i * 3] = Math.sin(a) * 1000;
    RIDGE[i * 3 + 1] = h * 1000; HORIZ[i * 3 + 1] = 0;
    RIDGE[i * 3 + 2] = HORIZ[i * 3 + 2] = Math.cos(a) * 1000;
  }
}
buildRidge(1);
const SUN = (() => { const l = Math.hypot(0.3, 0.2, 1); return [0.3 / l, 0.2 / l, 1 / l]; })();

function drawSky(p) {
  // stars
  ctx.fillStyle = '#ffffff';
  for (const s of STARS) {
    const c = dirToCam(s.x, s.y, s.z);
    if (c[2] < 0.05) continue;
    const sx = V.cx + c[0] / c[2] * V.F, sy = V.cy - c[1] / c[2] * V.F;
    if (sx < 0 || sx > V.W || sy < 0 || sy > V.H) continue;
    const r = s.s * V.U;
    ctx.globalAlpha = s.b * (0.65 + 0.35 * Math.sin(G.t * s.tw + s.ph));
    ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
  }
  ctx.globalAlpha = 1;
  // striped sun
  const c = dirToCam(SUN[0], SUN[1], SUN[2]);
  if (c[2] > 0.15) {
    const sx = V.cx + c[0] / c[2] * V.F, sy = V.cy - c[1] / c[2] * V.F, r = 0.105 * V.F;
    if (sx > -r && sx < V.W + r && sy > -r && sy < V.H + r) {
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(cam.roll);
      pen.beginPath();
      pen.arc(0, 0, r, Math.PI, TAU);
      glow(p.sun, 1.4, 0.95);
      pen.beginPath();
      for (const y of [0, 0.2, 0.38, 0.54, 0.68, 0.8, 0.9, 0.97]) {
        const hw = Math.sqrt(1 - y * y) * r;
        pen.moveTo(-hw, y * r); pen.lineTo(hw, y * r);
      }
      glow(p.sun2, 1.3, 0.9);
      ctx.restore();
    }
  }
  // mountains + horizon, both at infinity
  for (let pass = 0; pass < 2; pass++) {
    const arr = pass ? HORIZ : RIDGE;
    for (let i = 0; i <= RN; i++) {
      const q = dirToCam(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]);
      rcam[i * 3] = q[0]; rcam[i * 3 + 1] = q[1]; rcam[i * 3 + 2] = q[2];
    }
    pen.beginPath();
    for (let i = 0; i < RN; i++) {
      const a = i * 3;
      lineC(rcam[a], rcam[a + 1], rcam[a + 2], rcam[a + 3], rcam[a + 4], rcam[a + 5]);
    }
    if (pass) glow(p.grid, 1.4, 1); else glow(p.ridge, 1.1, 0.85);
  }
}

/* ---- ground ---- */
const gbuf = new Float32Array(GP * GP * 3);
const gbandH = new Int8Array(GP * GP), gbandV = new Int8Array(GP * GP);
const GRID_W = [1.3, 1.1, 1, 0.9], GRID_A = [0.85, 0.52, 0.28, 0.12];
const gridBand = (wx, wz, maxD) => {
  const d = Math.sqrt(wx * wx + wz * wz) / maxD;
  return d < 0.25 ? 0 : d < 0.5 ? 1 : d < 0.75 ? 2 : d < 1 ? 3 : 4;
};
function gridLine(a, b) {
  a *= 3; b *= 3;
  lineC(gbuf[a], gbuf[a + 1], gbuf[a + 2], gbuf[b], gbuf[b + 1], gbuf[b + 2]);
}
/** Ground grid, faded in four distance bands. Collinear cells in the same band are merged into one stroke. */
function drawGrid(p) {
  const gx0 = Math.floor(cam.x / GS) - GN, gz0 = Math.floor(cam.z / GS) - GN, maxD = GN * GS;
  let n = 0;
  for (let j = 0; j < GP; j++) for (let i = 0; i < GP; i++) {
    const wx = (gx0 + i) * GS, wz = (gz0 + j) * GS;
    const c = toCam(wx, 0, wz);
    gbuf[n * 3] = c[0]; gbuf[n * 3 + 1] = c[1]; gbuf[n * 3 + 2] = c[2];
    gbandH[n] = gridBand(wx + GS / 2 - cam.x, wz - cam.z, maxD);     // segment toward +x
    gbandV[n] = gridBand(wx - cam.x, wz + GS / 2 - cam.z, maxD);     // segment toward +z
    n++;
  }
  for (let band = 0; band < 4; band++) {
    pen.beginPath();
    for (let j = 0; j < GP; j++) {
      let s = -1;
      for (let i = 0; i < GP; i++) {
        const k = j * GP + i, inBand = i < GP - 1 && gbandH[k] === band;
        if (inBand && s < 0) s = k;
        else if (!inBand && s >= 0) { gridLine(s, k); s = -1; }
      }
    }
    for (let i = 0; i < GP; i++) {
      let s = -1;
      for (let j = 0; j < GP; j++) {
        const k = j * GP + i, inBand = j < GP - 1 && gbandV[k] === band;
        if (inBand && s < 0) s = k;
        else if (!inBand && s >= 0) { gridLine(s, k); s = -1; }
      }
    }
    glow(p.grid, GRID_W[band], GRID_A[band]);
  }
}
function drawScenery(p) {
  const cx = Math.floor(cam.x / SC), cz = Math.floor(cam.z / SC);
  for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) {
    const o = sceneryAt(cx + i, cz + j);
    if (!o) continue;
    const d = Math.hypot(o.x - cam.x, o.z - cam.z);
    if (d > 2900) continue;
    drawEnt(o.m, o.x, 0, o.z, o.yaw, 0, 0, o.s, p.deco, 1, clamp(1.25 - d / 2500, 0.08, 0.8));
  }
}
function drawGate(p) {
  const g = G.gate, pulse = 0.7 + 0.3 * Math.sin(g.t * 6);
  drawEnt(M.gate, g.x, g.y, g.z, g.yaw, 0, g.t * 0.5, 1, COL.white, 1.7, pulse, true);
  drawEnt(M.gateInner, g.x, g.y, g.z, g.yaw, 0, -g.t * 1.3, 1 + 0.08 * Math.sin(g.t * 3), p.sun, 1.3, 0.8);
  const rx = g.nz * 128, rz = -g.nx * 128;
  pen.beginPath();
  lineW(g.x + rx, g.y, g.z + rz, g.x + rx * 1.15, 0, g.z + rz * 1.15);
  lineW(g.x - rx, g.y, g.z - rz, g.x - rx * 1.15, 0, g.z - rz * 1.15);
  lineW(g.x, g.y + 128, g.z, g.x, 2600, g.z);                  // beacon
  glow(COL.white, 1.2, 0.55 * pulse);
}
function drawSurface() {
  const p = pal();
  drawSky(p);
  drawGrid(p);
  drawScenery(p);
  if (G.gate) drawGate(p);
}

/* ---- rift ---- */
const RIFT_SEC = [[-(RW - RC), 0], [RW - RC, 0], [RW, RC], [RW, RH - RC], [RW - RC, RH], [-(RW - RC), RH], [-RW, RH - RC], [-RW, RC]];
const ringA = new Float32Array(24), ringB = new Float32Array(24);
function ringCam(z, out) {
  for (let i = 0; i < 8; i++) {
    const c = toCam(RIFT_SEC[i][0], RIFT_SEC[i][1], z);
    out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2];
  }
}
function drawRift() {
  const p = pal(), step = 100, N = 28;
  const k0 = Math.floor(cam.z / step);
  let A = ringA, B = ringB;
  ringCam(k0 * step, A);
  for (let i = 0; i < N; i++) {
    const k = k0 + i + 1;
    ringCam(k * step, B);
    const a = Math.pow(1 - i / N, 1.4) * (0.72 + 0.28 * Math.sin(k * 0.8 - G.t * 7));
    const accent = k % 5 === 0;
    pen.beginPath();
    for (let j = 0; j < 8; j++) {
      const a3 = j * 3, b3 = ((j + 1) % 8) * 3;
      lineC(B[a3], B[a3 + 1], B[a3 + 2], B[b3], B[b3 + 1], B[b3 + 2]);       // hoop
      lineC(A[a3], A[a3 + 1], A[a3 + 2], B[a3], B[a3 + 1], B[a3 + 2]);       // stringer
    }
    glow(accent ? p.ridge : p.grid, accent ? 1.4 : 1, a);
    const t = A; A = B; B = t;
  }
  if (!G.rift) return;
  for (const b of G.rift.barriers) {
    const dz = b.z - cam.z;
    if (b.hit || dz < 2 || dz > 2700) continue;
    pen.beginPath();
    for (const r of b.rects) {
      lineW(r[0], r[1], b.z, r[2], r[1], b.z); lineW(r[2], r[1], b.z, r[2], r[3], b.z);
      lineW(r[2], r[3], b.z, r[0], r[3], b.z); lineW(r[0], r[3], b.z, r[0], r[1], b.z);
      lineW(r[0], r[1], b.z, r[2], r[3], b.z); lineW(r[0], r[3], b.z, r[2], r[1], b.z);
    }
    glow(COL.barrier, 1.8, clamp(1.15 - dz / 2700, 0, 1) * (0.8 + 0.2 * Math.sin(G.t * 10)), dz < 900);
  }
}

/* ---- things ---- */
function drawEntities() {
  const p = pal();
  for (const e of enemies) {
    if (e.dead) continue;
    const T = e.T, d = Math.hypot(e.x - cam.x, e.y - cam.y, e.z - cam.z);
    const a = clamp((3600 - d) / 700, 0, 1);
    if (a <= 0) continue;
    const col = e.flash > 0 ? COL.white : T.color;
    switch (e.type) {
      case 'spire':
        drawEnt(T.model, e.x, 0, e.z, e.yaw, 0, 0, T.scale, col, 1.2, a);
        drawEnt(M.crystal, e.x, 140, e.z, e.age * 2, 0, 0, 15, COL.white, 1.3, a * (0.7 + 0.3 * Math.sin(e.age * 9)), true);
        break;
      case 'wisp':
        drawEnt(T.model, e.x, e.y, e.z, e.age * 2.2, e.age * 1.3, 0, T.scale * (1 + 0.12 * Math.sin(e.age * 8)), col, 1.2, a, true);
        break;
      case 'core': {
        const hp = e.hp / e.maxHp;
        const c2 = e.flash > 0 ? COL.white : (hp < 0.5 && ((G.t * 8) | 0) & 1) ? '#ff6a2e' : T.color;
        drawEnt(M.ico, e.x, e.y, e.z, e.age * 0.9, e.age * 0.6, 0, T.scale, c2, 1.8, 1, true);
        drawEnt(M.cube, e.x, e.y, e.z, -e.age * 0.5, e.age * 0.35, e.age * 0.2, 36, p.grid, 1.2, 0.8);
        drawEnt(M.octa, e.x, e.y, e.z, e.age * 3, e.age * 2, 0, 14 + 4 * Math.sin(e.age * 10), COL.white, 1.4, 1, true);
        break;
      }
      default:
        drawEnt(T.model, e.x, e.y, e.z, e.yaw, e.pitch, e.roll, T.scale, col, 1.3, a, e.type === 'hunter');
    }
  }
  if (pbolts.length) {
    pen.beginPath();
    for (const b of pbolts) lineW(b.x, b.y, b.z, b.x - b.vx * 0.03, b.y - b.vy * 0.03, b.z - b.vz * 0.03);
    glow(COL.laser, 2.2, 1, true);
  }
  if (ebolts.length) {
    pen.beginPath();
    for (const b of ebolts) drawModel(M.star, b.x, b.y, b.z, b.spin, b.spin * 0.7, b.spin * 1.3, 10);
    glow(((G.t * 14) | 0) & 1 ? '#ffd24d' : '#ff6a2e', 1.5, 1, true);
  }
  for (const m of missiles) {
    drawEnt(M.missile, m.x, m.y, m.z, Math.atan2(m.dx, m.dz), Math.asin(clamp(m.dy, -1, 1)), m.life * 9, 1.6, COL.white, 1.4, 1, true);
  }
  for (const c of pickups) {
    drawEnt(M.crystal, c.x, c.y, c.z, c.age * 4, 0, 0, 7 + Math.sin(c.age * 8), COL.cell, 1.4, clamp(c.life, 0, 1), true);
  }
}
function drawParticles() {
  for (const d of debris) {
    pen.beginPath();
    lineW(d.x - d.hx, d.y - d.hy, d.z - d.hz, d.x + d.hx, d.y + d.hy, d.z + d.hz);
    glow(d.color, 1, clamp(d.life / d.max * 1.8, 0, 1));
  }
  for (const s of sparks) {
    pen.beginPath();
    lineW(s.x, s.y, s.z, s.x - s.vx * 0.05, s.y - s.vy * 0.05, s.z - s.vz * 0.05);
    glow(s.color, 1, clamp(s.life / s.max * 1.5, 0, 1));
  }
  for (const r of rings) {
    const q = project(r.x, r.y, r.z);
    if (!q.ok) continue;
    const rad = r.r / q.z * V.F;
    if (rad > 2500) continue;
    pen.beginPath();
    pen.arc(q.x, q.y, rad, 0, TAU);
    glow(r.color, 1.2, r.life / r.max);
  }
  for (const f of floaters) {
    const q = project(f.x, f.y, f.z);
    if (q.ok) label(f.text, q.x, q.y, 12 * V.U, AMBER, 0.5, clamp(f.life * 2, 0, 1));
  }
}
function drawWarp() {
  const w = G.warp, k = w.t / w.dur, inten = Math.sin(k * Math.PI);
  const maxR = Math.hypot(V.W, V.H) * 0.6;
  pen.beginPath();
  for (let i = 0; i < 90; i++) {
    const a = i * 2.39996, ph = hash2(i, 7, 3);
    const rr = (G.t * (1.2 + ph) + ph * 5) % 1;
    const r0 = rr * rr * maxR + 12 * V.U, r1 = r0 + inten * maxR * 0.4 * (0.25 + rr);
    pen.moveTo(V.bx + Math.cos(a) * r0, V.by + Math.sin(a) * r0);
    pen.lineTo(V.bx + Math.cos(a) * r1, V.by + Math.sin(a) * r1);
  }
  glow('#bfeaff', 1.2, inten);
  const f = Math.max(0, 1 - Math.abs(k - 0.5) * 5);
  if (f > 0) {
    ctx.globalAlpha = f;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, V.W, V.H);
    ctx.globalAlpha = 1;
  }
}

/* ---- HUD ---- */
function bar(x, y, w, h, frac, color, segs = 12) {
  pen.beginPath();
  pen.rect(x, y, w, h);
  glow(color, 0.8, 0.55);
  const n = Math.round(clamp(frac, 0, 1) * segs), sw = w / segs;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.85;
  for (let i = 0; i < n; i++) ctx.fillRect(x + i * sw + sw * 0.16, y + h * 0.22, sw * 0.68, h * 0.56);
  ctx.globalAlpha = 1;
}
/** Marker on a world position; becomes an edge arrow when it's off-screen. */
function drawPointer(wx, wy, wz, color, lbl, a) {
  const U = V.U, c = toCam(wx, wy, wz), x = c[0], y = c[1], z = c[2];
  const dist = Math.hypot(wx - P.x, wy - P.y, wz - P.z);
  if (z > NEAR) {
    const sx = V.cx + x / z * V.F, sy = V.cy - y / z * V.F;
    if (sx > 30 * U && sx < V.W - 30 * U && sy > 30 * U && sy < V.H - 165 * U) {
      const s = 9 * U;
      pen.beginPath();
      pen.moveTo(sx, sy - s); pen.lineTo(sx + s, sy); pen.lineTo(sx, sy + s); pen.lineTo(sx - s, sy); pen.closePath();
      glow(color, 1.1, a);
      if (lbl) label(lbl + ' ' + Math.round(dist), sx, sy + s + 6 * U, 9 * U, color, 0.5, a);
      return;
    }
  }
  const ang = Math.atan2(-y, x || 1e-6);
  const R = Math.min(V.W * 0.42, V.H * 0.33);
  const ax = V.bx + Math.cos(ang) * R, ay = V.by + Math.sin(ang) * R;
  const s = 13 * U, ca = Math.cos(ang), sa = Math.sin(ang);
  pen.beginPath();
  pen.moveTo(ax - ca * s - sa * s * 0.7, ay - sa * s + ca * s * 0.7);
  pen.lineTo(ax, ay);
  pen.lineTo(ax - ca * s + sa * s * 0.7, ay - sa * s - ca * s * 0.7);
  glow(color, 1.5, a);
  if (lbl) label(lbl, ax - ca * s * 2.6, ay - sa * s * 2.6 - 5 * U, 9 * U, color, 0.5, a);
}
function drawRadar(cx, cy, r) {
  pen.beginPath();
  pen.arc(cx, cy, r, 0, TAU);
  pen.moveTo(cx + r * 0.5, cy);
  pen.arc(cx, cy, r * 0.5, 0, TAU);
  pen.moveTo(cx - r, cy); pen.lineTo(cx + r, cy);
  pen.moveTo(cx, cy - r); pen.lineTo(cx, cy + r);
  glow(HUD, 0.8, 0.45);
  const sw = G.t * 2.4;
  pen.beginPath();
  pen.moveTo(cx, cy); pen.lineTo(cx + Math.cos(sw) * r, cy + Math.sin(sw) * r);
  glow(HUD, 1, 0.3);
  const range = G.scene === 'rift' ? 1600 : 3000, U = V.U;
  const cyw = Math.cos(P.yaw), syw = Math.sin(P.yaw);
  const blip = (wx, wz, color, size) => {
    const dx = wx - P.x, dz = wz - P.z;
    let rx = dx * cyw - dz * syw, rz = dx * syw + dz * cyw;
    const d = Math.hypot(rx, rz) / range;
    if (d > 1) { rx /= d; rz /= d; }
    ctx.fillStyle = color;
    ctx.fillRect(cx + rx / range * r - size / 2, cy - rz / range * r - size / 2, size, size);
  };
  if (G.scene === 'rift' && G.rift) {
    pen.beginPath();
    for (const b of G.rift.barriers) {
      const dz = b.z - P.z;
      if (b.passed || dz > range || dz < 0) continue;
      const y = cy - dz / range * r, hw = Math.sqrt(Math.max(0, r * r - (y - cy) * (y - cy))) * 0.5;
      pen.moveTo(cx - hw, y); pen.lineTo(cx + hw, y);
    }
    glow(COL.barrier, 1, 0.8);
  }
  for (const e of enemies) if (!e.dead) blip(e.x, e.z, e.T.color, (e.type === 'core' ? 7 : 4) * U);
  ctx.globalAlpha = 0.8;
  for (const b of ebolts) blip(b.x, b.z, '#ffffff', 2 * U);
  for (const c of pickups) blip(c.x, c.z, COL.cell, 3 * U);
  ctx.globalAlpha = 1;
  if (G.gate && ((G.t * 4) | 0) & 1) blip(G.gate.x, G.gate.z, '#ffffff', 7 * U);
  pen.beginPath();
  pen.moveTo(cx, cy - 5 * U); pen.lineTo(cx + 4 * U, cy + 4 * U); pen.lineTo(cx - 4 * U, cy + 4 * U); pen.closePath();
  glow('#ffffff', 1, 0.9);
}
function drawCockpit() {
  const U = V.U, W = V.W, H = V.H, cx = W / 2, hw = 250 * U;
  const pts = [[0, H - 62 * U], [cx - hw - 72 * U, H - 62 * U], [cx - hw, H - 152 * U], [cx + hw, H - 152 * U], [cx + hw + 72 * U, H - 62 * U], [W, H - 62 * U]];
  // opaque console so the world doesn't show through
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, pts[0][1], W, H - pts[0][1] + 1);
  ctx.beginPath();
  ctx.moveTo(pts[1][0], pts[1][1] + 1);
  for (let i = 2; i <= 4; i++) ctx.lineTo(pts[i][0], pts[i][1] + (i === 4 ? 1 : 0));
  ctx.closePath();
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  pen.beginPath();
  pen.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) pen.lineTo(pts[i][0], pts[i][1]);
  glow(HUD, 1.4, 0.9);
  // canopy struts
  pen.beginPath();
  pen.moveTo(0, H * 0.2); pen.lineTo(W * 0.1, 0);
  pen.moveTo(W, H * 0.2); pen.lineTo(W * 0.9, 0);
  pen.moveTo(cx - hw, H - 152 * U); pen.lineTo(cx - hw - 14 * U, H - 170 * U);
  pen.moveTo(cx + hw, H - 152 * U); pen.lineTo(cx + hw + 14 * U, H - 170 * U);
  glow(HUD, 1, 0.3);

  drawRadar(cx, H - 78 * U, 62 * U);

  // left block: shield / energy / missiles
  const lx = cx - hw + 14 * U, bw = 150 * U;
  const low = P.shield <= 25, sc = low ? RED : P.shield <= 50 ? AMBER : HUD;
  label('SHIELD', lx, H - 138 * U, 9 * U, sc, 0, low && ((G.t * 5) | 0) & 1 ? 0.4 : 0.9);
  bar(lx, H - 124 * U, bw, 14 * U, P.shield / 100, sc);
  label('ENERGY', lx, H - 100 * U, 9 * U, HUD, 0, 0.9);
  bar(lx, H - 86 * U, bw, 14 * U, P.energy / 100, P.energy < 15 ? AMBER : COL.laser);
  label('MISSILES', lx, H - 62 * U, 9 * U, HUD, 0, 0.9);
  pen.beginPath();
  for (let i = 0; i < 4; i++) {
    const mx = lx + 8 * U + i * 22 * U, my = H - 46 * U;
    if (i < P.missiles) {
      pen.moveTo(mx - 6 * U, my + 16 * U); pen.lineTo(mx, my); pen.lineTo(mx + 6 * U, my + 16 * U); pen.closePath();
    } else {
      pen.moveTo(mx - 4 * U, my + 16 * U); pen.lineTo(mx + 4 * U, my + 16 * U);
    }
  }
  glow(AMBER, 1, 0.9);

  // right block: speed / altitude / heading
  const rx = cx + 86 * U;
  label('SPEED', rx, H - 138 * U, 9 * U, HUD, 0, 0.9);
  label(pad(P.speed, 3), rx + bw, H - 138 * U, 9 * U, HUD, 1, 0.9);
  bar(rx, H - 124 * U, bw, 14 * U, (P.speed - 60) / 280, HUD);
  label('ALT', rx, H - 100 * U, 9 * U, HUD, 0, 0.9);
  label(pad(P.y, 3), rx + bw, H - 100 * U, 9 * U, HUD, 1, 0.9);
  bar(rx, H - 86 * U, bw, 14 * U, G.scene === 'rift' ? P.y / RH : P.y / 900, AMBER);
  const hdg = (((P.yaw * 180 / Math.PI) % 360) + 360) % 360;
  label('HDG ' + pad(hdg, 3), rx, H - 58 * U, 11 * U, HUD, 0, 0.9);
  if (!mouse.locked && !mouse.touch) label('STICK', rx + bw, H - 58 * U, 9 * U, AMBER, 1, 0.7);

  // side strips
  label('SECTOR ' + pad(G.sector, 2) + ' ' + pal().name, 16 * U, H - 40 * U, 11 * U, HUD, 0, 0.9);
  let st, stc = HUD;
  if (G.phase === 'hunt') st = 'HOSTILES ' + pad(G.kills, 2) + '/' + pad(G.quota, 2);
  else if (G.phase === 'gate') { st = 'GATE OPEN'; stc = '#ffffff'; }
  else if (G.phase === 'rift') st = 'RIFT ' + Math.round(clamp(P.z / G.rift.len, 0, 1) * 100) + '%';
  else if (G.phase === 'boss') { st = 'CORE'; stc = COL.core; }
  else st = 'SECTOR CLEAR';
  label(st, W - 16 * U, H - 40 * U, 11 * U, stc, 1, 0.9);
  if (G.boss) bar(W - 16 * U - 170 * U, H - 22 * U, 170 * U, 10 * U, G.boss.hp / G.boss.maxHp, COL.core, 20);
}
function drawBanner() {
  const b = G.banner;
  if (!b) return;
  const U = V.U, cx = V.W / 2, y = V.H * 0.2;
  const a = clamp((b.dur - b.t) / 0.6, 0, 1);
  const n = Math.floor(b.t * 28);
  const S = Math.min(40 * U, V.W * 0.8 / Math.max(8, b.title.length));
  const t1 = b.title.slice(0, n);
  chroma(t1, cx - textWidth(b.title, S) / 2, y, S, 0, a, 2);
  const m = n - b.title.length - 6;
  if (m > 0 && b.sub) {
    const s2 = Math.min(15 * U, V.W * 0.9 / b.sub.length);
    label(b.sub.slice(0, m), cx - textWidth(b.sub, s2) / 2, y + S * 1.5, s2, AMBER, 0, a, 1);
  }
}
function drawHUD() {
  const U = V.U, W = V.W, H = V.H, cx = W / 2;
  if (P.alive) {
    // crosshair
    const x = V.cx, y = V.cy, g = 7 * U, l = 20 * U;
    pen.beginPath();
    pen.moveTo(x - l, y); pen.lineTo(x - g, y); pen.moveTo(x + g, y); pen.lineTo(x + l, y);
    pen.moveTo(x, y - l); pen.lineTo(x, y - g); pen.moveTo(x, y + g); pen.lineTo(x, y + l);
    glow(HUD, 1, 0.85);
    if (!mouse.locked && mouse.moved && !mouse.touch) {     // stick-mode cursor
      const mx = mouse.x * W, my = mouse.y * H;
      pen.beginPath();
      pen.moveTo(x, y); pen.lineTo(mx, my);
      pen.moveTo(mx + 5 * U, my); pen.arc(mx, my, 5 * U, 0, TAU);
      glow(AMBER, 0.8, 0.35);
    }
    // target brackets
    const L = P.lock;
    if (L) {
      const q = project(L.x, L.y, L.z);
      if (q.ok) {
        const s = Math.max(15 * U, L.r / q.z * V.F * 1.25), k = s * 0.4;
        pen.beginPath();
        for (let i = 0; i < 4; i++) {
          const sx = i === 0 || i === 3 ? -1 : 1, sy = i < 2 ? -1 : 1;
          pen.moveTo(q.x + sx * s, q.y + sy * (s - k));
          pen.lineTo(q.x + sx * s, q.y + sy * s);
          pen.lineTo(q.x + sx * (s - k), q.y + sy * s);
        }
        glow(L.bolt ? AMBER : RED, 1.2, 0.95);
      }
    }
    // navigation pointers
    if (G.gate) drawPointer(G.gate.x, G.gate.y, G.gate.z, '#ffffff', 'GATE', 0.9);
    else if (G.phase === 'hunt') {
      let best = null, bd = 1e9;
      for (const e of enemies) {
        const d = Math.hypot(e.x - P.x, e.y - P.y, e.z - P.z);
        if (!e.dead && d < bd) { bd = d; best = e; }
      }
      if (best && best !== (L && L.o)) drawPointer(best.x, best.y + best.T.hit[0][0], best.z, best.T.color, '', 0.55);
    }
  }
  drawCockpit();
  // scores
  label('SCORE ' + pad(G.score, 7), 18 * U, 16 * U, 16 * U, HUD, 0, 0.95, 1.1);
  label('HI ' + pad(Math.max(G.score, G.hi[0] ? G.hi[0].s : 0), 7), W - 18 * U, 16 * U, 16 * U, AMBER, 1, 0.9, 1.1);
  drawBanner();
  const nt = G.note;
  if (nt) label(nt.text, cx, 58 * U, 13 * U, nt.color, 0.5, clamp((nt.dur - nt.t) * 3, 0, 1) * (((G.t * 10) | 0) % 5 ? 1 : 0.5));
  if (P.alive && P.shield <= 25 && ((G.t * 3) | 0) & 1) label('SHIELD CRITICAL', cx, H * 0.62, 14 * U, RED, 0.5, 1, 1.2);
  if (G.phase === 'gate' && G.gate && !G.banner && Math.hypot(G.gate.x - P.x, G.gate.z - P.z) < 900) {
    label('ALIGN WITH THE RING', cx, H * 0.62 + 24 * U, 11 * U, '#ffffff', 0.5, 0.8);
  }
  if (G.tally && G.tally.t > 1.2) {
    const T = G.tally, y0 = H * 0.17;
    chroma('SECTOR ' + pad(G.sector, 2) + ' CLEARED', cx, y0, 34 * U, 0.5, 1, 2);
    for (let i = 0; i < T.lines.length; i++) {
      if (T.t < 1.7 + i * 0.4) continue;
      const y = y0 + 74 * U + i * 30 * U;
      label(T.lines[i][0], cx - 200 * U, y, 14 * U, HUD, 0, 1);
      label(String(T.lines[i][1]), cx + 200 * U, y, 14 * U, AMBER, 1, 1);
    }
    if (T.t > 3.4 && ((G.t * 2) | 0) & 1) label('PRESS FIRE TO JUMP', cx, y0 + 180 * U, 12 * U, '#ffffff', 0.5, 0.9);
  }
  // cracked canopy
  if (G.cracks) {
    const a = clamp(G.stateT * 4, 0, 1);
    pen.beginPath();
    for (const pl of G.cracks) {
      pen.moveTo(pl[0][0] * W, pl[0][1] * H);
      for (let i = 1; i < pl.length; i++) pen.lineTo(pl[i][0] * W, pl[i][1] * H);
    }
    glow('#ffffff', 1.1, a * 0.8);
  }
  if (G.paused) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    chroma('PAUSED', cx, H * 0.34, 48 * U, 0.5, 1, 2);
    label(mouse.touch ? 'TAP TO RESUME' : 'CLICK OR PRESS P TO RESUME', cx, H * 0.34 + 80 * U, 14 * U, '#ffffff', 0.5, 0.9);
    label('N SOUND   I INVERT PITCH   C CRT OVERLAY', cx, H * 0.34 + 112 * U, 10 * U, HUD, 0.5, 0.8);
  }
}

/* ---- screens ---- */
function panel(x, y, w, h) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(0,0,0,0.74)';
  ctx.fillRect(x, y, w, h);
  ctx.globalCompositeOperation = 'lighter';
  pen.beginPath();
  pen.rect(x, y, w, h);
  glow(HUD, 1, 0.6);
}
function drawScoreTable(cx, y, U) {
  label('HIGH SCORES', cx, y, 15 * U, AMBER, 0.5, 1, 1.1);
  for (let i = 0; i < G.hi.length; i++) {
    const r = G.hi[i], yy = y + 36 * U + i * 28 * U;
    const c = i === 0 ? '#ffffff' : HUD;
    label((i + 1) + '.', cx - 190 * U, yy, 14 * U, c);
    label(r.n, cx - 140 * U, yy, 14 * U, c);
    label(pad(r.s, 7), cx + 70 * U, yy, 14 * U, c, 1);
    label('SEC ' + pad(r.k || 1, 2), cx + 190 * U, yy, 14 * U, c, 1, 0.8);
  }
}
const HELP = [
  ['MOUSE / ARROWS', 'STEER'],
  ['W / S', 'THROTTLE'],
  ['SPACE / LEFT CLICK', 'LASERS'],
  ['F / RIGHT CLICK', 'HOMING MISSILE'],
  ['P', 'PAUSE'],
  ['N   I   C', 'SOUND  INVERT  CRT'],
];
function drawTitle() {
  const U = V.U, W = V.W, H = V.H, cx = W / 2;
  const S = Math.min(92 * U, W * 0.86 / 12), y = H * 0.12;
  chroma('SPACE GLIDER', cx, y, S, 0.5, 1, 2.6);
  const hw = textWidth('SPACE GLIDER', S) / 2;
  pen.beginPath();
  pen.moveTo(cx - hw, y + S * 1.28); pen.lineTo(cx + hw, y + S * 1.28);
  pen.moveTo(cx - hw * 0.8, y + S * 1.4); pen.lineTo(cx + hw * 0.8, y + S * 1.4);
  pen.moveTo(cx - hw * 0.55, y + S * 1.52); pen.lineTo(cx + hw * 0.55, y + S * 1.52);
  glow(AMBER, 1.2, 0.9);
  const ss = Math.min(14 * U, W * 0.8 / 40), sw2 = textWidth('A NEON VECTOR HOMAGE TO THE 16-BIT SKIES', ss);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(cx - sw2 / 2 - ss, y + S * 1.78 - ss * 0.6, sw2 + ss * 2, ss * 2.2);
  ctx.globalCompositeOperation = 'lighter';
  label('A NEON VECTOR HOMAGE TO THE 16-BIT SKIES', cx, y + S * 1.78, ss, AMBER, 0.5, 0.9);
  if (((G.t * 1.7) | 0) & 1) {
    label(mouse.touch ? 'TAP TO LAUNCH' : 'PRESS ENTER OR CLICK TO LAUNCH', cx, H * 0.47, 17 * U, '#ffffff', 0.5, 1, 1.2);
  }
  const pw = Math.min(560 * U, W * 0.92), ph = 206 * U, py = H * 0.57;
  panel(cx - pw / 2, py, pw, ph);
  if (Math.floor(G.stateT / 7) % 2 === 0) {
    drawScoreTable(cx, py + 18 * U, U);
  } else {
    label('FLIGHT CONTROLS', cx, py + 18 * U, 15 * U, AMBER, 0.5, 1, 1.1);
    for (let i = 0; i < HELP.length; i++) {
      const yy = py + 52 * U + i * 25 * U;
      label(HELP[i][0], cx - 16 * U, yy, 11 * U, '#ffffff', 1);
      label(HELP[i][1], cx + 16 * U, yy, 11 * U, HUD, 0);
    }
  }
  label('SOUND ' + ['ON', 'FX ONLY', 'OFF'][Sfx.mode] + '   PITCH ' + (G.invert ? 'INVERTED' : 'NORMAL'), cx, py + ph + 16 * U, 9 * U, HUD, 0.5, 0.7);
  if (G.note) label(G.note.text, cx, H * 0.47 + 40 * U, 12 * U, G.note.color, 0.5, 1);
}
function drawGameOver() {
  const U = V.U, cx = V.W / 2, H = V.H;
  chroma('GAME OVER', cx, H * 0.22, Math.min(70 * U, V.W * 0.8 / 9), 0.5, clamp(G.stateT * 2, 0, 1), 2.4, RED, AMBER);
  label('FINAL SCORE ' + pad(G.score, 7), cx, H * 0.22 + 120 * U, 20 * U, '#ffffff', 0.5, 1, 1.2);
  label('SECTOR REACHED ' + pad(G.sector, 2), cx, H * 0.22 + 160 * U, 14 * U, HUD, 0.5, 0.9);
  if (G.stateT > 1.2 && ((G.t * 2) | 0) & 1) label(mouse.touch ? 'TAP TO CONTINUE' : 'PRESS ENTER', cx, H * 0.22 + 220 * U, 13 * U, AMBER, 0.5, 0.9);
}
function drawInitials() {
  const U = V.U, cx = V.W / 2, H = V.H;
  const pw = Math.min(600 * U, V.W * 0.92);
  panel(cx - pw / 2, H * 0.14, pw, 330 * U);
  chroma('NEW HIGH SCORE', cx, H * 0.14 + 28 * U, 30 * U, 0.5, 1, 1.8);
  label('RANK ' + (G.rank + 1) + '   SCORE ' + pad(G.score, 7), cx, H * 0.14 + 86 * U, 14 * U, AMBER, 0.5);
  label('ENTER YOUR INITIALS', cx, H * 0.14 + 126 * U, 12 * U, HUD, 0.5, 0.9);
  const S = 64 * U, x0 = cx - S * 1.5 + S / 6, yy = H * 0.14 + 166 * U;
  for (let i = 0; i < 3; i++) {
    const ch = G.initials[i];
    if (ch) label(ch, x0 + i * S, yy, S, '#ffffff', 0, 1, 2);
    else if (i !== G.initials.length || ((G.t * 3) | 0) & 1) label('_', x0 + i * S, yy, S, HUD, 0, 0.8, 1.6);
  }
  label(mouse.touch ? 'TAP TO CONFIRM' : 'TYPE, THEN PRESS ENTER', cx, H * 0.14 + 284 * U, 11 * U, HUD, 0.5, 0.8);
}

/* ---- frame ---- */
function render(dt) {
  const W = V.W, H = V.H, U = V.U;
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';

  const sh = G.shake;
  V.cx = V.bx + (sh ? rand(-1, 1) * sh * 14 * U : 0);
  V.cy = V.by + (sh ? rand(-1, 1) * sh * 14 * U : 0);
  setCamera(P.x, P.y, P.z, P.yaw, P.pitch, P.roll);

  if (G.scene === 'rift') drawRift(); else drawSurface();
  drawEntities();
  drawParticles();
  if (G.warp) drawWarp();

  switch (G.state) {
    case 'title': drawTitle(); break;
    case 'play':
    case 'dying': drawHUD(); break;
    case 'gameover': drawGameOver(); break;
    case 'initials': drawInitials(); break;
  }

  // full-screen tints
  const tint = (color, a) => {
    if (a <= 0.01) return;
    ctx.globalAlpha = Math.min(1, a);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  };
  tint('#ff2846', G.hurt * 0.3);
  tint('#2bff88', G.good * 0.14);
  tint('#ffffff', G.flash * 0.8);

  present(dt);
}

/* ---------------- main loop ---------------- */
let lastTs = 0, avgDt = 1 / 60, slowT = 0, stress = 1, autoQuality = true;
function frame(ts) {
  requestAnimationFrame(frame);
  let dt = lastTs ? (ts - lastTs) / 1000 : 1 / 60;
  lastTs = ts;
  if (!(dt > 0)) dt = 1 / 60;
  if (dt > 0.25) dt = 1 / 60;          // came back from a hidden tab
  // adaptive quality: drop resolution first, then the phosphor blend, then the bloom
  avgDt = lerp(avgDt, dt, 0.05);
  slowT = avgDt > 1 / 40 ? slowT + dt : Math.max(0, slowT - dt);
  if (slowT > 3 && autoQuality) {
    slowT = 0;
    if ((window.devicePixelRatio || 1) > 1 && V.dprCap > 1) { V.dprCap = 1; resize(); }
    else if (V.persist === 'lighten') V.persist = 'alpha';   // cheaper blend, slightly softer trails
    else if (V.bloom) V.bloom = false;
  }
  dt = Math.min(dt, 0.05);
  G.t += dt;
  update(dt);
  render(dt);
  for (let i = 1; i < stress; i++) render(dt);
  endInputFrame();
  Sfx.tick();
}

/* ---------------- boot ---------------- */
loadSaved();
/* Dev aid: index.html#demo=surface|gate|rift|boss|over jumps straight to a scene. */
(function demoBoot() {
  const m = /demo=(\w+)/.exec(window.location.hash || '');
  if (!m) return;
  const mode = m[1];
  startGame();
  G.banner = null;
  if (mode === 'surface' || mode === 'over') {
    const put = (type, x, y, z) => { const e = spawnEnemy(); Object.assign(e, makeEnemy(type), { x, y, z, dx: 0, dy: 0, dz: -1, cd: 0.4 }); };
    put('dart', -60, 170, 420); put('dart', 140, 210, 700); put('crawler', -120, 0, 520); put('spire', 150, 0, 620);
    if (mode === 'over') { G.score = 4200; die(); }
  } else if (mode === 'gate') {
    G.kills = G.quota; openGate(); G.banner = null;
    Object.assign(G.gate, { x: 0, z: 700, yaw: 0, nx: 0, nz: 1 });
  } else if (mode === 'rift' || mode === 'boss') {
    G.scene = 'rift'; G.phase = 'rift'; buildRift();
    Object.assign(P, { x: 0, y: RH / 2, z: mode === 'boss' ? G.rift.len + 1 : 300, speed: 200, throttle: 200 });
    if (mode === 'boss') for (const b of G.rift.barriers) b.passed = true;
  }
  if (/[&]fire/.test(window.location.hash)) keys.Space = true;
  const st = /[&]stress=(d+)/.exec(window.location.hash);
  if (st) stress = +st[1];       // render N times per frame to find the performance headroom
})();
window.SG = {
  get fps() { return 1 / avgDt; },
  set autoQuality(v) { autoQuality = v; },
  G, P, V, Sfx, mouse, enemies, ebolts, pbolts, missiles, pickups, openGate, enterRift, spawnBoss, kill, hurt, die, startGame, spawnEnemy,
};
requestAnimationFrame(frame);
