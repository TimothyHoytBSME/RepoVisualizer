export const REF = 1, CONTAIN = 2, DEP = 3;
const RANK = { ref: REF, contain: CONTAIN, dep: DEP };
const STRUCT = new Set(['dir', 'file', 'lib']);

function csr(n, count, each) {
  const start = new Int32Array(n + 1);
  each((a, b) => { start[a + 1]++; if (b >= 0) start[b + 1]++; });
  for (let i = 0; i < n; i++) start[i + 1] += start[i];
  const list = new Int32Array(start[n]);
  const fill = start.slice(0, n);
  let k = 0;
  each((a, b) => { list[fill[a]++] = k; if (b >= 0) list[fill[b]++] = k; k++; });
  return { start, list };
}

export function indexGraph(g) {
  const N = g.nodes.length;
  g.out = csr(N, g.edges.length, f => { for (const e of g.edges) f(e.s, -1); });
  g.in = csr(N, g.edges.length, f => { for (const e of g.edges) f(e.t, -1); });
  g.byKey = new Map(g.nodes.map(n => [n.key, n.id]));
}

export function edgesOf(g, id, dir) {
  const { start, list } = dir === 'in' ? g.in : g.out;
  const r = [];
  for (let k = start[id]; k < start[id + 1]; k++) r.push(g.edges[list[k]]);
  return r;
}

export function buildView(g, type) {
  const files = type === 'files';
  const keep = files ? k => STRUCT.has(k) : k => k !== 'dir';
  const local = new Int32Array(g.nodes.length).fill(-1);
  const ids = [];
  for (const n of g.nodes) if (keep(n.kind)) { local[n.id] = ids.length; ids.push(n.id); }
  const n = ids.length;
  const lift = id => (STRUCT.has(g.nodes[id].kind) ? id : g.nodes[id].file);
  const seen = new Map();
  const A = [], B = [], T = [];
  for (const e of g.edges) {
    let s = e.s, t = e.t;
    if (files && e.type !== 'contain') { s = lift(s); t = lift(t); }
    const a = local[s], b = local[t];
    if (a < 0 || b < 0 || a === b) continue;
    const k = a * n + b, ty = RANK[e.type];
    const p = seen.get(k);
    if (p !== undefined) { if (ty > T[p]) T[p] = ty; continue; }
    seen.set(k, A.length);
    A.push(a); B.push(b); T.push(ty);
  }
  const eA = Int32Array.from(A), eB = Int32Array.from(B), eT = Uint8Array.from(T);
  const adj = csr(n, A.length, f => { for (let i = 0; i < A.length; i++) f(A[i], B[i]); });
  const deg = new Int32Array(n);
  for (let i = 0; i < n; i++) deg[i] = adj.start[i + 1] - adj.start[i];
  return { type, ids, local, n, eA, eB, eT, start: adj.start, adj: adj.list, deg };
}

export function neighborhood(v, sel, depth) {
  const d = new Int32Array(v.n).fill(-1);
  const from = new Int32Array(v.n).fill(-1);
  const order = [sel];
  d[sel] = 0;
  for (let h = 0; h < order.length; h++) {
    const u = order[h];
    if (d[u] >= depth) continue;
    for (let k = v.start[u]; k < v.start[u + 1]; k++) {
      const e = v.adj[k];
      const w = v.eA[e] === u ? v.eB[e] : v.eA[e];
      if (d[w] < 0) { d[w] = d[u] + 1; from[w] = u; order.push(w); }
    }
  }
  const edges = [];
  for (const u of order) {
    for (let k = v.start[u]; k < v.start[u + 1]; k++) {
      const e = v.adj[k];
      const a = v.eA[e], b = v.eB[e];
      const w = a === u ? b : a;
      if (d[w] >= 0 && u === (a < b ? a : b)) edges.push(e);
    }
  }
  return { nodes: Int32Array.from(order), depth: d, from, edges: Int32Array.from(edges) };
}

export function defaultNode(g, v) {
  if (v.type === 'files') return v.local[0] >= 0 ? v.local[0] : 0;
  const minor = /(^|\/)(tests?|__tests__|spec|specs|examples?|docs?|benchmarks?|fixtures?|scripts?)\/|[._-](test|spec)s?\.|^test_|\.(md|json|ya?ml|toml|txt|html?|css)$/i;
  let best = 0, bd = -1;
  for (let i = 0; i < v.n; i++) {
    const n = g.nodes[v.ids[i]];
    if (n.kind !== 'file') continue;
    const score = v.deg[i] * (minor.test(n.path) || minor.test(n.name) ? 0.15 : 1);
    if (score > bd) { bd = score; best = i; }
  }
  return best;
}
