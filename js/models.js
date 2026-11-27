'use strict';
/* ============================================================
   SPACE GLIDER — models.js
   Wireframe models: vertex lists + edge index pairs.
   Fighters point down +z; ground objects sit on y = 0.
   ============================================================ */

function mkModel(verts, edges) {
  const v = [];
  let r = 0;
  for (const p of verts) {
    v.push(p[0], p[1], p[2]);
    r = Math.max(r, Math.hypot(p[0], p[1], p[2]));
  }
  return { v, e: edges, r };
}
/** Closed loop of n vertices starting at index s. */
function eLoop(s, n) {
  const e = [];
  for (let i = 0; i < n; i++) e.push(s + i, s + (i + 1) % n);
  return e;
}
/** Connect vertex a+i to b+i for n pairs. */
function eLink(a, b, n) {
  const e = [];
  for (let i = 0; i < n; i++) e.push(a + i, b + i);
  return e;
}
/** Fan: connect every vertex s..s+n-1 to apex. */
function eFan(s, n, apex) {
  const e = [];
  for (let i = 0; i < n; i++) e.push(s + i, apex);
  return e;
}
const sq = (r, y) => [[-r, y, -r], [r, y, -r], [r, y, r], [-r, y, r]];

const M = {};

/* --- hostiles --- */
M.dart = mkModel(
  [[0, 0, 22], [-18, -2, -12], [18, -2, -12], [0, 7, -10], [0, -4, -8], [0, 0, -16]],
  [0, 1, 0, 2, 0, 3, 0, 4, 1, 3, 2, 3, 1, 4, 2, 4, 1, 5, 2, 5, 3, 5, 4, 5]
);

M.hunter = mkModel(
  [[-9, 0, 30], [9, 0, 30], [0, 0, 10], [-30, -3, -14], [30, -3, -14],
   [0, 10, -6], [0, -7, -6], [0, 0, -22], [-34, 10, -20], [34, 10, -20]],
  [0, 2, 1, 2, 0, 3, 1, 4, 3, 7, 4, 7, 0, 5, 1, 5, 5, 7, 0, 6, 1, 6, 6, 7,
   3, 5, 4, 5, 3, 6, 4, 6, 3, 8, 4, 9, 2, 5, 2, 6]
);

M.crawler = mkModel(
  [[-16, 0, -22], [16, 0, -22], [16, 0, 22], [-16, 0, 22],
   [-12, 9, -18], [12, 9, -18], [12, 9, 14], [-12, 9, 14],
   [0, 18, -2], [0, 13, 4], [0, 15, 30]],
  [...eLoop(0, 4), ...eLoop(4, 4), ...eLink(0, 4, 4), ...eFan(4, 4, 8), 9, 10]
);

M.spire = mkModel(
  [...sq(20, 0), ...sq(8, 92), ...sq(14, 114)],
  [...eLoop(0, 4), ...eLoop(4, 4), ...eLoop(8, 4), ...eLink(0, 4, 4), ...eLink(4, 8, 4)]
);

const OCTA_E = [0, 2, 0, 3, 0, 4, 0, 5, 1, 2, 1, 3, 1, 4, 1, 5, 2, 4, 2, 5, 3, 4, 3, 5];
M.octa = mkModel([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], OCTA_E);
M.crystal = mkModel([[1, 0, 0], [-1, 0, 0], [0, 1.7, 0], [0, -1.7, 0], [0, 0, 1], [0, 0, -1]], OCTA_E);

M.wisp = mkModel(
  [[8, 0, 0], [-8, 0, 0], [0, 8, 0], [0, -8, 0], [0, 0, 8], [0, 0, -8],
   [19, 0, 0], [-19, 0, 0], [0, 19, 0], [0, -19, 0], [0, 0, 19], [0, 0, -19]],
  [...OCTA_E, ...eLink(0, 6, 6)]
);

/* plasma bolt: a little spinning caltrop */
M.star = mkModel(
  [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
   [0.45, 0.45, 0], [-0.45, 0.45, 0], [-0.45, -0.45, 0], [0.45, -0.45, 0]],
  [0, 1, 2, 3, 4, 5, ...eLoop(6, 4)]
);

M.missile = mkModel(
  [[0, 0, 9], [-2.5, 0, -6], [2.5, 0, -6], [0, 2.5, -6], [0, -2.5, -6]],
  [0, 1, 0, 2, 0, 3, 0, 4, 1, 2, 3, 4]
);

M.turret = mkModel(
  [...sq(11, 0), [0, 15, 0], [0, 24, 0], [-5, 7.5, -5], [5, 7.5, -5], [5, 7.5, 5], [-5, 7.5, 5]],
  [...eLoop(0, 4), ...eFan(0, 4, 4), 4, 5, ...eLoop(6, 4)]
);

/* icosahedron (the Core) */
(function () {
  const p = (1 + Math.sqrt(5)) / 2, v = [];
  for (const a of [-1, 1]) for (const b of [-p, p]) v.push([0, a, b], [a, b, 0], [b, 0, a]);
  const n = Math.hypot(1, p);
  for (const q of v) { q[0] /= n; q[1] /= n; q[2] /= n; }
  const e = [];
  for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) {
    if (Math.hypot(v[i][0] - v[j][0], v[i][1] - v[j][1], v[i][2] - v[j][2]) < 1.1) e.push(i, j);
  }
  M.ico = mkModel(v, e);
})();

M.cube = mkModel(
  [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1], [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]],
  [...eLoop(0, 4), ...eLoop(4, 4), ...eLink(0, 4, 4)]
);

/* --- the rift gate: two concentric polygons joined by spokes, in the XY plane --- */
function ringModel(n, r1, r2) {
  const v = [];
  for (const r of [r1, r2]) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      v.push([Math.cos(a) * r, Math.sin(a) * r, 0]);
    }
  }
  return mkModel(v, [...eLoop(0, n), ...eLoop(n, n), ...eLink(0, n, n)]);
}
M.gate = ringModel(20, 128, 112);
M.gateInner = ringModel(6, 84, 70);

/* --- scenery (unit-ish, scaled when placed) --- */
M.pyramid = mkModel([...sq(1, 0), [0, 1.3, 0]], [...eLoop(0, 4), ...eFan(0, 4, 4)]);

M.obelisk = mkModel(
  [...sq(0.28, 0), ...sq(0.2, 2), [0, 2.45, 0]],
  [...eLoop(0, 4), ...eLoop(4, 4), ...eLink(0, 4, 4), ...eFan(4, 4, 8)]
);

M.arch = (function () {
  const prof = [[-1, 0], [-1, 1.6], [1, 1.6], [1, 0], [0.6, 0], [0.6, 1.2], [-0.6, 1.2], [-0.6, 0]];
  const v = [];
  for (const z of [-0.25, 0.25]) for (const q of prof) v.push([q[0], q[1], z]);
  return mkModel(v, [...eLoop(0, 8), ...eLoop(8, 8), ...eLink(0, 8, 8)]);
})();

M.antenna = mkModel(
  [[0, 0, 0], [0, 2.2, 0], [-0.5, 1.4, 0], [0.5, 1.4, 0], [-0.3, 1.8, 0], [0.3, 1.8, 0],
   [0, 2.2, 0.2], [0.2, 2.4, 0], [0, 2.6, -0.2], [-0.2, 2.4, 0], [-0.3, 0, -0.3], [0.3, 0, 0.3]],
  [0, 1, 2, 3, 4, 5, ...eLoop(6, 4), 10, 1, 11, 1]
);

M.bunker = mkModel(
  [...sq(1, 0), ...sq(0.8, 0.5), ...sq(0.4, 0.5), ...sq(0.3, 0.85)],
  [...eLoop(0, 4), ...eLoop(4, 4), ...eLink(0, 4, 4), ...eLoop(8, 4), ...eLoop(12, 4), ...eLink(8, 12, 4)]
);

/* scenery table: model, base scale, height & collision radius in model units (r 0 = fly-through) */
const DECO = [
  { m: M.pyramid, s: 60, h: 1.3, r: 0.75 },
  { m: M.obelisk, s: 52, h: 2.45, r: 0.3 },
  { m: M.arch, s: 70, h: 1.6, r: 0 },
  { m: M.antenna, s: 46, h: 2.6, r: 0 },
  { m: M.bunker, s: 50, h: 0.85, r: 0.9 },
  { m: M.pyramid, s: 34, h: 1.3, r: 0.75 },
];
