import { Layout, place } from './layout.js';

export class LayoutHost {
  constructor(view) {
    this.view = view;
    this.x = new Float32Array(view.n);
    this.y = new Float32Array(view.n);
    this.placed = new Uint8Array(view.n);
    this.alpha = 0;
    this.seq = 0;
    this.fresh = false;
    this.local = null;
    this.w = null;
    try {
      this.w = new Worker(new URL('./layout-worker.js', import.meta.url), { type: 'module' });
      this.w.onmessage = e => this.receive(e.data);
      this.w.onerror = e => { e.preventDefault?.(); this.fallback(); };
      this.w.postMessage({ type: 'view', n: view.n, eA: view.eA, eB: view.eB });
    } catch {
      this.fallback();
    }
  }

  fallback() {
    if (this.local) return;
    this.w?.terminate();
    this.w = null;
    const L = new Layout(this.view);
    L.x.set(this.x);
    L.y.set(this.y);
    L.placed.set(this.placed);
    this.local = L;
    this.x = L.x;
    this.y = L.y;
    this.placed = L.placed;
    if (this.nb) { L.set(this.nb, this.sel); this.alpha = L.alpha; }
  }

  receive(d) {
    if (d.seq !== this.seq || !this.nb) return;
    const nodes = this.nb.nodes, p = d.pos;
    for (let k = 0; k < nodes.length; k++) {
      this.x[nodes[k]] = p[2 * k];
      this.y[nodes[k]] = p[2 * k + 1];
    }
    this.alpha = d.alpha;
    this.fresh = true;
    this.onFresh?.();
  }

  set(nb, sel, hx = 0, hy = 0) {
    this.nb = nb;
    this.sel = sel;
    if (this.local) {
      this.local.set(nb, sel, hx, hy);
      this.alpha = this.local.alpha;
      this.onFresh?.();
      return;
    }
    place(this, nb, sel, hx, hy);
    const m = nb.nodes.length, pos = new Float32Array(m * 2);
    for (let k = 0; k < m; k++) {
      pos[2 * k] = this.x[nb.nodes[k]];
      pos[2 * k + 1] = this.y[nb.nodes[k]];
    }
    this.seq++;
    this.alpha = 0.9;
    this.w.postMessage({ type: 'set', seq: this.seq, nodes: nb.nodes, depth: nb.depth, edges: nb.edges, sel, pos }, [pos.buffer]);
  }

  run(budget) {
    if (this.local) {
      const moved = this.local.run(budget);
      this.alpha = this.local.alpha;
      return moved;
    }
    const f = this.fresh;
    this.fresh = false;
    return f;
  }

  dispose() {
    this.w?.terminate();
    this.w = null;
  }
}
