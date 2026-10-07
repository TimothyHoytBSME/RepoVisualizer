import { langOf, mask } from './langs.js';

const MAXC = 6;
const isFn = k => k === 'function' || k === 'method';
const isClassy = k => k === 'class' || k === 'type';

function lineStarts(t) {
  const s = [0];
  for (let i = t.indexOf('\n'); i >= 0; i = t.indexOf('\n', i + 1)) s.push(i + 1);
  return s;
}

function lineAt(s, idx) {
  let lo = 0, hi = s.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid] <= idx) lo = mid; else hi = mid - 1;
  }
  return lo;
}

function countLines(t) {
  let n = 1;
  for (let i = t.indexOf('\n'); i >= 0; i = t.indexOf('\n', i + 1)) n++;
  return n;
}

function indentOf(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 32) n++; else if (c === 9) n += 4; else break;
  }
  return n;
}

function blockEnd(lines, d) {
  const I = indentOf(lines[d]);
  let end = d, first = true;
  for (let k = d + 1; k < lines.length; k++) {
    const s = lines[k], t = s.trim();
    if (!t) continue;
    const ind = indentOf(s);
    if (ind > I) { end = k; first = false; continue; }
    if (ind === I) {
      const c = t[0];
      if (c === '{' && first) { end = k; first = false; continue; }
      if (c === '}' || c === ')' || c === ']') {
        end = k;
        if (/(?:[{(\[:]|=>)$/.test(t)) { first = false; continue; }
        break;
      }
      if (/^end\b/.test(t)) end = k;
    }
    break;
  }
  return end;
}

function extractDefs(masked, L, starts, lines) {
  const found = [], seen = new Set();
  const push = (name, idx, kind) => {
    if (L.clean) name = L.clean(name);
    if (!name || L.kw.has(name)) return;
    const line = lineAt(starts, idx);
    const k = line + ':' + name;
    if (seen.has(k)) return;
    if (kind === 'variable' && /,\s*$/.test(lines[line])) return;
    seen.add(k);
    found.push({ name, kind, line, idx, end: line });
  };
  for (const [re, kind] of L.defs) for (const m of masked.matchAll(re)) push(m[1], m.indices[1][0], kind);
  if (L.extra) for (const d of L.extra(masked)) push(d.name, d.idx, d.kind);
  found.sort((a, b) => a.idx - b.idx);
  for (const d of found) d.end = blockEnd(lines, d.line);
  return found;
}

const OPEN = '([{<', CLOSE = ')]}>';

function params(t, from, L) {
  const i = t.indexOf('(', from);
  if (i < 0 || i - from > 120 || /[{};]/.test(t.slice(from, i))) return [];
  let j = i + 1, depth = 1;
  const lim = Math.min(t.length, j + 2000);
  for (; j < lim && depth; j++) {
    const c = t[j];
    if (OPEN.includes(c)) depth++; else if (CLOSE.includes(c)) depth--;
  }
  if (depth) return [];
  const inner = t.slice(i + 1, j - 1), parts = [];
  let d = 0, s = 0;
  for (let k = 0; k < inner.length; k++) {
    const c = inner[k];
    if (OPEN.includes(c)) d++;
    else if (CLOSE.includes(c)) d--;
    else if (c === ',' && d === 0) { parts.push(inner.slice(s, k)); s = k + 1; }
  }
  parts.push(inner.slice(s));
  const out = [];
  for (const p of parts) {
    const head = p.split('=')[0];
    const colon = head.search(/(?<!:):(?!:)/);
    const pre = colon >= 0 ? head.slice(0, colon) : head;
    const ids = (pre.match(L.idAll) || []).filter(w => !L.kw.has(w));
    if (!ids.length) continue;
    if (/^\s*[{[]/.test(pre)) out.push(...ids);
    else out.push(colon >= 0 || L.paramLast ? ids[ids.length - 1] : ids[0]);
  }
  return out;
}

function join(dir, rel) {
  const out = dir ? dir.split('/') : [];
  for (const s of rel.split('/')) {
    if (!s || s === '.') continue;
    if (s === '..') { if (!out.length) return null; out.pop(); } else out.push(s);
  }
  return out.join('/');
}

const parentOf = d => (d ? d.slice(0, Math.max(0, d.lastIndexOf('/'))) : null);
const JS_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte', '.json', '.css', '.scss', '.d.ts'];
const EXTERNAL = /^([a-z][\w+.-]*:|\/\/|#)/i;

function makeResolver({ nodes, fileIds, dirs, dirFiles, csNs }) {
  const suffix = new Map();
  for (const [p, id] of fileIds) {
    let i = -1;
    do {
      const s = p.slice(i + 1);
      const a = suffix.get(s);
      if (a) a.push(id); else suffix.set(s, [id]);
      i = p.indexOf('/', i + 1);
    } while (i >= 0);
  }
  const topDirs = new Set([...dirs.keys()].filter(d => d && !d.includes('/')));
  const exact = p => (p == null ? null : fileIds.get(p) ?? null);
  const pick = (list, info) => {
    if (!list) return null;
    if (list.length === 1) return list[0];
    let best = list[0], bl = -1;
    const from = info.f.path;
    for (const id of list) {
      const p = nodes[id].path;
      let k = 0;
      while (k < p.length && p[k] === from[k]) k++;
      if (k > bl) { bl = k; best = id; }
    }
    return best;
  };
  const suf = (p, info) => pick(suffix.get(p), info);
  const dirMatch = spec => {
    let s = spec;
    for (;;) {
      if (dirs.has(s)) return s;
      const i = s.indexOf('/');
      if (i < 0) return null;
      s = s.slice(i + 1);
    }
  };
  const filesIn = (d, ext) => (dirFiles.get(d) || []).filter(id => nodes[id].path.endsWith(ext)).slice(0, 12);

  const tryJs = b => {
    if (b == null) return null;
    b = b.replace(/[?#].*$/, '').replace(/\/$/, '');
    let r = exact(b);
    if (r != null) return r;
    for (const e of JS_EXT) if ((r = exact(b + e)) != null) return r;
    for (const e of JS_EXT) if ((r = exact(b + '/index' + e)) != null) return r;
    const m = /\.[mc]?jsx?$/.exec(b);
    if (m) {
      const s = b.slice(0, m.index);
      for (const e of ['.ts', '.tsx', '.mts', '.cts']) if ((r = exact(s + e)) != null) return r;
    }
    return null;
  };

  const R = {
    js(spec, info) {
      if (EXTERNAL.test(spec) && !spec.startsWith('node:')) return null;
      if (spec[0] === '.') return tryJs(join(info.dir, spec));
      if (spec[0] === '/') return tryJs(spec.slice(1));
      const a = /^[@~#]\/(.*)$/.exec(spec);
      if (a) return tryJs('src/' + a[1]) ?? tryJs(a[1]);
      if (topDirs.has(spec.split('/')[0])) {
        const r = tryJs(spec);
        if (r != null) return r;
      }
      const s = spec.replace(/^node:/, '');
      return s[0] === '@' ? s.split('/').slice(0, 2).join('/') : s.split('/')[0];
    },
    py(spec, info) {
      const m = /^(\.*)(.*)$/.exec(spec);
      const dots = m[1].length, segs = m[2] ? m[2].split('.') : [];
      if (dots) {
        let d = info.dir;
        for (let i = 1; i < dots; i++) { d = parentOf(d); if (d == null) return null; }
        for (let k = segs.length; k >= 0; k--) {
          const b = segs.slice(0, k).join('/');
          const base = b ? join(d, b) : d;
          const r = (b ? exact(base + '.py') : null) ?? exact((base ? base + '/' : '') + '__init__.py');
          if (r != null) return r;
        }
        return null;
      }
      for (let k = segs.length; k > 0; k--) {
        const q = segs.slice(0, k).join('/');
        const r = suf(q + '.py', info) ?? suf(q + '/__init__.py', info);
        if (r != null) return r;
      }
      return segs[0];
    },
    go(spec) {
      const d = dirMatch(spec);
      if (d) {
        const fs = filesIn(d, '.go').filter(id => !nodes[id].path.endsWith('_test.go'));
        if (fs.length) return fs;
      }
      const p = spec.split('/');
      return p[0].includes('.') ? p.slice(0, 3).join('/') : spec;
    },
    rs(spec, info) {
      if (spec.startsWith('extern:')) return spec.slice(7);
      if (spec.startsWith('mod:')) {
        const x = spec.slice(4), fn = nodes[info.id].name;
        const base = /^(mod|lib|main)\.rs$/.test(fn) ? info.dir : join(info.dir, fn.replace(/\.rs$/, ''));
        return exact(join(base, x + '.rs')) ?? exact(join(base, x + '/mod.rs'));
      }
      const segs = spec.split('::').filter(Boolean);
      const head = segs[0];
      if (!head) return null;
      if (head === 'std' || head === 'core' || head === 'alloc') return head;
      const local = head === 'crate' || head === 'self' || head === 'super';
      const rest = local ? segs.slice(1) : segs;
      for (let k = rest.length; k > 0; k--) {
        const q = rest.slice(0, k).join('/');
        const r = suf(q + '.rs', info) ?? suf(q + '/mod.rs', info);
        if (r != null) return r;
      }
      return local ? null : head;
    },
    c(spec, info) {
      const sys = spec[0] === '<';
      const s = sys ? spec.slice(1) : spec;
      const r = exact(join(info.dir, s)) ?? suf(s.replace(/^(\.\.?\/)+/, ''), info);
      if (r != null) return r;
      return sys ? s.split('/')[0].replace(/\.(h|hpp|hh)$/, '') : null;
    },
    jvm(spec, info) {
      const wild = spec.endsWith('.*');
      const s = spec.replace(/\.\*$|\.$/, '');
      const segs = s.split('.');
      const min = segs.length >= 2 ? Math.max(2, segs.length - 2) : 1;
      for (let k = segs.length; k >= min; k--) {
        const q = segs.slice(0, k).join('/');
        for (const e of ['.java', '.kt', '.scala', '.groovy']) {
          const r = suf(q + e, info);
          if (r != null) return r;
        }
      }
      if (wild) {
        const d = dirMatch(segs.join('/'));
        if (d) {
          const fs = (dirFiles.get(d) || []).slice(0, 12);
          if (fs.length) return fs;
        }
      }
      return segs.slice(0, Math.min(2, segs.length)).join('.');
    },
    cs(spec) {
      const first = spec.split('.')[0];
      return csNs.has(first) ? null : first;
    },
    mod: spec => spec.split('.')[0],
    dart(spec, info) {
      if (spec.startsWith('dart:')) return spec;
      const m = /^package:([^/]+)\/(.*)$/.exec(spec);
      if (m) return suf('lib/' + m[2], info) ?? m[1];
      return exact(join(info.dir, spec));
    },
    rb(spec, info) {
      if (spec.startsWith('rel:')) {
        const b = join(info.dir, spec.slice(4));
        return b == null ? null : exact(b + '.rb') ?? exact(b);
      }
      return suf(spec.replace(/\.rb$/, '') + '.rb', info) ?? spec.split('/')[0];
    },
    php(spec, info) {
      if (/\/|\.php$/.test(spec)) {
        const s = spec.replace(/^\.\//, '');
        return exact(join(info.dir, s)) ?? suf(s.replace(/^(\.\.\/)+/, '').replace(/^\//, ''), info);
      }
      const segs = spec.split('\\').filter(Boolean);
      const n = segs.length;
      for (let i = 0; i <= Math.max(0, n - 2); i++) {
        const r = suf(segs.slice(i).join('/') + '.php', info);
        if (r != null) return r;
      }
      return n > 1 ? segs[0] : null;
    },
    lua(spec, info) {
      const p = spec.replace(/\./g, '/');
      return suf(p + '.lua', info) ?? suf(p + '/init.lua', info) ?? spec.split('.')[0];
    },
    sh(spec, info) {
      if (spec.includes('$')) return null;
      return exact(join(info.dir, spec)) ?? suf(spec.replace(/^(\.\.?\/)+/, ''), info);
    },
    css(spec, info) {
      if (EXTERNAL.test(spec)) return null;
      const b = spec[0] === '/' ? spec.slice(1) : join(info.dir, spec);
      if (b == null) return null;
      const i = b.lastIndexOf('/');
      const partial = b.slice(0, i + 1) + '_' + b.slice(i + 1);
      for (const x of [b, partial]) for (const e of ['', '.css', '.scss', '.sass', '.less']) {
        const r = exact(x + e);
        if (r != null) return r;
      }
      return null;
    },
    md(spec, info) {
      if (EXTERNAL.test(spec)) return null;
      let s = spec.split('#')[0];
      try { s = decodeURIComponent(s); } catch {}
      const b = s[0] === '/' ? s.slice(1) : join(info.dir, s);
      if (b == null) return null;
      const c = b.replace(/\/$/, '');
      return exact(c) ?? exact(c + '/README.md');
    },
    html(spec, info) {
      if (EXTERNAL.test(spec)) return null;
      const s = spec.split(/[?#]/)[0];
      return tryJs(s[0] === '/' ? s.slice(1) : join(info.dir, s));
    },
  };
  return (kind, spec, info) => (R[kind] ? R[kind](spec, info) : null);
}

export function analyze(files, rootName, progress = () => {}) {
  const nodes = [], edges = [];
  const add = n => { n.id = nodes.length; nodes.push(n); return n.id; };
  const root = add({ kind: 'dir', key: 'd:', name: rootName || 'repo', path: '', parent: -1, file: -1, line: 0, end: 0, group: '' });
  const dirs = new Map([['', root]]);
  const dirFiles = new Map([['', []]]);
  const dirNode = p => {
    let id = dirs.get(p);
    if (id !== undefined) return id;
    const i = p.lastIndexOf('/');
    const parent = dirNode(i < 0 ? '' : p.slice(0, i));
    id = add({ kind: 'dir', key: 'd:' + p, name: p.slice(i + 1), path: p, parent, file: -1, line: 0, end: 0, group: '' });
    dirs.set(p, id);
    dirFiles.set(p, []);
    edges.push({ s: parent, t: id, type: 'contain' });
    return id;
  };

  const sorted = files.slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const fileIds = new Map();
  const infos = [];
  for (const f of sorted) {
    if (fileIds.has(f.path)) continue;
    const i = f.path.lastIndexOf('/');
    const dir = i < 0 ? '' : f.path.slice(0, i);
    const parent = dirNode(dir);
    const L = langOf(f.path);
    const id = add({ kind: 'file', key: 'f:' + f.path, name: f.path.slice(i + 1), path: f.path, parent, file: -1, line: 0, end: countLines(f.text) - 1, group: L ? L.group : '' });
    nodes[id].file = id;
    fileIds.set(f.path, id);
    dirFiles.get(dir).push(id);
    edges.push({ s: parent, t: id, type: 'contain' });
    if (L) infos.push({ id, f, L, dir });
  }

  const names = new Map();
  const localsOf = new Map();
  const csNs = new Set();
  let done = 0;
  for (const info of infos) {
    if (++done % 50 === 0) progress({ phase: 'Reading code', done, total: infos.length });
    const { f, L } = info;
    const masked = L.syntax ? mask(f.text, L) : null;
    info.masked = masked;
    info.specs = L.imports ? L.imports(f.text, masked) : [];
    if (L.group === 'cs') for (const m of masked.matchAll(/\bnamespace[ \t]+(\w+)/g)) csNs.add(m[1]);
    if (!L.defs || !masked) continue;

    const starts = lineStarts(masked);
    const lines = masked.split('\n');
    const defs = extractDefs(masked, L, starts, lines);
    const stack = [];
    for (const d of defs) {
      while (stack.length && stack[stack.length - 1].end < d.line) stack.pop();
      d.up = stack.length ? stack[stack.length - 1] : null;
      stack.push(d);
    }
    for (const d of defs) {
      if (d.kind !== 'variable') continue;
      for (let p = d.up; p; p = p.up) if (isFn(p.kind)) { d.drop = true; break; }
    }
    for (const d of defs) {
      if (d.drop) {
        let p = d.up;
        while (p && !isFn(p.kind)) p = p.up;
        if (p) (p.locals ??= new Set()).add(d.name);
      } else if (isFn(d.kind)) {
        for (const x of params(masked, d.idx + d.name.length, L)) (d.locals ??= new Set()).add(x);
      }
    }
    const owner = new Int32Array(lines.length).fill(info.id);
    const defPos = new Set();
    const local = new Map();
    const keys = new Map();
    let g = names.get(L.group);
    if (!g) names.set(L.group, (g = new Map()));
    for (const d of defs) {
      if (d.drop) continue;
      let p = d.up;
      while (p && p.drop) p = p.up;
      if (d.kind === 'variable' && L.flatVars && !p && indentOf(lines[d.line]) > 0) { d.drop = true; continue; }
      if (d.kind === 'method' && !(p && isClassy(p.kind))) d.kind = 'function';
      else if (d.kind === 'function' && p && isClassy(p.kind)) d.kind = 'method';
      d.qual = p ? p.qual + '.' + d.name : d.name;
      let key = 's:' + f.path + '#' + d.qual;
      const c = (keys.get(key) || 0) + 1;
      keys.set(key, c);
      if (c > 1) key += '~' + c;
      const parent = p ? p.node : info.id;
      d.node = add({ kind: d.kind, key, name: d.name, path: f.path, parent, file: info.id, line: d.line, end: d.end, group: L.group });
      edges.push({ s: parent, t: d.node, type: 'contain' });
      if (d.locals) localsOf.set(d.node, d.locals);
      owner.fill(d.node, d.line, d.end + 1);
      defPos.add(d.idx);
      const a = g.get(d.name);
      if (a) a.push(d.node); else g.set(d.name, [d.node]);
      const b = local.get(d.name);
      if (b) b.push(d.node); else local.set(d.name, [d.node]);
    }
    Object.assign(info, { starts, owner, defPos, local });
  }

  const resolve = makeResolver({ nodes, fileIds, dirs, dirFiles, csNs });
  const libs = new Map();
  for (const info of infos) {
    info.imported = new Set();
    if (!info.specs.length) continue;
    const seen = new Set();
    for (const spec of info.specs) {
      let r;
      try { r = resolve(info.L.resolve, spec.trim(), info); } catch { r = null; }
      if (r == null || r === '') continue;
      if (typeof r === 'string') {
        let id = libs.get(r);
        if (id === undefined) {
          id = add({ kind: 'lib', key: 'l:' + r, name: r, path: '', parent: -1, file: -1, line: 0, end: 0, group: info.L.group });
          libs.set(r, id);
        }
        if (!seen.has(id)) { seen.add(id); edges.push({ s: info.id, t: id, type: 'dep' }); }
        continue;
      }
      for (const t of Array.isArray(r) ? r : [r]) {
        if (t === info.id || seen.has(t)) continue;
        seen.add(t);
        info.imported.add(t);
        edges.push({ s: info.id, t, type: info.L.linkType || 'dep' });
      }
    }
  }

  done = 0;
  for (const info of infos) {
    if (++done % 50 === 0) progress({ phase: 'Linking', done, total: infos.length });
    if (!info.owner) continue;
    const { L, masked, starts, owner, defPos, local, id: fid } = info;
    const g = names.get(L.group);
    const fdir = nodes[fid].parent;
    const out = new Map();
    let ln = 0;
    for (const m of masked.matchAll(L.id)) {
      const name = m[0];
      if (name.length < 2) continue;
      const cands = g.get(name);
      if (!cands) continue;
      const at = m.index;
      if (defPos.has(at)) continue;
      while (ln + 1 < starts.length && starts[ln + 1] <= at) ln++;
      const src = owner[ln];
      let shadow = false;
      for (let o = src; o !== fid && o >= 0; o = nodes[o].parent) {
        const ls = localsOf.get(o);
        if (ls && ls.has(name)) { shadow = true; break; }
      }
      if (shadow) continue;
      let targets = local.get(name);
      let type = 'dep';
      if (!targets) {
        if (cands.length > 200) continue;
        targets = cands.filter(c => info.imported.has(nodes[c].file));
        if (!targets.length && L.pkgDir) targets = cands.filter(c => nodes[nodes[c].file].parent === fdir);
        if (!targets.length) {
          if (cands.length > MAXC) continue;
          targets = cands;
          if (cands.length > 1 || L.explicit) type = 'ref';
        }
      }
      if (targets.length > MAXC) continue;
      for (const t of targets) {
        if (t === src || nodes[t].parent === src || nodes[src].parent === t) continue;
        const k = src + ',' + t;
        const prev = out.get(k);
        if (prev === undefined || (prev === 'ref' && type === 'dep')) out.set(k, type);
      }
    }
    for (const [k, type] of out) {
      const i = k.indexOf(',');
      edges.push({ s: +k.slice(0, i), t: +k.slice(i + 1), type });
    }
  }

  let symbols = 0;
  for (const n of nodes) if (n.kind !== 'dir' && n.kind !== 'file' && n.kind !== 'lib') symbols++;
  return { nodes, edges, stats: { files: fileIds.size, symbols, libs: libs.size } };
}
