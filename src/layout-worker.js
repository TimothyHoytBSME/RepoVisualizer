import { Layout } from './layout.js';

let lay = null, seq = 0, timer = 0;

function loop() {
  clearTimeout(timer);
  const t0 = performance.now();
  do lay.tick(); while (!lay.done && performance.now() - t0 < 14);
  const nodes = lay.nb.nodes, pos = new Float32Array(nodes.length * 2);
  for (let k = 0; k < nodes.length; k++) {
    pos[2 * k] = lay.x[nodes[k]];
    pos[2 * k + 1] = lay.y[nodes[k]];
  }
  self.postMessage({ seq, pos, alpha: lay.alpha }, [pos.buffer]);
  if (!lay.done) timer = setTimeout(loop, 0);
}

self.onmessage = e => {
  const m = e.data;
  if (m.type === 'view') {
    clearTimeout(timer);
    lay = new Layout({ n: m.n, eA: m.eA, eB: m.eB });
  } else if (m.type === 'set' && lay) {
    seq = m.seq;
    const { nodes, pos } = m;
    for (let k = 0; k < nodes.length; k++) {
      const u = nodes[k];
      lay.x[u] = pos[2 * k];
      lay.y[u] = pos[2 * k + 1];
      lay.vx[u] = lay.vy[u] = 0;
      lay.placed[u] = 1;
    }
    if (!lay.from) lay.from = new Int32Array(lay.x.length);
    for (let k = 0; k < nodes.length; k++) lay.from[nodes[k]] = m.par[k];
    lay.set({ nodes, depth: m.depth, edges: m.edges, from: lay.from }, m.sel);
    loop();
  }
};
