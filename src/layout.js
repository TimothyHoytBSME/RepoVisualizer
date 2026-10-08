const STRENGTH = -60;
const SPACE = 42;
const MIN_ALPHA = 0.004;
const TAU = Math.PI * 2;
const wrap = a => a - TAU * Math.round(a / TAU);

export function place(L, nb, sel, hx = 0, hy = 0) {
  const { x, y, placed } = L;
  if (!placed[sel]) { x[sel] = hx; y[sel] = hy; placed[sel] = 1; }
  for (const u of nb.nodes) {
    if (placed[u]) continue;
    const p = nb.from ? nb.from[u] : -1;
    const a = Math.random() * Math.PI * 2, r = 25 + Math.random() * 35;
    x[u] = (p >= 0 ? x[p] : x[sel]) + Math.cos(a) * r;
    y[u] = (p >= 0 ? y[p] : y[sel]) + Math.sin(a) * r;
    if (L.vx) L.vx[u] = L.vy[u] = 0;
    placed[u] = 1;
  }
}

export class Layout {
  constructor(view) {
    const n = view.n;
    this.view = view;
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.placed = new Uint8Array(n);
    this.vdeg = new Int32Array(n);
    this.bnext = new Int32Array(n);
    this.alo = new Float32Array(n);
    this.ahi = new Float32Array(n);
    this.alpha = 0;
    this.aspect = 1;
    this.ax = this.ay = 1;
    this.cap = 0;
    this.stack = new Int32Array(2048);
  }

  set(nb, sel, hx = 0, hy = 0) {
    const { vdeg, view } = this;
    this.nb = nb;
    this.sel = sel;
    place(this, nb, sel, hx, hy);
    const E = nb.edges, ne = E.length;
    for (const u of nb.nodes) vdeg[u] = 0;
    for (let i = 0; i < ne; i++) { vdeg[view.eA[E[i]]]++; vdeg[view.eB[E[i]]]++; }
    this.la = new Int32Array(ne);
    this.lb = new Int32Array(ne);
    this.ls = new Float32Array(ne);
    this.lbias = new Float32Array(ne);
    this.ld = new Float32Array(ne);
    for (let i = 0; i < ne; i++) {
      const a = view.eA[E[i]], b = view.eB[E[i]];
      const da = vdeg[a], db = vdeg[b];
      this.la[i] = a; this.lb[i] = b;
      this.ls[i] = 1 / Math.min(da, db);
      this.lbias[i] = da / (da + db);
      this.ld[i] = 50 + 5 * Math.sqrt(Math.min(da, db));
    }
    let maxD = 0;
    for (const u of nb.nodes) if (nb.depth[u] > maxD) maxD = nb.depth[u];
    const cnt = new Int32Array(maxD + 1);
    for (const u of nb.nodes) cnt[nb.depth[u]]++;
    this.rIn = new Float32Array(maxD + 1);
    this.rOut = new Float32Array(maxD + 1);
    let prev = 0;
    for (let d = 1; d <= maxD; d++) {
      const inner = prev + (d === 1 ? 30 : 24);
      const outer = Math.max(inner + 90, Math.sqrt(inner * inner + (cnt[d] * SPACE * SPACE) / Math.PI));
      this.rIn[d] = inner;
      this.rOut[d] = outer;
      prev = outer;
    }
    const asp = Math.min(1.8, Math.max(0.6, this.aspect || 1));
    this.ay = Math.sqrt(asp);
    this.ax = 1 / this.ay;
    this.sectors(nb, sel);
    const m = nb.nodes.length;
    this.theta2 = m > 3000 ? 1.44 : 0.81;
    this.decay = m > 8000 ? 0.045 : m > 2000 ? 0.03 : 0.0228;
    this.alpha = Math.max(this.alpha, 0.9);
  }

  sectors(nb, sel) {
    const { x, y, alo, ahi } = this, { nodes, depth, from } = nb;
    const m = nodes.length;
    this.useSec = !!from && m > 2;
    if (!this.useSec) return;
    const order = Array.from(nodes).sort((a, b) => depth[a] - depth[b]);
    const kids = new Map(), w = new Map();
    for (const u of order) {
      w.set(u, 1);
      const p = u === sel ? -1 : from[u];
      if (p >= 0 && p !== u) { const k = kids.get(p); if (k) k.push(u); else kids.set(p, [u]); }
    }
    for (let i = order.length - 1; i >= 0; i--) {
      const u = order[i], p = u === sel ? -1 : from[u];
      if (p >= 0 && w.has(p)) w.set(p, w.get(p) + w.get(u));
    }
    const sx = x[sel], sy = y[sel], { ax, ay } = this;
    const ang = u => Math.atan2((y[u] - sy) / ay, (x[u] - sx) / ax);
    const split = (u, lo, hi) => {
      const k = kids.get(u);
      if (!k) return;
      const mid = (lo + hi) / 2;
      const rel = new Map(k.map(c => [c, wrap(ang(c) - mid)]));
      k.sort((a, b) => rel.get(a) - rel.get(b));
      let tot = 0;
      for (const c of k) tot += w.get(c);
      let a = lo;
      if (u === sel) a = rel.get(k[0]) + mid - (w.get(k[0]) / tot) * Math.PI;
      for (const c of k) {
        const span = ((hi - lo) * w.get(c)) / tot;
        alo[c] = a; ahi[c] = a + span;
        split(c, a, a + span);
        a += span;
      }
    };
    for (const u of nodes) { alo[u] = -Math.PI; ahi[u] = Math.PI; }
    split(sel, -Math.PI, Math.PI);
  }

  run(budget) {
    if (this.alpha < MIN_ALPHA || !this.nb) return false;
    const t0 = performance.now();
    do this.tick(); while (this.alpha >= MIN_ALPHA && performance.now() - t0 < budget);
    return true;
  }

  get done() { return this.alpha < MIN_ALPHA; }

  tick() {
    const { x, y, vx, vy, la, lb, ls, lbias, ld, sel, rIn, rOut, alo, ahi, useSec, ax, ay } = this;
    const { nodes, depth } = this.nb;
    const alpha = this.alpha, warp = ax !== 1;
    if (warp) for (let k = 0; k < nodes.length; k++) { const i = nodes[k]; x[i] /= ax; y[i] /= ay; vx[i] /= ax; vy[i] /= ay; }
    for (let i = 0; i < la.length; i++) {
      const a = la[i], b = lb[i];
      let dx = x[b] + vx[b] - x[a] - vx[a], dy = y[b] + vy[b] - y[a] - vy[a];
      const l = Math.sqrt(dx * dx + dy * dy) || 1e-3;
      const f = ((l - ld[i]) / l) * alpha * ls[i];
      dx *= f; dy *= f;
      const bb = lbias[i];
      vx[b] -= dx * bb; vy[b] -= dy * bb;
      vx[a] += dx * (1 - bb); vy[a] += dy * (1 - bb);
    }
    this.charge(alpha);
    const sx = x[sel], sy = y[sel];
    for (let k = 0; k < nodes.length; k++) {
      const i = nodes[k];
      if (i === sel) continue;
      const dx = x[i] - sx, dy = y[i] - sy;
      const d = Math.sqrt(dx * dx + dy * dy) || 1e-3;
      const dd = depth[i], lo = rIn[dd], hi = rOut[dd];
      const target = d < lo ? lo : d > hi ? hi : d;
      if (target !== d) {
        const f = ((target - d) / d) * alpha * 0.2;
        vx[i] += dx * f; vy[i] += dy * f;
      }
      if (useSec) {
        const span = ahi[i] - alo[i];
        if (span < TAU - 1e-3) {
          const r = wrap(Math.atan2(dy, dx) - (alo[i] + ahi[i]) / 2), h = span / 2;
          if (r > h || r < -h) {
            const f = (r > 0 ? h - r : -h - r) * alpha * 0.15;
            vx[i] -= dy * f; vy[i] += dx * f;
          }
        }
      }
    }
    for (let k = 0; k < nodes.length; k++) {
      const i = nodes[k];
      if (i === sel) { vx[i] = vy[i] = 0; continue; }
      vx[i] *= 0.6; vy[i] *= 0.6;
      x[i] += vx[i]; y[i] += vy[i];
    }
    if (warp) for (let k = 0; k < nodes.length; k++) { const i = nodes[k]; x[i] *= ax; y[i] *= ay; vx[i] *= ax; vy[i] *= ay; }
    this.alpha -= this.alpha * this.decay;
  }

  charge(alpha) {
    const { x, y, vx, vy, bnext, theta2 } = this;
    const nodes = this.nb.nodes, m = nodes.length;
    if (m < 2) return;
    const need = m * 4 + 64;
    if (this.cap < need) {
      this.cap = need * 2;
      const c = this.cap;
      this.qx = new Float64Array(c); this.qy = new Float64Array(c); this.qm = new Float64Array(c);
      this.q0x = new Float64Array(c); this.q0y = new Float64Array(c); this.qs = new Float64Array(c);
      this.qc = new Int32Array(c * 4); this.qb = new Int32Array(c);
    }
    const { qx, qy, qm, q0x, q0y, qs, qc, qb, cap } = this;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < m; k++) {
      const i = nodes[k];
      if (x[i] < x0) x0 = x[i]; if (x[i] > x1) x1 = x[i];
      if (y[i] < y0) y0 = y[i]; if (y[i] > y1) y1 = y[i];
    }
    let count = 1;
    q0x[0] = x0; q0y[0] = y0; qs[0] = Math.max(x1 - x0, y1 - y0) + 1; qb[0] = -1;
    const quad = (nd, px, py) => {
      const h = qs[nd] / 2;
      return (px >= q0x[nd] + h ? 1 : 0) + (py >= q0y[nd] + h ? 2 : 0);
    };
    for (let k = 0; k < m; k++) {
      const i = nodes[k];
      bnext[i] = -1;
      let nd = 0, depth = 0;
      for (;;) {
        const b = qb[nd];
        if (b === -1) { qb[nd] = i; break; }
        if (b >= 0) {
          if ((x[b] === x[i] && y[b] === y[i]) || depth > 40 || count + 4 > cap) { bnext[i] = b; qb[nd] = i; break; }
          const c0 = count;
          count += 4;
          const h = qs[nd] / 2;
          for (let q = 0; q < 4; q++) {
            const c = c0 + q;
            q0x[c] = q0x[nd] + (q & 1 ? h : 0);
            q0y[c] = q0y[nd] + (q & 2 ? h : 0);
            qs[c] = h;
            qb[c] = -1;
            qc[nd * 4 + q] = c;
          }
          qb[nd] = -2;
          qb[c0 + quad(nd, x[b], y[b])] = b;
          continue;
        }
        nd = qc[nd * 4 + quad(nd, x[i], y[i])];
        depth++;
      }
    }
    for (let nd = count - 1; nd >= 0; nd--) {
      const b = qb[nd];
      if (b === -2) {
        let mm = 0, sx = 0, sy = 0;
        for (let q = 0; q < 4; q++) {
          const c = qc[nd * 4 + q];
          mm += qm[c]; sx += qx[c] * qm[c]; sy += qy[c] * qm[c];
        }
        qm[nd] = mm;
        if (mm) { qx[nd] = sx / mm; qy[nd] = sy / mm; }
      } else if (b >= 0) {
        let mm = 0, sx = 0, sy = 0;
        for (let j = b; j >= 0; j = bnext[j]) { mm++; sx += x[j]; sy += y[j]; }
        qm[nd] = mm; qx[nd] = sx / mm; qy[nd] = sy / mm;
      } else qm[nd] = 0;
    }
    const st = this.stack;
    const s = STRENGTH * alpha;
    for (let k = 0; k < m; k++) {
      const i = nodes[k];
      const xi = x[i], yi = y[i];
      let fx = 0, fy = 0, sp = 0;
      st[sp++] = 0;
      while (sp) {
        const nd = st[--sp];
        const mass = qm[nd];
        if (!mass) continue;
        const b = qb[nd];
        if (b === -2) {
          const dx = qx[nd] - xi, dy = qy[nd] - yi;
          const d2 = dx * dx + dy * dy;
          if (qs[nd] * qs[nd] < theta2 * d2) {
            const w = (s * mass) / Math.max(d2, 1);
            fx += dx * w; fy += dy * w;
          } else if (sp < st.length - 4) {
            for (let q = 0; q < 4; q++) st[sp++] = qc[nd * 4 + q];
          }
        } else {
          for (let j = b; j >= 0; j = bnext[j]) {
            if (j === i) continue;
            let dx = x[j] - xi, dy = y[j] - yi;
            let d2 = dx * dx + dy * dy;
            if (d2 < 1e-6) { dx = (Math.random() - 0.5) * 1e-2; dy = (Math.random() - 0.5) * 1e-2; d2 = dx * dx + dy * dy; }
            const w = s / Math.max(d2, 1);
            fx += dx * w; fy += dy * w;
          }
        }
      }
      vx[i] += fx; vy[i] += fy;
    }
  }
}
