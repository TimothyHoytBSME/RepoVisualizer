const W = String.raw`[A-Za-z_$][\w$]*`;
const N = String.raw`[A-Za-z_]\w*`;
const R = (s, ...v) => new RegExp(String.raw(s, ...v), 'gmd');
const RI = (s, ...v) => new RegExp(String.raw(s, ...v), 'gmdi');
const kw = s => new Set(s.trim().split(/\s+/));
const CHAR = /'(?:\\.[^'\n]{0,8}|[^'\\\n])'/y;
const DEC = new TextDecoder('utf-16le');

function grab(out, re, text, masked, g = 1, fmt) {
  for (const m of text.matchAll(re)) {
    if (masked) {
      const k = m.index + m[0].length - m[0].trimStart().length;
      if (masked.charCodeAt(k) !== text.charCodeAt(k)) continue;
    }
    const v = fmt ? fmt(m) : m[g];
    if (v) out.push(v);
  }
  return out;
}

const NOT_BEFORE = kw('return else new case throw await yield typeof delete sizeof goto do in of and or not is as co_return co_await co_yield if while for switch catch using lock fixed foreach');
const GAP = /^\s*(?:(?:const|noexcept|override|final|volatile|mutable|async|throws|where)\b|->|:(?!:)|$)/;
const TYPEISH = /[\w>*&\]?]$/;
const LAST_WORD = /(\w+)[\s*&]*$/;

function prevLine(t, ls) {
  let pe = ls - 1;
  while (pe > 0) {
    const ps = t.lastIndexOf('\n', pe - 1) + 1;
    const prev = t.slice(Math.max(ps, pe - 200), pe).trim();
    if (prev) return prev;
    pe = ps - 1;
  }
  return '';
}

function cfuncs(t, gnu) {
  const out = [];
  let ls = 0, nl = t.indexOf('\n');
  for (const m of t.matchAll(/([A-Za-z_~][\w:~]*)[ \t]*\(/g)) {
    while (nl !== -1 && nl < m.index) { ls = nl + 1; nl = t.indexOf('\n', ls); }
    const name = m[1];
    const before = t.slice(Math.max(ls, m.index - 200), m.index).trim();
    if (!before) {
      if (!name.includes('::')) {
        if (!gnu || ls === 0) continue;
        const prev = prevLine(t, ls);
        if (!prev || !/[\w*&>]$/.test(prev) || prev[0] === '#' || /[=(@]/.test(prev)) continue;
        const pw = LAST_WORD.exec(prev);
        if (pw && NOT_BEFORE.has(pw[1])) continue;
      }
    } else {
      if (!TYPEISH.test(before) || /\s\?$/.test(before) || before.includes('=')) continue;
      let bal = 0;
      for (let i = 0; i < before.length; i++) {
        const c = before.charCodeAt(i);
        if (c === 40) bal++; else if (c === 41) bal--;
      }
      if (bal > 0) continue;
      const lw = LAST_WORD.exec(before);
      if (lw && NOT_BEFORE.has(lw[1])) continue;
    }
    let j = m.index + m[0].length, depth = 1;
    const lim = Math.min(t.length, j + 3000);
    for (; j < lim && depth; j++) {
      const c = t.charCodeAt(j);
      if (c === 40) depth++;
      else if (c === 41) depth--;
      else if (c === 59 || c === 123 || c === 125) break;
    }
    if (depth) continue;
    let k = j;
    const lim2 = Math.min(t.length, j + 400);
    while (k < lim2) {
      const c = t.charCodeAt(k);
      if (c === 123 || c === 59 || c === 125) break;
      k++;
    }
    if (k >= lim2 || t.charCodeAt(k) !== 123 || !GAP.test(t.slice(j, k))) continue;
    const q = name.lastIndexOf(':');
    out.push({ name: name.slice(q + 1), idx: m.index + q + 1, kind: 'function' });
  }
  return out;
}

function goGroups(t) {
  const out = [];
  for (const m of t.matchAll(/^(var|const|type)[ \t]*\(\r?\n([\s\S]*?)^\)/gmd)) {
    const kind = m[1] === 'type' ? 'type' : 'variable';
    const base = m.indices[2][0];
    for (const n of m[2].matchAll(/^(?:\t| {2,4})([A-Za-z_]\w*)/gm)) {
      out.push({ name: n[1], idx: base + n.index + n[0].length - n[1].length, kind });
    }
  }
  return out;
}

function goMethods(t) {
  const out = [];
  for (const m of t.matchAll(/^func[ \t]*\([ \t]*(?:(\w+)[ \t]+)?\*?[ \t]*(\w+)(?:\[[^\]]*\])?[ \t]*\)[ \t]*([A-Za-z_]\w*)/gmd)) {
    out.push({ name: m[3], idx: m.indices[3][0], kind: 'method', owner: m[2], self: m[1] });
  }
  return out;
}

function pyImports(raw, m) {
  const out = [];
  for (const x of m.matchAll(/^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]*(?:\(([^)]*)\)|([^\n(]*))/gm)) {
    const mod = x[1];
    const names = (x[2] ?? x[3] ?? '').split(/[,\s\\]+/).filter(n => /^\w+$/.test(n) && n !== 'as').slice(0, 6);
    for (const n of names) out.push(mod.endsWith('.') ? mod + n : mod + '.' + n);
    out.push(mod);
  }
  for (const x of m.matchAll(/^[ \t]*import[ \t]+([\w.]+(?:[ \t]+as[ \t]+\w+)?(?:[ \t]*,[ \t]*[\w.]+(?:[ \t]+as[ \t]+\w+)?)*)/gm)) {
    for (const p of x[1].split(',')) out.push(p.trim().split(/\s+/)[0]);
  }
  return out;
}

function goImports(raw) {
  const out = [];
  for (const m of raw.matchAll(/^import[ \t]*\(([\s\S]*?)\)/gm)) for (const s of m[1].matchAll(/"([^"]+)"/g)) out.push(s[1]);
  return grab(out, /^import[ \t]+(?:[\w.]+[ \t]+)?"([^"]+)"/gm, raw);
}

function rsExpand(s, out, depth = 0) {
  const i = s.indexOf('{');
  if (i < 0 || depth > 4) {
    const p = s.replace(/\s+as\s+\w+$/, '').replace(/::(?:self|\*)$/, '').replace(/::$/, '').trim();
    if (p && p !== 'self') out.push(p);
    return;
  }
  let d = 0, j = i;
  for (; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}' && --d === 0) break; }
  const inner = s.slice(i + 1, j), pre = s.slice(0, i);
  let k = 0, start = 0;
  d = 0;
  for (; k <= inner.length; k++) {
    const c = inner[k];
    if (c === '{') d++; else if (c === '}') d--;
    else if ((c === ',' || k === inner.length) && d === 0) { const part = inner.slice(start, k).trim(); if (part) rsExpand(part === 'self' ? pre : pre + part, out, depth + 1); start = k + 1; }
  }
}

function rsImports(raw, m) {
  const out = [];
  for (const x of m.matchAll(/^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?use[ \t]+(?:::)?([^;]*);/gm)) rsExpand(x[1].replace(/\s+/g, ' '), out);
  grab(out, /^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?mod[ \t]+(\w+)[ \t]*;/gm, m, null, 1, x => 'mod:' + x[1]);
  return grab(out, /^[ \t]*extern[ \t]+crate[ \t]+(\w+)/gm, m, null, 1, x => 'extern:' + x[1]);
}

function htmlImports(raw) {
  const o = grab([], /<(?:script|img|iframe|source|audio|video|embed)\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi, raw);
  grab(o, /<link\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/gi, raw);
  return grab(o, /\bimport\s*(?:[\w{}\s*,]+from\s*)?["'](\.[^"']+)["']/g, raw);
}

function sfc(path, text) {
  if (!/\.(vue|svelte|astro)$/i.test(path)) return text;
  const n = text.length, keep = new Uint8Array(n);
  const mark = (a, b) => { if (b > a) keep.fill(1, a, b); };
  for (const m of text.matchAll(/(<script\b[^>]*>)([\s\S]*?)<\/script>/gi)) mark(m.index + m[1].length, m.index + m[1].length + m[2].length);
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (fm && /\.astro$/i.test(path)) mark(4, 4 + fm[1].length);
  const styles = [];
  for (const m of text.matchAll(/<style\b[\s\S]*?<\/style>/gi)) styles.push([m.index, m.index + m[0].length]);
  const inStyle = i => styles.some(([a, b]) => i >= a && i < b);
  for (const m of text.matchAll(/\{\{([\s\S]*?)\}\}/g)) if (!keep[m.index] && !inStyle(m.index)) mark(m.index + 2, m.index + 2 + m[1].length);
  for (const m of text.matchAll(/\s(?::|@|#|v-[\w-]+|on:|bind:)[\w.:-]*=(["'])([^"']*)\1/g)) {
    if (keep[m.index] || inStyle(m.index)) continue;
    const s = m.index + m[0].length - m[2].length - 1;
    mark(s, s + m[2].length);
  }
  if (/\.(svelte|astro)$/i.test(path)) for (const m of text.matchAll(/\{([^{}]*)\}/g)) if (!keep[m.index] && !inStyle(m.index)) mark(m.index + 1, m.index + 1 + m[1].length);
  for (const m of text.matchAll(/<\/?([A-Z][\w.]*)/g)) if (!keep[m.index]) mark(m.index + m[0].length - m[1].length, m.index + m[0].length);
  const out = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    out[i] = keep[i] || c === 10 || c === 13 ? c : 32;
  }
  return DEC.decode(out);
}

const LOCAL_DECL = /(?:^|[;{}(,])[ \t]*(?:(?:final|const|out|using|ref|in|readonly|let|var|struct|enum|union|unsigned|signed|static|volatile|register|long|short|auto)[ \t]+)*([A-Za-z_][\w.]*(?:<[^;={}()\n]*>)?(?:\[[^\]\n]*\])*[?*&]*)[ \t]+[*&]*([A-Za-z_]\w*)[ \t]*(?=[=;:,)]|in\b)/gm;

function notSig(t, i) {
  const e = t.indexOf('\n', i), line = t.slice(i, e < 0 ? t.length : e), a = line.indexOf('=>');
  return a < 0 || !/^\s*[A-Za-z_$][\w$.]*(?:<[^>\n]*>)?(?:\[\])*\s*(?:[|&]\s*[A-Za-z_$][\w$.]*(?:<[^>\n]*>)?(?:\[\])*\s*)*[;,]?\s*$/.test(line.slice(a + 2));
}

function jsBinds(raw) {
  const out = [];
  const names = list => list.split(',').map(p => p.trim().split(/\s+as\s+|\s*:\s*/).pop().trim()).filter(n => /^[A-Za-z_$][\w$]*$/.test(n));
  for (const m of raw.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push([m[1], m[2]]);
  for (const m of raw.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) for (const n of names(m[1])) out.push([n, m[2]]);
  for (const m of raw.matchAll(/\bimport\s+(?:type\s+)?([\w$*{},\s]+?)\s+from\s*['"]([^'"]+)['"]/g)) {
    const c = m[1], b = /\{([^}]*)\}/.exec(c);
    if (b) for (const n of names(b[1])) out.push([n, m[2]]);
    const rest = c.replace(/\{[^}]*\}/, '');
    const star = /\*\s*as\s+([A-Za-z_$][\w$]*)/.exec(rest);
    if (star) out.push([star[1], m[2]]);
    const def = /^\s*([A-Za-z_$][\w$]*)/.exec(rest);
    if (def && def[1] !== 'type') out.push([def[1], m[2]]);
  }
  return out;
}

const C_SYN = { line: ['//'], block: [['/*', '*/']], quotes: '"', charQuote: true };

const BASE_KW = kw(`if else for while do switch case break continue return function class def fn func let var const new this self true false null nil none None True False import from export package public private protected static void int string bool in of and or not is end then`);

const JS = {
  group: 'js', explicit: true, flatVars: true,
  exts: 'js mjs cjs jsx ts tsx mts cts vue svelte astro',
  syntax: { line: ['//'], block: [['/*', '*/']], quotes: '\'"`', template: '`', regex: true },
  id: /[A-Za-z_$][\w$]*/g,
  kw: kw(`break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return super switch this throw try typeof var void while with yield async await static of null true false undefined interface type enum implements package private protected public readonly abstract declare namespace module as from any number string boolean never unknown object symbol bigint keyof infer is satisfies override require exports console window document Math JSON Object Array String Number Boolean Promise Error Map Set Date RegExp Symbol`),
  defs: [
    [R`\bfunction\b\s*\*?\s*(${W})`, 'function'],
    [R`\bclass\s+(${W})`, 'class'],
    [R`\b(?:interface|enum)\s+(${W})`, 'type'],
    [R`\b(?:namespace|module)\s+(${W})\s*\{`, 'module'],
    [R`\btype\s+(${W})\s*(?:<[^>\n]*>)?\s*=`, 'type'],
    [R`\b(?:const|let|var)\s+(${W})\s*(?::[^=;\n]+)?=\s*(?:async\s*)?(?:function\b|(?:\([^()]*\)|${W})\s*(?::[^=;\n]+)?=>)`, 'function'],
    [R`\b(?:const|let|var)\s+(${W})(?![\w$]|\s*=\s*(?:require\s*\(|await\s+import\s*\())`, 'variable', (t, i) => !/\bfor\s*\(\s*(?:const|let|var)\s+$/.test(t.slice(Math.max(0, i - 40), i))],
    [R`^[ \t]*(?:(?:static|async|get|set|public|private|protected|readonly|override|abstract|declare)\s+)*\*?\s*(#?${W})\s*(?:<[^>\n]*>)?\((?:[^()]|\([^()]*\))*\)\s*(?::[^{;\n]+)?\{`, 'method'],
    [R`^[ \t]*(?:(?:static|public|private|protected|readonly)\s+)*(#?${W})\s*(?::[^=;\n]+)?=\s*(?:async\s*)?(?:\([^()]*\)|${W})\s*=>`, 'method'],
    [R`^[ \t]*(${W})\s*:\s*(?:async\s*)?(?:function\b\s*\*?\s*(?:${W}\s*)?\(|(?:\([^()]*\)|${W})\s*(?::[^=;\n]+)?=>)`, 'prop', notSig],
  ],
  clean: s => s.replace(/^#/, ''),
  prep: sfc,
  imports: (raw, m) => grab([], /(?:\bfrom|\bimport|\brequire\s*\(|\bimport\s*\()\s*(['"`])([^'"`\n]+)\1/g, raw, m, 2),
  binds: jsBinds,
  anon: [/\bfunction\b\s*\*?\s*(?=\()/g, /\((?=[^()]*(?:\([^()]*\)[^()]*)*\)\s*(?::[^=;{}\n]*)?=>)/g, /(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/g],
  resolve: 'js',
};

const PY = {
  group: 'py', explicit: true, flatVars: true, shadowExt: true, exts: 'py pyi pyw',
  syntax: { line: ['#'], quotes: '\'"', triple: true },
  kw: kw(`False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield self cls print len range str int float list dict set tuple bool object super isinstance type match case`),
  defs: [
    [R`^[ \t]*(?:async[ \t]+)?def[ \t]+(${N})`, 'function'],
    [R`^[ \t]*class[ \t]+(${N})`, 'class'],
    [R`^[ \t]*(${N})[ \t]*(?::[^=\n]+)?=(?!=)`, 'variable'],
  ],
  imports: pyImports, resolve: 'py',
};

const GO = {
  group: 'go', pkgDir: true, exts: 'go',
  syntax: { line: ['//'], block: [['/*', '*/']], quotes: '"`', charQuote: true, raw: '`' },
  kw: kw(`break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false iota string int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 uintptr byte rune float32 float64 complex64 complex128 bool error any make new len cap append copy delete panic recover close print println`),
  defs: [
    [R`^func[ \t]+(${N})`, 'function'],
    [R`^[ \t]*type[ \t]+(${N})`, 'type'],
    [R`^(?:var|const)[ \t]+(${N})`, 'variable'],
  ],
  extra: t => goGroups(t).concat(goMethods(t)), imports: goImports, resolve: 'go',
  anon: [/\bfunc[ \t]*(?=\()/g],
};

const RS = {
  group: 'rs', explicit: true, shadowExt: true, exts: 'rs', strip: /^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?use[ \t][^;]*;/gm,
  syntax: { ...C_SYN, multi: '"', rawHash: true },
  kw: kw(`as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while Some None Ok Err Box Vec String Option Result i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 usize isize f32 f64 bool str char println format vec assert assert_eq`),
  defs: [
    [R`\bfn[ \t]+(${N})`, 'function'],
    [R`^[ \t]*(?:unsafe[ \t]+)?impl\b(?:[ \t]*<[^>{]*>)?[ \t]+(?:[\w:]+(?:<[^>{]*>)?[ \t]+for[ \t]+)?(?:\w+::)*(${N})`, 'impl'],
    [R`\b(?:struct|enum|trait|union)[ \t]+(${N})`, 'type'],
    [R`^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?type[ \t]+(${N})`, 'type'],
    [R`\b(?:const|static)[ \t]+(?:mut[ \t]+)?(${N})[ \t]*:`, 'variable'],
    [R`^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?mod[ \t]+(${N})[ \t]*\{`, 'module'],
    [R`\bmacro_rules![ \t]*(${N})`, 'function'],
  ],
  imports: rsImports, resolve: 'rs',
};

const C = {
  paramLast: true, group: 'c', exts: 'c h cc cpp cxx c++ hpp hh hxx h++ ino cu cuh m mm glsl vert frag comp geom hlsl metal',
  syntax: C_SYN,
  kw: kw(`auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false NULL nullptr class namespace template typename public private protected virtual override final new delete this using operator friend explicit const_cast static_cast dynamic_cast reinterpret_cast try catch throw std include define ifdef ifndef endif elif pragma size_t uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t string vector self nil YES NO id`),
  defs: [
    [R`^[ \t]*#[ \t]*define[ \t]+(${N})`, 'variable'],
    [R`\b(?:struct|class|union|enum(?:[ \t]+class)?)[ \t]+(${N})[ \t]*(?:final[ \t]*)?(?::[^;{]*)?\{`, 'class'],
    [R`\bnamespace[ \t]+(${N})[ \t]*\{`, 'module'],
    [R`^[ \t]*typedef\b[^;\n]*?\b(${N})[ \t]*(?:\[[^\]]*\])?[ \t]*;`, 'type'],
    [R`^\}[ \t]*(${N})[ \t]*;`, 'type'],
    [R`^[ \t]*@(?:interface|implementation|protocol)[ \t]+(${N})`, 'class'],
    [R`^[ \t]*[-+][ \t]*\([^)]*\)[ \t]*(${N})`, 'method'],
  ],
  extra: t => cfuncs(t, true), localDecl: LOCAL_DECL,
  imports: (raw, m) => grab([], /^[ \t]*#[ \t]*include[ \t]*([<"])([^>"\n]+)[>"]/gm, raw, m, 2, x => (x[1] === '<' ? '<' : '') + x[2]),
  resolve: 'c',
};

const JVM_KW = kw(`abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var val fun object when is in out override open internal data sealed companion lateinit init let def it constructor typealias actual expect String Int Long Boolean Unit Any List Map Set Integer Object`);

const JVM = {
  paramLast: true, group: 'jvm', pkgDir: true, explicit: true, shadowExt: true, exts: 'java kt kts scala sc groovy gradle',
  syntax: { ...C_SYN, triple: true, template: '"', dollarId: true },
  kw: JVM_KW,
  priv: /\bprivate\b/,
  pkg: /^[ \t]*package[ \t]+([\w.]+)/m,
  strip: /^[ \t]*(?:package|import)\b[^\n]*/gm,
  head: /^(?:(?:private|public|protected|internal|actual|expect|@[\w.]+(?:\([^)]*\))?)\s+)*constructor\b/,
  defs: [
    [R`\b(?:enum[ \t]+class|annotation[ \t]+class|class|interface|enum|record|object|trait)[ \t]+(${N})`, 'class'],
    [R`\btypealias[ \t]+(${N})`, 'type'],
    [R`@interface[ \t]+(${N})`, 'type'],
    [R`\b(?:fun|def)[ \t]+(?:(?:<(?:[^<>\n]|<[^<>\n]*>)*>)[ \t]*)?(?:[\w.]+(?:<(?:[^<>\n]|<[^<>\n]*>)*>)?\??\.)?(${N})`, 'function'],
    [R`^[ \t]*(?:(?:@[\w.:]+(?:\([^)\n]*\))?|private|public|protected|internal|override|lateinit|const|open|static|final|inline|actual|expect|abstract|external|lazy|implicit)[ \t]+)*(?:val|var)[ \t]+(?:(?:<(?:[^<>\n]|<[^<>\n]*>)*>)[ \t]*)?(?:[\w.]+(?:<(?:[^<>\n]|<[^<>\n]*>)*>)?\??\.)?(${N})`, 'variable', null, true],
    [R`^[ \t]*(?:(?:public|private|protected|static|final|volatile|transient)[ \t]+)+(?!class\b|interface\b|enum\b|record\b|abstract\b|void\b)[\w<>\[\],.? ]+?[ \t]+(${N})[ \t]*(?:=|;)`, 'variable'],
  ],
  extra: cfuncs, localDecl: LOCAL_DECL,
  anon: [/\{[ \t]*\(?([A-Za-z_]\w*(?:[ \t]*:[ \t]*[\w.<>?]+)?(?:[ \t]*,[ \t]*[A-Za-z_]\w*(?:[ \t]*:[ \t]*[\w.<>?]+)?)*)\)?[ \t]*->/g],
  imports: (raw, m) => grab([], /^[ \t]*import[ \t]+(?:static[ \t]+)?([\w.]+(?:\.\*)?)/gm, m),
  resolve: 'jvm',
};

const CS = {
  paramLast: true, group: 'cs', pkgDir: true, exts: 'cs', priv: /\bprivate\b/, strip: /^[ \t]*(?:using|namespace)\b[^\n{]*/gm, pkg: /^[ \t]*namespace[ \t]+([\w.]+)/m, localDecl: LOCAL_DECL,
  syntax: C_SYN,
  kw: kw(`abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while var get set init value async await record required yield nameof dynamic List Task`),
  defs: [
    [R`\b(?:class|interface|enum|struct|record)[ \t]+(${N})`, 'class'],
    [R`\bdelegate[ \t]+[\w<>\[\],.? ]+[ \t]+(${N})[ \t]*\(`, 'type'],
    [R`^[ \t]*(?:(?:public|private|protected|internal|static|virtual|override|abstract|readonly|required|new|sealed|const)[ \t]+)+[\w<>\[\],.?]+[ \t]+(${N})[ \t]*(?:\{[ \t]*(?:get|set|init)\b|=>|=(?!=)|;)`, 'variable'],
  ],
  extra: cfuncs,
  imports: (raw, m) => grab([], /^[ \t]*(?:global[ \t]+)?using[ \t]+(?:static[ \t]+)?(?:\w+[ \t]*=[ \t]*)?([\w.]+)[ \t]*;/gm, m),
  resolve: 'cs',
};

const SWIFT = {
  group: 'swift', pkgDir: true, exts: 'swift', priv: /\b(?:private|fileprivate)\b/, strip: /^[ \t]*(?:@\w+[ \t]+)*import\b[^\n]*/gm,
  syntax: { line: ['//'], block: [['/*', '*/']], quotes: '"', triple: true },
  kw: kw(`associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as false is nil self Self super throw throws true try async await some any String Int Double Bool Array Dictionary`),
  defs: [
    [R`\b(?:class|struct|enum|protocol|actor)[ \t]+(${N})`, 'class'],
    [R`\bextension[ \t]+(${N})`, 'extension'],
    [R`\bfunc[ \t]+(${N})`, 'function'],
    [R`^[ \t]*(?:(?:private|public|internal|fileprivate|open|static|final|lazy|weak|unowned|override|class|@\w+)[ \t]+)*(?:let|var)[ \t]+(${N})`, 'variable'],
    [R`\btypealias[ \t]+(${N})`, 'type'],
  ],
  imports: (raw, m) => grab([], /^[ \t]*(?:@\w+[ \t]+)*import[ \t]+(?:(?:class|struct|enum|protocol|func|var|let|typealias)[ \t]+)?([\w.]+)/gm, m),
  anon: [/\{[ \t]*(?:\[[^\]\n]*\][ \t]*)?\(?((?:[A-Za-z_]\w*|_)(?:[ \t]*:[ \t]*[\w.<>?]+)?(?:[ \t]*,[ \t]*(?:[A-Za-z_]\w*|_)(?:[ \t]*:[ \t]*[\w.<>?]+)?)*)\)?(?:[ \t]+(?:async[ \t]+)?(?:throws[ \t]+)?(?:->[ \t]*[\w.<>?]+[ \t]+)?)?[ \t]+in\b/g],
  resolve: 'swift',
};

const DART = {
  paramLast: true, group: 'dart', exts: 'dart', localDecl: LOCAL_DECL,
  syntax: { line: ['//'], block: [['/*', '*/']], quotes: '\'"', triple: true },
  kw: kw(`abstract as assert async await break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory false final finally for get hide if implements import in interface is late library mixin new null on operator part required rethrow return set show static super switch sync this throw true try typedef var void while with yield int double num String bool List Map Set Future Stream Widget`),
  defs: [
    [R`\b(?:class|mixin|enum|extension|typedef)[ \t]+(${N})`, 'class'],
    [R`^[ \t]*(?:(?:static|final|const|late)[ \t]+)+(?:[\w<>?,]+[ \t]+)?(${N})[ \t]*=`, 'variable'],
  ],
  extra: cfuncs,
  imports: (raw, m) => grab([], /^[ \t]*(?:import|export|part)[ \t]+['"]([^'"]+)['"]/gm, raw, m),
  resolve: 'dart',
};

const RB = {
  group: 'rb', flatVars: true, exts: 'rb rake gemspec ru',
  names: ['gemfile', 'rakefile', 'podfile', 'fastfile', 'vagrantfile', 'guardfile'],
  syntax: { line: ['#'], block: [['=begin', '=end']], quotes: '\'"`', multi: '"' },
  id: /[A-Za-z_]\w*[!?]?/g,
  kw: kw(`alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield require require_relative attr_accessor attr_reader attr_writer include extend puts private protected public new raise lambda proc`),
  defs: [
    [R`^[ \t]*def[ \t]+(?:self\.)?(${N}[!?=]?)`, 'function'],
    [R`^[ \t]*(?:class|module)[ \t]+(?:[\w:]+::)?([A-Z]\w*)`, 'class'],
    [R`^[ \t]*([A-Z][A-Z0-9_]*)[ \t]*=(?!=)`, 'variable'],
  ],
  clean: s => s.replace(/=$/, ''),
  anon: [/(?:\bdo|\{)[ \t]*\|([^|\n]*)\|/g],
  imports: (raw, m) => grab([], /\b(require_relative|require|load)[ \t(]+['"]([^'"]+)['"]/g, raw, m, 2, x => (x[1] === 'require_relative' ? 'rel:' : '') + x[2]),
  resolve: 'rb',
};

const PHP = {
  group: 'php', flatVars: true, paramLast: true, sigil: true, exts: 'php phtml', strip: /^(?:use|namespace)\b[^\n;{]*/gm,
  syntax: { line: ['//', '#'], block: [['/*', '*/']], quotes: '\'"', multi: '\'"' },
  kw: kw(`abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield this self parent true false null string int float bool mixed void`),
  defs: [
    [R`\bfunction[ \t]+&?(${N})`, 'function'],
    [R`\b(?:class|interface|trait|enum)[ \t]+(${N})`, 'class'],
    [R`\bconst[ \t]+(${N})`, 'variable'],
    [R`^[ \t]*(?:(?:public|private|protected|static|readonly|var)[ \t]+)+(?:\??[\w\\]+[ \t]+)?\$(${N})`, 'variable'],
  ],
  imports: (raw, m) => {
    const o = grab([], /^[ \t]*use[ \t]+(?:function[ \t]+|const[ \t]+)?([\w\\]+)/gm, m);
    return grab(o, /\b(?:require|include)(?:_once)?[ \t(]*['"]([^'"]+)['"]/g, raw, m);
  },
  resolve: 'php',
};

const LUA = {
  group: 'lua', exts: 'lua',
  syntax: { line: ['--'], block: [['--[[', ']]']], quotes: '\'"' },
  kw: kw(`and break do else elseif end false for function goto if in local nil not or repeat return then true until while self require`),
  defs: [
    [R`^[ \t]*(?:local[ \t]+)?function[ \t]+([\w.:]+)`, 'function'],
    [R`^local[ \t]+(${N})[ \t]*=`, 'variable'],
    [R`^([\w.]+)[ \t]*=[ \t]*function\b`, 'function'],
  ],
  clean: s => s.split(/[.:]/).pop(),
  imports: (raw, m) => grab([], /\brequire[ \t(]*['"]([^'"]+)['"]/g, raw, m),
  resolve: 'lua',
};

const SH = {
  group: 'sh', exts: 'sh bash zsh ksh fish',
  syntax: { line: ['#'], quotes: '\'"', hashWord: true },
  id: /[A-Za-z_][\w-]*/g,
  kw: kw(`if then else elif fi case esac for while until do done in function select time return local export readonly declare echo exit set unset shift source true false test cd`),
  defs: [
    [R`^[ \t]*(?:function[ \t]+)?([A-Za-z_][\w-]*)[ \t]*\(\)`, 'function'],
    [R`^[ \t]*function[ \t]+([A-Za-z_][\w-]*)`, 'function'],
    [R`^(?:export[ \t]+|readonly[ \t]+|declare[ \t]+(?:-\w+[ \t]+)?)?([A-Z_][A-Z0-9_]*)=`, 'variable'],
  ],
  imports: (raw, m) => grab([], /^[ \t]*(?:source|\.)[ \t]+["']?([^\s"';|&]+)/gm, raw, m),
  resolve: 'sh',
};

const SQL = {
  group: 'sql', exts: 'sql',
  syntax: { line: ['--'], block: [['/*', '*/']], quotes: '\'' },
  kw: kw(`select from where and or not null insert into values update set delete create table view index primary key foreign references on join left right inner outer group by order having limit as is in exists`),
  defs: [[RI`\bcreate[ \t]+(?:or[ \t]+replace[ \t]+)?(?:temp(?:orary)?[ \t]+)?(?:table|view|function|procedure|index|trigger|type|materialized[ \t]+view)[ \t]+(?:if[ \t]+not[ \t]+exists[ \t]+)?(?:[\w"]+\.)?"?(${N})`, 'type']],
};

const GEN_DEFS = [
  [R`\b(?:function|func|fn|def|defp|defmacro|defn-?|fun|sub|proc|procedure|rpc)[ \t]+([A-Za-z_][\w?!']*)`, 'function'],
  [R`\b(?:class|struct|interface|enum|trait|module|defmodule|record|type|contract|library|message|service|input|schema)[ \t]+([A-Za-z_][\w.]*)`, 'class'],
];
const gen = (exts, syntax) => ({ group: 'gen', exts, syntax: { quotes: '"', triple: true, multi: '"', ...syntax }, defs: GEN_DEFS });
const GENS = [
  gen('hs elm purs', { line: ['--'], block: [['{-', '-}']] }),
  gen('ml mli', { block: [['(*', '*)']] }),
  gen('ex exs r jl nim pl pm tf hcl gd cr raku', { line: ['#'] }),
  gen('erl hrl', { line: ['%'] }),
  gen('clj cljs cljc edn lisp el scm rkt', { line: [';'] }),
  gen('zig v sol fs fsx wgsl proto graphql gql d', { line: ['//'], block: [['/*', '*/']] }),
];

const MD = {
  group: 'md', exts: 'md mdx markdown rst', linkType: 'ref', resolve: 'md',
  imports: raw => grab(grab([], /\]\(\s*<?([^)\s>]+)/g, raw), /^\s*\[[^\]]+\]:\s*<?(\S+?)>?\s*$/gm, raw),
};
const HTML = { group: 'html', exts: 'html htm xhtml', imports: htmlImports, resolve: 'html' };
const CSS = {
  group: 'css', exts: 'css scss sass less styl', resolve: 'css',
  imports: raw => grab([], /@(?:import|use|forward)[ \t]+(?:url\()?[ \t]*['"]?([^'")\s;]+)/g, raw),
};
const TEXT = {
  group: 'text', exts: 'txt json jsonc json5 yaml yml toml ini cfg conf xml plist properties env cmake mk',
  names: ['makefile', 'dockerfile', 'license', 'readme', 'procfile', 'justfile', 'containerfile', 'go.mod'],
};

export const LANGS = [JS, PY, GO, RS, C, JVM, CS, SWIFT, DART, RB, PHP, LUA, SH, SQL, ...GENS, MD, HTML, CSS, TEXT];
const BY_EXT = new Map(), BY_NAME = new Map();
for (const L of LANGS) {
  for (const e of L.exts.split(' ')) BY_EXT.set(e, L);
  for (const n of L.names || []) BY_NAME.set(n, L);
  L.kw ??= BASE_KW;
  L.id ??= /[A-Za-z_]\w*/g;
  L.idAll = new RegExp(L.id.source, 'g');
  if (L.syntax) {
    const s = L.syntax, f = new Uint8Array(128);
    for (const [o] of s.block || []) f[o.charCodeAt(0)] = 1;
    for (const l of s.line || []) f[l.charCodeAt(0)] = 1;
    for (const q of s.quotes || '') f[q.charCodeAt(0)] = 1;
    if (s.regex) f[47] = 1;
    s.first = f;
  }
}

export function langOf(path) {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const byName = BY_NAME.get(base);
  if (byName) return byName;
  const i = base.lastIndexOf('.');
  return i > 0 ? BY_EXT.get(base.slice(i + 1)) || null : null;
}

const SKIP_DIRS = new Set(['node_modules', 'vendor', 'dist', 'build', 'out', 'target', 'coverage', '__pycache__', 'venv', 'env', 'bower_components', 'Pods', 'DerivedData', 'site-packages', 'obj', 'third_party', 'external']);
const SKIP_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'cargo.lock', 'poetry.lock', 'go.sum', 'composer.lock', 'gemfile.lock', 'pipfile.lock', 'bun.lockb', 'flake.lock']);
const TEXT_GROUPS = new Set(['text', 'md', 'html', 'css']);

export function wanted(path, size = 0) {
  const segs = path.split('/');
  for (let i = 0; i < segs.length - 1; i++) {
    const s = segs[i];
    if (SKIP_DIRS.has(s) || (s[0] === '.' && s !== '.github')) return false;
  }
  const base = segs[segs.length - 1].toLowerCase();
  if (SKIP_FILES.has(base) || /\.min\.(js|css)$|\.map$|\.bundle\.js$|\.lock$/.test(base)) return false;
  const L = langOf(path);
  if (!L) return false;
  return size <= (TEXT_GROUPS.has(L.group) ? 250e3 : 800e3);
}

const RE_PREV = new Set('(,=:[!&|?{};+-*%>~^'.split(''));
const RE_KW = /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/;

function regexEnd(text, out, i) {
  let p = i - 1;
  while (p >= 0 && (out[p] === 32 || out[p] === 9 || out[p] === 10 || out[p] === 13)) p--;
  if (p >= 0) {
    const pc = String.fromCharCode(out[p]);
    if (!RE_PREV.has(pc) && !(/[\w$]/.test(pc) && RE_KW.test(text.slice(Math.max(0, p - 12), p + 1)))) return -1;
  }
  const n = text.length;
  if (out[i + 1] === 62) return -1;
  let j = i + 1, inClass = false;
  while (j < n) {
    const c = out[j];
    if (c === 92) { j += 2; continue; }
    if (c === 10) return -1;
    if (c === 91) inClass = true;
    else if (c === 93) inClass = false;
    else if (c === 47 && !inClass) {
      j++;
      while (j < n && /[a-z]/i.test(text[j])) j++;
      return j;
    }
    j++;
  }
  return -1;
}

export function mask(text, L, cls) {
  const S = L.syntax;
  if (!S) return text;
  const n = text.length;
  const out = new Uint16Array(n);
  for (let i = 0; i < n; i++) out[i] = text.charCodeAt(i);
  const blank = (a, b, c) => {
    if (b > n) b = n;
    for (let k = a; k < b; k++) if (out[k] !== 10) out[k] = 32;
    if (cls) cls.fill(c, a, b);
  };
  const line = S.line || [], block = S.block || [], quotes = S.quotes || '', first = S.first, raw = S.raw || '', multi = S.multi || '';
  let i = 0;
  scan: while (i < n) {
    const code = out[i];
    if (code >= 128 || !first[code]) { i++; continue; }
    for (const [o, c] of block) {
      if (text.startsWith(o, i)) {
        const j = text.indexOf(c, i + o.length);
        const e = j < 0 ? n : j + c.length;
        blank(i, e, 1); i = e; continue scan;
      }
    }
    for (const lc of line) {
      if (text.startsWith(lc, i)) {
        if (S.hashWord && i > 0 && !/\s/.test(text[i - 1])) break;
        let j = text.indexOf('\n', i);
        if (j < 0) j = n;
        blank(i, j, 1); i = j; continue scan;
      }
    }
    if (code === 47 && S.regex) {
      const e = regexEnd(text, out, i);
      if (e > 0) { blank(i, e, 2); i = e; } else i++;
      continue;
    }
    const ch = text[i];
    if (quotes.includes(ch)) {
      if (S.triple && text.startsWith(ch + ch + ch, i)) {
        const j = text.indexOf(ch + ch + ch, i + 3);
        const e = j < 0 ? n : j + 3;
        blank(i, e, 2); i = e; continue;
      }
      if (S.rawHash && ch === '"') {
        let k = i - 1, h = 0;
        while (k >= 0 && text[k] === '#') { h++; k--; }
        if (k >= 0 && text[k] === 'r' && (k === 0 || !/\w/.test(text[k - 1]) || (text[k - 1] === 'b' && (k < 2 || !/\w/.test(text[k - 2]))))) {
          const j = text.indexOf('"' + '#'.repeat(h), i + 1);
          const e = j < 0 ? n : j + 1 + h;
          blank(i, e, 2); i = e; continue;
        }
      }
      if (ch === "'" && S.charQuote) {
        CHAR.lastIndex = i;
        if (CHAR.test(text)) { blank(i, CHAR.lastIndex, 2); i = CHAR.lastIndex; } else i++;
        continue;
      }
      const ml = multi.includes(ch) && !(i > 0 && /[\w'\\$?\/]/.test(text[i - 1]));
      let j = i + 1, start = i;
      while (j < n) {
        const c = out[j];
        if (c === 92 && !raw.includes(ch)) { j += 2; continue; }
        if (c === code) { j++; break; }
        if (c === 10 && ch !== '`' && !ml) break;
        if (S.dollarId && c === 36 && S.template.includes(ch) && /[A-Za-z_]/.test(text[j + 1] || '')) {
          blank(start, j + 1, 2);
          j++;
          while (j < n && /\w/.test(text[j])) j++;
          start = j;
          continue;
        }
        if (S.template && S.template.includes(ch) && c === 36 && out[j + 1] === 123) {
          blank(start, j, 2);
          j += 2;
          let d = 1;
          while (j < n && d) {
            const e = out[j];
            if (e === 123) d++; else if (e === 125) d--;
            j++;
          }
          start = j;
          continue;
        }
        j++;
      }
      blank(start, j, 2); i = Math.min(j, n); continue;
    }
    i++;
  }
  return DEC.decode(out);
}
