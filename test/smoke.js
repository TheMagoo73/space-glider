'use strict';
/* Headless smoke test: runs the real game scripts against a stub DOM/canvas/WebAudio
   and drives the whole loop (title → hunt → gate → rift → core → next sector →
   death → initials → title), failing on exceptions or non-finite draw coordinates.

   Run:  node test/smoke.js                                                        */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = ['core', 'audio', 'models', 'game']
  .map((f) => fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8')).join('\n;\n');

/* ---------- stubs ---------- */
const listeners = { window: {}, document: {}, canvas: {} };
const on = (who) => (type, fn) => { (listeners[who][type] = listeners[who][type] || []).push(fn); };
const fire = (who, type, ev = {}) => {
  ev.preventDefault = ev.preventDefault || (() => {});
  for (const fn of listeners[who][type] || []) fn(ev);
};

let badDraw = 0, drawCalls = 0, lastBad = '';
const NUMERIC = new Set(['moveTo', 'lineTo', 'arc', 'rect', 'fillRect', 'translate', 'rotate']);
function makeCtx() {
  const store = {};
  return new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k];
      return (...args) => {
        drawCalls++;
        if (NUMERIC.has(k)) {
          for (const a of args) {
            if (typeof a === 'number' && !Number.isFinite(a)) { badDraw++; lastBad = k + '(' + args.join(',') + ')'; break; }
          }
        }
      };
    },
    set(t, k, v) {
      if ((k === 'globalAlpha' || k === 'lineWidth') && !Number.isFinite(v)) { badDraw++; lastBad = k + '=' + v; }
      t[k] = v;
      return true;
    },
  });
}
function makeCanvas(who) {
  return {
    width: 0, height: 0,
    getContext: () => makeCtx(),
    addEventListener: who ? on(who) : () => {},
    requestPointerLock() {
      doc.pointerLockElement = canvasEl;
      fire('document', 'pointerlockchange');
      return Promise.resolve();
    },
  };
}
const canvasEl = makeCanvas('canvas');
const doc = {
  hidden: false, pointerLockElement: null,
  getElementById: () => canvasEl,
  createElement: () => makeCanvas(null),
  addEventListener: on('document'),
  exitPointerLock() { doc.pointerLockElement = null; fire('document', 'pointerlockchange'); },
  body: { classList: { toggle() {} } },
};
// A do-anything object standing in for the WebAudio graph.
const any = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'state' ? 'running' : any),
  apply: () => any, construct: () => any, set: () => true,
});
const storage = {};
let rafCb = null;
const sandbox = {
  console, Math, JSON, Promise, Float32Array, Set, Object, String, Number, Array, Symbol,
  document: doc,
  localStorage: { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); } },
  requestAnimationFrame: (cb) => { rafCb = cb; },
  innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  location: { hash: '' },
  AudioContext: any,
  addEventListener: on('window'),
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'space-glider.js' });
const { G, P, enemies, pbolts, ebolts } = sandbox.SG;
const SG = sandbox.SG;

/* ---------- helpers ---------- */
let ts = 1000, frames = 0;
function step(n = 1, each) {
  for (let i = 0; i < n; i++) {
    ts += 1000 / 60;
    frames++;
    const cb = rafCb;
    cb(ts);
    if (each) each(i);
    if (badDraw) throw new Error('non-finite draw call at frame ' + frames + ': ' + lastBad + ' (state ' + G.state + '/' + G.phase + ')');
    for (const k of ['x', 'y', 'z', 'yaw', 'pitch', 'roll', 'speed', 'shield', 'energy']) {
      if (!Number.isFinite(P[k])) throw new Error('player.' + k + ' is ' + P[k] + ' at frame ' + frames);
    }
  }
}
const key = (code, k) => { fire('window', 'keydown', { code, key: k || code }); fire('window', 'keyup', { code }); };
const hold = (code, down) => fire('window', down ? 'keydown' : 'keyup', { code, key: code });
let passed = 0;
function check(cond, msg) {
  if (!cond) throw new Error('FAILED: ' + msg);
  passed++;
  console.log('  ok  ' + msg);
}

/* ---------- scenario ---------- */
console.log('title / attract');
step(180);
check(G.state === 'title', 'boots to the title screen');
key('KeyN'); key('KeyI'); key('KeyC'); step(3); key('KeyI'); key('KeyN'); key('KeyN'); step(3);
check(G.invert === false && SG.Sfx.mode === 0, 'sound / invert toggles cycle back');

console.log('launch');
key('Enter', 'Enter');
step(2);
check(G.state === 'play' && G.sector === 1 && G.phase === 'hunt', 'enter starts sector 1 in hunt phase');
check(doc.pointerLockElement === canvasEl, 'pointer lock requested');

console.log('free flight with fire held, mouse weaving');
hold('Space', true);
let maxEnemies = 0, sawPlayerBolt = false, sawEnemyBolt = false;
step(60 * 25, (i) => {
  fire('window', 'mousemove', { movementX: Math.sin(i * 0.02) * 6, movementY: Math.cos(i * 0.031) * 3 });
  if (i % 240 === 0) key('KeyF');
  if (i === 300) hold('KeyW', true);
  if (i === 500) hold('KeyW', false);
  P.shield = 100;                                    // keep the test pilot alive
  maxEnemies = Math.max(maxEnemies, enemies.length);
  sawPlayerBolt = sawPlayerBolt || pbolts.length > 0;
  sawEnemyBolt = sawEnemyBolt || ebolts.length > 0;
});
check(maxEnemies >= 3, 'hostiles spawn (peak ' + maxEnemies + ')');
check(sawPlayerBolt, 'lasers fire');
check(sawEnemyBolt, 'hostiles return fire');
check(P.y >= 10 && P.y <= 900, 'altitude stays inside limits (' + P.y.toFixed(0) + ')');

console.log('pause');
key('KeyP'); step(5);
const zPaused = P.z, xPaused = P.x;
step(30);
check(G.paused && P.z === zPaused && P.x === xPaused, 'P pauses the simulation');
key('KeyP'); step(2);
check(!G.paused, 'P resumes');
doc.exitPointerLock(); step(2);
check(G.paused, 'losing pointer lock pauses');
fire('window', 'mousedown', { button: 0 }); fire('window', 'mouseup', { button: 0 }); step(2);
check(!G.paused && doc.pointerLockElement === canvasEl, 'click resumes and re-locks');

console.log('quota → gate');
let guard = 0;
while (G.phase === 'hunt' && guard++ < 200) {
  if (!enemies.length) SG.spawnEnemy();
  SG.kill(enemies[0]);
  step(1);
}
check(G.phase === 'gate' && G.gate, 'meeting the quota opens the rift gate (score ' + G.score + ')');
check(G.kills === G.quota, 'kill counter matches quota');

console.log('fly through the gate');
hold('Space', false);
{
  const g = G.gate;
  // miss on purpose first: cross the ring plane well outside the ring
  Object.assign(P, { x: g.x - g.nx * 60 + g.nz * 400, y: g.y, z: g.z - g.nz * 60 - g.nx * 400, yaw: g.yaw, pitch: 0 });
  step(60, () => { P.shield = 100; });
  check(G.scene === 'surface' && G.phase === 'gate', 'missing the ring does not enter the rift');
  Object.assign(P, { x: g.x - g.nx * 150, y: g.y, z: g.z - g.nz * 150, yaw: g.yaw, pitch: 0 });
  step(200, () => { P.shield = 100; });
}
check(G.scene === 'rift' && G.phase === 'rift' && G.rift, 'passing through the ring warps into the rift');
check(G.rift.barriers.length >= 5, 'rift has barriers (' + G.rift.barriers.length + ')');

console.log('rift run (flying straight, taking hits)');
const b0 = G.rift.barriers[0];
let barrierHits = 0, lastShield = 100;
guard = 0;
while (G.phase === 'rift' && guard++ < 60 * 60) {
  step(1, () => {
    if (P.shield < lastShield - 15) barrierHits++;
    P.shield = 100; lastShield = 100;
    fire('window', 'mousemove', { movementX: Math.sin(guard * 0.05) * 4, movementY: Math.cos(guard * 0.04) * 4 });
  });
}
check(b0.passed, 'barriers register as passed');
check(G.phase === 'boss' && G.boss, 'the core appears at the end of the rift (barrier hits: ' + barrierHits + ')');
check(Math.abs(P.x) <= 115 && P.y >= 0 && P.y <= 150, 'player stays inside the rift walls');

console.log('core fight');
hold('Space', true);
const hp0 = G.boss.hp, scoreBefore = G.score;
let bossBolts = 0, bossHpSeen = hp0;
guard = 0;
while (G.boss && guard++ < 60 * 12) {
  step(1, () => {
    P.shield = 100; P.yaw = 0; P.pitch = 0;
    bossBolts = Math.max(bossBolts, ebolts.length);
    if (G.boss) bossHpSeen = G.boss.hp;
  });
}
hold('Space', false);
check(bossBolts > 0, 'the core fires back');
check(bossHpSeen < hp0, 'lasers damage the core (' + hp0 + ' -> ' + bossHpSeen + (G.boss ? '' : ', destroyed') + ' in ' + (guard / 60).toFixed(1) + 's)');
if (G.boss) SG.kill(G.boss);
step(2);
check(G.phase === 'tally' && G.tally, 'destroying the core starts the tally');
step(60 * 9, () => { if (G.phase === 'tally') P.shield = 60; });
check(G.sector === 2 && G.scene === 'surface' && G.phase === 'hunt', 'tally warps on to sector 2');
check(G.score >= scoreBefore + 2000 + 1000, 'core score and sector bonuses are awarded (+' + (G.score - scoreBefore) + ')');
check(P.shield === 100 && P.missiles === 4, 'shield topped up and missiles restocked for the new sector');

console.log('unassisted play until destroyed');
hold('Space', true);
guard = 0;
while (G.state === 'play' && guard++ < 60 * 600) {
  step(1);
  if (guard % 7 === 0) fire('window', 'mousemove', { movementX: Math.sin(guard * 0.01) * 10, movementY: Math.sin(guard * 0.013) * 5 });
  if (guard === 60 * 120) SG.die();                // don't wait forever on a lucky pilot
}
hold('Space', false);
check(G.state === 'dying', 'shield loss ends the run (after ' + (guard / 60).toFixed(0) + 's)');
step(60 * 4);
check(G.state === 'gameover', 'game over screen follows');
check(doc.pointerLockElement === null, 'pointer lock released on game over');
step(90);
key('Enter', 'Enter'); step(2);
check(G.state === 'initials', 'a qualifying score asks for initials (score ' + G.score + ')');
for (const ch of ['x', 'y', 'z', 'q']) fire('window', 'keydown', { code: 'Key' + ch.toUpperCase(), key: ch });
fire('window', 'keydown', { code: 'Backspace', key: 'Backspace' });
fire('window', 'keydown', { code: 'KeyV', key: 'v' });
step(2);
check(G.initials === 'XYV', 'initials entry handles typing and backspace');
key('Enter', 'Enter'); step(2);
check(G.state === 'title', 'returns to the title');
check(G.hi.some((r) => r.n === 'XYV') && /XYV/.test(storage['spaceglider.hiscores'] || ''), 'score saved to the table and storage');
step(60 * 16);                                      // attract mode cycles panels + palettes

console.log('second run via click, then quick death with a zero score');
fire('window', 'mousedown', { button: 0 }); fire('window', 'mouseup', { button: 0 }); step(3);
check(G.state === 'play' && G.sector === 1 && G.score === 0 && P.shield === 100, 'restart resets the run');
SG.die(); step(60 * 4); step(60 * 10);
check(G.state === 'title', 'zero score skips initials and times out to the title');

console.log('\n' + passed + ' checks passed over ' + frames + ' frames, ' + drawCalls + ' canvas calls, 0 non-finite.');
