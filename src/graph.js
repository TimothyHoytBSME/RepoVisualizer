export const REF = 1, CONTAIN = 2, DEP = 3;
const NAMES = ['', 'ref', 'contain', 'dep'];
const STRUCT = new Set(['dir', 'file', 'lib']);

function csr(n, m, ends) {
  const start = new Int32Array(n + 1);
  for (const a of ends) for (let k = 0; k < m; k++) start[a[k] + 1]++;
  for (let i = 0; i < n; i++) start[i + 1] += start[i];
  const list = new Int32Array(start[n]);
  const fill = start.slice(0, n);
  for (const a of ends) for (let k = 0; k < m; k++) list[fill[a[k]]++] = k;
  return { start, list };
}

export function indexGraph(g) {
  const N = g.nodes.length, M = g.edges.s.length;
  g.out = csr(N, M, [g.edges.s]);
  g.in = csr(N, M, [g.edges.t]);
  g.byKey = new Map(g.nodes.map(n => [n.key, n.id]));
}

export function edgesOf(g, id, dir) {
  const { start, list } = dir === 'in' ? g.in : g.out;
  const { s, t, type } = g.edges;
  const r = [];
  for (let k = start[id]; k < start[id + 1]; k++) {
    const e = list[k];
    r.push({ s: s[e], t: t[e], type: NAMES[type[e]] });
  }
  return r;
}

export const TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs|testing|testdata|e2e)\/|[._-](test|spec)s?\.[^/]+$|(^|\/)test_[^/]*$|(^|\/)conftest\.py$/i;

export function isTest(n) {
  return n.kind !== 'lib' && !!n.path && TEST_PATH.test(n.kind === 'dir' ? n.path + '/' : n.path);
}

export function buildView(g, type, filters = {}) {
  const files = type === 'files', words = type === 'words';
  const keep = files ? k => STRUCT.has(k) : words ? k => k === 'file' || k === 'keyword' : k => k !== 'dir' && k !== 'keyword';
  const shown = n => keep(n.kind)
    && !(filters.tests === false && isTest(n))
    && !(filters.vars === false && n.kind === 'variable')
    && !(filters.libs === false && n.kind === 'lib');
  const local = new Int32Array(g.nodes.length).fill(-1);
  const ids = [];
  for (const n of g.nodes) if (shown(n)) { local[n.id] = ids.length; ids.push(n.id); }
  if (!ids.length) for (const n of g.nodes) if (keep(n.kind)) { local[n.id] = ids.length; ids.push(n.id); }
  const n = ids.length;
  const lift = id => (STRUCT.has(g.nodes[id].kind) ? id : g.nodes[id].file);
  const { s: ES, t: ET, type: TY } = g.edges;
  const seen = new Map();
  const A = [], B = [], T = [];
  for (let k = 0; k < ES.length; k++) {
    let s = ES[k], t = ET[k];
    const ty = TY[k];
    if (words ? g.nodes[t].kind !== 'keyword' : g.nodes[t].kind === 'keyword') continue;
    if (ty === REF && filters.refs === false && !words) continue;
    if (files && ty !== CONTAIN) { s = lift(s); t = lift(t); }
    const a = local[s], b = local[t];
    if (!(a >= 0) || !(b >= 0) || a === b) continue;
    const key = a * n + b;
    const p = seen.get(key);
    if (p !== undefined) { if (ty > T[p]) T[p] = ty; continue; }
    seen.set(key, A.length);
    A.push(a); B.push(b); T.push(ty);
  }
  const eA = Int32Array.from(A), eB = Int32Array.from(B), eT = Uint8Array.from(T);
  const adj = csr(n, eA.length, [eA, eB]);
  const deg = new Int32Array(n);
  for (let i = 0; i < n; i++) deg[i] = adj.start[i + 1] - adj.start[i];
  return { type, ids, local, n, eA, eB, eT, start: adj.start, adj: adj.list, deg };
}

function inducedEdges(v, order, d) {
  const edges = [];
  for (const u of order) {
    for (let k = v.start[u]; k < v.start[u + 1]; k++) {
      const e = v.adj[k];
      const a = v.eA[e], b = v.eB[e];
      const w = a === u ? b : a;
      if (d[w] >= 0 && u === (a < b ? a : b)) edges.push(e);
    }
  }
  return edges;
}

export function neighborhood(v, sel, depth, limit = Infinity) {
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
  const all = inducedEdges(v, order, d);
  const total = { nodes: order.length, edges: all.length };
  if (order.length <= limit) return { nodes: Int32Array.from(order), depth: d, from, edges: Int32Array.from(all), total };
  const keep = new Uint8Array(v.n);
  keep[sel] = 1;
  let kept = 1, level = [sel];
  for (let dd = 1; dd <= depth && kept < limit && level.length; dd++) {
    const score = new Map();
    for (const u of level) {
      for (let k = v.start[u]; k < v.start[u + 1]; k++) {
        const e = v.adj[k];
        const w = v.eA[e] === u ? v.eB[e] : v.eA[e];
        if (d[w] !== dd || keep[w]) continue;
        const s = score.get(w);
        if (s === undefined) { score.set(w, 1); from[w] = u; } else score.set(w, s + 1);
      }
    }
    const cands = [...score.keys()];
    const room = dd < depth ? Math.max(1, Math.floor((limit - kept) * 0.7)) : limit - kept;
    if (cands.length > room) {
      cands.sort((a, b) => score.get(b) - score.get(a) || v.deg[b] - v.deg[a]);
      cands.length = room;
    }
    for (const w of cands) keep[w] = 1;
    kept += cands.length;
    level = cands;
  }
  const nodes = order.filter(u => keep[u]);
  for (const u of order) if (!keep[u]) d[u] = -1;
  return { nodes: Int32Array.from(nodes), depth: d, from, edges: Int32Array.from(inducedEdges(v, nodes, d)), total };
}

export function defaultNode(g, v) {
  if (v.type === 'files') return v.local[0] >= 0 ? v.local[0] : 0;
  if (v.type === 'words') {
    let best = 0, bd = -1;
    for (let i = 0; i < v.n; i++) if (g.nodes[v.ids[i]].kind === 'keyword' && v.deg[i] > bd) { bd = v.deg[i]; best = i; }
    return best;
  }
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
