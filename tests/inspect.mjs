import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const [dir, mode = 'sum', arg, other] = process.argv.slice(2);
if (!dir) {
  console.log(`usage: node tests/inspect.mjs <repo dir> [mode] [arg]
  sum                  counts of node kinds and edge types, library names
  refs                 most common targets of uncertain (ref) links
  file <path suffix>   definitions in a file and its outgoing links
  into <name>          links into nodes with this name
  diff <old src dir>   links added/removed compared with another copy of src/`);
  process.exit(0);
}
const { wanted } = await import(path.join(SRC, 'langs.js'));
const files = [];
const walk = d => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else { const rel = path.relative(dir, p); if (wanted(rel, fs.statSync(p).size)) files.push({ path: rel, text: fs.readFileSync(p, 'utf8') }); }
  }
};
walk(dir);
const run = async src => {
  const { analyze, EDGE_NAMES } = await import(path.join(path.resolve(src), 'analyze.js'));
  const t = performance.now();
  const g = analyze(files, 'r');
  return { g, E: EDGE_NAMES, ms: performance.now() - t };
};
const { g, E, ms } = await run(SRC);
const N = g.nodes, { s, t, type } = g.edges;
const nm = n => `${n.kind}:${n.name}${n.path ? '@' + n.path + ':' + (n.line + 1) : ''}`;
if (mode === 'sum') {
  const kinds = {}, et = {};
  for (const n of N) kinds[n.kind] = (kinds[n.kind] || 0) + 1;
  for (let k = 0; k < s.length; k++) et[E[type[k]]] = (et[E[type[k]]] || 0) + 1;
  console.log(files.length, 'files', ms.toFixed(0) + 'ms', JSON.stringify(kinds), JSON.stringify(et));
  console.log('libs:', N.filter(n => n.kind === 'lib').map(n => n.name).join(', '));
} else if (mode === 'refs') {
  const c = {};
  for (let k = 0; k < s.length; k++) if (E[type[k]] === 'ref' && N[t[k]].kind !== 'keyword') c[N[t[k]].name] = (c[N[t[k]].name] || 0) + 1;
  console.log(Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 40).map(x => x.join(':')).join(' '));
} else if (mode === 'file') {
  const f = N.find(n => n.kind === 'file' && n.path.endsWith(arg));
  for (const n of N) if (n.path === f.path && n.kind !== 'file') console.log(' ', n.kind, n.name, `${n.line + 1}-${n.end + 1}`);
  for (let k = 0; k < s.length; k++) if (E[type[k]] !== 'contain' && N[s[k]].path === f.path && N[t[k]].kind !== 'keyword') console.log(' ', nm(N[s[k]]), E[type[k]], nm(N[t[k]]));
} else if (mode === 'into') {
  for (let k = 0; k < s.length; k++) if (E[type[k]] !== 'contain' && N[t[k]].name === arg) console.log(' ', nm(N[s[k]]), E[type[k]], nm(N[t[k]]));
} else if (mode === 'diff') {
  const set = (g, E) => { const o = new Set(), { s, t, type } = g.edges; for (let k = 0; k < s.length; k++) if (E[type[k]] !== 'contain') o.add(`${E[type[k]]} ${g.nodes[s[k]].key} -> ${g.nodes[t[k]].key}`); return o; };
  const old = await run(arg);
  const A = set(old.g, old.E), B = set(g, E);
  const added = [...B].filter(x => !A.has(x)), removed = [...A].filter(x => !B.has(x));
  console.log('added', added.length, 'removed', removed.length);
  const n = +(other || 15);
  console.log('sample added:'); added.sort(() => Math.random() - 0.5).slice(0, n).forEach(x => console.log('  ', x));
  console.log('sample removed:'); removed.sort(() => Math.random() - 0.5).slice(0, n).forEach(x => console.log('  ', x));
}
