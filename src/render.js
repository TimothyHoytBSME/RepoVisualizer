import { DEP, REF } from './graph.js';

export const KINDS = ['dir', 'file', 'lib', 'class', 'type', 'module', 'function', 'method', 'variable', 'keyword'];
const BASE_R = { dir: 5.2, file: 4.6, lib: 4, class: 4.2, type: 3.6, module: 4, function: 3.3, method: 3, variable: 2.7, keyword: 4 };

const HEAD = `#version 300 es
uniform vec2 uCenter; uniform float uScale; uniform vec2 uHalf; uniform float uDpr;
`;
const NODE_VS = HEAD + `
layout(location=0) in vec2 aCorner;
layout(location=1) in vec2 aPos;
layout(location=2) in float aRad;
layout(location=3) in vec4 aCol;
layout(location=4) in float aRing;
out vec2 vP; out vec4 vCol; out float vR; out float vRing; out float vShape;
void main() {
  float shape = floor(aRing / 4.0);
  float ring = aRing - shape * 4.0;
  float r = max(aRad * uScale, 2.5 * uDpr);
  float h = r * 1.4 + (ring > 0.0 ? 6.0 * uDpr : 0.0) + 1.5;
  vec2 px = (aPos - uCenter) * uScale + aCorner * h;
  vP = aCorner * h; vR = r; vCol = aCol; vRing = ring; vShape = shape;
  gl_Position = vec4(px.x / uHalf.x, -px.y / uHalf.y, 0.0, 1.0);
}`;
const NODE_FS = `#version 300 es
precision highp float;
in vec2 vP; in vec4 vCol; in float vR; in float vRing; in float vShape;
uniform vec4 uSelCol; uniform vec4 uHlCol; uniform float uDpr;
out vec4 o;
void main() {
  vec2 q = abs(vP);
  float d;
  if (vShape > 1.5 && vShape < 2.5) d = (q.x + q.y) * 0.78;
  else if (vShape > 0.5 && vShape < 1.5) { vec2 q2 = q * q; d = sqrt(sqrt(q2.x * q2.x + q2.y * q2.y)) * 1.04; }
  else d = length(vP);
  float fa = clamp(vR - d + 0.5, 0.0, 1.0);
  if (vShape > 2.5) fa *= clamp(d - vR * 0.5 + 0.5, 0.0, 1.0);
  fa *= vCol.a;
  vec3 c = vCol.rgb * fa;
  float a = fa;
  if (vRing > 0.0) {
    vec4 rc = vRing > 1.5 ? uHlCol : uSelCol;
    float ra = clamp(1.2 * uDpr - abs(d - vR - 3.0 * uDpr) + 0.5, 0.0, 1.0) * rc.a;
    c += rc.rgb * ra * (1.0 - a);
    a += ra * (1.0 - a);
  }
  if (a < 0.003) discard;
  o = vec4(c, a);
}`;
const EDGE_VS = HEAD + `
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aSeg;
layout(location=2) in vec4 aCol;
layout(location=3) in vec4 aRad;
out vec4 vCol; out float vY; out float vW;
void main() {
  vec2 a = (aSeg.xy - uCenter) * uScale;
  vec2 b = (aSeg.zw - uCenter) * uScale;
  vec2 d = b - a;
  float L = length(d);
  vec2 dir = L > 0.001 ? d / L : vec2(1.0, 0.0);
  float ra = max(aRad.x * uScale, 2.5 * uDpr) + uDpr;
  float rb = max(aRad.y * uScale, 2.5 * uDpr) + uDpr + aRad.z * 6.0 * uDpr;
  vCol = aCol;
  if (L < ra + rb + 1.0) vCol.a = 0.0;
  a += dir * ra; b -= dir * rb;
  vec2 n = vec2(-dir.y, dir.x);
  float w = aRad.w * uDpr;
  float hw = w * 0.5 + 1.0;
  vec2 p = mix(a, b, aCorner.x) + n * aCorner.y * hw;
  vY = aCorner.y * hw; vW = w * 0.5;
  gl_Position = vec4(p.x / uHalf.x, -p.y / uHalf.y, 0.0, 1.0);
}`;
const EDGE_FS = `#version 300 es
precision highp float;
in vec4 vCol; in float vY; in float vW;
out vec4 o;
void main() {
  float a = clamp(vW - abs(vY) + 0.5, 0.0, 1.0) * vCol.a;
  if (a < 0.003) discard;
  o = vec4(vCol.rgb * a, a);
}`;
const ARROW_VS = HEAD + `
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aSeg;
layout(location=2) in vec4 aCol;
layout(location=3) in vec4 aRad;
out vec4 vCol;
void main() {
  vec2 a = (aSeg.xy - uCenter) * uScale;
  vec2 b = (aSeg.zw - uCenter) * uScale;
  vec2 d = b - a;
  float L = length(d);
  vec2 dir = L > 0.001 ? d / L : vec2(1.0, 0.0);
  float ra = max(aRad.x * uScale, 2.5 * uDpr);
  float rb = max(aRad.y * uScale, 2.5 * uDpr) + uDpr;
  vCol = aCol;
  if (L < ra + rb + 8.0 * uDpr) vCol.a = 0.0;
  float s = (aRad.w > 1.2 ? 1.25 : 1.0) * uDpr;
  vec2 tip = b - dir * rb;
  vec2 n = vec2(-dir.y, dir.x);
  vec2 p = aCorner.x > 0.5 ? tip : tip - dir * 8.0 * s + n * aCorner.y * 3.6 * s;
  gl_Position = vec4(p.x / uHalf.x, -p.y / uHalf.y, 0.0, 1.0);
}`;
const ARROW_FS = `#version 300 es
precision highp float;
in vec4 vCol;
out vec4 o;
void main() { if (vCol.a < 0.003) discard; o = vec4(vCol.rgb * vCol.a, vCol.a); }`;

function compile(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  for (const n of ['uCenter', 'uScale', 'uHalf', 'uDpr', 'uSelCol', 'uHlCol']) u[n] = gl.getUniformLocation(p, n);
  return { p, u };
}

function hex(c) {
  c = c.trim();
  if (c[0] === '#') {
    if (c.length === 4) c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
    return [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16) / 255);
  }
  const m = c.match(/[\d.]+/g);
  return m ? m.slice(0, 3).map(v => +v / 255) : [0.5, 0.5, 0.5];
}

export function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const v = n => cs.getPropertyValue(n);
  const p = { bg: hex(v('--bg')), fg: hex(v('--fg')), muted: hex(v('--muted')), accent: hex(v('--accent')), css: {}, kinds: [] };
  for (const n of ['--bg', '--fg', '--muted', '--accent']) p.css[n.slice(2)] = v(n).trim();
  for (const k of KINDS) p.kinds.push(hex(v('--k-' + k)));
  return p;
}

const SHAPE = { file: 1, dir: 1, lib: 2, keyword: 3 };

export function nodeStyle(g, view) {
  const kind = new Uint8Array(view.n), rad = new Float32Array(view.n), shape = new Uint8Array(view.n), label = new Array(view.n);
  const seen = new Map();
  for (const n of g.nodes) if (n.kind === 'file' || n.kind === 'dir') seen.set(n.kind + n.name, (seen.get(n.kind + n.name) || 0) + 1);
  for (let i = 0; i < view.n; i++) {
    const n = g.nodes[view.ids[i]];
    const k = KINDS.indexOf(n.kind);
    kind[i] = k < 0 ? 6 : k;
    rad[i] = (BASE_R[n.kind] || 3.3) + Math.min(5, 0.8 * Math.log2(1 + view.deg[i]));
    shape[i] = SHAPE[n.kind] || 0;
    label[i] = (n.kind === 'file' || n.kind === 'dir') && seen.get(n.kind + n.name) > 1 && n.parent > 0 ? g.nodes[n.parent].name + '/' + n.name : n.name;
  }
  return { kind, rad, shape, label };
}

export class Renderer {
  constructor(canvas, labels, onRestore, g2) {
    const gl = g2 ? null : canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
    if (!gl && !g2) throw new Error('This browser does not support WebGL2.');
    this.gl = gl;
    this.g2 = g2;
    this.flat = !!g2;
    this.canvas = canvas;
    this.labels = labels;
    this.ctx = labels.getContext('2d');
    this.widths = new Map();
    this.W = this.H = 1;
    this.dpr = 1;
    this.lost = false;
    this.grid = new Uint8Array(0);
    if (gl) canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; });
    if (gl) canvas.addEventListener('webglcontextrestored', () => { this.init(); this.lost = false; this.packKey = null; onRestore?.(); });
    this.init();
  }

  init() {
    const gl = this.gl;
    this.node = compile(gl, NODE_VS, NODE_FS);
    this.edge = compile(gl, EDGE_VS, EDGE_FS);
    this.arrow = compile(gl, ARROW_VS, ARROW_FS);
    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const strip = new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]);
    const tri = new Float32Array([1, 0, 0, 1, 0, -1]);
    this.bufs = {};
    for (const k of ['node', 'edge', 'arrow']) this.bufs[k] = { b: gl.createBuffer(), cap: 0 };
    this.nodeVao = this.vao(quad, this.bufs.node.b, [[1, 2, 0], [2, 1, 8], [3, 4, 12], [4, 1, 28]], 32);
    const eattrs = [[1, 4, 0], [2, 4, 16], [3, 4, 32]];
    this.edgeVao = this.vao(strip, this.bufs.edge.b, eattrs, 48);
    this.arrowVao = this.vao(tri, this.bufs.arrow.b, eattrs, 48);
    this.nodeData = new Float32Array(0);
    this.edgeData = new Float32Array(0);
    this.arrowData = new Float32Array(0);
  }

  vao(corners, inst, attrs, stride) {
    const gl = this.gl;
    const v = gl.createVertexArray();
    gl.bindVertexArray(v);
    const cb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cb);
    gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, inst);
    for (const [loc, size, off] of attrs) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);
    return v;
  }

  upload(key, data) {
    const gl = this.gl, B = this.bufs[key];
    gl.bindBuffer(gl.ARRAY_BUFFER, B.b);
    if (data.byteLength > B.cap) {
      B.cap = Math.max(data.byteLength, Math.ceil(B.cap * 1.5), 4096);
      gl.bufferData(gl.ARRAY_BUFFER, B.cap, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
  }

  resize(w, h, dpr) {
    this.W = w; this.H = h; this.dpr = dpr;
    for (const c of [this.canvas, this.labels]) {
      c.width = Math.max(1, Math.round(w * dpr));
      c.height = Math.max(1, Math.round(h * dpr));
    }
    this.widths.clear();
  }

  setLabelOrder(nb, rad) {
    const order = Array.from(nb.nodes);
    order.sort((a, b) => nb.depth[a] - nb.depth[b] || rad[b] - rad[a]);
    this.labelOrder = order;
  }

  draw(s) {
    if (this.lost) return;
    const key = [s.nb, s.sel, s.hl, s.hover, s.pal, s.ver, s.marks];
    const same = this.packKey && key.every((v, i) => v === this.packKey[i]);
    this.packKey = key;
    const { view, nb, lay, cam, pal, style, sel, hl, hover, marks } = s;
    const { x, y } = lay;
    const { kind, rad } = style;
    const nodes = nb.nodes, depth = nb.depth;
    const [bw, bh] = this.begin(pal);
    const dpr = this.dpr * (bw / this.canvas.width);

    const fade = d => Math.max(0.35, 1 - 0.13 * Math.max(0, d - 1));
    const E = nb.edges;
    if (same) {
      this.flush(cam, pal, dpr, bw, bh, null);
      this.drawLabels(s);
      return;
    }
    if (this.edgeData.length < E.length * 12) this.edgeData = new Float32Array(E.length * 12 + 1200);
    let arrows = 0;
    for (let i = 0; i < E.length; i++) if (view.eT[E[i]] === DEP) arrows++;
    if (this.arrowData.length < arrows * 12) this.arrowData = new Float32Array(arrows * 12 + 1200);
    const ed = this.edgeData, ad = this.arrowData;
    let ai = 0;
    for (let i = 0; i < E.length; i++) {
      const e = E[i], a = view.eA[e], b = view.eB[e], t = view.eT[e];
      const onPath = nb.pathE ? nb.pathE.has(e) : false;
      const hot = onPath || a === sel || b === sel || a === hl || b === hl || a === hover || b === hover;
      const c = onPath ? pal.accent : t === DEP ? pal.fg : pal.muted;
      let al = (t === DEP ? 0.34 : t === REF ? 0.3 : 0.2) * fade(Math.max(depth[a], depth[b])) * (depth[a] === depth[b] && depth[a] > 0 ? 0.45 : 1);
      if (hot) al = onPath ? 0.95 : Math.min(0.95, al * 2.6 + 0.15);
      else if (marks && !marks.has(a) && !marks.has(b)) al *= 0.35;
      const o = i * 12;
      ed[o] = x[a]; ed[o + 1] = y[a]; ed[o + 2] = x[b]; ed[o + 3] = y[b];
      ed[o + 4] = c[0]; ed[o + 5] = c[1]; ed[o + 6] = c[2]; ed[o + 7] = al;
      ed[o + 8] = rad[a]; ed[o + 9] = rad[b]; ed[o + 10] = t === DEP ? 1 : 0; ed[o + 11] = onPath ? 2.6 : hot ? 1.8 : 1.1;
      if (t === DEP) { ad.set(ed.subarray(o, o + 12), ai * 12); ai++; }
    }
    if (this.nodeData.length < nodes.length * 8) this.nodeData = new Float32Array(nodes.length * 8 + 800);
    const nd = this.nodeData;
    for (let k = nodes.length - 1, j = 0; k >= 0; k--, j++) {
      const i = nodes[k];
      const c = pal.kinds[kind[i]];
      const o = j * 8;
      nd[o] = x[i]; nd[o + 1] = y[i]; nd[o + 2] = rad[i];
      nd[o + 3] = c[0]; nd[o + 4] = c[1]; nd[o + 5] = c[2]; nd[o + 6] = marks ? (marks.has(i) ? 1 : i === sel ? fade(depth[i]) : 0.25) : fade(depth[i]);
      nd[o + 7] = (i === sel ? 1 : i === hl || i === hover || (nb.pathN && nb.pathN.has(i)) || (marks && marks.has(i)) ? 2 : 0) + style.shape[i] * 4;
    }

    this.counts = { edge: E.length, arrow: ai, node: nodes.length };
    this.flush(cam, pal, dpr, bw, bh, { edge: ed, arrow: ad, node: nd });
    this.drawLabels(s);
  }

  begin(pal) {
    const gl = this.gl;
    const bw = gl.drawingBufferWidth, bh = gl.drawingBufferHeight;
    gl.viewport(0, 0, bw, bh);
    gl.clearColor(pal.bg[0], pal.bg[1], pal.bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    return [bw, bh];
  }

  flush(cam, pal, dpr, bw, bh, data) {
    const gl = this.gl;
    const passes = [
      [this.edge, 'edge', 12, this.edgeVao, gl.TRIANGLE_STRIP, 4],
      [this.arrow, 'arrow', 12, this.arrowVao, gl.TRIANGLES, 3],
      [this.node, 'node', 8, this.nodeVao, gl.TRIANGLE_STRIP, 4],
    ];
    for (const [P, key, stride, vao, mode, verts] of passes) {
      const count = this.counts?.[key] || 0;
      if (!count) continue;
      gl.useProgram(P.p);
      gl.uniform2f(P.u.uCenter, cam.x, cam.y);
      gl.uniform1f(P.u.uScale, cam.scale * dpr);
      gl.uniform2f(P.u.uHalf, bw / 2, bh / 2);
      gl.uniform1f(P.u.uDpr, dpr);
      if (P.u.uSelCol) gl.uniform4f(P.u.uSelCol, pal.fg[0], pal.fg[1], pal.fg[2], 0.95);
      if (P.u.uHlCol) gl.uniform4f(P.u.uHlCol, pal.accent[0], pal.accent[1], pal.accent[2], 0.95);
      if (data) this.upload(key, data[key].subarray(0, count * stride));
      gl.bindVertexArray(vao);
      gl.drawArraysInstanced(mode, 0, verts, count);
    }
    gl.bindVertexArray(null);
  }

  drawLabels(s) {
    const { ctx, W, H, dpr } = this;
    const { g, view, nb, lay, cam, pal, style, sel, hl, hover } = s;
    if (this.graph !== g) { this.graph = g; this.widths.clear(); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!this.labelOrder) return;
    const CELL = 10, cols = Math.ceil(W / CELL) + 1, rows = Math.ceil(H / CELL) + 1;
    if (this.grid.length < cols * rows) this.grid = new Uint8Array(cols * rows);
    const grid = this.grid;
    grid.fill(0, 0, cols * rows);
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = pal.css.bg;
    ctx.lineWidth = 3;
    const keep = nb.pathN ? [sel, hl, hover, ...nb.pathN] : [sel, hl, hover];
    for (const i of keep) {
      if (i < 0 || nb.depth[i] < 0) continue;
      const r = style.rad[i] * cam.scale;
      const sx = (lay.x[i] - cam.x) * cam.scale + W / 2, sy = (lay.y[i] - cam.y) * cam.scale + H / 2;
      if (sx < -20 || sy < -20 || sx > W + 20 || sy > H + 20) continue;
      const q = Math.max(r, 4) * 0.8;
      const c0 = Math.max(0, Math.floor((sx - q) / CELL)), c1 = Math.min(cols - 1, Math.floor((sx + q) / CELL));
      const r0 = Math.max(0, Math.floor((sy - q) / CELL)), r1 = Math.min(rows - 1, Math.floor((sy + q) / CELL));
      for (let rr = r0; rr <= r1; rr++) grid.fill(2, rr * cols + c0, rr * cols + c1 + 1);
    }
    let count = 0;
    const more = this.moreHits = [];
    const label = (i, sp, pri) => {
      if (nb.depth[i] < 0) return;
      const r = Math.max(style.rad[i] * cam.scale, 2.5);
      if (!sp && !pri && r < 3.2 && nb.depth[i] > 1) return;
      const sx = (lay.x[i] - cam.x) * cam.scale + W / 2;
      const sy = (lay.y[i] - cam.y) * cam.scale + H / 2;
      if (sx < -200 || sx > W + 20 || sy < -20 || sy > H + 20) return;
      const gid = view.ids[i];
      const name = style.label[i];
      const px = i === sel ? 13 : nb.depth[i] <= 1 ? 12 : 11;
      const font = `${sp ? 600 : 500} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
      const key = gid * 64 + px * 2 + (sp ? 1 : 0);
      let w = this.widths.get(key);
      if (w === undefined) { ctx.font = font; w = ctx.measureText(name).width; this.widths.set(key, w); }
      const hid = nb.hidden ? nb.hidden.get(i) : 0, suf = hid ? ` +${hid}` : '';
      let w2 = 0;
      if (hid) {
        const k2 = suf + '|' + px;
        w2 = this.widths.get(k2);
        if (w2 === undefined) { ctx.font = `500 ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`; w2 = ctx.measureText(suf).width; this.widths.set(k2, w2); }
      }
      const tw = w + w2;
      let lx = sx + r + 4, ly = sy, c0 = 0, c1 = 0, r0 = 0, r1 = 0, ok = false;
      for (let at = 0; at < (sp ? 1 : 4) && !ok; at++) {
        if (at === 1) { lx = sx - r - 4 - tw; ly = sy; }
        else if (at === 2) { lx = sx - tw / 2; ly = sy - r - px / 2 - 3; }
        else if (at === 3) { lx = sx - tw / 2; ly = sy + r + px / 2 + 3; }
        c0 = Math.max(0, Math.floor(lx / CELL)); c1 = Math.min(cols - 1, Math.floor((lx + tw) / CELL));
        r0 = Math.max(0, Math.floor((ly - px / 2 - 1) / CELL)); r1 = Math.min(rows - 1, Math.floor((ly + px / 2 + 1) / CELL));
        ok = sp || (lx >= 2 && lx + tw <= W - 2);
        if (!sp) for (let rr = r0; rr <= r1 && ok; rr++) for (let cc = c0; cc <= c1; cc++) if (grid[rr * cols + cc]) { ok = false; break; }
      }
      if (!ok) return;
      for (let rr = r0; rr <= r1; rr++) grid.fill(1, rr * cols + c0, rr * cols + c1 + 1);
      ctx.font = font;
      ctx.globalAlpha = sp ? 1 : Math.max(0.45, 1 - 0.15 * Math.max(0, nb.depth[i] - 1));
      ctx.fillStyle = sp || pri || nb.depth[i] <= 1 ? pal.css.fg : pal.css.muted;
      if (pri) ctx.globalAlpha = 1;
      ctx.strokeText(name, lx, ly);
      ctx.fillText(name, lx, ly);
      if (hid) {
        ctx.font = `500 ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
        ctx.fillStyle = pal.css.accent;
        ctx.strokeText(suf, lx + w, ly);
        ctx.fillText(suf, lx + w, ly);
        more.push(i, lx + w, ly - px / 2, lx + w + w2, ly + px / 2);
      }
      count++;
    };
    if (sel >= 0) label(sel, true);
    if (hl >= 0 && hl !== sel) label(hl, true);
    if (hover >= 0 && hover !== sel && hover !== hl) label(hover, true);
    if (nb.pathN) for (const i of nb.pathN) if (i !== sel && i !== hl && i !== hover) label(i, true);
    if (s.marks) { let n = 0; for (const i of s.marks) if (i !== sel && i !== hl && i !== hover && n++ < 80) label(i, false, true); }
    const order = this.labelOrder;
    const cap = Math.max(60, Math.min(220, (W * H) / 4000));
    for (let k = 0; k < order.length && count <= cap && !s.marks; k++) {
      const i = order[k];
      if (i !== sel && i !== hl && i !== hover && !(nb.pathN && nb.pathN.has(i))) label(i, false);
    }
    ctx.globalAlpha = 1;
  }
}

const css = (c, a) => `rgba(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0},${a})`;

export class FlatRenderer extends Renderer {
  constructor(canvas, labels) {
    const c = canvas.cloneNode();
    canvas.replaceWith(c);
    const ctx = c.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Graphics are not available in this browser.');
    super(c, labels, null, ctx);
  }

  init() {
    this.nodeData = new Float32Array(0);
    this.edgeData = new Float32Array(0);
    this.arrowData = new Float32Array(0);
  }

  begin(pal) {
    const c = this.g2, w = this.canvas.width, h = this.canvas.height;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.fillStyle = css(pal.bg, 1);
    c.fillRect(0, 0, w, h);
    return [w, h];
  }

  flush(cam, pal, dpr, bw, bh) {
    const c = this.g2, n = this.counts || {}, S = cam.scale * dpr;
    const X = v => (v - cam.x) * S + bw / 2, Y = v => (v - cam.y) * S + bh / 2;
    const ed = this.edgeData, ad = this.arrowData, nd = this.nodeData;
    c.lineCap = 'round';
    for (let i = 0; i < (n.edge || 0); i++) {
      const o = i * 12;
      const ax = X(ed[o]), ay = Y(ed[o + 1]), bx = X(ed[o + 2]), by = Y(ed[o + 3]);
      const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
      const ra = Math.max(ed[o + 8] * S, 2.5 * dpr) + dpr, rb = Math.max(ed[o + 9] * S, 2.5 * dpr) + dpr + ed[o + 10] * 6 * dpr;
      if (L < ra + rb + 1) continue;
      const ux = dx / L, uy = dy / L;
      c.strokeStyle = css(ed.subarray(o + 4, o + 7), ed[o + 7]);
      c.lineWidth = ed[o + 11] * dpr;
      c.beginPath();
      c.moveTo(ax + ux * ra, ay + uy * ra);
      c.lineTo(bx - ux * rb, by - uy * rb);
      c.stroke();
    }
    for (let i = 0; i < (n.arrow || 0); i++) {
      const o = i * 12;
      const ax = X(ad[o]), ay = Y(ad[o + 1]), bx = X(ad[o + 2]), by = Y(ad[o + 3]);
      const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
      const ra = Math.max(ad[o + 8] * S, 2.5 * dpr), rb = Math.max(ad[o + 9] * S, 2.5 * dpr) + dpr;
      if (L < ra + rb + 8 * dpr) continue;
      const ux = dx / L, uy = dy / L, s = (ad[o + 11] > 1.2 ? 1.25 : 1) * dpr;
      const tx = bx - ux * rb, ty = by - uy * rb, kx = tx - ux * 8 * s, ky = ty - uy * 8 * s;
      c.fillStyle = css(ad.subarray(o + 4, o + 7), ad[o + 7]);
      c.beginPath();
      c.moveTo(tx, ty);
      c.lineTo(kx - uy * 3.6 * s, ky + ux * 3.6 * s);
      c.lineTo(kx + uy * 3.6 * s, ky - ux * 3.6 * s);
      c.fill();
    }
    const shape = (x, y, r, sh) => {
      c.beginPath();
      if (sh === 2) { const q = r * 1.28; c.moveTo(x, y - q); c.lineTo(x + q, y); c.lineTo(x, y + q); c.lineTo(x - q, y); c.closePath(); }
      else if (sh === 1) { const q = r * 0.9; if (c.roundRect) c.roundRect(x - q, y - q, 2 * q, 2 * q, q * 0.55); else c.rect(x - q, y - q, 2 * q, 2 * q); }
      else c.arc(x, y, r, 0, Math.PI * 2);
    };
    for (let j = 0; j < (n.node || 0); j++) {
      const o = j * 8;
      const x = X(nd[o]), y = Y(nd[o + 1]), r = Math.max(nd[o + 2] * S, 2.5 * dpr);
      if (x < -40 || y < -40 || x > bw + 40 || y > bh + 40) continue;
      const sh = Math.floor(nd[o + 7] / 4), ring = nd[o + 7] - sh * 4;
      const col = css(nd.subarray(o + 3, o + 6), nd[o + 6]);
      if (sh === 3) { shape(x, y, r * 0.75, 0); c.strokeStyle = col; c.lineWidth = r * 0.5; c.stroke(); }
      else { shape(x, y, r, sh); c.fillStyle = col; c.fill(); }
      if (ring > 0) {
        shape(x, y, r + 3 * dpr, sh === 3 ? 0 : sh);
        c.strokeStyle = css(ring > 1.5 ? pal.accent : pal.fg, 0.95);
        c.lineWidth = 1.2 * dpr;
        c.stroke();
      }
    }
  }
}
