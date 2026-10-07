import { langOf, mask } from './langs.js';
import { TEST_PATH } from './graph.js';

const MAXC = 6;
const WORD = /[A-Z]+(?![a-z])|[A-Z]?[a-z]+/g;
const STOP = new Set(`the and for with from that this these those not are was were has have had but can will would should could into onto over under than then else when what which who why how all any each every some such own same other only also just very too more most less least out off its our your their there here where
self cls this that args kwargs arg argv param params def func fn var let const return returns true false none null nil undefined new get set put has len str int bool float double char byte void obj val vals tmp res err ret ptr ref refs num idx cnt buf src dst msg ctx cfg opts opt env impl util utils misc foo bar baz qux test tests spec mock todo fixme xxx main init assert equal expect should describe require testing value data index add remove type default create dict list key code next end name item log join console length format result output input check call run make update count first last size string number object array function method module export import`.split(/\s+/));
const stem = w => (w.length > 4 && w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 4 && w.endsWith('s') && !/(ss|us|is|os)$/.test(w) ? w.slice(0, -1) : w);

function keywords(infos, nodes, edges, add) {
  const cache = new Map();
  const split = id => {
    let w = cache.get(id);
    if (!w) {
      w = [];
      for (const p of id.match(WORD) || []) {
        const x = stem(p.toLowerCase());
        if (x.length >= 3 && !STOP.has(x)) w.push(x);
      }
      cache.set(id, w);
    }
    return w;
  };
  const tfs = [], df = new Map();
  for (const info of infos) {
    if (!info.idc) continue;
    const tf = new Map();
    for (const [id, c] of info.idc) for (const w of split(id)) tf.set(w, (tf.get(w) || 0) + c);
    for (const w of tf.keys()) df.set(w, (df.get(w) || 0) + 1);
    tfs.push([info.id, tf]);
    info.idc = null;
  }
  const N = tfs.length;
  if (N < 3) return;
  const maxDf = Math.max(3, Math.floor(N * 0.4)), minDf = N > 60 ? 3 : 2;
  const chosen = new Set([...df].filter(([, d]) => d >= minDf && d <= maxDf)
    .map(([w, d]) => [w, d * Math.log(N / d)]).sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(30, Math.min(500, Math.round(N / 3)))).map(([w]) => w));
  const ids = new Map();
  for (const [fid, tf] of tfs) {
    const top = [];
    for (const [w, c] of tf) if (chosen.has(w)) top.push([w, c * Math.log(N / df.get(w))]);
    top.sort((a, b) => b[1] - a[1]);
    for (const [w] of top.slice(0, 8)) {
      let k = ids.get(w);
      if (k === undefined) {
        k = add({ kind: 'keyword', key: 'k:' + w, name: w, path: '', parent: -1, file: -1, line: 0, end: 0, group: '' });
        ids.set(w, k);
      }
      edges.push({ s: fid, t: k, type: 'ref' });
    }
  }
}
const EDGE_CODE = { ref: 1, contain: 2, dep: 3 };
export const EDGE_NAMES = ['', 'ref', 'contain', 'dep'];
const PROP_FN = /(?:\.[\w$]+\s*=|[\w$]+\s*:)\s*(?:async\s+)?function\s*\*?\s*$|\.prototype\.$/;
const CAP_TYPES = new Set(['jvm', 'cs', 'swift', 'dart', 'py', 'rs', 'rb', 'php']);
const IMPLICIT_THIS = new Set(['jvm', 'cs', 'swift', 'dart', 'c', 'rb']);
const AMBIENT = /\.d\.[mc]?ts$/;
const isFn = k => k === 'function' || k === 'method';
const SELF = new Set(['this', 'self', 'Self', 'static', 'me']);
const COMMON = new Set(`each map filter reduce forEach get set put add remove delete has contains size length count keys values entries items push pop shift unshift append insert extend clear close open read write flush call apply bind toString equals hashCode compareTo next hasNext iterator then catch finally emit on off once parse format join split replace trim match test exec find first last sort reverse slice copy clone merge reset cancel value name type id data message error list log debug info warn trace dispose description key path url status result index text constructor prototype String Error Get Set Write Read Close Len Open Value Type Status ToString Equals GetHashCode Add Remove Count Contains Clear Dispose Any Select Where First FirstOrDefault ToList ToArray Single Max Min Sum OrderBy Include unwrap expect as_bytes as_str as_ref as_mut is_none is_some is_ok is_err is_empty iter iter_mut into_iter to_string to_owned unwrap_or map_err ok err lines bytes chars len borrow kind start end to_s to_str to_a to_h to_i to_sym inspect respond_to? include? empty? nil? is_a? kind_of? dup freeze tap merge! fetch __toString __get __set __call`.split(/\s+/));
const NOT_TYPE = new Set('return throw new else case yield await goto in is as out ref package import using namespace extends implements throws delete sizeof typeof echo print'.split(' '));
const isW = c => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
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

const LABELS = /^(?:[A-Za-z_$][\w$]*:(?!:)\s*$|case\b|default\s*:)/;
const SKIP_SAME = {
  c: /^(?:#|[A-Za-z_]\w*:(?!:)\s*$|case\b|default\s*:)/,
  cs: /^(?:#|[A-Za-z_]\w*:(?!:)\s*$|case\b|default\s*:)/,
  go: LABELS, js: LABELS, jvm: LABELS, rs: LABELS, swift: LABELS, dart: LABELS, php: LABELS,
  rb: /^(?:rescue|ensure|elsif|when|else)\b/,
};

function blockEnd(lines, d, skip, cont) {
  const I = indentOf(lines[d]);
  let end = d, first = true;
  for (let k = d + 1; k < lines.length; k++) {
    const s = lines[k], t = s.trim();
    if (!t) continue;
    const ind = indentOf(s);
    if (ind > I) { end = k; first = false; continue; }
    if (ind === I) {
      const c = t[0];
      if (cont && first && cont.test(t)) { end = k; cont = null; continue; }
      if (skip && skip.test(t)) continue;
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

const skipOf = L => SKIP_SAME[L.group];

function extractDefs(masked, L, starts, lines) {
  const found = [], seen = new Set();
  let pdepth = null;
  const nested = line => {
    if (!pdepth) {
      pdepth = new Int16Array(lines.length);
      let d = 0, ln = 0;
      for (let i = 0; i < masked.length; i++) {
        const c = masked.charCodeAt(i);
        if (c === 10) { if (++ln < pdepth.length) pdepth[ln] = d; }
        else if (c === 40 || c === 91) d++;
        else if ((c === 41 || c === 93) && d > 0) d--;
      }
    }
    return pdepth[line] > 0;
  };
  const push = (name, idx, kind, extra, owner, self) => {
    if (L.clean) name = L.clean(name);
    if (!name || L.kw.has(name)) return;
    const line = lineAt(starts, idx);
    const k = line + ':' + name;
    if (seen.has(k)) return;
    if (kind === 'variable') {
      const ln = lines[line];
      if (!extra && ((ln.length < 2000 && /,\s*$/.test(ln)) || (L.group === 'py' && nested(line)))) return;
    }
    seen.add(k);
    if (!owner && L.extRecv && kind === 'function') {
      const r = L.extRecv.exec(masked.slice(Math.max(starts[line], idx - 160), idx));
      if (r) owner = r[1];
    }
    found.push({ name, kind, line, idx, end: line, owner, self });
  };
  for (const [re, kind, ok, keep] of L.defs) {
    for (const m of masked.matchAll(re)) {
      const i = m.indices[1][0];
      if (!ok || ok(masked, i)) push(m[1], i, kind, keep);
    }
  }
  if (L.extra) for (const d of L.extra(masked)) push(d.name, d.idx, d.kind, true, d.owner, d.self);
  found.sort((a, b) => a.idx - b.idx);
  const skip = SKIP_SAME[L.group];
  for (const d of found) d.end = blockEnd(lines, d.line, skip, d.kind === 'class' ? L.head : null);
  return found;
}

const OPEN = '([{<', CLOSE = ')]}>';

const FIELD_MODS = new Set('public private protected internal static final readonly override abstract virtual new required lateinit open transient volatile const sealed partial'.split(' '));
const CTOR = /^(?:constructor|__init__|init|initialize)$/;
const MODS = new Set('final const out ref in params this readonly volatile struct unsigned signed static register mut inout var val let'.split(' '));
const lastSeg = s => { const m = s.match(/[A-Za-z_]\w*/g); return m ? m[m.length - 1] : null; };
const CALL_VARS = [
  /\b(?:let|var|val|const|auto)[ \t]+([A-Za-z_$][\w$]*)[ \t]*=[ \t]*(?:try[!?]?[ \t]+|await[ \t]+)*(?:[\w$]+[ \t]*\.[ \t]*)*([A-Za-z_$][\w$]*)[ \t]*\(/g,
  /\b([A-Za-z_]\w*)(?:[ \t]*,[ \t]*\w+)?[ \t]*:=[ \t]*(?:\w+\.)*([A-Za-z_]\w*)[ \t]*\(/g,
];
const CALL_VARS_PLAIN = /^[ \t]*([A-Za-z_]\w*)[ \t]*=[ \t]*(?:await[ \t]+)?(?:[\w]+\.)*([A-Za-z_]\w*)[ \t]*\(/gm;
const RET = [
  /^\s*(?:async\s+)?(?:throws\s+|rethrows\s+)?->\s*&?(?:mut\s+)?(?:impl\s+|dyn\s+)?(?:[a-z]\w*(?:::|\.))*([A-Za-z_]\w*)/,
  /^\s*:\s*(?:Promise<\s*)?(?:[a-z]\w*\.)*([A-Za-z_]\w*)/,
];
const RET_GO = /^\s*\(?\s*\*?(?:[a-z]\w*\.)?([A-Z]\w*)/;

function afterParams(t, from) {
  const i = t.indexOf('(', from);
  if (i < 0 || i - from > 120) return -1;
  let j = i + 1, depth = 1;
  const lim = Math.min(t.length, j + 3000);
  for (; j < lim && depth; j++) {
    const c = t.charCodeAt(j);
    if (c === 40) depth++; else if (c === 41) depth--;
  }
  return depth ? -1 : j;
}

const VAR_TYPES = [
  /\b(?:const|let|var|val|auto)[ \t]+([A-Za-z_$][\w$]*)[ \t]*(?::[ \t]*([A-Za-z_][\w.]*))?[ \t]*(?:=[ \t]*(?:new[ \t]+([A-Za-z_][\w.]*)|([A-Z]\w*)[ \t]*[({]))?/g,
  /\b([A-Za-z_]\w*)[ \t]*:=[ \t]*&?(?:[a-z]\w*\.)?([A-Z]\w*)[ \t]*\{/g,
];

function params(t, from, L, types) {
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
    let colon = -1;
    for (let k = 0; k < head.length; k++) {
      if (head[k] === ':' && head[k - 1] !== ':' && head[k + 1] !== ':') { colon = k; break; }
    }
    const pre = colon >= 0 ? head.slice(0, colon) : head;
    const ids = (pre.match(L.idAll) || []).filter(w => !L.kw.has(w));
    if (!ids.length) continue;
    if (/^\s*[{[]/.test(pre)) { out.push(...ids); continue; }
    const name = colon >= 0 || L.paramLast ? ids[ids.length - 1] : ids[0];
    out.push(name);
    if (!types) continue;
    let ty = null;
    if (colon >= 0) ty = lastSeg(head.slice(colon + 1).replace(/<[^]*$/, '').replace(/\b(?:mut|const|readonly|inout|dyn|impl)\b/g, ''));
    else {
      const all = (pre.replace(/<[^]*?>/g, ' ').match(L.idAll) || []).filter(w => !MODS.has(w));
      if (L.paramLast) ty = all.length > 1 ? all[all.length - 2] : null;
      else if (L.group === 'go') ty = all.length > 1 ? all[all.length - 1] : null;
    }
    if (ty && ty !== name) types.set(name, ty);
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

function suffixMap(entries) {
  const map = new Map();
  for (const [p, v] of entries) {
    if (!p) continue;
    let i = -1;
    do {
      const s = p.slice(i + 1);
      const a = map.get(s);
      if (a) a.push(v); else map.set(s, [v]);
      i = p.indexOf('/', i + 1);
    } while (i >= 0);
  }
  return map;
}

function looseJSON(t) {
  let o = '', i = 0;
  const n = t.length;
  while (i < n) {
    const c = t[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && t[j] !== '"') j += t[j] === '\\' ? 2 : 1;
      o += t.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && t[i + 1] === '/') {
      const j = t.indexOf('\n', i);
      i = j < 0 ? n : j;
    } else if (c === '/' && t[i + 1] === '*') {
      const j = t.indexOf('*/', i + 2);
      i = j < 0 ? n : j + 2;
    } else { o += c; i++; }
  }
  try { return JSON.parse(o.replace(/,(\s*[}\]])/g, '$1')); } catch { return null; }
}

function makeResolver({ nodes, fileIds, dirs, dirFiles, csNs, goMods, names, swiftMods, crates, jsPkgs, jsAliases }) {
  const suffix = suffixMap(fileIds);
  const csFirst = new Set([...csNs].map(n => n.split('.')[0]));
  const dirSuffix = suffixMap([...dirs.keys()].map(d => [d, d]));
  const prefixOf = (id, tail) => { const p = nodes[id].path; return p.slice(0, p.length - tail.length); };
  const hasFile = (d, f) => fileIds.has((d ? d + '/' : '') + f);
  const isGo = id => nodes[id].path.endsWith('.go') && !nodes[id].path.endsWith('_test.go');
  const goPkg = d => { const fs = (dirFiles.get(d) || []).filter(isGo); return fs.length ? fs.slice(0, 60) : null; };
  const crateRoot = dir => {
    for (let d = dir; d != null; d = parentOf(d)) {
      if (hasFile(d, 'lib.rs') || hasFile(d, 'main.rs')) return d;
      if (!d) break;
    }
    return null;
  };
  const modDir = info => (/^(mod|lib|main)\.rs$/.test(nodes[info.id].name) ? info.dir : join(info.dir, nodes[info.id].name.replace(/\.rs$/, '')));
  const rsFind = (base, rest) => {
    for (let k = rest.length; k > 0; k--) {
      const q = rest.slice(0, k).join('/');
      const r = exact(join(base, q + '.rs')) ?? exact(join(base, q + '/mod.rs'));
      if (r != null) return r;
    }
    return null;
  };
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

  const tryJs = b => {
    if (b == null) return null;
    b = b.replace(/[?#].*$/, '').replace(/\/$/, '');
    let r = exact(b);
    if (r != null) return r;
    for (const e of JS_EXT) if ((r = exact(b + e)) != null) return r;
    const pre = b ? b + '/' : '';
    for (const e of JS_EXT) if ((r = exact(pre + 'index' + e)) != null) return r;
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
      for (const al of jsAliases) {
        if (al.post == null ? spec !== al.pre : !(spec.startsWith(al.pre) && spec.endsWith(al.post) && spec.length >= al.pre.length + al.post.length)) continue;
        const mid = al.post == null ? '' : spec.slice(al.pre.length, spec.length - al.post.length);
        for (const t of al.targets) { const r = tryJs(t.replace('*', mid)); if (r != null) return r; }
      }
      if (jsPkgs.size) {
        const segs = spec.split('/'), name = spec[0] === '@' ? segs.slice(0, 2).join('/') : segs[0];
        const p = jsPkgs.get(name);
        if (p) {
          const rest = spec.slice(name.length + 1);
          if (rest) { const r = tryJs(join(p.dir, rest)) ?? tryJs(join(p.dir, 'src/' + rest)); if (r != null) return r; }
          else {
            for (const e of p.entry) { const r = tryJs(join(p.dir, e.replace(/^\.\//, ''))); if (r != null) return r; }
            const r = tryJs(join(p.dir, 'src')) ?? tryJs(p.dir) ?? tryJs(join(p.dir, 'lib'));
            if (r != null) return r;
          }
        }
      }
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
        for (const tail of [q + '.py', q + '/__init__.py']) {
          const list = (suffix.get(tail) || []).filter(id => !hasFile(prefixOf(id, tail).replace(/\/$/, ''), '__init__.py'));
          const r = pick(list.length ? list : null, info);
          if (r != null) return r;
        }
      }
      return segs[0];
    },
    go(spec) {
      for (const { dir, mod } of goMods) {
        if (spec === mod) return goPkg(dir);
        if (spec.startsWith(mod + '/')) return goPkg(join(dir, spec.slice(mod.length + 1)));
      }
      const p = spec.split('/');
      if (!p[0].includes('.')) return spec;
      if (!goMods.length) {
        const d = dirMatch(spec);
        if (d) { const fs = goPkg(d); if (fs) return fs; }
      }
      return p.slice(0, 3).join('/');
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
      if (head === 'crate') {
        const root = crateRoot(info.dir);
        return root == null ? null : rsFind(root, segs.slice(1));
      }
      if (head === 'self' || head === 'super') {
        let base = modDir(info), i = 0;
        while (segs[i] === 'super' || segs[i] === 'self') {
          if (segs[i] === 'super') { base = parentOf(base); if (base == null) return null; }
          i++;
        }
        return rsFind(base, segs.slice(i));
      }
      const root = crateRoot(info.dir);
      const r = root == null ? null : rsFind(root, segs);
      if (r != null) return r;
      const cd = crates.get(head);
      if (cd != null) {
        const src = join(cd, 'src');
        if (segs.length === 1) return exact(join(src, 'lib.rs')) ?? exact(join(src, 'main.rs'));
        return rsFind(src, segs.slice(1)) ?? exact(join(src, 'lib.rs'));
      }
      return /^[A-Z]/.test(head) ? null : head;
    },
    c(spec, info) {
      const sys = spec[0] === '<';
      const s = sys ? spec.slice(1) : spec;
      let r = exact(join(info.dir, s));
      if (r != null) return r;
      const tail = s.replace(/^(\.\.?\/)+/, '');
      let list = suffix.get(tail);
      if (list && sys && !tail.includes('/')) list = list.filter(id => /(^|\/)(include|inc)\/$/.test(prefixOf(id, tail)) || prefixOf(id, tail) === '');
      r = pick(list && list.length ? list : null, info);
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
      const pkg = (wild ? segs : segs.slice(0, -1)).join('/');
      const ds = pkg ? dirSuffix.get(pkg) : null;
      if (ds) {
        if (wild) {
          const fs = ds.flatMap(d => dirFiles.get(d) || []).slice(0, 60);
          return fs.length ? fs : null;
        }
        const cands = names.get(info.L.group)?.get(segs[segs.length - 1]);
        if (cands) {
          const set = new Set(ds);
          const hits = [...new Set(cands.filter(c => nodes[c].parent === nodes[c].file).map(c => nodes[c].file).filter(f => set.has(nodes[nodes[f].parent].path)))];
          if (hits.length) return hits;
        }
        return null;
      }
      const pk = wild || segs.length < 2 ? segs : segs.slice(0, -1);
      return pk.slice(0, 2).join('.');
    },
    cs(spec, info) {
      if (csNs.has(spec)) { (info.uses ??= new Set()).add(spec); return null; }
      const first = spec.split('.')[0];
      return csFirst.has(first) ? null : first;
    },
    mod: spec => spec.split('.')[0],
    swift(spec) {
      const m = spec.split('.')[0];
      return swiftMods.has(m) || dirs.has('Sources/' + m) || dirs.has(m) ? null : m;
    },
    dart(spec, info) {
      if (spec.startsWith('dart:')) return spec;
      const m = /^package:([^/]+)\/(.*)$/.exec(spec);
      if (m) return suf('lib/' + m[2], info) ?? m[1];
      return exact(join(info.dir, spec));
    },
    rb(spec, info) {
      if (spec.includes('#{')) return null;
      if (spec.startsWith('rel:')) {
        const b = join(info.dir, spec.slice(4));
        return b == null ? null : exact(b + '.rb') ?? exact(b);
      }
      const tail = spec.replace(/\.rb$/, '') + '.rb';
      const list = (suffix.get(tail) || []).filter(id => { const pre = prefixOf(id, tail); return pre === '' || /(^|\/)(lib|test|spec)\/$/.test(pre); });
      return pick(list.length ? list : null, info) ?? spec.split('/')[0];
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
  const goMods = [];
  const swiftMods = new Set();
  const crates = new Map();
  const jsPkgs = new Map(), jsAliases = [];
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
    if (f.path === 'Package.swift' || f.path.endsWith('/Package.swift')) for (const m of f.text.matchAll(/\.(?:target|library|executableTarget|testTarget)\s*\(\s*name:\s*"([^"]+)"/g)) swiftMods.add(m[1]);
    if (/(?:^|\/)package\.json$/.test(f.path)) {
      const j = looseJSON(f.text);
      if (j && typeof j.name === 'string') jsPkgs.set(j.name, { dir, entry: [j.source, j.module, j.main, j.types].filter(x => typeof x === 'string') });
    }
    if (/(?:^|\/)[jt]sconfig[\w.-]*\.json$/.test(f.path)) {
      const j = looseJSON(f.text), co = j && j.compilerOptions;
      if (co && co.paths && typeof co.paths === 'object') {
        const base = join(dir, co.baseUrl || '.') ?? dir;
        for (const [pat, targets] of Object.entries(co.paths)) {
          if (!Array.isArray(targets)) continue;
          const star = pat.indexOf('*');
          jsAliases.push({ pre: star < 0 ? pat : pat.slice(0, star), post: star < 0 ? null : pat.slice(star + 1), targets: targets.filter(x => typeof x === 'string').map(x => join(base, x) ?? x) });
        }
      }
    }
    if (/(?:^|\/)Cargo\.toml$/.test(f.path)) {
      const m = /^\[package\][^[]*?^name\s*=\s*"([^"]+)"/m.exec(f.text);
      if (m) crates.set(m[1].replace(/-/g, '_'), dir);
    }
    if (f.path === 'go.mod' || f.path.endsWith('/go.mod')) {
      const m = /^module\s+"?([^\s"]+)/m.exec(f.text);
      if (m) goMods.push({ dir, mod: m[1] });
    }
  }
  goMods.sort((a, b) => b.mod.length - a.mod.length);

  const names = new Map();
  const localsOf = new Map();
  const ownerOf = new Map(), selfOf = new Map(), memberish = new Set(), typesOf = new Map(), fieldTypes = new Map(), retOf = new Map(), basesOf = new Map();
  const pkgOf = new Map();
  const csNs = new Set();
  let done = 0;
  for (const info of infos) {
    if (++done % 50 === 0) progress({ phase: 'Reading code', done, total: infos.length });
    const { f, L } = info;
    const text = L.prep ? L.prep(f.path, f.text) : f.text;
    let masked = L.syntax ? mask(text, L) : null;
    info.specs = L.imports ? L.imports(text, masked) : [];
    if (L.binds) info.binds = L.binds(text);
    if ((L.group === 'dart' && /^export[ \t]+['"]/m.test(text)) || (L.group === 'js' && /^export[ \t]+(?:type[ \t]+)?(?:\*|\{[^}]*\})[ \t]*from[ \t]/m.test(text))) info.facade = true;
    info.module = L.explicit && (L.group !== 'js' || (masked != null && /\b(?:import|export|require)\b/.test(masked)));
    if (L.pkg && masked) {
      const pm = L.pkg.exec(masked);
      if (pm) info.pkg = pm[1];
    }
    if (L.group === 'cs' && masked) for (const m of masked.matchAll(/\bnamespace[ \t]+([\w.]+)/g)) csNs.add(m[1]);
    if (L.strip && masked) masked = masked.replace(L.strip, x => ' '.repeat(x.length));
    info.masked = masked;
    if (!L.defs || !masked) continue;

    const starts = lineStarts(masked);
    if (masked.length > 20000 && starts.length * 400 < masked.length) continue;
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
      for (let p = d.up; p; p = p.up) if (isFn(p.kind) || p.kind === 'variable') { d.drop = true; break; }
    }
    for (const d of defs) {
      if (d.drop) {
        let p = d.up;
        while (p && !isFn(p.kind)) p = p.up;
        if (p) (p.locals ??= new Set()).add(d.name);
      } else if (isFn(d.kind)) {
        d.types = new Map();
        for (const x of params(masked, d.idx + d.name.length, L, d.types)) (d.locals ??= new Set()).add(x);
      }
    }
    const fnAt = new Int32Array(lines.length).fill(-1);
    defs.forEach((d, i) => { if (isFn(d.kind) && !d.drop) fnAt.fill(i, d.line, d.end + 1); });
    if (L.localDecl) {
      for (const m of masked.matchAll(L.localDecl)) {
        const di = fnAt[lineAt(starts, m.index + m[0].length - m[2].length)];
        if (di < 0) continue;
        const ty = /(\w+)\W*$/.exec(m[1]);
        if (ty && NOT_TYPE.has(ty[1])) continue;
        (defs[di].locals ??= new Set()).add(m[2]);
        const tn = lastSeg(m[1].replace(/<[^]*$/, ''));
        if (tn && !MODS.has(tn) && tn !== 'auto') (defs[di].types ??= new Map()).set(m[2], tn);
      }
    }
    for (const re of L.group === 'py' || L.group === 'rb' ? [CALL_VARS_PLAIN] : L.group === 'go' ? CALL_VARS : CALL_VARS.slice(0, 1)) {
      for (const m of masked.matchAll(re)) {
        const ln = lineAt(starts, m.index + m[0].length - 1), di = fnAt[ln];
        if (di >= 0) (defs[di].types ??= new Map()).set(m[1], '()' + m[2]);
        else if (indentOf(lines[ln]) === 0) (info.types ??= new Map()).set(m[1], '()' + m[2]);
      }
    }
    for (const re of L.group === 'go' ? VAR_TYPES : L.group === 'py' || L.group === 'rb' ? [] : VAR_TYPES.slice(0, 1)) {
      for (const m of masked.matchAll(re)) {
        const ty = m[2] || m[3] || m[4];
        if (!ty) continue;
        const ln = lineAt(starts, m.index), di = fnAt[ln];
        if (di >= 0) (defs[di].types ??= new Map()).set(m[1], lastSeg(ty));
        else if (indentOf(lines[ln]) === 0) (info.types ??= new Map()).set(m[1], lastSeg(ty));
      }
    }
    const owner = new Int32Array(lines.length).fill(info.id);
    const defPos = new Set();
    const local = new Map();
    const keys = new Map();
    let g = names.get(L.group);
    if (!g) names.set(L.group, (g = new Map()));
    const types = new Map();
    for (const d of defs) {
      if (d.kind === 'impl') { d.drop = true; continue; }
      if (d.kind === 'extension') { d.kind = 'class'; d.ext = true; }
      else if (d.kind === 'prop') { d.kind = 'function'; d.ext = true; }
      if (d.drop) continue;
      let p = d.up, ownerName = d.owner;
      while (p && p.drop) {
        if (!ownerName && p.kind === 'impl') ownerName = p.name;
        p = p.up;
      }
      if (ownerName && !(p && isClassy(p.kind))) {
        const t = types.get(ownerName);
        if (t) p = t;
      }
      if (d.kind === 'variable' && L.flatVars && !p && indentOf(lines[d.line]) > 0) { d.drop = true; continue; }
      const away = ownerName && !(p && isClassy(p.kind));
      if (d.kind === 'method' && !(p && isClassy(p.kind)) && !away) d.kind = 'function';
      else if (d.kind === 'function' && ((p && isClassy(p.kind)) || away)) d.kind = 'method';
      d.qual = p ? p.qual + '.' + d.name : away ? ownerName + '.' + d.name : d.name;
      let key = 's:' + f.path + '#' + d.qual;
      const c = (keys.get(key) || 0) + 1;
      keys.set(key, c);
      if (c > 1) key += '~' + c;
      const parent = p ? p.node : info.id;
      d.node = add({ kind: d.kind, key, name: d.name, path: f.path, parent, file: info.id, line: d.line, end: d.end, group: L.group });
      edges.push({ s: parent, t: d.node, type: 'contain' });
      if (d.locals) localsOf.set(d.node, d.locals);
      if (d.types && d.types.size) typesOf.set(d.node, d.types);
      if (isFn(d.kind)) {
        let rt = null;
        const e = afterParams(masked, d.idx + d.name.length);
        if (e > 0) {
          const rest = masked.slice(e, e + 200);
          for (const re of RET) { const m = re.exec(rest); if (m) { rt = m[1]; break; } }
          if (!rt && L.group === 'go') { const m = RET_GO.exec(rest); if (m) rt = m[1]; }
        }
        if (!rt && L.paramLast) {
          const ids = (lines[d.line].slice(0, d.idx - starts[d.line]).replace(/<[^<>]*(?:<[^<>]*>[^<>]*)*>/g, ' ').match(L.idAll) || []).filter(w => !MODS.has(w) && !FIELD_MODS.has(w));
          rt = ids.length ? ids[ids.length - 1] : null;
        }
        if (rt && !/^(?:void|Unit|None|Void|self|Self|this)$/.test(rt)) retOf.set(d.name, retOf.has(d.name) && retOf.get(d.name) !== rt ? null : rt);
        else if (retOf.has(d.name)) retOf.set(d.name, null);
      }
      if (isClassy(d.kind) && !d.ext) {
        const rest = lines[d.line].slice(d.idx - starts[d.line] + d.name.length);
        let m, list = null;
        if (L.group === 'py') { if ((m = /^\s*\(([^)]*)\)/.exec(rest))) list = m[1].split(',').filter(x => !x.includes('=')); }
        else if ((m = /^\s*(?:<[^>{]*>)?\s*(?:\([^)]*\)\s*)?(?:extends|implements|:|<)\s*([^{]*)/.exec(rest))) {
          list = m[1].replace(/<[^<>]*(?:<[^<>]*>[^<>]*)*>/g, '').replace(/\b(?:implements|extends|public|private|protected|virtual|where|with)\b/g, ',').split(',');
        }
        if (list) {
          const bs = list.map(x => lastSeg(x.replace(/\(.*$/, ''))).filter(b => b && b !== d.name && !L.kw.has(b));
          if (bs.length) basesOf.set(d.node, bs.slice(0, 6));
        }
      }
      if (p && isClassy(p.kind)) {
        let ft = fieldTypes.get(p.node);
        if (d.kind === 'variable') {
          const ln = lines[d.line], col = d.idx - starts[d.line];
          const after = /^[ \t]*[?!]?[ \t]*:[ \t]*([A-Za-z_][\w.]*)/.exec(ln.slice(col + d.name.length));
          let ty = after ? lastSeg(after[1]) : null;
          if (!ty && L.paramLast) {
            const ids = (ln.slice(0, col).replace(/<[^<>]*(?:<[^<>]*>[^<>]*)*>/g, ' ').match(L.idAll) || []).filter(w => !MODS.has(w) && !FIELD_MODS.has(w));
            ty = ids.length ? ids[ids.length - 1] : null;
          }
          if (ty) { if (!ft) fieldTypes.set(p.node, (ft = new Map())); ft.set(d.name, ty); }
        } else if (d.types && (CTOR.test(d.name) || d.name === p.name)) {
          if (!ft) fieldTypes.set(p.node, (ft = new Map()));
          for (const [k, v] of d.types) if (!ft.has(k)) ft.set(k, v);
        }
      }
      if (ownerName) ownerOf.set(d.node, ownerName);
      if (L.group === 'js' && isFn(d.kind) && PROP_FN.test(lines[d.line].slice(Math.max(0, d.idx - starts[d.line] - 120), d.idx - starts[d.line]))) memberish.add(d.node);
      if (d.self) selfOf.set(d.node, d.self);
      if (isClassy(d.kind) && !d.ext && !types.has(d.name)) types.set(d.name, d);
      owner.fill(d.node, d.line, d.end + 1);
      defPos.add(d.idx);
      let inFn = false;
      for (let q = p; q && !inFn; q = q.up) if (isFn(q.kind) && !q.drop) inFn = true;
      if (!d.ext && !inFn && !(L.priv && L.priv.test(lines[d.line].slice(0, d.idx - starts[d.line])))) {
        const a = g.get(d.name);
        if (a) a.push(d.node); else g.set(d.name, [d.node]);
      }
      const b = local.get(d.name);
      if (b) b.push(d.node); else local.set(d.name, [d.node]);
    }
    if (L.anon) {
      const scopes = [];
      for (const re of L.anon) {
        for (const m of masked.matchAll(re)) {
          let ns, tm = null;
          if (m[1] === undefined) ns = params(masked, m.index, L, (tm = new Map()));
          else ns = (m[1].replace(/:[^,]*/g, '').match(L.idAll) || []).filter(w => !L.kw.has(w));
          if (!ns.length) continue;
          const a = lineAt(starts, m.index);
          scopes.push({ a, b: blockEnd(lines, a, skipOf(L)), names: new Set(ns), types: tm && tm.size ? tm : null });
        }
      }
      if (scopes.length) {
        info.scopes = scopes;
        info.scopeNames = new Set(scopes.flatMap(sc => [...sc.names, ...(sc.types ? sc.types.keys() : [])]));
      }
    }
    for (const m of masked.matchAll(/(?:\b(?:self|this)\.|@)([A-Za-z_]\w*)[ \t]*=[ \t]*(?:(?:new[ \t]+)?([A-Z]\w*)(?:[ \t]*[({]|\.new\b)|([A-Za-z_]\w*)[ \t]*;?[ \t]*$)/gm)) {
      const di = fnAt[lineAt(starts, m.index)];
      if (di < 0) continue;
      let c = defs[di].up;
      while (c && !(isClassy(c.kind) && c.node != null)) c = c.up;
      if (!c) continue;
      const ty = m[2] || (defs[di].types && defs[di].types.get(m[3]));
      if (!ty || ty.startsWith('()')) continue;
      let ft = fieldTypes.get(c.node);
      if (!ft) fieldTypes.set(c.node, (ft = new Map()));
      if (!ft.has(m[1])) ft.set(m[1], ty);
    }
    if (L.group === 'cs') {
      for (const m of masked.matchAll(/\bnew[ \t]+([A-Za-z_][\w.]*)(?:<[^>\n]*>)?[ \t]*(?:\([^()]*\))?\s*\{/g)) {
        let d = 1, k = m.index + m[0].length;
        const lim = Math.min(masked.length, k + 4000), ty = lastSeg(m[1]);
        for (let q = k; q < lim && d; q++) {
          const c = masked.charCodeAt(q);
          if (c === 123) d++;
          else if (c === 125) d--;
          else if (d === 1 && (c === 123 || c === 44 || q === k)) {
            const a = /^[\s,]*([A-Za-z_]\w*)\s*=(?!=)/.exec(masked.slice(q, q + 120));
            if (a) (info.inits ??= new Map()).set(q + a[0].indexOf(a[1]), ty);
          }
        }
      }
    }
    Object.assign(info, { starts, owner, defPos, local });
    if (info.pkg != null) pkgOf.set(info.id, info.pkg);
  }

  const resolve = makeResolver({ nodes, fileIds, dirs, dirFiles, csNs, goMods, names, swiftMods, crates, jsPkgs, jsAliases });
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
        if (info.L.shadowExt && !spec.endsWith('*')) (info.ext ??= new Set()).add(spec.trim().split(/[.:/]/).pop());
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

  for (const info of infos) {
    if (!info.binds) continue;
    for (const [n, sp] of info.binds) {
      if (!info.specs.includes(sp)) continue;
      let r;
      try { r = resolve(info.L.resolve, sp.trim(), info); } catch { r = null; }
      if (typeof r === 'string' || r == null) (info.ext ??= new Set()).add(n);
    }
    info.binds = null;
  }
  const infoOf = new Map(infos.map(i => [i.id, i]));
  const impl = new Map();
  for (const info of infos) if (info.L.group === 'c' && !/\.(?:h|hh|hpp|hxx|h\+\+|cuh)$/i.test(info.f.path)) impl.set(info.f.path.replace(/\.[^./]+$/, ''), info.id);
  for (const info of infos) {
    if (info.L.group !== 'c' || !info.imported.size) continue;
    const seen = new Set(info.imported), q = [...seen];
    for (let h = 0; h < q.length && seen.size < 400; h++) {
      const t = q[h], ti = infoOf.get(t);
      const sib = impl.get(nodes[t].path.replace(/\.[^./]+$/, ''));
      if (sib != null && !seen.has(sib)) { seen.add(sib); q.push(sib); }
      if (ti) for (const u of ti.imported) if (!seen.has(u)) { seen.add(u); q.push(u); }
    }
    seen.delete(info.id);
    info.cimp = seen;
  }
  for (const info of infos) if (info.cimp) { info.imported = info.cimp; info.cimp = null; }
  const FACADE = /^(?:__init__\.pyi?|index\.[mc]?[jt]sx?|mod\.rs|lib\.rs)$/;
  for (const info of infos) {
    for (const t of [...info.imported]) {
      const ti = infoOf.get(t);
      if (!FACADE.test(nodes[t].name) && !(ti && ti.facade)) continue;
      if (ti) for (const u of ti.imported) if (u !== info.id) info.imported.add(u);
    }
  }

  const typeNames = new Set(ownerOf.values()), classByName = new Map();
  const fnLocal = id => { for (let p = nodes[id].parent; p >= 0 && nodes[p].kind !== 'file'; p = nodes[p].parent) if (isFn(nodes[p].kind)) return true; return false; };
  const fnLocalSet = new Set();
  for (const n of nodes) if (isClassy(n.kind)) {
    if (fnLocal(n.id)) fnLocalSet.add(n.id);
    typeNames.add(n.name);
    const a = classByName.get(n.name);
    if (a) a.push(n.id); else classByName.set(n.name, [n.id]);
  }
  const preferImported = (list, info) => {
    if (list.length < 2) return list;
    const near = list.filter(c => nodes[c].file === info.id || info.imported.has(nodes[c].file));
    return near.length ? near : list;
  };
  const byClass = new Map(), byType = new Map();
  const addIdx = (m, k, name, id) => {
    let a = m.get(k);
    if (!a) m.set(k, (a = new Map()));
    const l = a.get(name);
    if (l) l.push(id); else a.set(name, [id]);
  };
  for (const n of nodes) {
    const cp = n.parent >= 0 && isClassy(nodes[n.parent].kind) ? nodes[n.parent] : null;
    if (cp && n.kind !== 'keyword') {
      addIdx(byClass, cp.id, n.name, n.id);
      addIdx(byType, cp.name, n.name, n.id);
      const dot = cp.name.lastIndexOf('.');
      if (dot >= 0) addIdx(byType, cp.name.slice(dot + 1), n.name, n.id);
    }
    const ow = ownerOf.get(n.id);
    if (ow && !(cp && cp.name === ow)) addIdx(byType, ow, n.name, n.id);
  }
  const ofType = (t, name, f) => { const l = byType.get(t)?.get(name); return l ? l.filter(c => !fnLocalSet.has(nodes[c].parent) || nodes[c].file === f) : null; };
  const classes = (name, f) => (classByName.get(name) || []).filter(c => !fnLocalSet.has(c) || nodes[c].file === f).slice(0, 4);
  const memberIn = (cls, name) => {
    const seen = new Set([cls]);
    let level = [cls];
    for (let depth = 0; depth < 6 && level.length; depth++) {
      const hit = [];
      for (const c of level) { const l = byClass.get(c)?.get(name); if (l) hit.push(...l); }
      if (hit.length) return hit;
      const next = [];
      for (const k of level) for (const b of basesOf.get(k) || []) for (const c2 of classes(b, nodes[cls].file)) if (!seen.has(c2)) { seen.add(c2); next.push(c2); }
      level = next;
    }
    return null;
  };

  done = 0;
  for (const info of infos) {
    if (++done % 50 === 0) progress({ phase: 'Linking', done, total: infos.length });
    if (!info.owner) continue;
    const { L, masked, starts, owner, defPos, local, id: fid } = info;
    const g = names.get(L.group);
    const fdir = nodes[fid].parent;
    const out = new Map();
    const idc = new Map();
    const countWords = !TEST_PATH.test(info.f.path);
    if (countWords) info.idc = idc;
    let ln = 0;
    for (const m of masked.matchAll(L.id)) {
      const name = m[0];
      if (name.length < 2) continue;
      if (countWords && !L.kw.has(name)) idc.set(name, (idc.get(name) || 0) + 1);
      const cands = g.get(name) || local.get(name);
      if (!cands) continue;
      if (info.ext && info.ext.has(name) && !local.has(name)) continue;
      const at = m.index;
      if (defPos.has(at)) continue;
      const prev = at > 0 ? masked.charCodeAt(at - 1) : 0;
      if (L.sigil && prev === 36) continue;
      while (ln + 1 < starts.length && starts[ln + 1] <= at) ln++;
      const src = owner[ln];
      let member = false, recv = '', recvCall = '';
      const p2 = at > 1 ? masked.charCodeAt(at - 2) : 0;
      if ((prev === 46 && p2 !== 46) || (prev === 62 && p2 === 45) || (prev === 58 && p2 === 58)) {
        member = true;
        let j = at - (prev === 46 ? 1 : 2);
        const q = masked.charCodeAt(j - 1);
        if (q === 63 || q === 33) j--;
        let k = j;
        while (k > 0 && isW(masked.charCodeAt(k - 1))) k--;
        recv = masked.slice(k, j);
        if (!recv && masked.charCodeAt(j - 1) === 41) {
          let d = 0, q2 = j - 1;
          for (const lim = Math.max(0, j - 600); q2 >= lim; q2--) {
            const c = masked.charCodeAt(q2);
            if (c === 41) d++;
            else if (c === 40 && --d === 0) break;
          }
          let e2 = q2;
          while (e2 > 0 && isW(masked.charCodeAt(e2 - 1))) e2--;
          if (d === 0 && e2 < q2) recvCall = masked.slice(e2, q2);
        }
      }
      if (!member) {
        let shadow = false;
        if (info.scopes && info.scopeNames.has(name)) for (const sc of info.scopes) if (sc.a <= ln && ln <= sc.b && sc.names.has(name)) { shadow = true; break; }
        for (let o = src; o !== fid && o >= 0; o = nodes[o].parent) {
          const ls = localsOf.get(o);
          if (ls && ls.has(name)) { shadow = true; break; }
        }
        if (shadow) continue;
      }
      let targets = null;
      let type = 'dep';
      if (info.inits && info.inits.has(at)) {
        const ty = info.inits.get(at), hit = new Set();
        for (const c of classes(ty, fid)) for (const h of memberIn(c, name) || []) hit.add(h);
        if (!hit.size) continue;
        targets = [...hit];
      }
      if (member && recv && info.ext && info.ext.has(recv) && !local.has(recv)) continue;
      if (member && recv) {
        let selfT = null;
        if (!SELF.has(recv) && info.scopes && info.scopeNames.has(recv)) {
          let best = null;
          for (const sc of info.scopes) if (sc.types && sc.a <= ln && ln <= sc.b && sc.types.has(recv) && (!best || sc.a >= best.a)) best = sc;
          if (best) selfT = best.types.get(recv);
        }
        if (!SELF.has(recv) && !selfT) for (let o = src; o !== fid && o >= 0; o = nodes[o].parent) {
          const tm = typesOf.get(o), ty = tm && tm.get(recv);
          if (ty) { selfT = ty; break; }
          if (selfOf.get(o) === recv) break;
          const ft = fieldTypes.get(o), fy = ft && ft.get(recv);
          if (fy) { selfT = fy; break; }
        }
        if (!selfT && info.types && info.types.has(recv) && !(info.scopes && info.scopeNames.has(recv))) {
          let shadowed = false;
          for (let o = src; o !== fid && o >= 0 && !shadowed; o = nodes[o].parent) shadowed = !!(localsOf.get(o)?.has(recv) || typesOf.get(o)?.has(recv));
          if (!shadowed) selfT = info.types.get(recv);
        }
        if (!selfT) for (let o = src; o !== fid && o >= 0; o = nodes[o].parent) {
          if (SELF.has(recv)) { if (isClassy(nodes[o].kind)) break; if (ownerOf.has(o)) { selfT = ownerOf.get(o); break; } continue; }
          const sv = selfOf.get(o);
          if (sv) { if (sv === recv) selfT = ownerOf.get(o); break; }
        }
        if (selfT && selfT.startsWith('()')) {
          const call = selfT.slice(2);
          selfT = typeNames.has(call) ? call : retOf.get(call) || null;
        }
        if (selfT) {
          const own = ofType(selfT, name, fid) || [];
          if (own.length) targets = own;
          else if (!typeNames.has(selfT)) continue;
          else if (classByName.has(selfT)) {
            const hit = new Set();
            for (const c of classes(selfT, fid)) for (const h of memberIn(c, name) || []) hit.add(h);
            if (hit.size) targets = [...hit];
          }
        } else if (SELF.has(recv)) {
          let cls = src;
          while (cls !== fid && cls >= 0 && !isClassy(nodes[cls].kind)) cls = nodes[cls].parent;
          if (cls !== fid && cls >= 0) {
            const hit = memberIn(cls, name);
            if (!hit) continue;
            targets = hit;
          }
        } else if (recv.charCodeAt(0) >= 65 && recv.charCodeAt(0) <= 90) {
          const own = (ofType(recv, name, fid) || []).filter(c => isClassy(nodes[nodes[c].parent].kind));
          if (own.length) targets = own;
          else if (classByName.has(recv)) {
            const hit = new Set();
            for (const c of classes(recv, fid)) for (const h of memberIn(c, name) || []) hit.add(h);
            if (!hit.size) continue;
            targets = [...hit];
          } else if (CAP_TYPES.has(L.group) && !typeNames.has(recv)) continue;
          else if (COMMON.has(name)) continue;
        } else if (COMMON.has(name)) continue;
      } else if (member && recvCall) {
        const rt = typeNames.has(recvCall) ? recvCall : retOf.get(recvCall);
        if (rt) {
          const own = ofType(rt, name, fid) || [];
          if (own.length) targets = own;
          else if (!typeNames.has(rt) || COMMON.has(name)) continue;
        } else if (COMMON.has(name)) continue;
      } else if (member && COMMON.has(name)) continue;
      if (!targets && !member && IMPLICIT_THIS.has(L.group)) {
        let cls = src;
        while (cls !== fid && cls >= 0 && !isClassy(nodes[cls].kind)) cls = nodes[cls].parent;
        if (cls !== fid && cls >= 0 && basesOf.has(cls)) {
          const hit = memberIn(cls, name);
          if (hit) targets = hit;
        } else if (cls === fid || cls < 0) {
          let ow = null;
          for (let o = src; o !== fid && o >= 0 && !ow; o = nodes[o].parent) ow = ownerOf.get(o);
          if (ow && classByName.has(ow)) {
            const hit = new Set();
            for (const c of classes(ow, fid)) for (const h of memberIn(c, name) || []) hit.add(h);
            if (hit.size) targets = [...hit];
          }
        }
      }
      if (!targets) {
        targets = local.get(name);
        if (!targets) {
          if (cands.length > 200) continue;
          targets = cands.filter(c => info.imported.has(nodes[c].file));
          const viaImport = targets.length > 0;
          if (!targets.length && L.pkgDir) {
            const pk = info.pkg, uses = info.uses;
            const nsOk = ns => ns != null && (ns === pk || (uses != null && uses.has(ns)) || (L.group === 'cs' && pk != null && pk.startsWith(ns + '.')));
            targets = pk != null || uses
              ? cands.filter(c => nsOk(pkgOf.get(nodes[c].file)) && (member || nodes[c].parent === nodes[c].file))
              : cands.filter(c => nodes[nodes[c].file].parent === fdir);
          }
          if (!targets.length) {
            if (cands.length > MAXC) continue;
            targets = L.group === 'c' ? cands.filter(c => isFn(nodes[c].kind))
              : !info.module || (L.pkgDir && info.pkg != null) ? cands
              : member ? preferImported(cands.filter(c => memberish.has(c) || (nodes[c].parent >= 0 && isClassy(nodes[nodes[c].parent].kind))), info)
              : masked.charCodeAt(at + name.length) === 33 ? cands : cands.filter(c => AMBIENT.test(nodes[c].path));
            if (!targets.length) continue;
            if (cands.length > 1 || L.explicit || member) type = 'ref';
          } else if (member && targets.length > 1) {
            const top = viaImport ? targets.filter(c => nodes[c].parent === nodes[c].file) : [];
            if (top.length) targets = top; else type = 'ref';
          }
        } else if (member && targets.length > 1) type = 'ref';
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

  keywords(infos, nodes, edges, add);

  let symbols = 0, kws = 0;
  for (const n of nodes) {
    if (n.kind === 'keyword') kws++;
    else if (n.kind !== 'dir' && n.kind !== 'file' && n.kind !== 'lib') symbols++;
  }
  const E = edges.length, es = new Int32Array(E), et = new Int32Array(E), ty = new Uint8Array(E);
  for (let i = 0; i < E; i++) {
    const e = edges[i];
    es[i] = e.s; et[i] = e.t; ty[i] = EDGE_CODE[e.type];
  }
  return { nodes, edges: { s: es, t: et, type: ty }, stats: { files: fileIds.size, symbols, libs: libs.size, keywords: kws } };
}
