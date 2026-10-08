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
const C_HEADER = /\.(?:h|hh|hpp|hxx|h\+\+|cuh|inc|inl)$/i;
const STR_TYPE = { jvm: 'String', swift: 'String', dart: 'String', cs: 'string', js: 'String', py: 'str', rs: 'str' };
const PATHSEG = new Set(['rs', 'c', 'rb', 'php']);
const DECLS = new Set(['c', 'jvm', 'cs']);
const LOOSE_BARE = new Set(['rb', 'ex', 'gen', 'sh', 'lua', 'sql', 'md', 'html', 'css', 'text']);
const STD_SETS = {
  py: '__future__ _typeshed abc argparse array ast asyncio atexit base64 binascii bisect builtins bz2 calendar cgi cmath cmd code codecs collections colorsys concurrent configparser contextlib contextvars copy copyreg cProfile csv ctypes curses dataclasses datetime dbm decimal difflib dis doctest email encodings enum errno faulthandler fcntl filecmp fileinput fnmatch fractions ftplib functools gc getopt getpass gettext glob graphlib grp gzip hashlib heapq hmac html http imaplib importlib inspect io ipaddress itertools json keyword linecache locale logging lzma mailbox marshal math mimetypes mmap multiprocessing netrc numbers operator optparse os pathlib pdb pickle pkgutil platform plistlib poplib posixpath pprint profile pstats pty pwd py_compile queue quopri random re readline reprlib resource rlcompleter runpy sched secrets select selectors shelve shlex shutil signal site smtplib socket socketserver sqlite3 ssl stat statistics string stringprep struct subprocess symtable sys sysconfig syslog tarfile tempfile termios textwrap threading time timeit tkinter token tokenize tomllib trace traceback tracemalloc tty types typing unicodedata unittest urllib uuid venv warnings wave weakref webbrowser winreg wsgiref xml xmlrpc zipapp zipfile zipimport zlib zoneinfo _thread',
  js: 'assert async_hooks buffer child_process cluster console constants crypto dgram diagnostics_channel dns domain events fs http http2 https inspector module net os path perf_hooks process punycode querystring readline repl stream string_decoder sys timers tls trace_events tty url util v8 vm wasi worker_threads zlib',
  rb: 'abbrev base64 benchmark bigdecimal cgi coverage csv date delegate digest English erb etc fcntl fiddle fileutils find forwardable getoptlong io ipaddr irb json logger matrix monitor net objspace observer open3 open-uri openssl optparse ostruct pathname pp prettyprint prime pstore psych racc rbconfig readline resolv ripper securerandom set shellwords singleton socket stringio strscan syslog tempfile time timeout tmpdir tsort un uri weakref yaml zlib',
  c: 'assert complex ctype errno fenv float inttypes iso646 limits locale math setjmp signal stdalign stdarg stdatomic stdbool stddef stdint stdio stdlib stdnoreturn string tgmath threads time uchar wchar wctype unistd fcntl pthread sys dirent dlfcn poll sched semaphore strings termios netdb netinet arpa windows algorithm any array atomic bitset cassert cctype cerrno cfloat charconv chrono cinttypes climits clocale cmath codecvt complex condition_variable csetjmp csignal cstdarg cstddef cstdint cstdio cstdlib cstring ctime cwchar deque exception execution filesystem forward_list fstream functional future initializer_list iomanip ios iosfwd iostream istream iterator limits list map memory memory_resource mutex new numeric optional ostream queue random ratio regex scoped_allocator set shared_mutex span sstream stack stdexcept streambuf string_view system_error thread tuple type_traits typeindex typeinfo unordered_map unordered_set utility valarray variant vector',
  swift: 'Foundation UIKit SwiftUI AppKit Combine Dispatch os Darwin Glibc CoreGraphics CoreFoundation CoreServices XCTest Network Security CoreImage AVFoundation QuartzCore ObjectiveC MobileCoreServices UniformTypeIdentifiers FoundationNetworking FoundationEssentials SystemConfiguration CoreData CoreLocation MapKit WebKit Photos StoreKit UserNotifications Accelerate Metal MetalKit SceneKit SpriteKit GameKit CryptoKit OSLog Observation',
  lua: 'string table math io os coroutine debug utf8 package bit jit ffi',
  ex: 'Kernel Enum Map MapSet String List Keyword GenServer Supervisor DynamicSupervisor Agent Task Logger Application Process Registry IO File Path System Code Module Atom Integer Float Tuple Stream Access Inspect Protocol Exception ExUnit Mix Regex URI Base Bitwise Calendar Date DateTime NaiveDateTime Time Version Node Port Function Range StringIO OptionParser EEx',
};
const STD = Object.fromEntries(Object.entries(STD_SETS).map(([k, v]) => [k, new Set(v.split(' '))]));
const isStd = (name, group) => {
  switch (group) {
    case 'go': return !name.split('/')[0].includes('.');
    case 'rs': return /^(?:std|core|alloc|proc_macro|test)$/.test(name);
    case 'jvm': return /^(?:java|javax|kotlin|scala|groovy|jdk|sun)(?:\.|$)/.test(name);
    case 'cs': return /^System(?:\.|$)/.test(name);
    case 'dart': return name.startsWith('dart:');
    case 'zig': return /^(?:std|builtin|root)$/.test(name);
    case 'hs': return /^(?:Prelude|GHC|Foreign|Numeric|Debug|Unsafe|Type|System\.(?:IO|Exit|Environment|Info|Mem|Timeout|CPUTime)|Control\.(?:Monad|Applicative|Exception|Concurrent|Arrow|Category|DeepSeq)|Text\.(?:Printf|Read|Show)|Data\.(?:List|Maybe|Char|Either|Function|Functor|Foldable|Traversable|IORef|STRef|Word|Int|Bits|Ord|Monoid|Semigroup|Kind|Proxy|Coerce|Void|Typeable|Data|String|Tuple|Ratio|Complex|Fixed|Dynamic|Unique|Version|Bifunctor|Bool|Eq|Type|Array))(?:\.|$)/.test(name);
    case 'js': return name.startsWith('node:') || STD.js.has(name.split('/')[0]);
    default: return !!STD[group]?.has(name.split(/[./]/)[0]);
  }
};
const RET_ANY = /\breturn\b(?:[ \t]+(?:new[ \t]+)?([A-Z]\w*)[ \t]*\(|[ \t]+(this|self)\b[ \t]*;?[ \t]*$)?/gm;
const MULTI_INIT = new Set(['js', 'jvm', 'swift', 'dart', 'cs', 'rs']);
const UNTYPED_RET = new Set(['py', 'js', 'rb', 'php', 'lua']);
const KEY_COLON = new Set(['js', 'rb', 'swift', 'dart', 'cs', 'php', 'ex']);
const KEY_EQ = { py: /(?:^|[(,])[ \t]*$/, lua: /[{,][ \t]*$/ };
const TRAILING = new Set(['swift', 'jvm']);
const GLOBAL_VARS = new Set(['swift', 'go', 'c', 'jvm', 'cs']);
const EX_PATH = /^(?:[^/]+\/){0,2}(?:examples?|samples?|demos?|docs?|benchmarks?|bench)\//i;
const GEN_FILE = /\.(?:gen|g|generated|pb|freezed)\.\w+$|_pb2\.py$|_generated\.\w+$/;
const EX_ROOT = /^(?:[^/]+\/){0,2}(?:examples?|samples?|demos?)\/[^/]+(?:\/|$)/i;
const isFn = k => k === 'function' || k === 'method';
const SELF = new Set(['this', 'self', 'Self', 'static', 'me']);
const COMMON = new Set(`each map filter reduce forEach some every indexOf lastIndexOf findIndex includes concat splice flatMap get set put add remove delete has contains size length count keys values entries items push pop shift unshift append insert extend clear close open read write flush call apply bind toString equals hashCode compareTo next hasNext iterator then catch finally emit on off once parse format join split replace trim match test exec find first last sort reverse slice copy clone merge reset cancel value name type id data message error list log debug info warn trace dispose description key path url status result index text constructor prototype String Error Get Set Write Read Close Len Open Value Type Status ToString Equals GetHashCode Add Remove Count Contains Clear Dispose Any Select Where First FirstOrDefault ToList ToArray Single Max Min Sum OrderBy Include unwrap expect as_bytes as_str as_ref as_mut is_none is_some is_ok is_err is_empty iter iter_mut into_iter to_string to_owned unwrap_or map_err ok err lines bytes chars len borrow kind start end to_s to_str to_a to_h to_i to_sym inspect respond_to? include? empty? nil? is_a? kind_of? dup freeze tap merge! fetch __toString __get __set __call toUpperCase toLowerCase toLocaleUpperCase toLocaleLowerCase startsWith endsWith padStart padEnd charAt charCodeAt codePointAt substring substr trimStart trimEnd repeat localeCompare normalize fill flat findLast findLastIndex toFixed toPrecision toISOString toJSON getTime valueOf hasOwnProperty addEventListener removeEventListener dispatchEvent querySelector querySelectorAll appendChild removeChild setAttribute getAttribute removeAttribute preventDefault stopPropagation upper lower strip lstrip rstrip startswith endswith encode decode setdefault popitem appendleft popleft isdigit isalpha splitlines`.split(/\s+/));
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
  let end = d, first = true, where = false;
  for (let k = d + 1; k < lines.length; k++) {
    const s = lines[k], t = s.trim();
    if (!t) continue;
    const ind = indentOf(s);
    if (ind > I) { end = k; if (!where) first = false; continue; }
    if (ind === I) {
      const c = t[0];
      if (cont && first && cont.test(t)) { end = k; cont = null; continue; }
      if (first && /^where\b/.test(t)) { end = k; where = true; continue; }
      if (skip && skip.test(t)) continue;
      if (c === '{' && first) { end = k; first = where = false; continue; }
      if (c === '}' || c === ')' || c === ']') {
        end = k;
        if (/(?:[{(\[:,]|=>)$/.test(t)) { first = false; continue; }
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
  const push = (name, idx, kind, extra, owner, self, ty) => {
    if (L.clean) name = L.clean(name);
    if (!name || L.kw.has(name)) return;
    const line = lineAt(starts, idx);
    const k = line + ':' + name;
    if (seen.has(k)) return;
    if (kind === 'variable' || kind === 'field') {
      const ln = lines[line];
      if (!extra && ((ln.length < 2000 && /,\s*$/.test(ln)) || ((L.group === 'py' || (L.group === 'js' && kind === 'field')) && nested(line)))) return;
    }
    seen.add(k);
    if (!owner && L.extRecv && kind === 'function') {
      const r = L.extRecv.exec(masked.slice(Math.max(starts[line], idx - 160), idx));
      if (r) owner = r[1];
    }
    found.push({ name, kind, line, idx, end: line, owner, self, ty, prop: extra && kind === 'field' });
  };
  for (const [re, kind, ok, keep] of L.defs) {
    for (const m of masked.matchAll(re)) {
      const i = m.indices[1][0];
      if (!ok || ok(masked, i)) push(m[1], i, kind, keep);
    }
  }
  if (L.extra) for (const d of L.extra(masked)) push(d.name, d.idx, d.kind, true, d.owner, d.self, d.ty);
  found.sort((a, b) => a.idx - b.idx);
  const skip = SKIP_SAME[L.group];
  for (const d of found) {
    if (L.group === 'c' && /^[ \t]*#[ \t]*define\b/.test(lines[d.line])) {
      let e = d.line;
      while (e + 1 < lines.length && /\\[ \t]*$/.test(lines[e])) e++;
      d.end = e;
    } else d.end = d.kind === 'field' || (L.group === 'c' && d.kind === 'type') ? d.line : blockEnd(lines, d.line, skip, d.kind === 'class' ? L.head : null);
    if (L.sameName && isFn(d.kind) && indentOf(lines[d.line]) === 0) {
      const re = new RegExp(`^${d.name}(?![\\w'])`);
      for (let k = d.end + 1; k < lines.length; k++) {
        const t = lines[k];
        if (!t.trim()) continue;
        if (re.test(t)) { d.end = blockEnd(lines, k, skip, null); k = d.end; continue; }
        break;
      }
    }
  }
  return found;
}

const OPEN = '([{<', CLOSE = ')]}>';

const FIELD_MODS = new Set('public private protected internal static final readonly override abstract virtual new required lateinit open transient volatile const sealed partial'.split(' '));
const CTOR = /^(?:constructor|__init__|__construct|init|initialize)$/;
const MODS = new Set('final const out ref in params this readonly volatile struct unsigned signed static register mut inout var val let'.split(' '));
const lastSeg = s => { const m = s.match(/[A-Za-z_]\w*/g); return m ? m[m.length - 1] : null; };
const WRAP = new Set('Option Optional Box Rc Arc RefCell Cell Mutex RwLock Weak Nullable Lazy Ref RefMut Cow NonNull Pin ManuallyDrop AtomicReference WeakReference Readonly Partial Required NonNullable Union'.split(' '));
const COLL = new Set('List Array ArrayList LinkedList Set HashSet TreeSet LinkedHashSet SortedSet NavigableSet Collection Iterable Iterator ListIterator Sequence MutableList MutableSet MutableCollection MutableIterable MutableSequence ReadonlyArray ReadonlySet Vec VecDeque BTreeSet IEnumerable IList ICollection IReadOnlyList IReadOnlyCollection ISet IAsyncEnumerable IEnumerator Stream Flow Deque ArrayDeque Queue PriorityQueue BinaryHeap list set frozenset FrozenSet AbstractSet Generator AsyncIterator AsyncIterable AsyncGenerator Iter IntoIter vector deque forward_list unordered_set multiset span initializer_list array ImmutableList ImmutableSet Slice IterableIterator ArrayLike NodeListOf HTMLCollectionOf'.split(' '));

const headOf = t => { if (!t) return t; const k = t.indexOf('[]'); return k < 0 ? t : k ? t.slice(0, k) : '[]'; };

function topSplit(s, ch) {
  const out = [];
  let d = 0, a = 0;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (OPEN.includes(c)) d++;
    else if (CLOSE.includes(c) && !(c === '>' && s[k - 1] === '=')) d--;
    else if (c === ch && d === 0) { out.push(s.slice(a, k)); a = k + 1; }
  }
  out.push(s.slice(a));
  return out;
}

function tyOf(s, n = 0) {
  if (!s || n > 4) return null;
  s = s.replace(/@[\w.]+(?:\([^()]*\))?/g, ' ').replace(/'[a-z_]\w*\b/g, ' ')
    .replace(/\s*\|\s*(?:null|undefined|None)\b|\b(?:null|undefined|None)\s*\|\s*/g, '')
    .replace(/\b(?:mut|const|readonly|inout|dyn|impl|final|volatile|struct|class|enum|union|unsigned|signed|register|static|in|out|ref|params|var|val|let|keyof|typeof|unique)\b|[&*?!^]/g, ' ')
    .trim().replace(/\.\.\.$/, '[]').replace(/^<[^<>]*(?:<[^<>]*>[^<>]*)*>\s*/, '');
  if (!s) return null;
  if (s.startsWith('[]')) { const e = tyOf(s.slice(2), n + 1); return e && '[]' + e; }
  const mp = /^map\[[^\]]*\](.+)$/.exec(s);
  if (mp) { const e = tyOf(mp[1], n + 1); return e ? 'map[]' + e : 'map'; }
  if (s[0] === '[') {
    if (!s.endsWith(']')) return null;
    if (topSplit(s.slice(1, -1), ':').length > 1) return 'Dictionary';
    const e = tyOf(s.slice(1, -1), n + 1);
    return e && '[]' + e;
  }
  if (s.endsWith('[]')) { const e = tyOf(s.slice(0, -2), n + 1); return e && '[]' + e; }
  if (s[0] === '(' || topSplit(s, '|').length > 1) return null;
  const b = s.search(/[<[]/);
  if (b < 0) return qualSeg(s);
  const head = lastSeg(s.slice(0, b)), qh = qualSeg(s.slice(0, b));
  if (!head || !s.endsWith(s[b] === '<' ? '>' : ']')) return qh;
  const args = topSplit(s.slice(b + 1, -1), ',').map(x => x.trim()).filter(x => x && !/^(?:None|null|undefined)$/.test(x));
  if (WRAP.has(head)) return args.length === 1 ? tyOf(args[0], n + 1) : null;
  if (head === 'Result' && args.length) return tyOf(args[0], n + 1);
  if (COLL.has(head)) { const e = args.length ? tyOf(args[0], n + 1) : null; return e ? '[]' + e : '[]'; }
  if (args.length === 1) { const e = tyOf(args[0], n + 1); return e && !e.includes('[]') ? qh + '[]' + e : qh; }
  return qh;
}
const qualSeg = s => { const m = s.match(/[A-Za-z_]\w*/g); if (!m) return null; const a = m[m.length - 2], b = m[m.length - 1]; return a && /^[A-Z]/.test(a) && /^[A-Z]/.test(b) && !/^[A-Z0-9_]+$/.test(a) ? a + '.' + b : b; };
const CALL_VARS = [
  /\b(?:let|var|val|const|auto)[ \t]+([A-Za-z_$][\w$]*)[ \t]*=[ \t]*(?:try[!?]?[ \t]+|await[ \t]+)*(?:[\w$]+[ \t]*\.[ \t]*)*([A-Za-z_$][\w$]*)[ \t]*(?:<([A-Z][\w.]*)>)?[ \t]*\(/g,
  /\b([A-Za-z_]\w*)(?:[ \t]*,[ \t]*\w+)?[ \t]*:=[ \t]*(?:\w+\.)*([A-Za-z_]\w*)[ \t]*\(/g,
];
const PHP_CALL = /\$(\w+)[ \t]*=[ \t]*(?:\$?\w+[ \t]*(?:->|::)[ \t]*)*(\w+)[ \t]*\(/g;
const PHP_NEW = /\$(\w+)[ \t]*=[ \t]*new[ \t]+\\?(?:\w+\\)*([A-Z]\w*)()()/g;
const RB_NEW = /^[ \t]*@?(\w+)[ \t]*=[ \t]*(?:\w+::)*([A-Z]\w*)\.new\b()()/gm;
const CALL_VARS_PLAIN = /^[ \t]*([A-Za-z_]\w*)[ \t]*=[ \t]*(?:await[ \t]+)?(?:[\w]+\.)*([A-Za-z_]\w*)[ \t]*\(/gm;
const RET = [
  /^\s*(?:async\s+)?(?:throws\s+|rethrows\s+)?->\s*([^{:=;\n]+)/,
  /^[ \t]*:[ \t]*([^{=;\n]+)/,
];
const RET_GO = /^\s*\(?\s*\*?(?:[a-z]\w*\.)?([A-Z]\w*)/;

function exprEnd(t, from) {
  let i = from, d = 0;
  while (i < t.length && t.charCodeAt(i) <= 32) i++;
  for (const lim = Math.min(t.length, from + 3000); i < lim; i++) {
    const c = t.charCodeAt(i);
    if (c === 40 || c === 91 || c === 123) d++;
    else if (c === 41 || c === 93 || c === 125) { if (!d) return i; d--; }
    else if (c === 59 && !d) return i;
    else if (c === 10 && !d) {
      let j = i + 1;
      while (j < t.length && t.charCodeAt(j) <= 32) j++;
      const n = t.charCodeAt(j), n2 = t.charCodeAt(j + 1);
      if (!((n === 46 && n2 !== 46) || (n === 63 && n2 === 46) || (n === 33 && n2 === 46))) return i;
    }
  }
  return -1;
}

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

const LOOPS = {
  js: [/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+of\s+(?:this\.)?([A-Za-z_$][\w$]*)\s*\)/g],
  py: [/\bfor[ \t]+(\w+)[ \t]+in[ \t]+(?:self\.)?(\w+)\b(?![ \t]*[.(\[])/g],
  jvm: [/\bfor\s*\(\s*(?:val\s+|var\s+)?(\w+)\s+in\s+(?:this\.)?(\w+)\s*\)/g],
  swift: [/\bfor\s+(\w+)\s+in\s+(?:self\.)?(\w+)\s*\{/g],
  go: [/\bfor\s+\w+\s*,\s*(\w+)\s*:=\s*range\s+(?:\w+\.)?(\w+)/g],
  rs: [/\bfor\s+(\w+)\s+in\s+&?(?:mut\s+)?(?:self\.)?(\w+)/g],
  cs: [/\bforeach\s*\(\s*var\s+(\w+)\s+in\s+(?:this\.)?(\w+)\s*\)/g],
};
const CB_NAMES = 'Select|Where|First|FirstOrDefault|Single|SingleOrDefault|Any|All|OrderBy|OrderByDescending|ForEach|SelectMany|GroupBy|ToDictionary|Count|Sum|Max|Min|forEach|map|filter|some|every|find|findLast|findIndex|flatMap|sort|each|each_with_index|select|reject|collect|flat_map|compactMap|first|contains|allSatisfy|forEachIndexed|mapNotNull|filterNot|any|all|none|sumOf|associateBy|groupBy|onEach|sortedBy|maxBy|minBy|forEachOrdered';
const CB = new RegExp(`(?:\\b(?:this|self)\\.|@)?([A-Za-z_$][\\w$]*)[ \\t]*[?!]?\\.[ \\t]*(?:${CB_NAMES})[ \\t]*(?:\\([ \\t]*(?:async[ \\t]*)?)?[ \\t]*$`);
const CB_IT = new RegExp(`(?:\\bthis\\.)?([A-Za-z_]\\w*)[ \\t]*[?!]*\\.[ \\t]*(?:${CB_NAMES})[ \\t]*\\{(?![^\\n]*->)`, 'g');
const VAR_TYPES = [
  /\b(?:const|let|var|val|auto)[ \t]+([A-Za-z_$][\w$]*)[ \t]*(?::[ \t]*([A-Za-z_][\w.]*(?:<[^=;\n]*>)?(?:\[\])*\??))?[ \t]*(?:=[ \t]*(?:new[ \t]+([A-Za-z_][\w.]*)|([A-Z]\w*)[ \t]*[({]|([A-Z]\w*)\.(?:shared|default|instance|current|main|standard|sharedInstance|getInstance\(\)|INSTANCE)\b))?/g,
  /\b([A-Za-z_]\w*)[ \t]*:=[ \t]*&?(?:[a-z]\w*\.)?([A-Z]\w*)[ \t]*\{/g,
];

function params(t, from, L, types) {
  if (L.group === 'ml' || L.group === 'hs') {
    const e = t.indexOf('\n', from), head = t.slice(from, e < 0 ? t.length : e).split(/=|->/)[0];
    return (head.match(/[a-z_][\w']*/g) || []).filter(w => !L.kw.has(w));
  }
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
    if (colon >= 0) ty = tyOf(head.slice(colon + 1));
    else if (L.paramLast) { const k = pre.lastIndexOf(name); ty = k > 0 ? tyOf(pre.slice(0, k)) : null; }
    else if (L.group === 'go') { const k = pre.indexOf(name); ty = tyOf(pre.slice(k + name.length)); }
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

let mlNear = null;
function makeResolver({ nodes, fileIds, dirs, dirFiles, csNs, phpNs, exMods, mlMods, goMods, names, swiftMods, crates, jsPkgs, jsAliases }) {
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
  const nearMl = (mod, from) => {
    const l = mlMods.get(mod);
    if (!l) return null;
    const fp = nodes[from].path;
    let best = null, bl = -1;
    for (const id of l) {
      if (/\.mli$/.test(nodes[id].path) && l.some(o => o !== id && nodes[o].path === nodes[id].path.slice(0, -1))) continue;
      const p = nodes[id].path;
      let k = 0;
      while (k < p.length && k < fp.length && p[k] === fp[k]) k++;
      if (k > bl) { bl = k; best = id; }
    }
    return best;
  };
  mlNear = nearMl;
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
      if (phpNs.size) {
        const inNs = (phpNs.get(segs.slice(0, -1).join('\\')) || []).find(id => nodes[id].name === segs[n - 1] + '.php');
        if (inNs != null) return inNs;
        if (n < 2) return null;
      }
      for (let i = 0; i <= Math.max(0, n - 2); i++) {
        const r = suf(segs.slice(i).join('/') + '.php', info);
        if (r != null) return r;
      }
      return n > 1 ? segs[0] : null;
    },
    ml(spec, info) {
      return nearMl(spec, info.id) ?? spec;
    },
    hs(spec, info) {
      const p = spec.replace(/\./g, '/');
      return suf(p + '.hs', info) ?? suf(p + '.lhs', info) ?? spec.split('.').slice(0, 2).join('.');
    },
    ex(spec) {
      return exMods.get(spec) ?? spec.split('.')[0];
    },
    lua(spec, info) {
      const p = spec.replace(/\./g, '/');
      return suf(p + '.lua', info) ?? suf(p + '/init.lua', info) ?? spec.split('.')[0];
    },
    zig(spec, info) {
      if (!/\.zig$/.test(spec)) return spec;
      return exact(join(info.dir, spec)) ?? suf(spec.replace(/^(\.\.?\/)+/, ''), info);
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
  const macros = new Set(), privC = new Set(), aliasOf = new Map(), retNode = new Map(), closureOf = new Map(), ownerOf = new Map(), selfOf = new Map(), memberish = new Set(), typesOf = new Map(), fieldTypes = new Map(), retOf = new Map(), basesOf = new Map();
  const pkgOf = new Map();
  const csNs = new Set(), phpNs = new Map(), exMods = new Map(), mlMods = new Map(), fixtures = new Set();
  let done = 0;
  const readFile = info => {
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
    if (L.group === 'ml') { const b = nodes[info.id].name.replace(/\.mli?$/, ''), k = b[0].toUpperCase() + b.slice(1), l = mlMods.get(k); if (!l) mlMods.set(k, [info.id]); else if (!l.includes(info.id)) l.push(info.id); }
    if (L.group === 'ex' && masked) { for (const m of masked.matchAll(/\bdefmodule[ \t]+([A-Z][\w.]*)/g)) if (!exMods.has(m[1])) exMods.set(m[1], info.id); if (L.aliases) info.alias = L.aliases(text); }
    if (L.group === 'php' && masked) { const m = /^namespace[ \t]+([\w\\]+)/m.exec(masked); if (m) { const l = phpNs.get(m[1]); if (l) l.push(info.id); else phpNs.set(m[1], [info.id]); } }
    if (L.strip && masked) masked = masked.replace(L.strip, x => ' '.repeat(x.length));
    info.masked = masked;
    if (STR_TYPE[L.group]) info.raw = text;
    if (!L.defs || !masked) return;

    const starts = lineStarts(masked);
    if (masked.length > 20000 && starts.length * 400 < masked.length) return;
    const lines = masked.split('\n');
    const defs = extractDefs(masked, L, starts, lines);
    const stack = [];
    for (const d of defs) {
      while (stack.length && (stack[stack.length - 1].end < d.line || (stack[stack.length - 1].kind === 'field' && stack[stack.length - 1].line === d.line))) stack.pop();
      d.up = stack.length ? stack[stack.length - 1] : null;
      stack.push(d);
    }
    for (const d of defs) {
      if (d.kind !== 'variable') continue;
      for (let p = d.up; p; p = p.up) if (isFn(p.kind) || (p.kind === 'variable' && /[{([]\s*$/.test(lines[p.line]))) { d.drop = true; break; }
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
        const tn = tyOf(m[1]);
        if (tn && !MODS.has(tn) && tn !== 'auto') (defs[di].types ??= new Map()).set(m[2], tn);
      }
    }
    for (const re of L.group === 'py' || L.group === 'rb' ? [CALL_VARS_PLAIN] : L.group === 'go' ? CALL_VARS : L.group === 'php' ? [PHP_CALL] : CALL_VARS.slice(0, 1)) {
      for (const m of masked.matchAll(re)) {
        if (m[2] === 'require' || m[2] === 'import') continue;
        const ln = lineAt(starts, m.index + m[0].length - 1), di = fnAt[ln];
        const q = /[.>:][ \t]*$/.test(m[0].slice(0, m[0].lastIndexOf(m[2]))) ? '().' : '()';
        if (q === '().') { const h = /=[ \t]*(?:(?:await|try[!?]?)[ \t]+)*\$?([A-Za-z_$][\w$]*)/.exec(m[0]); if (h) (info.callHead ??= new Map()).set(m[1], h[1]); }
        if (q === '().') { const r = /=[ \t]*(?:(?:await|try[!?]?)[ \t]+)*\$?([A-Za-z_$][\w$]*)[ \t]*(?:\.|->)[ \t]*[A-Za-z_$][\w$]*[ \t]*(?:<[^<>\n]*>)?[ \t]*\($/.exec(m[0]); if (r) (info.callRecv ??= new Map()).set(m[1], r[1]); }
        const ty = m[3] ? lastSeg(m[3]) : q + m[2];
        if (di >= 0) (defs[di].types ??= new Map()).set(m[1], ty);
        else if (indentOf(lines[ln]) === 0) (info.types ??= new Map()).set(m[1], ty);
      }
    }
    for (const re of LOOPS[L.group] || []) {
      for (const m of masked.matchAll(re)) {
        const di = fnAt[lineAt(starts, m.index)];
        if (di >= 0 && m[1] !== m[2]) (defs[di].types ??= new Map()).set(m[1], '@' + m[2]);
      }
    }
    for (const re of L.group === 'go' ? VAR_TYPES : L.group === 'php' ? [PHP_NEW] : L.group === 'rb' ? [RB_NEW] : L.group === 'py' ? [] : VAR_TYPES.slice(0, 1)) {
      for (const m of masked.matchAll(re)) {
        const ty = m[2] || m[3] || m[4] || m[5];
        if (!ty) continue;
        const ln = lineAt(starts, m.index), di = fnAt[ln];
        const tn = tyOf(ty);
        if (!tn) continue;
        if (di >= 0) (defs[di].types ??= new Map()).set(m[1], tn);
        else if (indentOf(lines[ln]) === 0) (info.types ??= new Map()).set(m[1], tn);
      }
    }
    if (MULTI_INIT.has(L.group)) for (const m of masked.matchAll(/\b(?:val|let|var|const|auto|final)[ \t]+(?:mut[ \t]+)?([A-Za-z_$][\w$]*)[ \t]*=(?![=>])/g)) {
      const st = m.index + m[0].length, e = exprEnd(masked, st);
      if (e < 0 || !masked.slice(st, e).includes('\n')) continue;
      let j = e;
      while (j > st && masked.charCodeAt(j - 1) <= 32) j--;
      const ln = lineAt(starts, m.index), di = fnAt[ln];
      if (di >= 0) { const tm = (defs[di].types ??= new Map()); if (!tm.has(m[1])) tm.set(m[1], '#' + j); }
      else if (indentOf(lines[ln]) === 0 && !info.types?.has(m[1])) (info.types ??= new Map()).set(m[1], '#' + j);
    }
    const owner = new Int32Array(lines.length).fill(info.id);
    const defPos = new Set();
    const local = new Map();
    const keys = new Map();
    let g = names.get(L.group);
    if (!g) names.set(L.group, (g = new Map()));
    const types = new Map();
    for (const d of defs) {
      if (d.kind === 'impl' || d.kind === 'ns') { d.drop = true; continue; }
      if (L.group === 'c' && d.kind === 'type' && lines[d.line][0] === '}' && defs.some(c => c.kind === 'class' && c.name === d.name && c.line < d.line && c.end >= d.line - 1)) { d.drop = true; continue; }
      if (d.kind === 'extension') { d.kind = 'class'; d.ext = true; }
      else if (d.kind === 'prop') { d.kind = 'function'; d.ext = true; }
      else if (d.kind === 'field') { if (!(d.up && d.up.kind === 'class' && !d.up.drop)) { d.drop = true; continue; } d.kind = 'variable'; }
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
        if (e > 0 && TRAILING.has(L.group)) {
          const op = masked.indexOf('(', d.idx + d.name.length), last = op >= 0 && op < e ? topSplit(masked.slice(op + 1, e - 1), ',').pop() : '';
          const fm = last && /\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*(?:async\s*)?(?:throws\s*)?->/.exec(last);
          if (fm) closureOf.set(d.node, topSplit(fm[1], ',').map(a => { const x = tyOf(a.slice(a.lastIndexOf(':') + 1)); return x && !/^[A-Z]\d?$/.test(x) ? x : null; }));
        }
        if (e > 0) {
          const rest = masked.slice(e, e + 200);
          for (const re of L.group === 'py' ? RET.slice(0, 1) : RET) { const m = re.exec(rest); if (m) { rt = tyOf(m[1].replace(/\bwhere\b[^]*$/, '').replace(/^\s*Promise<([^]*)>\s*$/, '$1')); break; } }
          if (!rt && L.group === 'go') { const m = RET_GO.exec(rest); if (m) rt = m[1]; }
        }
        if (!rt && L.paramLast) rt = tyOf(lines[d.line].slice(0, d.idx - starts[d.line]).split(/\s+/).filter(w => !FIELD_MODS.has(w)).join(' '));
        if (rt && L.kw.has(rt)) rt = null;
        if (!rt && d.end > d.line && d.end - d.line < 80) {
          const a = starts[d.line + 1], b = d.end + 1 < starts.length ? starts[d.end + 1] : masked.length;
          let n = 0, same = null, self = 0, m;
          RET_ANY.lastIndex = a;
          while ((m = RET_ANY.exec(masked)) && m.index < b) {
            n++;
            if (m[2]) self++;
            else if (m[1] && (same === null || same === m[1])) same = m[1];
            else same = false;
          }
          if (n && self === n) rt = 'this';
          else if (n && same && !self && UNTYPED_RET.has(L.group)) rt = same;
        }
        if (L.group === 'py' && /^[ \t]*@(?:pytest\.)?fixture\b/.test(lines[d.line - 1] || '')) fixtures.add(d.name);
        if (!rt && e > 0 && /^\s*=\s*(?:apply|also|this)\b/.test(masked.slice(e, e + 40))) rt = 'this';
        const cls = p && isClassy(p.kind) ? p.name : ownerName;
        if (rt && cls && /^(?:self|Self|this|static)$/.test(rt)) retNode.set(d.node, cls);
        else if (rt && !/^(?:void|Unit|None|Void|[A-Z]\d?)$/.test(rt)) retNode.set(d.node, rt);
        if (rt && !/^(?:void|Unit|None|Void|self|Self|this|[A-Z]\d?)$/.test(rt)) retOf.set(d.name, retOf.has(d.name) && retOf.get(d.name) !== rt ? null : rt);
        else if (retOf.has(d.name)) retOf.set(d.name, null);
      }
      if (isClassy(d.kind)) {
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
        if (d.ext) basesOf.set(d.node, [d.name, ...(basesOf.get(d.node) || [])].slice(0, 6));
      }
      if (p && isClassy(p.kind)) {
        let ft = fieldTypes.get(p.node);
        if (d.kind === 'variable') {
          const ln = lines[d.line], col = d.idx - starts[d.line];
          const after = /^[ \t]*[?!]?[ \t]*:[ \t]*([^=;\n{,)]+)/.exec(ln.slice(col + d.name.length));
          let ty = d.ty ? tyOf(d.ty) : after ? tyOf(after[1]) : null;
          if (!ty && L.paramLast) ty = tyOf(ln.slice(0, col).split(/\s+/).filter(w => !FIELD_MODS.has(w)).join(' '));
          if (!ty) { const im = /^[ \t]*=[ \t]*(?:new[ \t]+)?(?:([A-Z][\w.]*)|([a-z_]\w*))[ \t]*(?:<[^<>\n]*>)?[ \t]*\(/.exec(ln.slice(col + d.name.length)); if (im) ty = im[1] ? tyOf(im[1]) : '()' + im[2]; }
          if (ty) { if (!ft) fieldTypes.set(p.node, (ft = new Map())); ft.set(d.name, ty); }
        } else if (d.types && (CTOR.test(d.name) || d.name === p.name)) {
          if (!ft) fieldTypes.set(p.node, (ft = new Map()));
          for (const [k, v] of d.types) if (!ft.has(k)) ft.set(k, v);
        }
      }
      if (ownerName) ownerOf.set(d.node, ownerName);
      if (L.group === 'c' && d.kind === 'type') {
        const ln = lines[d.line], m = /\btypedef\s+(?:const\s+)?(?:struct|union|enum)?\s*(\w+)\s*\**\s*(\w+)\s*;/.exec(ln);
        if (m && m[2] === d.name && m[1] !== d.name) aliasOf.set(d.name, m[1]);
        else if (/^\}/.test(ln)) for (const c of defs) if (isClassy(c.kind) && c.node != null && c.name !== d.name && (c.end === d.line || c.end === d.line - 1)) aliasOf.set(d.name, c.name);
      }
      if (L.group === 'js' && isFn(d.kind) && PROP_FN.test(lines[d.line].slice(Math.max(0, d.idx - starts[d.line] - 120), d.idx - starts[d.line]))) memberish.add(d.node);
      if (d.self) selfOf.set(d.node, d.self);
      if (isClassy(d.kind) && !d.ext && !types.has(d.name)) types.set(d.name, d);
      if (!d.prop) owner.fill(d.node, d.line, d.end + 1);
      defPos.add(d.idx);
      let inFn = false;
      for (let q = p; q && !inFn; q = q.up) if (isFn(q.kind) && !q.drop) inFn = true;
      const pre = lines[d.line].slice(0, d.idx - starts[d.line]);
      const cPriv = L.group === 'c' && isFn(d.kind) && !(p && isClassy(p.kind)) && !C_HEADER.test(f.path) && /\bstatic\b/.test(pre.trim() ? pre : lines[d.line - 1] || '');
      if (cPriv) privC.add(d.node);
      if (L.group === 'rs' && /\bmacro_rules!/.test(lines[d.line])) macros.add(d.node);
      if (L.group === 'c' && /^[ \t]*#[ \t]*define\b/.test(lines[d.line])) privC.add(d.node);
      if (!d.ext && !inFn && !(L.priv && L.priv.test(pre))) {
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
          const at0 = m[1] !== undefined && L.group === 'js' ? m.index + m[0].indexOf(m[1]) : m.index, cb = CB.exec(masked.slice(Math.max(0, at0 - 120), at0));
          if (cb && !(tm && tm.has(ns[0]))) (tm ??= new Map()).set(ns[0], '@' + cb[1]);
          else if (TRAILING.has(L.group)) {
            let j = m.index;
            while (j > 0 && masked.charCodeAt(j - 1) <= 32) j--;
            const c = masked.charCodeAt(j - 1);
            if (c === 41 || (isW(c) && !/\b(?:in|else|do|try|return|=|throws|async)$/.test(masked.slice(Math.max(0, j - 8), j)))) for (let i = 0; i < ns.length; i++) if (!(tm && tm.has(ns[i]))) (tm ??= new Map()).set(ns[i], '%' + j + ':' + i);
          }
          const a = lineAt(starts, m.index);
          scopes.push({ a, at: m.index, b: blockEnd(lines, a, skipOf(L)), names: new Set(ns), types: tm && tm.size ? tm : null });
        }
      }
      if (L.group === 'swift') for (const m of masked.matchAll(/\bcatch\b[ \t]*(?:let[ \t]+(\w+)[ \t]+as[ \t]*!?[ \t]*(\w+)[ \t]*)?\{/g)) {
        const a = lineAt(starts, m.index), nm = m[1] || 'error';
        scopes.push({ a, at: m.index, b: blockEnd(lines, a, skipOf(L)), names: new Set([nm]), types: new Map([[nm, m[2] || 'Error']]) });
      }
      if (L.group === 'jvm') for (const m of masked.matchAll(CB_IT)) {
        const a = lineAt(starts, m.index);
        scopes.push({ a, at: m.index, b: blockEnd(lines, a, skipOf(L)), names: new Set(['it']), types: new Map([['it', '@' + m[1]]]) });
      }
      if (scopes.length) {
        info.scopes = scopes;
        info.scopeNames = new Set(scopes.flatMap(sc => [...sc.names, ...(sc.types ? sc.types.keys() : [])]));
      }
    }
    for (const m of masked.matchAll(/(?:\b(?:self|this)\.|@)([A-Za-z_]\w*)[ \t]*=[ \t]*(?:(?:new[ \t]+)?([A-Z]\w*)(?:[ \t]*[({]|\.new\b)|([A-Za-z_]\w*)[ \t]*;?[ \t]*$|(?:await[ \t]+)?((?:[A-Za-z_]\w*\.)*)([a-z_]\w*)[ \t]*\()/gm)) {
      const di = fnAt[lineAt(starts, m.index)];
      if (di < 0) continue;
      let c = defs[di].up;
      while (c && !(isClassy(c.kind) && c.node != null)) c = c.up;
      if (!c) continue;
      const ty = m[2] || (m[5] ? (m[4] ? '().' : '()') + m[5] : defs[di].types && defs[di].types.get(m[3]));
      if (!ty || (!m[5] && ty.startsWith('()'))) continue;
      let ft = fieldTypes.get(c.node);
      if (!ft) fieldTypes.set(c.node, (ft = new Map()));
      if (!ft.has(m[1])) ft.set(m[1], ty);
    }
    if (L.group === 'go' || L.group === 'rs' || L.group === 'swift' || L.group === 'c') {
      for (const m of masked.matchAll(/\b(?:type[ \t]+(\w+)[ \t]+struct|struct[ \t]+(\w+)(?:<[^>{]*>)?)[^{;\n]*\{/g)) {
        const t = types.get(m[1] || m[2]);
        if (!t || t.node == null) continue;
        let d = 1, k = m.index + m[0].length;
        const lim = Math.min(masked.length, k + 20000), body0 = k;
        for (; k < lim && d; k++) { const c = masked.charCodeAt(k); if (c === 123) d++; else if (c === 125) d--; }
        const body = masked.slice(body0, k - 1);
        let ft = fieldTypes.get(t.node);
        for (const f of body.matchAll(/^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?(?:(?:let|var)[ \t]+)?([A-Za-z_]\w*)[ \t]*:?[ \t]*[*&]?(\[\])?(?:mut[ \t]+)?(?:\w+(?:\.|::))*([A-Z]\w*)/gm)) {
          if (f[1] === f[3]) continue;
          if (!ft) fieldTypes.set(t.node, (ft = new Map()));
          if (!ft.has(f[1])) ft.set(f[1], (f[2] || '') + f[3]);
        }
      }
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
  };
  for (const info of infos) {
    if (++done % 50 === 0) progress({ phase: 'Reading code', done, total: infos.length });
    readFile(info);
  }

  const resolve = makeResolver({ nodes, fileIds, dirs, dirFiles, csNs, phpNs, exMods, mlMods, goMods, names, swiftMods, crates, jsPkgs, jsAliases });
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
        if (info.L.shadowExt && !spec.endsWith('*')) {
          const sp = spec.trim(), last = sp.split(/[.:/]/).pop();
          if (!(info.binds && info.binds.some(([n, t]) => t === sp && n !== last))) (info.ext ??= new Set()).add(last);
        }
        let id = libs.get(r);
        if (id === undefined) {
          id = add({ kind: 'lib', key: 'l:' + r, name: r, path: '', parent: -1, file: -1, line: 0, end: 0, group: info.L.group });
          if (isStd(r, info.L.group)) nodes[id].std = true;
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
    for (const [n, sp, ns] of info.binds) {
      if (!info.specs.includes(sp)) continue;
      let r;
      try { r = resolve(info.L.resolve, sp.trim(), info); } catch { r = null; }
      if (typeof r === 'string' || r == null) (info.ext ??= new Set()).add(n);
      else if (typeof r === 'number' && (ns === true || (typeof ns === 'string' && new RegExp(`(?:^|/)${ns}(?:\\.py|/__init__\\.py)$`).test(nodes[r].path)))) (info.modBind ??= new Map()).set(n, r);
    }
    info.binds = null;
  }
  const infoOf = new Map(infos.map(i => [i.id, i]));
  const lineCache = new Map();
  const staticish = c => {
    const n = nodes[c];
    let ls = lineCache.get(n.file);
    if (!ls) { const inf = infoOf.get(n.file); lineCache.set(n.file, (ls = inf && inf.masked ? inf.masked.split('\n') : [])); }
    return /^[ \t]*(?:@\w+[ \t]+)*(?:(?:public|private|internal|fileprivate|open|final|indirect|nonisolated)[ \t]+)*(?:case|static|class[ \t]+(?:var|let|func))\b/.test(ls[n.line] || '');
  };
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
  const qnCache = new Map();
  const qn = c => { let q = qnCache.get(c); if (q === undefined) { q = nodes[c].name; for (let p = nodes[c].parent; p >= 0 && isClassy(nodes[p].kind); p = nodes[p].parent) q = nodes[p].name + '.' + q; qnCache.set(c, q); } return q; };
  for (const n of nodes) if (isClassy(n.kind) && n.parent >= 0 && isClassy(nodes[n.parent].kind) && !n.name.includes('.')) {
    const q = qn(n.id), q2 = nodes[n.parent].name + '.' + n.name;
    for (const k of q === q2 ? [q] : [q, q2]) {
      const a = classByName.get(k);
      typeNames.add(k);
      if (a) a.push(n.id); else classByName.set(k, [n.id]);
    }
  }
  const fixT = v => typeof v === 'string' && v.includes('.') ? v.replace(/([A-Za-z_]\w*)\.([A-Z]\w*)/g, (m, a, b) => classByName.has(m) ? m : b) : v;
  const fixM = m => { if (m) for (const [k, v] of m) if (typeof v === 'string' && v.includes('.')) m.set(k, fixT(v)); };
  fixM(retNode); fixM(retOf);
  for (const m of fieldTypes.values()) fixM(m);
  for (const m of typesOf.values()) fixM(m);
  for (const [k, a] of closureOf) closureOf.set(k, a.map(fixT));
  for (const info of infos) { fixM(info.types); if (info.scopes) for (const sc of info.scopes) fixM(sc.types); }
  const preferImported = (list, info) => {
    if (list.length < 2) return list;
    const near = list.filter(c => nodes[c].file === info.id || info.imported.has(nodes[c].file));
    return near.length ? near : list;
  };
  const byClass = new Map(), byType = new Map(), byOwner = new Map();
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
      if (cp.parent >= 0 && isClassy(nodes[cp.parent].kind)) addIdx(byType, qn(cp.id), n.name, n.id);
      const dot = cp.name.lastIndexOf('.');
      if (dot >= 0) addIdx(byType, cp.name.slice(dot + 1), n.name, n.id);
    }
    const ow = ownerOf.get(n.id);
    if (ow && !(cp && cp.name === ow)) { addIdx(byType, ow, n.name, n.id); addIdx(byOwner, ow, n.name, n.id); }
  }
  const ofType = (t, name, f) => { const l = byType.get(t)?.get(name) || (aliasOf.has(t) ? byType.get(aliasOf.get(t))?.get(name) : null); return l ? l.filter(c => !fnLocalSet.has(nodes[c].parent) || nodes[c].file === f) : null; };
  const clsRank = new Map();
  const classes = (name, f) => {
    const all = aliasOf.has(name) && classByName.get(aliasOf.get(name)) || classByName.get(name) || [];
    if (all.length <= 4) return all.filter(c => !fnLocalSet.has(c) || nodes[c].file === f);
    let ranked = clsRank.get(name);
    if (!ranked) clsRank.set(name, (ranked = all.filter(c => !fnLocalSet.has(c)).sort((a, b) => (basesOf.has(b) - basesOf.has(a)) || ((byClass.get(b)?.size || 0) - (byClass.get(a)?.size || 0)))));
    const out = all.filter(c => nodes[c].file === f);
    for (const c of ranked) { if (out.length >= 4) break; if (!out.includes(c)) out.push(c); }
    return out.slice(0, 4);
  };
  const derivedOf = new Map();
  for (const [c, bs] of basesOf) for (const b of bs) { const l = derivedOf.get(b); if (l) l.push(c); else derivedOf.set(b, [c]); }
  const inSubclasses = (t, name) => {
    const out = new Set(), seen = new Set([t]);
    let level = [t];
    for (let d = 0; d < 4 && level.length && seen.size < 40; d++) {
      const next = [];
      for (const b of level) for (const c of derivedOf.get(b) || []) {
        const cn = nodes[c].name;
        if (seen.has(cn)) continue;
        seen.add(cn);
        next.push(cn);
        for (const h of byClass.get(c)?.get(name) || []) out.add(h);
        for (const h of byOwner.get(cn)?.get(name) || []) out.add(h);
      }
      level = next;
    }
    return [...out];
  };
  const notField = c => !(nodes[c].kind === 'variable' && nodes[c].parent >= 0 && isClassy(nodes[nodes[c].parent].kind));
  const memberIn = (cls, name) => {
    const seen = new Set([cls]);
    let level = [cls];
    for (let depth = 0; depth < 6 && level.length; depth++) {
      const hit = [];
      for (const c of level) {
        const l = byClass.get(c)?.get(name);
        if (l) hit.push(...l);
        const o = byOwner.get(nodes[c].name)?.get(name);
        if (o) for (const x of o) if (!hit.includes(x) && (!fnLocalSet.has(c) || nodes[x].file === nodes[c].file)) hit.push(x);
      }
      if (hit.length) return hit;
      const next = [];
      for (const k of level) for (const b of basesOf.get(k) || []) for (const c2 of classes(b, nodes[cls].file)) if (!seen.has(c2)) { seen.add(c2); next.push(c2); }
      level = next;
    }
    return null;
  };

  const gvt = new Map();
  for (const info of infos) if (info.types && GLOBAL_VARS.has(info.L.group)) for (const [k, v] of info.types) {
    if (v[0] === '#') continue;
    const key = info.L.group + ':' + k;
    gvt.set(key, gvt.has(key) && gvt.get(key) !== v ? null : v);
  }
  done = 0;
  const testFile = new Map();
  let fileIdx = null;
  const inFile = (f, name) => {
    if (!fileIdx) { fileIdx = new Map(); for (const n of nodes) if (n.kind !== 'file' && n.kind !== 'dir' && n.file >= 0) { let m = fileIdx.get(n.file); if (!m) fileIdx.set(n.file, (m = new Map())); const l = m.get(n.name); if (l) l.push(n.id); else m.set(n.name, [n.id]); } }
    return fileIdx.get(f)?.get(name);
  };
  const linkFile = info => {
    const { L, masked, starts, owner, defPos, local, id: fid } = info;
    const g = names.get(L.group);
    const fdir = nodes[fid].parent;
    const nf = L.group === 'c' || L.group === 'py' ? notField : () => true, srcTest = TEST_PATH.test(nodes[fid].path), srcEx = EX_PATH.test(nodes[fid].path), exRoot = srcEx ? EX_ROOT.exec(nodes[fid].path)?.[0] : null;
    const out = new Map(), impCache = new Map(), strictBare = !LOOSE_BARE.has(L.group) && !/\.(?:kts?|scala|sc|groovy|gradle)$/.test(nodes[fid].path);
    const multi = a => { const p = nodes[a[0]].parent; for (const c of a) if (nodes[c].parent !== p) return true; return false; };
    const bareOk = (c, src) => { const p = nodes[c].parent; if (p < 0 || !isClassy(nodes[p].kind) || isClassy(nodes[c].kind) || nodes[c].name === nodes[p].name) return true; for (let o = src; o >= 0; o = nodes[o].parent) if (o === p) return true; return false; };
    const idc = new Map();
    const countWords = !TEST_PATH.test(info.f.path);
    if (countWords) info.idc = idc;
    const elemOf = it => {
      if (it && it.startsWith('()')) { const c = it.slice(it[2] === '.' ? 3 : 2); it = typeNames.has(c) ? null : retOf.get(c) || null; }
      const k = it ? it.indexOf('[]') : -1;
      return k >= 0 && it.length > k + 2 ? it.slice(k + 2) : null;
    };
    const varType = (v, src, ln, depth, raw) => {
      let t = null;
      if (info.scopes && info.scopeNames.has(v)) {
        let best = null;
        for (const sc of info.scopes) if (sc.types && sc.a <= ln && ln <= sc.b && !(sc.a === ln && curAt < sc.at) && sc.types.has(v) && (!best || sc.a >= best.a)) best = sc;
        if (best) t = best.types.get(v);
        if (t && t[0] === '%') { const k = t.indexOf(':'); t = depth < 3 ? closureArg(+t.slice(1, k), +t.slice(k + 1), src) : null; }
      }
      if (!t) for (let o = src; o !== fid && o >= 0; o = nodes[o].parent) {
        const tm = typesOf.get(o), ty = tm && tm.get(v);
        if (ty) { t = ty; break; }
        if (selfOf.get(o) === v) break;
        const ft = fieldTypes.get(o), fy = ft && ft.get(v);
        if (fy) { t = fy; break; }
      }
      if (!t) {
        let ow = null;
        for (let o = src; o !== fid && o >= 0 && !ow; o = nodes[o].parent) ow = ownerOf.get(o);
        if (ow) for (const c of classes(ow, fid)) { const fy = fieldTypes.get(c)?.get(v); if (fy) { t = fy; break; } }
      }
      if (!t) {
        let cls = src;
        while (cls !== fid && cls >= 0 && !isClassy(nodes[cls].kind)) cls = nodes[cls].parent;
        if (cls !== fid && cls >= 0 && basesOf.has(cls)) {
          const seen = new Set([cls]);
          let level = [cls];
          for (let d = 0; d < 6 && level.length && !t; d++) {
            const next = [];
            for (const k of level) for (const b of basesOf.get(k) || []) for (const c2 of classes(b, nodes[k].file)) if (!seen.has(c2)) {
              seen.add(c2);
              const fy = fieldTypes.get(c2)?.get(v);
              if (fy) { t = fy; break; }
              next.push(c2);
            }
            level = next;
          }
        }
      }
      if (!t && !(info.scopes && info.scopeNames.has(v))) {
        const ft = info.types && info.types.get(v), gt = ft ? null : gvt.get(L.group + ':' + v);
        if (ft || gt) {
          let shadowed = false;
          for (let o = src; o !== fid && o >= 0 && !shadowed; o = nodes[o].parent) shadowed = !!(localsOf.get(o)?.has(v) || typesOf.get(o)?.has(v));
          if (!shadowed && (ft || !local.has(v))) t = ft || gt;
        }
      }
      if (!t && L.group === 'py' && fixtures.has(v)) for (let o = src; o !== fid && o >= 0; o = nodes[o].parent) if (localsOf.get(o)?.has(v)) { t = '()' + v; break; }
      if (t && t[0] === '#') { if (hashDepth < 3) { hashDepth++; try { t = exprType(+t.slice(1), 0, src); } finally { hashDepth--; } } else t = null; }
      if (t && t[0] === '@') t = depth < 3 && t.slice(1) !== v ? elemOf(varType(t.slice(1), src, ln, depth + 1, true)) : null;
      if (!raw) t = headOf(t);
      return t;
    };
    let cDepth = 0, curAt = Infinity, hashDepth = 0;
    const closureArg = (j, i, src) => {
      if (cDepth > 2) return null;
      cDepth++;
      try { return closureArgIn(j, i, src); } finally { cDepth--; }
    };
    const closureArgIn = (j, i, src) => {
      let e, name;
      if (masked.charCodeAt(j - 1) === 41) {
        let d = 0, q = j - 1;
        for (const lim = Math.max(0, j - 2000); q >= lim; q--) { const ch = masked.charCodeAt(q); if (ch === 41) d++; else if (ch === 40 && --d === 0) break; }
        if (d) return null;
        e = q;
        while (e > 0 && isW(masked.charCodeAt(e - 1))) e--;
        name = masked.slice(e, q);
      } else {
        e = j;
        while (e > 0 && isW(masked.charCodeAt(e - 1))) e--;
        name = masked.slice(e, j);
      }
      if (!name) return null;
      const T = recvTypeAt(e, 1, src);
      let c;
      if (T === undefined) c = g.get(name) || local.get(name) || [];
      else if (!T) return null;
      else { const set = new Set(ofType(headOf(T), name, fid) || []); for (const k of classes(headOf(T), fid)) for (const h of memberIn(k, name) || []) set.add(h); c = [...set]; }
      const cnt = new Map();
      let out = null, n = 0;
      for (const h of c) { const r = closureOf.get(h)?.[i]; if (!r) continue; n++; cnt.set(r, (cnt.get(r) || 0) + 1); if (!out || cnt.get(r) > cnt.get(out)) out = r; }
      return out && cnt.get(out) >= n * 0.75 ? out : null;
    };
    const callT = c => typeNames.has(c) ? c : headOf(retOf.get(c)) || null;
    const retIn = (T, name) => {
      T = headOf(T);
      if (!T || T === '[]') return null;
      const c = new Set(ofType(T, name, fid) || []);
      for (const k of classes(T, fid)) for (const h of memberIn(k, name) || []) c.add(h);
      const cnt = new Map();
      let out = null, n = 0;
      for (const h of c) {
        let r = retNode.get(h);
        if (!r) continue;
        const p = nodes[h].parent;
        if (p >= 0 && isClassy(nodes[p].kind) && !r.includes('.')) { const pq = qn(p); if (r === nodes[p].name) r = pq; else if (classByName.has(pq + '.' + r)) r = pq + '.' + r; }
        n++; cnt.set(r, (cnt.get(r) || 0) + 1); if (!out || cnt.get(r) > cnt.get(out)) out = r;
      }
      if (out && cnt.get(out) < n * 0.75) out = null;
      if (!out && name === 'new' && typeNames.has(T)) return T;
      return out ? headOf(out) : null;
    };
    const fieldIn = (T, w) => { for (const k of classes(headOf(T), fid)) { const f = fieldTypes.get(k)?.get(w); if (f) return f.startsWith('()') ? callT(f.slice(f[2] === '.' ? 3 : 2)) : headOf(f); } return null; };
    const recvTypeAt = (e, depth, src) => {
      const p = masked.charCodeAt(e - 1), p2 = masked.charCodeAt(e - 2);
      if (p === 46 && p2 !== 46) return exprType(e - 1, depth + 1, src);
      if ((p === 58 && p2 === 58) || (p === 62 && p2 === 45)) return exprType(e - 2, depth + 1, src);
      return undefined;
    };
    const exprType = (j, depth, src) => {
      if (info.raw) { const q = info.raw.charCodeAt(j - 1); if ((q === 34 || q === 39 || q === 96) && masked.charCodeAt(j - 1) <= 32) return STR_TYPE[L.group]; }
      while (j > 0 && masked.charCodeAt(j - 1) <= 32) j--;
      if (depth > 8 || j <= 0) return null;
      let c = masked.charCodeAt(j - 1);
      if (c === 63 || c === 33) c = masked.charCodeAt(--j - 1);
      if (c === 41) {
        let d = 0, q = j - 1;
        for (const lim = Math.max(0, j - 2000); q >= lim; q--) {
          const ch = masked.charCodeAt(q);
          if (ch === 41) d++;
          else if (ch === 40 && --d === 0) break;
        }
        if (d) return null;
        let targ = null, ne = q;
        if (masked.charCodeAt(q - 1) === 62) {
          const lt = masked.lastIndexOf('<', q - 1);
          if (lt > 0 && q - lt < 80) { targ = tyOf(masked.slice(lt + 1, q - 1)); ne = lt; }
        }
        let e = ne;
        while (e > 0 && isW(masked.charCodeAt(e - 1))) e--;
        if (e === ne) return null;
        const name = masked.slice(e, ne), T = recvTypeAt(e, depth, src);
        const r = T === undefined ? callT(name) : T ? retIn(T, name) || (classByName.has(headOf(T) + '.' + name) ? headOf(T) + '.' + name : typeNames.has(name) && /^[A-Z]/.test(name) ? name : null) : null;
        return r || (targ && !targ.includes('[]') && typeNames.has(targ) ? targ : null);
      }
      if (!isW(c)) return null;
      let e = j;
      while (e > 0 && isW(masked.charCodeAt(e - 1))) e--;
      const w = masked.slice(e, j), T = recvTypeAt(e, depth, src);
      if (T === undefined) {
        if (SELF.has(w)) { for (let o = src; o !== fid && o >= 0; o = nodes[o].parent) { if (isClassy(nodes[o].kind)) return nodes[o].name; if (ownerOf.has(o)) return ownerOf.get(o); } return null; }
        const v = varType(w, src, ln, 0);
        if (v) return v.startsWith('()') ? callT(v.slice(v[2] === '.' ? 3 : 2)) : v;
        return typeNames.has(w) ? w : null;
      }
      return T ? fieldIn(T, w) || (/^(?:shared|default|instance|current|main|standard|sharedInstance|INSTANCE)$/.test(w) && typeNames.has(T) ? T : null) : null;
    };
    let kAt = -1, kQ = -1;
    const keyTargets = (at, name) => {
      let d = 0, q = -1;
      if (kAt >= 0 && kAt < at && at - kAt < 3000) {
        for (let i = kAt; i < at && d >= 0; i++) {
          const c = masked.charCodeAt(i);
          if (c === 40 || c === 91 || c === 123) d++;
          else if (c === 41 || c === 93 || c === 125) d--;
        }
        if (d === 0) q = kQ;
        d = 0;
      }
      if (q < 0) {
        q = at - 1;
        for (const lim = Math.max(0, at - 3000); ; q--) {
          if (q < lim) { kAt = -1; return null; }
          const c = masked.charCodeAt(q);
          if (c === 41 || c === 93 || c === 125) d++;
          else if (c === 40 || c === 91 || c === 123) { if (!d) break; d--; }
        }
      }
      kAt = at; kQ = q;
      if (masked.charCodeAt(q) !== 40) return null;
      let b = q;
      while (b > 0 && (isW(masked.charCodeAt(b - 1)) || masked.charCodeAt(b - 1) === 46)) b--;
      const segs = masked.slice(b, q).split('.').filter(Boolean), hit = new Set();
      for (const T of new Set([segs[segs.length - 1], segs[0]])) if (T && classByName.has(T)) {
        for (const c of classes(T, fid)) for (const h of memberIn(c, name) || []) hit.add(h);
        if (hit.size) break;
      }
      return hit.size ? [...hit] : null;
    };
    let ln = 0, declEnd = -1;
    for (const m of masked.matchAll(L.id)) {
      curAt = m.index;
      const name = m[0];
      if (name.length < 2) continue;
      if (countWords && !L.kw.has(name)) idc.set(name, (idc.get(name) || 0) + 1);
      let look = name;
      if (info.alias && name.charCodeAt(0) < 91) { const d = name.indexOf('.'), h = info.alias.get(d < 0 ? name : name.slice(0, d)); if (h) look = d < 0 ? h : h + name.slice(d); }
      if (L.group === 'ml' && name.charCodeAt(0) < 91 && masked.charCodeAt(m.index + name.length) === 46) {
        const f = mlNear(name, fid);
        if (f != null && f !== fid) {
          while (ln + 1 < starts.length && starts[ln + 1] <= m.index) ln++;
          const k = owner[ln] * 4194304 + f;
          if (!out.has(k)) out.set(k, 'dep');
        }
        if (f != null) continue;
      }
      if (L.group === 'ml' && name.charCodeAt(0) < 91 && masked.charCodeAt(m.index + name.length) !== 46 && masked.charCodeAt(m.index - 1) !== 46) continue;
      const cands = g.get(look) || local.get(look);
      if (!cands) continue;
      if (info.ext && info.ext.has(name) && !local.has(name)) continue;
      const at = m.index;
      if (defPos.has(at)) continue;
      const prev = at > 0 ? masked.charCodeAt(at - 1) : 0;
      if (L.sigil && prev === 36) continue;
      while (ln + 1 < starts.length && starts[ln + 1] <= at) ln++;
      const src = owner[ln];
      let member = false, recv = '', recvCall = '', recvIdx = '', chainT = null, keyHit = null;
      if (prev === 64 && L.group === 'rb') {
        let cls = src;
        while (cls !== fid && cls >= 0 && !isClassy(nodes[cls].kind)) cls = nodes[cls].parent;
        keyHit = cls !== fid && cls >= 0 ? memberIn(cls, name) : null;
        if (!keyHit) continue;
      }
      const p2 = at > 1 ? masked.charCodeAt(at - 2) : 0;
      if ((prev === 46 && p2 !== 46) || (prev === 62 && p2 === 45) || (prev === 58 && p2 === 58)) {
        member = true;
        let j = at - (prev === 46 ? 1 : 2);
        const q = masked.charCodeAt(j - 1);
        if (q === 63 || q === 33) j--;
        else if (q === 62 && (prev === 58 || prev === 46)) {
          let d = 0, r = j - 1;
          for (const lim = Math.max(0, j - 200); r >= lim; r--) { const c = masked.charCodeAt(r); if (c === 62) d++; else if (c === 60 && --d === 0) break; else if (c === 59 || c === 123 || c === 125) { r = -1; break; } }
          if (r > 0 && d === 0) {
            let r2 = r;
            if (masked.charCodeAt(r2 - 1) === 58 && masked.charCodeAt(r2 - 2) === 58) r2 -= 2;
            let w = r2;
            while (w > 0 && isW(masked.charCodeAt(w - 1))) w--;
            if (prev === 58 || (w < r2 && masked.charCodeAt(w) >= 65 && masked.charCodeAt(w) <= 90)) j = r2;
          }
        }
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
        } else if (!recv && masked.charCodeAt(j - 1) === 93) {
          let d = 0, q2 = j - 1;
          for (const lim = Math.max(0, j - 200); q2 >= lim; q2--) {
            const c = masked.charCodeAt(q2);
            if (c === 93) d++;
            else if (c === 91 && --d === 0) break;
          }
          let e2 = q2;
          while (e2 > 0 && isW(masked.charCodeAt(e2 - 1))) e2--;
          if (d === 0 && e2 < q2) recvIdx = masked.slice(e2, q2);
        }
        if (!recv && !recvIdx) chainT = exprType(j, 0, src);
        else if (recv && !SELF.has(recv)) {
          const b1 = masked.charCodeAt(k - 1), b2 = masked.charCodeAt(k - 2);
          if ((b1 === 46 && b2 !== 46) || (b1 === 62 && b2 === 45) || (b1 === 58 && b2 === 58)) chainT = exprType(j, 0, src);
        }
      } else if (prev === 46 && p2 === 46 && L.group === 'dart' && masked.charCodeAt(at - 3) !== 46) {
        member = true;
        let j = at - 2;
        while (j > 0 && masked.charCodeAt(j - 1) <= 32) j--;
        let k = j;
        while (k > 0 && isW(masked.charCodeAt(k - 1))) k--;
        if (k < j && masked.charCodeAt(k - 1) !== 46 && masked.charCodeAt(k - 1) !== 41) recv = masked.slice(k, j);
        else chainT = exprType(j, 0, src);
      }
      if (!member && (KEY_COLON.has(L.group) || KEY_EQ[L.group])) {
        const nx = masked.slice(at + name.length, at + name.length + 3), ps = masked.slice(Math.max(starts[ln], at - 60), at), whole = at - starts[ln] <= 60;
        if (KEY_COLON.has(L.group) ? (L.group === 'js' ? /^\??:(?!:)/ : /^:(?!:)/).test(nx) && (/[,({][ \t]*$/.test(ps) || (whole && /^[ \t]*(?:(?:readonly|public|private|protected|static|declare|override)[ \t]+)*$/.test(ps)))
          : /^[ \t]*=(?![=>])/.test(nx) && KEY_EQ[L.group].test(whole ? ps : ps.replace(/^[^(,{]*$/, 'x')) && (!whole || !/^[ \t]*$/.test(ps) || /[(,][ \t\r\n]*$/.test(masked.slice(Math.max(0, starts[ln] - 200), starts[ln])))) {
          keyHit = keyTargets(at, name);
          if (!keyHit) continue;
        }
      }
      if (L.bareVars && !member && name.charCodeAt(0) >= 95) {
        const nx = masked.slice(at + name.length, at + name.length + 12);
        const call = /^[ \t]*[(/]/.test(nx) || (/^[ \t]+[\w:@\[{%&~]/.test(nx) && !/^[ \t]+(?:when|do|in|and|or|not|else|end|after|catch|rescue)\b/.test(nx));
        if (!call && !/(?:\|>|&)[ \t]*$/.test(masked.slice(Math.max(0, at - 4), at))) continue;
      }
      if (DECLS.has(L.group) && !member) {
        if (L.group === 'c' && /\([ \t]*\*[ \t]*$/.test(masked.slice(Math.max(0, at - 6), at)) && /^[ \t]*\)[ \t]*\(/.test(masked.slice(at + name.length, at + name.length + 6))) continue;
        if (L.group === 'c' && /(?:goto[ \t]+|^[ \t]*#[ \t]*)$/.test(masked.slice(Math.max(starts[ln], at - 8), at)) || (/^[ \t]*$/.test(masked.slice(starts[ln], at)) && /^[ \t]*:(?!:)/.test(masked.slice(at + name.length, at + name.length + 4)))) continue;
        if (at < declEnd) {
          if (/^[ \t]*[,)=[]/.test(masked.slice(at + name.length, at + name.length + 8)) && /(?:\w[ \t]+|[*&][ \t]*)$/.test(masked.slice(Math.max(0, at - 40), at))) continue;
        } else if (src === fid || isClassy(nodes[src].kind) || nodes[src].kind === 'module') {
          let q = at + name.length;
          while (masked.charCodeAt(q) === 32 || masked.charCodeAt(q) === 9) q++;
          if (masked.charCodeAt(q) === 40 && /(?:[\w>][ \t]+|[*&][ \t]*)$/.test(masked.slice(Math.max(0, at - 40), at))) {
            const e = afterParams(masked, q);
            if (e > 0 && /^\s*(?:(?:const|override|final|noexcept|volatile|&&?)\s*)*(?:=\s*(?:0|default|delete)\s*)?(?:throws\s+[\w.,\s]+)?;/.test(masked.slice(e, e + 80))) { declEnd = e; if (L.group !== 'c') continue; }
          }
        }
      }
      if (!member) {
        let shadow = false;
        if (info.scopes && info.scopeNames.has(name)) for (const sc of info.scopes) if (sc.a <= ln && ln <= sc.b && !(sc.a === ln && at < sc.at) && sc.names.has(name)) { shadow = true; break; }
        for (let o = src; o !== fid && o >= 0; o = nodes[o].parent) {
          const ls = localsOf.get(o);
          if (ls && ls.has(name)) { shadow = true; break; }
        }
        if (shadow) continue;
      }
      if (member && !keyHit && (recv === 'super' || recvCall === 'super' || (recv === 'base' && L.group === 'cs'))) {
        let cls = src;
        while (cls !== fid && cls >= 0 && !isClassy(nodes[cls].kind)) cls = nodes[cls].parent;
        const hit = new Set();
        if (cls !== fid && cls >= 0) for (const b of basesOf.get(cls) || []) for (const c of classes(b, fid)) for (const h of memberIn(c, name) || []) hit.add(h);
        if (!hit.size) continue;
        keyHit = [...hit];
      }
      if (member && recv && !keyHit && info.modBind) {
        const mf = info.modBind.get(recv);
        if (mf !== undefined) {
          const hit = inFile(mf, name);
          if (hit) keyHit = hit;
          else if (L.group === 'lua') continue;
        }
      }
      if (L.group === 'ml' && ((member && !(recv && recv.charCodeAt(0) < 91)) || prev === 126 || prev === 63)) continue;
      if (member && recv && !keyHit && L.group === 'ml' && recv.charCodeAt(0) < 91) {
        const f = mlNear(recv, fid), hit = new Set(f != null ? inFile(f, name) || [] : []);
        for (const c of classes(recv, fid)) for (const h of memberIn(c, name) || []) hit.add(h);
        if (hit.size) keyHit = [...hit];
        else continue;
      }
      if (member && recv && !keyHit && L.group === 'lua' && (recv === 'self' || local.get(recv)?.some(c => nodes[c].file === fid && nodes[c].parent === fid))) {
        const hit = local.get(name)?.filter(c => nodes[c].file === fid);
        if (!hit?.length) continue;
        keyHit = hit;
      }
      let targets = null;
      let type = 'dep';
      if (keyHit) targets = keyHit;
      else if (info.inits && info.inits.has(at)) {
        const ty = info.inits.get(at), hit = new Set();
        for (const c of classes(ty, fid)) for (const h of memberIn(c, name) || []) hit.add(h);
        if (!hit.size) continue;
        targets = [...hit];
      }
      if (member && recv && info.ext && info.ext.has(recv) && !local.has(recv)) continue;
      if (member && recv === 'class' && L.group === 'jvm') continue;
      if (member && recv === 'std' && L.group === 'c') continue;
      if (member && L.group === 'swift' && !recv && !recvIdx && !recvCall && !chainT && prev === 46) {
        let j = at - 1;
        while (j > 0 && masked.charCodeAt(j - 1) <= 32) j--;
        const b = masked.charCodeAt(j - 1);
        if (!isW(b) && b !== 41 && b !== 93 && b !== 63 && b !== 33 && b !== 62) {
          const hit = cands.filter(staticish);
          if (!hit.length) continue;
          targets = hit;
          if (multi(hit)) type = 'ref';
        }
      }
      if (!targets && member && (recv || recvIdx || chainT)) {
        let selfT = chainT || (recvIdx ? headOf(elemOf(varType(recvIdx, src, ln, 0, true))) : SELF.has(recv) ? null : varType(recv, src, ln, 0));
        if (!selfT) for (let o = src; o !== fid && o >= 0; o = nodes[o].parent) {
          if (SELF.has(recv)) { if (isClassy(nodes[o].kind)) break; if (ownerOf.has(o)) { selfT = ownerOf.get(o); break; } continue; }
          const sv = selfOf.get(o);
          if (sv) { if (sv === recv) selfT = ownerOf.get(o); break; }
        }
        if (selfT && selfT.startsWith('()')) {
          const q = selfT[2] === '.', call = selfT.slice(q ? 3 : 2);
          if (!typeNames.has(call) && !retOf.has(call) && !g.has(call) && !local.has(call) || !q && info.ext && info.ext.has(call) && !local.has(call)) continue;
          if (q && info.ext && recv && info.callHead) { const h = info.callHead.get(recv); if (h && info.ext.has(h) && !local.has(h)) continue; }
          let viaRecv = null;
          const cr = q && info.callRecv ? info.callRecv.get(recv) : null;
          if (cr && cr !== recv) { let T = null; if (SELF.has(cr)) { for (let o = src; o !== fid && o >= 0 && !T; o = nodes[o].parent) T = isClassy(nodes[o].kind) ? nodes[o].name : ownerOf.get(o) || null; } else { T = varType(cr, src, ln, 1); if (T && T.startsWith('()')) T = callT(T.slice(T[2] === '.' ? 3 : 2)); } if (T) viaRecv = retIn(T, call); }
          selfT = viaRecv || (typeNames.has(call) ? call : headOf(retOf.get(call)) || null);
        }
        if (selfT) {
          const own = ofType(selfT, name, fid) || [];
          if (own.length) targets = own;
          else if (!typeNames.has(selfT)) continue;
          else if (classByName.has(selfT)) {
            const hit = new Set();
            for (const c of classes(selfT, fid)) for (const h of memberIn(c, name) || []) hit.add(h);
            if (hit.size) targets = [...hit];
            else {
              const sub = inSubclasses(selfT, name);
              if (sub.length) { targets = sub; if (sub.length > 1) type = 'ref'; }
            }
          }
          if (!targets && COMMON.has(name)) continue;
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
      } else if (!targets && member && recvCall) {
        if (!typeNames.has(recvCall) && !retOf.has(recvCall) && !g.has(recvCall) && !local.has(recvCall)) continue;
        const rt = typeNames.has(recvCall) ? recvCall : headOf(retOf.get(recvCall));
        if (rt) {
          const own = ofType(rt, name, fid) || [];
          if (own.length) targets = own;
          else if (!typeNames.has(rt) || COMMON.has(name)) continue;
        } else if (COMMON.has(name)) continue;
      } else if (!targets && member && COMMON.has(name)) continue;
      if (!targets && !member && IMPLICIT_THIS.has(L.group)) {
        let cls = src;
        while (cls !== fid && cls >= 0 && !isClassy(nodes[cls].kind)) cls = nodes[cls].parent;
        if (cls !== fid && cls >= 0) {
          const hit = memberIn(cls, name);
          if (hit) targets = hit;
        } else {
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
          const ck = member ? '.' + name : name;
          targets = impCache.get(ck);
          if (!targets) impCache.set(ck, (targets = cands.filter(c => info.imported.has(nodes[c].file) && (!member || nf(c)))));
          if (strictBare && !member && targets.length) targets = targets.filter(c => bareOk(c, src));
          const viaImport = targets.length > 0;
          if (!targets.length && L.pkgDir) {
            const pk = info.pkg, uses = info.uses;
            const nsOk = ns => ns != null && (ns === pk || (uses != null && uses.has(ns)) || (L.group === 'cs' && pk != null && pk.startsWith(ns + '.')));
            targets = pk != null || uses
              ? cands.filter(c => nsOk(pkgOf.get(nodes[c].file)) && (member ? nf(c) : nodes[c].parent === nodes[c].file))
              : cands.filter(c => nodes[nodes[c].file].parent === fdir && (!member || nf(c)));
            if (!srcTest && targets.length) targets = targets.filter(c => !TEST_PATH.test(nodes[c].path));
          }
          if (!targets.length) {
            if (cands.length > MAXC) continue;
            targets = L.group === 'c' ? cands.filter(c => isFn(nodes[c].kind) && !privC.has(c) && (!member || prev === 58 || nodes[c].kind === 'method'))
              : !info.module || (L.pkgDir && info.pkg != null) ? cands
              : member ? preferImported(cands.filter(c => (memberish.has(c) || (nodes[c].parent >= 0 && isClassy(nodes[nodes[c].parent].kind))) && nf(c)), info)
              : masked.charCodeAt(at + name.length) === 33 ? cands : cands.filter(c => AMBIENT.test(nodes[c].path));
            if (!srcTest) targets = targets.filter(c => !TEST_PATH.test(nodes[c].path));
            if (!GEN_FILE.test(nodes[fid].path)) targets = targets.filter(c => !GEN_FILE.test(nodes[c].path));
            if (strictBare && !member) targets = targets.filter(c => bareOk(c, src));
            if (!srcEx) targets = targets.filter(c => !EX_PATH.test(nodes[c].path));
            else if (exRoot) targets = targets.filter(c => { const r = EX_ROOT.exec(nodes[c].path); return !r || r[0] === exRoot; });
            if (!targets.length) continue;
            const t0 = targets.length === 1 && !member ? nodes[targets[0]].path : null, ad = t0 && AMBIENT.test(t0) ? t0.slice(0, t0.lastIndexOf('/') + 1) : null;
            if (!(ad != null && nodes[fid].path.startsWith(ad)) && (multi(L.group === 'c' || (strictBare && !member) ? targets : cands) || L.explicit || member)) type = 'ref';
          } else if (member && targets.length > 1) {
            const top = viaImport ? targets.filter(c => nodes[c].parent === nodes[c].file) : [];
            if (top.length) targets = top; else if (multi(targets)) type = 'ref';
          }
        } else if (member && targets.length > 1) {
          targets = targets.filter(nf);
          if (!targets.length) continue;
          if (multi(targets)) type = 'ref';
        }
      }
      if (L.group === 'rs') {
        const bang = masked.charCodeAt(at + name.length) === 33 && masked.charCodeAt(at + name.length + 1) !== 61;
        targets = targets.filter(c => bang === macros.has(c));
        if (!targets.length) continue;
      }
      if (PATHSEG.has(L.group) && masked.charCodeAt(at + name.length) === 58 && masked.charCodeAt(at + name.length + 1) === 58) {
        targets = targets.filter(c => !isFn(nodes[c].kind));
        if (!targets.length) continue;
      }
      if (targets.length > MAXC) continue;
      for (const t of targets) {
        if (t === src || nodes[t].parent === src || nodes[src].parent === t) continue;
        if (!srcTest) { const tf = nodes[t].file; let tt = testFile.get(tf); if (tt === undefined) testFile.set(tf, (tt = TEST_PATH.test(nodes[tf].path))); if (tt) continue; }
        const k = src * 4194304 + t;
        const prev = out.get(k);
        if (prev === undefined || (prev === 'ref' && type === 'dep')) out.set(k, type);
      }
    }
    for (const [k, type] of out) edges.push({ s: Math.floor(k / 4194304), t: k % 4194304, type });
  };
  for (const info of infos) {
    if (++done % 50 === 0) progress({ phase: 'Linking', done, total: infos.length });
    if (!info.owner || /\.gradle(?:\.kts)?$/.test(info.f.path)) continue;
    linkFile(info);
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
