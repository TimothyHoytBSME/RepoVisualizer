import { analyze, EDGE_NAMES } from '../src/analyze.js';

let failed = 0;
const syms = g => g.nodes.filter(n => !['dir','file','lib'].includes(n.kind)).map(n => `${n.kind}:${n.name}@${n.line}-${n.end}`);
const deps = g => {
  const { s, t, type } = g.edges, out = [];
  for (let k = 0; k < s.length; k++) if (EDGE_NAMES[type[k]] !== 'contain') out.push(`${g.nodes[s[k]].name}-${EDGE_NAMES[type[k]]}->${g.nodes[t[k]].name}`);
  return out;
};
const T = (name, files, check) => { const t = performance.now(); const g = analyze(files, 'r'); const ms = performance.now() - t; let ok; try { ok = check(g); } catch (e) { ok = 'ERR ' + e.message; } if (ok !== true) failed++;
  console.log(ok === true ? 'PASS' : 'FAIL', name, ms > 500 ? `(${ms.toFixed(0)}ms!)` : '', ok === true ? '' : JSON.stringify({ syms: syms(g), deps: deps(g) }).slice(0, 600)); };
const args = Array.from({ length: 18 }, (_, i) => `      a${i}: foo(${i}),`).join('\n');
T('dart ternary perf', [{ path: 'a.dart', text: `class W {\n  Widget build(BuildContext c) {\n    return loading ? const Center(child: X()) : Scaffold(\n${args}\n    );\n  }\n}\n` }], g => syms(g).includes('method:build@1-5') || syms(g).some(s => s.startsWith('function:build') || s.startsWith('method:build')));
const arms = Array.from({ length: 9 }, (_, i) => `        : isB${i}(x) ? foo(${i})`).join('\n');
T('c ternary perf', [{ path: 'a.c', text: `int f(int x) {\n  return isA(x) ? foo(1)\n${arms}\n        : 0;\n}\n` }], g => syms(g).some(s => s.startsWith('function:f@0')));
T('js regex literal', [{ path: 'a.js', text: "function first(p) { return p.replace(/\\/*$/, '') }\nfunction second() {}\nconst re = /`/g\nfunction third() {}\n" }], g => ['first','second','third'].every(n => syms(g).some(s => s.includes(':' + n + '@'))));
T('go raw backslash', [{ path: 'a.go', text: "package a\nfunc sep() string {\n\treturn `\\`\n}\nfunc other() {}\nfunc third() {}\n" }], g => syms(g).includes('function:other@4-4') && syms(g).includes('function:third@5-5'));
T('py stdlib not local', [{ path: 'src/pkg/__init__.py', text: 'import typing\n' }, { path: 'src/pkg/typing.py', text: 'X = 1\n' }, { path: 'src/pkg/app.py', text: 'import typing\nimport json\nfrom pkg import typing as t2\n' }], g => { const d = deps(g); return d.includes('app.py-dep->typing') && !d.includes('__init__.py-dep->typing.py') && d.filter(x => x.startsWith('app.py-dep->typing.py')).length === 1; });
T('js require root index', [{ path: 'index.js', text: 'module.exports = 1\n' }, { path: 'test/a.js', text: "var e = require('../')\n" }], g => deps(g).includes('a.js-dep->index.js'));
T('gnu style C', [{ path: 'a.c', text: 'static int\nfoo (int a)\n{\n  return a;\n}\n\nint bar(void) {\n  return foo(1);\n}\n' }], g => syms(g).some(s => s.startsWith('function:foo')) && deps(g).includes('bar-dep->foo'));
T('c ifdef in body', [{ path: 'a.c', text: 'void helper(void) {}\nvoid foo(void) {\n  int x = 1;\n#ifdef DEBUG\n  x = 2;\n#endif\n  helper();\n}\n' }], g => syms(g).includes('function:foo@1-7') && deps(g).includes('foo-dep->helper'));
T('go label', [{ path: 'a.go', text: 'package a\nfunc gg() {}\nfunc f() {\n\tx := 1\nwalk:\n\tfor {\n\t\tgg()\n\t\tbreak walk\n\t}\n}\n' }], g => syms(g).includes('function:f@2-9') && deps(g).includes('f-dep->gg'));
T('go.mod resolution', [{ path: 'go.mod', text: 'module github.com/x/y\n' }, { path: 'a.go', text: 'package y\nfunc A() {}\n' }, { path: 'sub/b.go', text: 'package sub\nimport (\n\t"github.com/x/y"\n\t"log"\n)\nfunc B() { y.A() }\n' }, { path: 'log/l.go', text: 'package log\n' }], g => { const d = deps(g); return d.includes('b.go-dep->a.go') && d.includes('b.go-dep->log') && !d.includes('b.go-dep->l.go'); });
T('kotlin top-level fn import', [{ path: 'src/com/acme/util/Dates.kt', text: 'package com.acme.util\nfun formatDate(x: Int): String { return "" }\n' }, { path: 'src/com/acme/Main.kt', text: 'package com.acme\nimport com.acme.util.formatDate\nfun main() { formatDate(1) }\n' }], g => deps(g).includes('Main.kt-dep->Dates.kt') && !g.nodes.some(n => n.kind === 'lib' && n.name === 'com.acme'));
T('rust multiline str', [{ path: 'src/main.rs', text: 'const HELP: &str = "Usage:\n  fn mode runs the fn handler\n  struct output\n";\nfn main() {}\n' }], g => !syms(g).some(s => /mode|handler|output/.test(s)) && syms(g).some(s => s.startsWith('function:main')));
T('rust crate paths', [{ path: 'src/main.rs', text: 'mod a;\nuse crate::a::b;\nuse serde::Deserialize;\nfn main() {}\n' }, { path: 'src/a.rs', text: 'pub mod b;\n' }, { path: 'src/a/b.rs', text: 'pub fn x() {}\n' }, { path: 'other/serde.rs', text: '' }], g => { const d = deps(g); return d.includes('main.rs-dep->a.rs') && d.includes('main.rs-dep->b.rs') && d.includes('main.rs-dep->serde') && !d.includes('main.rs-dep->serde.rs'); });
T('py kwargs not vars', [{ path: 'a.py', text: 'class C:\n    timeout = Field(\n        default=30,\n        alias="t")\n' }], g => !syms(g).some(s => s.includes('alias')) && syms(g).some(s => s.includes('variable:timeout')));
T('go grouped CRLF', [{ path: 'a.go', text: 'package a\r\nconst (\r\n\tAlpha = 1\r\n\tBeta = 2\r\n)\r\n' }], g => syms(g).some(s => s.includes('Alpha')) && syms(g).some(s => s.includes('Beta')));
T('long line perf', [{ path: 'a.c', text: 'int x; '.repeat(1) + 'f(a); '.repeat(40000) }], g => true);
T('elixir heredoc', [{ path: 'a.ex', text: 'defmodule A do\n  @moduledoc """\n  This module provides helpers. Each function returns the input string.\n  """\n  def run(x), do: x\nend\n' }], g => !syms(g).some(s => /provides|returns|string/.test(s)) && syms(g).some(s => /(function|method):run/.test(s)));
T('js for-of not var', [{ path: 'a.js', text: 'for (const item of list) {}\nconst real = 1\n' }], g => !syms(g).some(s => s.includes('item')) && syms(g).some(s => s.includes('real')));

T('jsx closing tags keep refs', [{ path: 'a.jsx', text: 'function Badge() {}\nfunction Row({ a }) {\n  return <tr><td>{a}</td><td><Badge /></td></tr>\n}\nfunction Cell({ x }) {\n  return <Foo x={x}/><Badge/>\n}\n' }], g => deps(g).includes('Row-dep->Badge') && deps(g).includes('Cell-dep->Badge'));
T('vue sfc', [{ path: 'src/UserCard.vue', text: '<template>\n  <div class="card" @click="select">\n    <Avatar :user="user" />\n    {{ formatName(user) }} it\'s here\n  </div>\n</template>\n<script setup>\nimport Avatar from \'./Avatar.vue\'\nimport { formatName } from \'./util\'\nfunction select() {}\n</script>\n<style>.card { color: red }</style>\n' }, { path: 'src/Avatar.vue', text: '<template><img></template>\n<script>\nexport default { name: "Avatar" }\n</script>\n' }, { path: 'src/util.js', text: 'export function formatName(u) { return u }\n' }], g => { const d = deps(g); return d.includes('UserCard.vue-dep->Avatar.vue') && d.includes('UserCard.vue-dep->formatName') && !syms(g).some(s => /card|color|red/.test(s)); });
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('all passed');
