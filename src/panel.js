import { langOf, mask } from './langs.js';
import { edgesOf, isTest } from './graph.js';

const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const KIND_LABEL = { dir: 'folder', file: 'file', lib: 'library', class: 'class', type: 'type', module: 'module', function: 'function', method: 'method', variable: 'variable', keyword: 'keyword' };
const MAX_LINES = 400;

const clsCache = new Map();
function classes(path, text) {
  let c = clsCache.get(path);
  if (c && c.text === text) return c.cls;
  const L = langOf(path);
  const cls = new Uint8Array(text.length);
  if (L && L.syntax) mask(text, L, cls);
  if (clsCache.size > 30) clsCache.delete(clsCache.keys().next().value);
  clsCache.set(path, { text, cls });
  return cls;
}

function lineHTML(text, cls, start, end, L, links, defName) {
  let html = '';
  let i = start;
  while (i < end) {
    const c = cls[i];
    let j = i + 1;
    while (j < end && cls[j] === c) j++;
    const seg = text.slice(i, j);
    if (c === 1) html += `<span class="tc">${esc(seg)}</span>`;
    else if (c === 2) html += `<span class="ts">${esc(seg)}</span>`;
    else {
      for (const m of seg.matchAll(/([A-Za-z_$][\w$]*)|(\d[\w.]*)|([^A-Za-z_$\d]+)/g)) {
        if (m[1]) {
          const w = m[1];
          if (w === defName) html += `<span class="td">${w}</span>`;
          else if (links && links.has(w)) html += `<span class="tl" data-n="${links.get(w)}">${w}</span>`;
          else if (L && L.kw.has(w)) html += `<span class="tk">${w}</span>`;
          else html += w;
        } else if (m[2]) html += `<span class="tn">${esc(m[2])}</span>`;
        else html += esc(m[3]);
      }
    }
    i = j;
  }
  return html;
}

export function codeHTML(path, text, from, to, hiFrom, hiTo, links, defName, mark = -1) {
  const L = langOf(path);
  const cls = classes(path, text);
  const starts = [0];
  for (let i = text.indexOf('\n'); i >= 0 && starts.length <= to + 1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  let html = '';
  for (let ln = from; ln <= to && ln < starts.length; ln++) {
    const s = starts[ln];
    let e = ln + 1 < starts.length ? starts[ln + 1] - 1 : text.length;
    if (text[e - 1] === '\r') e--;
    const hi = ln >= hiFrom && ln <= hiTo;
    html += `<div class="ln${hi ? ' hl' : ''}${ln === mark ? ' mk' : ''}" data-ln="${ln}"><span class="no">${ln + 1}</span><span class="tx">${lineHTML(text, cls, s, e, L, links, hi ? defName : null) || ' '}</span></div>`;
  }
  return html;
}

export function lineOf(text, ln) {
  let s = 0;
  for (let k = 0; k < ln; k++) {
    const i = text.indexOf('\n', s);
    if (i < 0) return '';
    s = i + 1;
  }
  const e = text.indexOf('\n', s);
  return text.slice(s, e < 0 ? text.length : e).replace(/\r$/, '');
}

const LANG_NAMES = { js: 'JavaScript/TypeScript', py: 'Python', go: 'Go', rs: 'Rust', c: 'C/C++', jvm: 'Java/Kotlin', cs: 'C#', swift: 'Swift', dart: 'Dart', rb: 'Ruby', php: 'PHP', lua: 'Lua', sh: 'Shell', sql: 'SQL', gen: 'Other code', md: 'Docs', html: 'HTML', css: 'Styles', text: 'Config & text', other: 'Other' };

export class Panel {
  constructor(el, peek, app) {
    this.el = el;
    this.peekEl = peek;
    this.app = app;
    this.cur = -1;
    this.rest = [];
    el.addEventListener('click', e => {
      if (e.target.closest('[data-share]')) { e.stopPropagation(); app.share(); return; }
      if (e.target.closest('[data-path]')) { e.stopPropagation(); app.startPath(); return; }
      if (e.target.closest('[data-path-clear]')) { e.stopPropagation(); app.clearPath(); return; }
      const mo = e.target.closest('[data-more]');
      if (mo) { e.stopPropagation(); const f = this.rest[+mo.dataset.more], li = mo.parentElement; if (f) li.outerHTML = f(); return; }
      const nav = e.target.closest('[data-nav]');
      if (nav) { e.stopPropagation(); if (nav.dataset.nav === 'back') history.back(); else history.forward(); return; }
      const t = e.target.closest('[data-n]');
      if (t) { e.preventDefault(); this.focusLine = t.dataset.line != null ? +t.dataset.line : null; app.selectGlobal(+t.dataset.n); this.focusLine = null; return; }
      const ln = e.target.closest('[data-ln]');
      if (ln && !String(getSelection?.() || '')) this.lineClick(+ln.dataset.ln);
    });
  }

  lineClick(line) {
    const { g } = this.app;
    const cur = g.nodes[this.cur];
    if (!cur || !cur.path || cur.kind === 'dir' || cur.kind === 'lib' || cur.kind === 'keyword') return;
    const fid = cur.kind === 'file' ? cur.id : cur.file;
    let best = fid, span = Infinity;
    for (const e of edgesOf(g, fid, 'out')) this.walk(e, line, n => { const s = n.end - n.line; if (s < span) { span = s; best = n.id; } });
    if (best !== this.cur) this.app.selectGlobal(best);
  }

  walk(e, line, hit) {
    const { g } = this.app;
    if (e.type !== 'contain') return;
    const n = g.nodes[e.t];
    if (line < n.line || line > n.end) return;
    hit(n);
    for (const c of edgesOf(g, n.id, 'out')) this.walk(c, line, hit);
  }

  overview() {
    const { g } = this.app, by = new Map();
    for (const n of g.nodes) if (n.kind === 'file') by.set(n.group || 'other', (by.get(n.group || 'other') || 0) + 1);
    const rows = [...by].sort((a, b) => b[1] - a[1]).map(([k, c]) => `<span class="lang"><b>${esc(LANG_NAMES[k] || k)}</b> ${c.toLocaleString()}</span>`).join('');
    const s = g.stats || {}, hubs = this.hubs();
    const top = (title, list) => list.length ? `<details class="rel" open><summary>${title} <span class="cnt">by files using them</span></summary><ul>${list.map(([id, c]) => this.item(id, `<span class="uses" title="Used from ${c} other file${c === 1 ? '' : 's'}">${c}</span>`)).join('')}</ul></details>` : '';
    return `<div class="rel overview"><div class="phd">Repository</div><div class="ovs">${(s.files || 0).toLocaleString()} files · ${(s.symbols || 0).toLocaleString()} symbols · ${(s.libs || 0).toLocaleString()} libraries</div><div class="langs">${rows}</div></div>${top('Most used files', hubs.files)}${top('Most used symbols', hubs.syms)}`;
  }

  hubs() {
    const { g } = this.app;
    if (g.hubs) return g.hubs;
    const N = g.nodes, { s, t, type } = g.edges, fileOf = i => (N[i].kind === 'file' ? i : N[i].file);
    const byFile = new Map(), bySym = new Map();
    const add = (m, k, v) => { let x = m.get(k); if (!x) m.set(k, (x = new Set())); x.add(v); };
    for (let k = 0; k < s.length; k++) {
      if (type[k] !== 3) continue;
      const a = s[k], b = t[k], fa = fileOf(a), fb = fileOf(b);
      if (fa == null || fb == null || fa < 0 || fb < 0 || fa === fb || isTest(N[fb]) || isTest(N[fa])) continue;
      add(byFile, fb, fa);
      if (N[b].kind !== 'file' && N[b].kind !== 'variable') add(bySym, b, fa);
    }
    const best = m => [...m].map(([id, set]) => [id, set.size]).filter(x => x[1] > 1).sort((a, b) => b[1] - a[1]).slice(0, 8);
    return (g.hubs = { files: best(byFile), syms: best(bySym) });
  }

  pathHTML(id) {
    const { app } = this, p = app.pathNodes;
    if (!p || app.view.ids[p[0]] !== id) return '';
    const { view, g } = app;
    const rel = (u, w) => {
      const e = app.edgeBetween(u, w);
      if (e < 0) return '';
      const fwd = view.eA[e] === u, t = view.eT[e];
      return t === 3 ? (fwd ? '↓ uses' : '↑ used by') : t === 2 ? (fwd ? '↓ contains' : '↑ inside') : '≈ related';
    };
    let items = '';
    for (let i = 1; i < p.length; i++) items += `<li class="step">${rel(p[i - 1], p[i])}</li>${this.item(view.ids[p[i]])}`;
    return `<div class="rel path"><div class="phd">Path to <b>${esc(g.nodes[view.ids[p[p.length - 1]]].name)}</b><span class="cnt">${p.length - 1} step${p.length > 2 ? 's' : ''}</span><button type="button" data-path-clear aria-label="Clear path" title="Clear path">×</button></div><ul>${items}</ul></div>`;
  }

  nav(back, fwd) {
    this.canBack = back;
    this.canFwd = fwd;
    const b = this.el.querySelector('[data-nav="back"]'), f = this.el.querySelector('[data-nav="fwd"]');
    if (b) b.disabled = !back;
    if (f) f.disabled = !fwd;
  }

  chip(kind) { return `<span class="chip k-${kind}">${KIND_LABEL[kind] || kind}</span>`; }

  link(n) {
    const m = this.app.meta;
    if (!m || m.kind !== 'github' || !n.path || n.kind === 'dir') return '';
    const L = n.kind === 'file' ? '' : `#L${n.line + 1}-L${n.end + 1}`;
    return `https://github.com/${m.owner}/${m.repo}/blob/${m.ref.split('/').map(encodeURIComponent).join('/')}/${n.path.split('/').map(encodeURIComponent).join('/')}${L}`;
  }

  item(id, note = '', at = -1) {
    const n = this.app.g.nodes[id];
    const sub = n.kind === 'lib' ? '' : at >= 0 ? `${n.path}:${at + 1}` : n.kind === 'file' || n.kind === 'dir' ? n.path.slice(0, n.path.length - n.name.length).replace(/\/$/, '') : `${n.path}:${n.line + 1}`;
    return `<li><a href="#" data-n="${id}"${at >= 0 ? ` data-line="${at}" title="Used on line ${at + 1}"` : ''}>${this.chip(n.kind)}<span class="nm">${esc(n.name)}</span>${note}<span class="sub">${esc(sub)}</span></a></li>`;
  }

  mentionLine(id, word) {
    const n = this.app.g.nodes[id], text = n.path && this.app.files.get(n.path);
    if (!text || !word || n.kind === 'dir' || n.kind === 'lib') return -1;
    const re = new RegExp(`(^|[^\\w$])${word.replace(/\W/g, '\\$&')}(?![\\w$])`);
    let ln = 0, i = 0;
    const from = n.kind === 'file' ? 0 : n.line, to = n.kind === 'file' ? Infinity : n.end;
    while (ln < from && i >= 0) { i = text.indexOf('\n', i) + 1 || -1; ln++; }
    for (; i >= 0 && ln <= to; ln++) {
      const e = text.indexOf('\n', i), line = text.slice(i, e < 0 ? text.length : e);
      if (ln !== from || n.kind === 'file' ? re.test(line) : re.test(line.slice(line.indexOf(n.name) + n.name.length))) return ln;
      i = e < 0 ? -1 : e + 1;
    }
    return -1;
  }

  list(title, ids, open = true, weak, word) {
    if (!ids.length) return '';
    const shown = ids.slice(0, 150);
    const more = ids.length - shown.length;
    const note = i => (weak && weak.has(i) ? '<span class="weak" title="Name match only; the analyzer couldn\'t confirm this link">≈</span>' : '');
    const it = i => this.item(i, note(i), word ? this.mentionLine(i, word) : -1);
    const k = more > 0 ? (this.rest.push(() => ids.slice(150).map(it).join('')), this.rest.length - 1) : -1;
    return `<details class="rel"${open ? ' open' : ''}><summary>${title} <span class="cnt">${ids.length}</span></summary><ul>${shown.map(it).join('')}${more > 0 ? `<li class="more"><button type="button" class="linkish" data-more="${k}">Show ${more.toLocaleString()} more</button></li>` : ''}</ul></details>`;
  }

  mentions(word, fileIds) {
    const { g, files } = this.app;
    const re = new RegExp(word.replace(/[^a-z0-9]/gi, ''), 'i');
    const rows = fileIds.slice(0, 80).map(fid => {
      const f = g.nodes[fid], text = files.get(f.path) || '';
      const m = re.exec(text);
      let line = 0, snippet = '';
      if (m) {
        for (let i = text.indexOf('\n'); i >= 0 && i < m.index; i = text.indexOf('\n', i + 1)) line++;
        snippet = lineOf(text, line).trim().slice(0, 140);
      }
      return `<li><a href="#" data-n="${fid}">${this.chip('file')}<span class="nm">${esc(f.name)}</span><span class="sub">${esc(f.path)}${m ? ':' + (line + 1) : ''}</span></a>${snippet ? `<div class="snip">${esc(snippet)}</div>` : ''}</li>`;
    });
    const more = fileIds.length - rows.length;
    return `<details class="rel" open><summary>Found in <span class="cnt">${fileIds.length}</span></summary><ul>${rows.join('')}${more > 0 ? `<li class="more">+${more} more</li>` : ''}</ul></details>`;
  }

  show(id) {
    this.rest = [];
    const { g, files } = this.app;
    this.cur = id;
    const n = g.nodes[id];
    const out = edgesOf(g, id, 'out'), inc = edgesOf(g, id, 'in');
    const uses = [], usedBy = [], children = [];
    const kws = [];
    const weak = new Set();
    for (const e of out) {
      (e.type === 'contain' ? children : g.nodes[e.t].kind === 'keyword' ? kws : uses).push(e.t);
      if (e.type === 'ref') weak.add(e.t);
    }
    for (const e of inc) {
      if (e.type === 'contain') continue;
      usedBy.push(e.s);
      if (e.type === 'ref') weak.add(e.s);
    }
    const v = this.app.view;
    if (n.kind === 'dir' && v && v.type === 'dirs' && v.local[id] >= 0) {
      const u = v.local[id];
      for (let k = v.start[u]; k < v.start[u + 1]; k++) {
        const e = v.adj[k];
        if (v.eT[e] === 2) continue;
        const a = v.ids[v.eA[e]], b = v.ids[v.eB[e]];
        if (a === id) { uses.push(b); if (v.eT[e] === 1) weak.add(b); } else { usedBy.push(a); if (v.eT[e] === 1) weak.add(a); }
      }
    }
    const strong = (a, b) => (weak.has(a) ? 1 : 0) - (weak.has(b) ? 1 : 0);
    const byName = (a, b) => g.nodes[a].name.localeCompare(g.nodes[b].name);
    uses.sort((a, b) => strong(a, b) || byName(a, b));
    usedBy.sort((a, b) => strong(a, b) || byName(a, b));
    if (n.kind === 'dir') children.sort((a, b) => (g.nodes[a].kind === 'dir' ? 0 : 1) - (g.nodes[b].kind === 'dir' ? 0 : 1) || byName(a, b));
    else children.sort((a, b) => g.nodes[a].line - g.nodes[b].line);

    const url = this.link(n);
    const loc = n.kind === 'keyword' ? `found in ${usedBy.length} files` : n.kind === 'lib' ? 'external library' : n.kind === 'dir' ? n.path || '/' : n.kind === 'file' ? n.path : `${n.path}:${n.line + 1}`;
    let html = `<div class="ph"><div class="grip"></div><div class="pt">${this.chip(n.kind)}<span class="pname">${esc(n.name)}</span><span class="pnav"><button type="button" data-path aria-label="Find a path to another node" title="Path to… (G)"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/></svg></button>${this.app.meta?.kind === 'github' ? '<button type="button" data-share aria-label="Share link" title="Share a link to this node"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6"/></svg></button>' : ''}<button type="button" data-nav="back" aria-label="Back" title="Back (Backspace)"${this.canBack ? '' : ' disabled'}>‹</button><button type="button" data-nav="fwd" aria-label="Forward" title="Forward"${this.canFwd ? '' : ' disabled'}>›</button></span></div>
      <div class="ppath">${url ? `<a href="${url}" target="_blank" rel="noopener">${esc(loc)} ↗</a>` : esc(loc)}</div></div><div class="pbody">`;
    html += this.pathHTML(id);

    if (n.path && n.kind !== 'dir' && files.has(n.path)) {
      const text = files.get(n.path);
      const links = new Map();
      const near = [...uses, ...usedBy, ...children];
      if (n.file >= 0) for (const e of edgesOf(g, n.file, 'out')) near.push(e.t);
      for (const t of near) { const m = g.nodes[t]; if (m.kind !== 'file' && m.kind !== 'dir' && !links.has(m.name)) links.set(m.name, t); }
      let from, to, hf, ht;
      if (n.kind === 'file') { from = 0; to = Math.min(n.end, MAX_LINES - 1); hf = ht = -1; }
      else {
        from = Math.max(0, n.line - 4);
        to = Math.min(g.nodes[n.file].end, n.end + 4, from + MAX_LINES - 1);
        hf = n.line; ht = n.end;
      }
      const trunc = n.kind === 'file' && n.end >= MAX_LINES ? `<div class="trunc">Showing the first ${MAX_LINES} of ${n.end + 1} lines${url ? ` · <a href="${url}" target="_blank" rel="noopener">open on GitHub</a>` : ''}</div>` : '';
      const mark = this.focusLine != null && this.focusLine >= from && this.focusLine <= to ? this.focusLine : -1;
      html += `<div class="code">${codeHTML(n.path, text, from, to, hf, ht, links, n.kind === 'file' ? null : n.name, mark)}</div>${trunc}`;
    }
    if (n.parent >= 0 && n.kind !== 'dir') html += `<div class="rel in">in ${this.item(n.parent).replace(/^<li>|<\/li>$/g, '')}</div>`;
    if (kws.length) html += `<div class="kws">${kws.map(k => `<a href="#" data-n="${k}" class="kw">${esc(g.nodes[k].name)}</a>`).join('')}</div>`;
    if (n.kind === 'dir' && !n.path) html += this.overview();
    if (n.kind === 'keyword') html += this.mentions(n.name, usedBy);
    html += this.list(n.kind === 'dir' ? 'Contents' : 'Defines', children, n.kind !== 'file' || children.length < 40);
    if (n.kind !== 'keyword') {
      html += this.list(n.kind === 'lib' ? 'Used by' : 'Uses', n.kind === 'lib' ? usedBy : uses, true, weak);
      if (n.kind !== 'lib') html += this.list('Used by', usedBy, true, weak, n.kind === 'file' ? null : n.name);
    }
    html += '</div>';
    this.el.innerHTML = html;
    const hl = this.el.querySelector('.ln.mk') || this.el.querySelector('.ln.hl');
    const code = this.el.querySelector('.code');
    if (code) code.scrollTop = hl ? Math.max(0, hl.offsetTop - code.offsetTop - 60) : 0;
    this.el.querySelector('.pbody').scrollTop = 0;
  }

  peek(id, sx, sy, W, H, top = 0, bottom = H) {
    if (id < 0) { this.peekEl.hidden = true; this.peekId = -1; return; }
    const { g, files } = this.app;
    const n = g.nodes[id];
    const li = this.app.view ? this.app.view.local[id] : -1, hid = li >= 0 && this.app.nb?.hidden?.get(li) || 0;
    if (this.peekId !== id || this.peekHid !== hid) {
      this.peekId = id;
      this.peekHid = hid;
      let body = '';
      if (n.kind === 'keyword') body = `<div class="pk-sub">keyword · found in ${edgesOf(g, id, 'in').length} files</div>`;
      else if (n.kind === 'lib') body = `<div class="pk-sub">external library · used by ${edgesOf(g, id, 'in').length} files</div>`;
      else if (n.kind === 'dir') body = `<div class="pk-sub">${esc(n.path || '/')} · ${edgesOf(g, id, 'out').length} items</div>`;
      else if (n.kind === 'file') {
        const defs = edgesOf(g, id, 'out').filter(e => e.type === 'contain').length;
        body = `<div class="pk-sub">${esc(n.path)} · ${n.end + 1} lines${defs ? ` · ${defs} definitions` : ''}</div>`;
      } else {
        const text = files.get(n.path) || '';
        const line = lineOf(text, n.line).trim().slice(0, 160);
        const cls = new Uint8Array(line.length);
        const L = langOf(n.path);
        if (L && L.syntax) mask(line, L, cls);
        body = `<div class="pk-sub">${esc(n.path)}:${n.line + 1}</div><div class="pk-code">${lineHTML(line, cls, 0, line.length, L, null, n.name)}</div>`;
      }
      if (hid) body += `<div class="pk-sub pk-more">+${hid} hidden connection${hid === 1 ? '' : 's'} · tap the +N or press E</div>`;
      this.peekEl.innerHTML = `<div class="pk-t">${this.chip(n.kind)}<b>${esc(n.name)}</b></div>${body}`;
      this.peekEl.hidden = false;
    }
    const pw = this.peekEl.offsetWidth, ph = this.peekEl.offsetHeight;
    let x = sx + 16, y = sy + 16;
    if (x + pw > W - 8) x = Math.max(8, sx - pw - 16);
    if (y + ph > bottom - 8) y = Math.max(top + 8, sy - ph - 16);
    if (y < top + 8) y = top + 8;
    this.peekEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
}
