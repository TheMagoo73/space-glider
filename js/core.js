'use strict';
/* ============================================================
   SPACE GLIDER — core.js
   Math helpers, input, the vector renderer and the stroke font.
   Everything is drawn as glowing line segments, the way a
   vector monitor would.
   ============================================================ */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
const pad = (n, len) => String(Math.max(0, Math.floor(n))).padStart(len, '0');

/** Deterministic 0..1 hash of two integers and a seed. */
function hash2(x, z, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Does the segment p0→p1 pass within r of point c? */
function segSphere(x0, y0, z0, x1, y1, z1, cx, cy, cz, r) {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const l2 = dx * dx + dy * dy + dz * dz;
  let t = l2 > 0 ? ((cx - x0) * dx + (cy - y0) * dy + (cz - z0) * dz) / l2 : 0;
  t = clamp(t, 0, 1);
  const px = x0 + dx * t - cx, py = y0 + dy * t - cy, pz = z0 + dz * t - cz;
  return px * px + py * py + pz * pz <= r * r;
}

/* ---------------- canvases ----------------
   The scene is drawn additively into an off-screen buffer, then
   composited onto the visible canvas with a "lighten" blend over
   a partially faded previous frame: phosphor persistence without
   the brightness build-up plain additive feedback would cause. */
const canvas = document.getElementById('screen');
const scr = canvas.getContext('2d', { alpha: false });
const buf = document.createElement('canvas');
const ctx = buf.getContext('2d', { alpha: false });

// two small buffers for a cheap bloom (downsample, then add back blurred)
const bloomA = document.createElement('canvas'), bloomB = document.createElement('canvas');
const bctxA = bloomA.getContext('2d', { alpha: false }), bctxB = bloomB.getContext('2d', { alpha: false });

const V = {
  W: 1, H: 1, U: 1, F: 1, bx: 0, by: 0, cx: 0, cy: 0,
  dprCap: 2, maxPixels: 2.8e6,
  halo: false,          // per-stroke glow (costly; fallback look when bloom is off)
  bloom: true,          // post-process glow
  persist: 'lighten',   // 'lighten' = phosphor decay, 'alpha' = cheaper blend, 'none'
};
const FOV_TAN = Math.tan((72 * Math.PI / 180) / 2);

function resize() {
  let dpr = Math.min(window.devicePixelRatio || 1, V.dprCap);
  const px = window.innerWidth * window.innerHeight * dpr * dpr;
  if (px > V.maxPixels) dpr *= Math.sqrt(V.maxPixels / px);        // keep the fill cost bounded on huge displays
  V.W = Math.max(320, Math.floor(window.innerWidth * dpr));
  V.H = Math.max(240, Math.floor(window.innerHeight * dpr));
  canvas.width = buf.width = V.W;
  canvas.height = buf.height = V.H;
  bloomA.width = Math.ceil(V.W / 2); bloomA.height = Math.ceil(V.H / 2);
  bloomB.width = Math.ceil(V.W / 4); bloomB.height = Math.ceil(V.H / 4);
  V.U = Math.min(V.H / 720, V.W / 960);                      // UI unit
  V.F = Math.min(V.H * 0.5 / FOV_TAN, V.W * 0.866);          // focal length in px
  V.bx = V.cx = V.W / 2;
  V.by = V.cy = V.H * 0.45;                                  // view centre sits above the console
  ctx.lineCap = 'butt';            // butt-capped single segments are the cheapest thing to stroke
}
window.addEventListener('resize', resize);
resize();

/** Finish the frame: bloom the buffer, then show it with phosphor persistence. */
function present(dt) {
  ctx.globalAlpha = 1;
  if (V.bloom) {
    bctxA.drawImage(buf, 0, 0, bloomA.width, bloomA.height);
    bctxB.drawImage(bloomA, 0, 0, bloomB.width, bloomB.height);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.45;
    ctx.drawImage(bloomA, 0, 0, V.W, V.H);
    ctx.globalAlpha = 0.8;
    ctx.drawImage(bloomB, 0, 0, V.W, V.H);
    ctx.globalAlpha = 1;
  }
  scr.globalAlpha = 1;
  if (V.persist === 'lighten') {
    // fade what's on the tube, then keep the brighter of old and new
    scr.globalCompositeOperation = 'source-over';
    scr.fillStyle = 'rgba(0,0,4,' + clamp(damp(30, dt), 0.2, 1).toFixed(3) + ')';
    scr.fillRect(0, 0, V.W, V.H);
    scr.globalCompositeOperation = 'lighten';
    scr.drawImage(buf, 0, 0);
  } else {
    scr.globalCompositeOperation = 'source-over';
    if (V.persist === 'alpha') scr.globalAlpha = clamp(damp(55, dt), 0.3, 1);
    scr.drawImage(buf, 0, 0);
    scr.globalAlpha = 1;
  }
}

/* ---------------- the pen ----------------
   Mirrors the canvas path calls (beginPath / moveTo / lineTo / closePath / arc / rect) but only
   records segments; glow() then strokes each one as its own path. On GPU-backed canvases a lone
   line segment takes a fast path that is 10-80x quicker than one big multi-segment path. */
const SEG_MAX = 4 * 8192, ARC_MAX = 5 * 256;
const segBuf = new Float32Array(SEG_MAX), arcBuf = new Float32Array(ARC_MAX);
let segN = 0, arcN = 0, penX = 0, penY = 0, penX0 = 0, penY0 = 0;
function addSeg(x1, y1, x2, y2) {
  if (segN >= SEG_MAX) return;
  segBuf[segN++] = x1; segBuf[segN++] = y1; segBuf[segN++] = x2; segBuf[segN++] = y2;
}
const pen = {
  beginPath() { segN = 0; arcN = 0; },
  moveTo(x, y) { penX = penX0 = x; penY = penY0 = y; },
  lineTo(x, y) { addSeg(penX, penY, x, y); penX = x; penY = y; },
  closePath() { addSeg(penX, penY, penX0, penY0); penX = penX0; penY = penY0; },
  rect(x, y, w, h) {
    addSeg(x, y, x + w, y); addSeg(x + w, y, x + w, y + h);
    addSeg(x + w, y + h, x, y + h); addSeg(x, y + h, x, y);
  },
  arc(x, y, r, a0 = 0, a1 = TAU) {
    if (arcN >= ARC_MAX) return;
    arcBuf[arcN++] = x; arcBuf[arcN++] = y; arcBuf[arcN++] = r; arcBuf[arcN++] = a0; arcBuf[arcN++] = a1;
  },
};
/** Stroke everything recorded, one primitive at a time. Segments are stretched by `ext` at each
    end so corners close up (and overlap into bright vertex dots, like a real vector tube). */
function strokeRecorded(ext) {
  for (let i = 0; i < segN; i += 4) {
    let x1 = segBuf[i], y1 = segBuf[i + 1], x2 = segBuf[i + 2], y2 = segBuf[i + 3];
    const dx = x2 - x1, dy = y2 - y1, l = Math.sqrt(dx * dx + dy * dy);
    if (!(l > 0.01)) continue;
    const k = ext / l;
    x1 -= dx * k; y1 -= dy * k; x2 += dx * k; y2 += dy * k;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  for (let i = 0; i < arcN; i += 5) {
    ctx.beginPath();
    ctx.arc(arcBuf[i], arcBuf[i + 1], arcBuf[i + 2], arcBuf[i + 3], arcBuf[i + 4]);
    ctx.stroke();
  }
}

/** Stroke what the pen recorded as a glowing vector line. */
function glow(color, w = 1, a = 1, hot = false) {
  if (a <= 0.004 || (segN === 0 && arcN === 0)) return;
  if (a > 1) a = 1;
  const lw = Math.max(1, w * V.U * 1.5), ext = lw * 0.5;
  ctx.strokeStyle = color;
  if (V.halo) {
    ctx.globalAlpha = a * 0.26;
    ctx.lineWidth = lw * 4.5;
    strokeRecorded(ext);
  }
  ctx.globalAlpha = a;
  ctx.lineWidth = lw;
  strokeRecorded(ext);
  if (hot) {
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = a * 0.85;
    ctx.lineWidth = Math.max(0.75, lw * 0.4);
    strokeRecorded(ext);
  }
  ctx.globalAlpha = 1;
}

/* ---------------- camera ---------------- */
const NEAR = 2;
const cam = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, cy: 1, sy: 0, cp: 1, sp: 0, cr: 1, sr: 0 };

function setCamera(x, y, z, yaw, pitch, roll) {
  cam.x = x; cam.y = y; cam.z = z;
  cam.yaw = yaw; cam.pitch = pitch; cam.roll = roll;
  cam.cy = Math.cos(yaw); cam.sy = Math.sin(yaw);
  cam.cp = Math.cos(pitch); cam.sp = Math.sin(pitch);
  cam.cr = Math.cos(roll); cam.sr = Math.sin(roll);
}

const _c = [0, 0, 0];
/** World point → camera space (x right, y up, z forward). Returns a shared array. */
function toCam(x, y, z) {
  const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
  const x1 = dx * cam.cy - dz * cam.sy, z1 = dx * cam.sy + dz * cam.cy;
  const y2 = dy * cam.cp - z1 * cam.sp;
  _c[2] = dy * cam.sp + z1 * cam.cp;
  _c[0] = x1 * cam.cr + y2 * cam.sr;
  _c[1] = -x1 * cam.sr + y2 * cam.cr;
  return _c;
}
/** Direction (point at infinity) → camera space. */
function dirToCam(dx, dy, dz) {
  const x1 = dx * cam.cy - dz * cam.sy, z1 = dx * cam.sy + dz * cam.cy;
  const y2 = dy * cam.cp - z1 * cam.sp;
  _c[2] = dy * cam.sp + z1 * cam.cp;
  _c[0] = x1 * cam.cr + y2 * cam.sr;
  _c[1] = -x1 * cam.sr + y2 * cam.cr;
  return _c;
}

const _p = { x: 0, y: 0, z: 0, ok: false };
/** World point → screen. _p.ok is false when behind the camera. */
function project(x, y, z) {
  const c = toCam(x, y, z);
  _p.z = c[2];
  _p.ok = c[2] > NEAR;
  if (_p.ok) {
    _p.x = V.cx + c[0] / c[2] * V.F;
    _p.y = V.cy - c[1] / c[2] * V.F;
  }
  return _p;
}

/** Record a camera-space segment (near-clipped, trivially rejected). */
function lineC(ax, ay, az, bx, by, bz) {
  if (az < NEAR && bz < NEAR) return;
  if (az < NEAR) {
    const t = (NEAR - az) / (bz - az);
    ax += (bx - ax) * t; ay += (by - ay) * t; az = NEAR;
  } else if (bz < NEAR) {
    const t = (NEAR - bz) / (az - bz);
    bx += (ax - bx) * t; by += (ay - by) * t; bz = NEAR;
  }
  const f = V.F;
  const sx1 = V.cx + ax / az * f, sy1 = V.cy - ay / az * f;
  const sx2 = V.cx + bx / bz * f, sy2 = V.cy - by / bz * f;
  const m = 60;
  if ((sx1 < -m && sx2 < -m) || (sx1 > V.W + m && sx2 > V.W + m) ||
      (sy1 < -m && sy2 < -m) || (sy1 > V.H + m && sy2 > V.H + m)) return;
  addSeg(sx1, sy1, sx2, sy2);
}
/** Record a world-space segment. */
function lineW(ax, ay, az, bx, by, bz) {
  const a = toCam(ax, ay, az);
  const x = a[0], y = a[1], z = a[2];
  const b = toCam(bx, by, bz);
  lineC(x, y, z, b[0], b[1], b[2]);
}

/* ---------------- wireframe models ---------------- */
const _mv = new Float32Array(3 * 160);
const _mw = new Float32Array(3 * 160);

function xformModel(m, x, y, z, yaw, pitch, roll, s, out, world) {
  const cyw = Math.cos(yaw), syw = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const v = m.v, n = v.length / 3;
  for (let i = 0; i < n; i++) {
    const lx = v[i * 3] * s, ly = v[i * 3 + 1] * s, lz = v[i * 3 + 2] * s;
    const x1 = lx * cr - ly * sr, y1 = lx * sr + ly * cr;       // roll
    const y2 = y1 * cp + lz * sp, z2 = -y1 * sp + lz * cp;      // pitch
    const x3 = x1 * cyw + z2 * syw, z3 = -x1 * syw + z2 * cyw;  // yaw
    if (world) {
      out[i * 3] = x + x3; out[i * 3 + 1] = y + y2; out[i * 3 + 2] = z + z3;
    } else {
      const c = toCam(x + x3, y + y2, z + z3);
      out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2];
    }
  }
}

/** Record a model's edges. */
function drawModel(m, x, y, z, yaw, pitch, roll, s) {
  xformModel(m, x, y, z, yaw, pitch, roll, s, _mv, false);
  const e = m.e;
  for (let i = 0; i < e.length; i += 2) {
    const a = e[i] * 3, b = e[i + 1] * 3;
    lineC(_mv[a], _mv[a + 1], _mv[a + 2], _mv[b], _mv[b + 1], _mv[b + 2]);
  }
}

/** Call fn(ax,ay,az,bx,by,bz) for each edge of a model in world space (used for debris). */
function modelEdges(m, x, y, z, yaw, pitch, roll, s, fn) {
  xformModel(m, x, y, z, yaw, pitch, roll, s, _mw, true);
  const e = m.e;
  for (let i = 0; i < e.length; i += 2) {
    const a = e[i] * 3, b = e[i + 1] * 3;
    fn(_mw[a], _mw[a + 1], _mw[a + 2], _mw[b], _mw[b + 1], _mw[b + 2]);
  }
}

/** Culled, self-contained model draw: begin, edges, glow. */
function drawEnt(m, x, y, z, yaw, pitch, roll, s, color, w, a, hot) {
  if (a <= 0.004) return;
  const c = toCam(x, y, z);
  const r = m.r * s;
  if (c[2] < -r) return;
  if (c[2] > 0) {
    const lim = (c[2] + r) * (V.W * 0.6 / V.F) + r;
    if (Math.abs(c[0]) > lim || Math.abs(c[1]) > lim) return;
  }
  pen.beginPath();
  drawModel(m, x, y, z, yaw, pitch, roll, s);
  glow(color, w, a, hot);
}

/* ---------------- stroke font (4x6 grid, y down) ---------------- */
const FONT_SRC = {
  A: '0,6 0,2 2,0 4,2 4,6|0,4 4,4',
  B: '0,0 0,6 3,6 4,5 4,4 3,3 0,3|0,0 3,0 4,1 4,2 3,3',
  C: '4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5',
  D: '0,0 0,6 2,6 4,4 4,2 2,0 0,0',
  E: '4,0 0,0 0,6 4,6|0,3 3,3',
  F: '4,0 0,0 0,6|0,3 3,3',
  G: '4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5 4,3 2,3',
  H: '0,0 0,6|4,0 4,6|0,3 4,3',
  I: '1,0 3,0|2,0 2,6|1,6 3,6',
  J: '4,0 4,5 3,6 1,6 0,5',
  K: '0,0 0,6|4,0 0,3 4,6',
  L: '0,0 0,6 4,6',
  M: '0,6 0,0 2,3 4,0 4,6',
  N: '0,6 0,0 4,6 4,0',
  O: '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0',
  P: '0,6 0,0 3,0 4,1 4,2 3,3 0,3',
  Q: '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0|2,4 4,6',
  R: '0,6 0,0 3,0 4,1 4,2 3,3 0,3|2,3 4,6',
  S: '4,1 3,0 1,0 0,1 0,2 1,3 3,3 4,4 4,5 3,6 1,6 0,5',
  T: '0,0 4,0|2,0 2,6',
  U: '0,0 0,5 1,6 3,6 4,5 4,0',
  V: '0,0 2,6 4,0',
  W: '0,0 1,6 2,3 3,6 4,0',
  X: '0,0 4,6|4,0 0,6',
  Y: '0,0 2,3 4,0|2,3 2,6',
  Z: '0,0 4,0 0,6 4,6',
  0: '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0|0.6,5 3.4,1',
  1: '1,1 2,0 2,6|1,6 3,6',
  2: '0,1 1,0 3,0 4,1 4,2 0,6 4,6',
  3: '0,0 4,0 2,2.5 3,2.5 4,3.5 4,5 3,6 1,6 0,5',
  4: '3,6 3,0 0,4 4,4',
  5: '4,0 0,0 0,2.6 3,2.6 4,3.6 4,5 3,6 1,6 0,5',
  6: '4,0 2,0 0,2 0,5 1,6 3,6 4,5 4,4 3,3 0,3',
  7: '0,0 4,0 1.5,6',
  8: '1,0 3,0 4,1 4,2 3,3 4,4 4,5 3,6 1,6 0,5 0,4 1,3 0,2 0,1 1,0|1,3 3,3',
  9: '0,6 2,6 4,4 4,1 3,0 1,0 0,1 0,2 1,3 4,3',
  ' ': '',
  '.': '2,5.4 2,6',
  ',': '2,5.2 1.2,6.8',
  ':': '2,1.4 2,2|2,4 2,4.6',
  '-': '1,3 3,3',
  '+': '0.8,3 3.2,3|2,1.8 2,4.2',
  '!': '2,0 2,4|2,5.4 2,6',
  '?': '0,1 1,0 3,0 4,1 4,2 2,3.4 2,4|2,5.4 2,6',
  '/': '0,6 4,0',
  '>': '1,1 3,3 1,5',
  '<': '3,1 1,3 3,5',
  "'": '2,0 2,1.5',
  '(': '3,0 2,1 2,5 3,6',
  ')': '1,0 2,1 2,5 1,6',
  '*': '2,1 2,5|0.3,2 3.7,4|3.7,2 0.3,4',
  '=': '1,2 3,2|1,4 3,4',
  '_': '0,6 4,6',
  '%': '0,6 4,0|0.4,0.4 1.6,0.4 1.6,1.6 0.4,1.6 0.4,0.4|2.4,4.4 3.6,4.4 3.6,5.6 2.4,5.6 2.4,4.4',
};
const FONT = Object.create(null);
for (const ch in FONT_SRC) {
  FONT[ch] = FONT_SRC[ch].split('|').filter(Boolean)
    .map((s) => s.trim().split(' ').map((pt) => pt.split(',').map(Number)));
}

/** Width of a string at glyph height `size` (advance == size). */
function textWidth(str, size) {
  return Math.max(0, String(str).length * size - size / 3);
}
/** Record a string's strokes. (x, y) is the top-left; align 0 / 0.5 / 1. */
function text(str, x, y, size, align = 0) {
  str = String(str).toUpperCase();
  const k = size / 6;
  let ox = x - textWidth(str, size) * align;
  for (let n = 0; n < str.length; n++) {
    const g = FONT[str[n]];
    if (g) {
      for (const pl of g) {
        for (let i = 1; i < pl.length; i++) {
          addSeg(ox + pl[i - 1][0] * k, y + pl[i - 1][1] * k, ox + pl[i][0] * k, y + pl[i][1] * k);
        }
      }
    }
    ox += size;
  }
}
/** One-call glowing text. */
function label(str, x, y, size, color, align = 0, a = 1, w = 1) {
  if (a <= 0.004) return;
  pen.beginPath();
  text(str, x, y, size, align);
  glow(color, w, a);
}
/** Text with a magenta/cyan chromatic split — the big-title look. */
function chroma(str, x, y, size, align, a, w, c1 = '#ff2bd6', c2 = '#00e5ff') {
  const o = size * 0.035;
  label(str, x - o, y, size, c1, align, a * 0.9, w);
  label(str, x + o, y + o * 0.5, size, c2, align, a * 0.9, w);
  label(str, x, y, size, '#ffffff', align, a * 0.75, w * 0.5);
}

/* ---------------- input ---------------- */
const keys = Object.create(null);     // held
const pressed = Object.create(null);  // went down this frame
const typed = [];                     // characters typed this frame (initials entry)
const mouse = {
  dx: 0, dy: 0, x: 0.5, y: 0.45, b0: false, b2: false,
  click: false, rclick: false, locked: false, moved: false, lockFailed: false, touch: false,
};
const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab', 'Backspace', 'Enter']);
let onLockChange = null;

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (!keys[e.code]) pressed[e.code] = true;
  keys[e.code] = true;
  if (e.key && (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Enter')) typed.push(e.key);
  if (PREVENT.has(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  mouse.b0 = mouse.b2 = false;
});
window.addEventListener('mousemove', (e) => {
  if (mouse.locked) {
    mouse.dx += e.movementX || 0;
    mouse.dy += e.movementY || 0;
  } else {
    mouse.x = e.clientX / Math.max(1, window.innerWidth);
    mouse.y = e.clientY / Math.max(1, window.innerHeight);
    mouse.moved = true;
  }
});
window.addEventListener('mousedown', (e) => {
  if (e.button === 0) { mouse.b0 = true; mouse.click = true; }
  if (e.button === 2) { mouse.b2 = true; mouse.rclick = true; }
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouse.b0 = false;
  if (e.button === 2) mouse.b2 = false;
});
window.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('pointerlockchange', () => {
  mouse.locked = document.pointerLockElement === canvas;
  if (onLockChange) onLockChange(mouse.locked);
});
document.addEventListener('pointerlockerror', () => { mouse.lockFailed = true; });

/* basic touch: drag = virtual stick + fire, second finger = missile */
function touchPos(e) {
  const t = e.touches[0];
  if (!t) return;
  mouse.x = t.clientX / Math.max(1, window.innerWidth);
  mouse.y = t.clientY / Math.max(1, window.innerHeight);
  mouse.moved = true;
}
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  mouse.touch = true; mouse.lockFailed = true;
  if (e.touches.length >= 2) mouse.rclick = true;
  else { mouse.b0 = true; mouse.click = true; touchPos(e); }
}, { passive: false });
canvas.addEventListener('touchmove', (e) => { e.preventDefault(); touchPos(e); }, { passive: false });
canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  if (e.touches.length === 0) { mouse.b0 = false; mouse.x = 0.5; mouse.y = 0.45; }
}, { passive: false });

function requestLock() {
  if (mouse.locked || mouse.touch) return;
  try {
    if (!canvas.requestPointerLock) { mouse.lockFailed = true; return; }
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => { mouse.lockFailed = true; });
  } catch (err) {
    mouse.lockFailed = true;
  }
}
function releaseLock() {
  try { if (document.exitPointerLock && document.pointerLockElement) document.exitPointerLock(); } catch (err) { /* ignore */ }
}
function endInputFrame() {
  for (const k in pressed) delete pressed[k];
  mouse.dx = mouse.dy = 0;
  mouse.click = mouse.rclick = false;
  typed.length = 0;
}
