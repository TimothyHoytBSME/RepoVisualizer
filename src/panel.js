import { langOf, mask } from './langs.js';
import { edgesOf } from './graph.js';

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

export function codeHTML(path, text, from, to, hiFrom, hiTo, links, defName) {
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
    html += `<div class="ln${hi ? ' hl' : ''}"><span class="no">${ln + 1}</span><span class="tx">${lineHTML(text, cls, s, e, L, links, hi ? defName : null) || ' '}</span></div>`;
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

export class Panel {
  constructor(el, peek, app) {
    this.el = el;
    this.peekEl = peek;
    this.app = app;
    this.cur = -1;
    el.addEventListener('click', e => {
      const t = e.target.closest('[data-n]');
      if (t) { e.preventDefault(); app.selectGlobal(+t.dataset.n); return; }
      if (e.target.closest('.ph') && !e.target.closest('a')) app.togglePanel();
    });
  }

  chip(kind) { return `<span class="chip k-${kind}">${KIND_LABEL[kind] || kind}</span>`; }

  link(n) {
    const m = this.app.meta;
    if (!m || m.kind !== 'github' || !n.path || n.kind === 'dir') return '';
    const L = n.kind === 'file' ? '' : `#L${n.line + 1}-L${n.end + 1}`;
    return `https://github.com/${m.owner}/${m.repo}/blob/${m.ref.split('/').map(encodeURIComponent).join('/')}/${n.path.split('/').map(encodeURIComponent).join('/')}${L}`;
  }

  item(id, note = '') {
    const n = this.app.g.nodes[id];
    const sub = n.kind === 'lib' ? '' : n.kind === 'file' || n.kind === 'dir' ? n.path.slice(0, n.path.length - n.name.length).replace(/\/$/, '') : `${n.path}:${n.line + 1}`;
    return `<li><a href="#" data-n="${id}">${this.chip(n.kind)}<span class="nm">${esc(n.name)}</span>${note}<span class="sub">${esc(sub)}</span></a></li>`;
  }

  list(title, ids, open = true) {
    if (!ids.length) return '';
    const shown = ids.slice(0, 150);
    const more = ids.length - shown.length;
    return `<details class="rel"${open ? ' open' : ''}><summary>${title} <span class="cnt">${ids.length}</span></summary><ul>${shown.map(i => this.item(i)).join('')}${more > 0 ? `<li class="more">+${more} more</li>` : ''}</ul></details>`;
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
    const { g, files } = this.app;
    this.cur = id;
    const n = g.nodes[id];
    const out = edgesOf(g, id, 'out'), inc = edgesOf(g, id, 'in');
    const uses = [], usedBy = [], children = [];
    const kws = [];
    for (const e of out) (e.type === 'contain' ? children : g.nodes[e.t].kind === 'keyword' ? kws : uses).push(e.t);
    for (const e of inc) if (e.type !== 'contain') usedBy.push(e.s);
    const byName = (a, b) => g.nodes[a].name.localeCompare(g.nodes[b].name);
    uses.sort(byName); usedBy.sort(byName);
    if (n.kind === 'dir') children.sort((a, b) => (g.nodes[a].kind === 'dir' ? 0 : 1) - (g.nodes[b].kind === 'dir' ? 0 : 1) || byName(a, b));
    else children.sort((a, b) => g.nodes[a].line - g.nodes[b].line);

    const url = this.link(n);
    const loc = n.kind === 'keyword' ? `found in ${usedBy.length} files` : n.kind === 'lib' ? 'external library' : n.kind === 'dir' ? n.path || '/' : n.kind === 'file' ? n.path : `${n.path}:${n.line + 1}`;
    let html = `<div class="ph"><div class="grip"></div><div class="pt">${this.chip(n.kind)}<span class="pname">${esc(n.name)}</span></div>
      <div class="ppath">${url ? `<a href="${url}" target="_blank" rel="noopener">${esc(loc)} ↗</a>` : esc(loc)}</div></div><div class="pbody">`;

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
      html += `<div class="code">${codeHTML(n.path, text, from, to, hf, ht, links, n.kind === 'file' ? null : n.name)}</div>${trunc}`;
    }
    if (n.parent >= 0 && n.kind !== 'dir') html += `<div class="rel in">in ${this.item(n.parent).replace(/^<li>|<\/li>$/g, '')}</div>`;
    if (kws.length) html += `<div class="kws">${kws.map(k => `<a href="#" data-n="${k}" class="kw">${esc(g.nodes[k].name)}</a>`).join('')}</div>`;
    if (n.kind === 'keyword') html += this.mentions(n.name, usedBy);
    html += this.list(n.kind === 'dir' ? 'Contents' : 'Defines', children, n.kind !== 'file' || children.length < 40);
    if (n.kind !== 'keyword') {
      html += this.list(n.kind === 'lib' ? 'Used by' : 'Uses', n.kind === 'lib' ? usedBy : uses);
      if (n.kind !== 'lib') html += this.list('Used by', usedBy);
    }
    html += '</div>';
    this.el.innerHTML = html;
    const hl = this.el.querySelector('.ln.hl');
    const code = this.el.querySelector('.code');
    if (code) code.scrollTop = hl ? Math.max(0, hl.offsetTop - code.offsetTop - 60) : 0;
    this.el.querySelector('.pbody').scrollTop = 0;
  }

  peek(id, sx, sy, W, H) {
    if (id < 0) { this.peekEl.hidden = true; this.peekId = -1; return; }
    const { g, files } = this.app;
    const n = g.nodes[id];
    if (this.peekId !== id) {
      this.peekId = id;
      let body = '';
      if (n.kind === 'keyword') body = `<div class="pk-sub">keyword · found in ${edgesOf(g, id, 'in').length} files</div>`;
      else if (n.kind === 'lib') body = `<div class="pk-sub">external library · used by ${edgesOf(g, id, 'in').length} files</div>`;
      else if (n.kind === 'dir') body = `<div class="pk-sub">${n.path || '/'} · ${edgesOf(g, id, 'out').length} items</div>`;
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
      this.peekEl.innerHTML = `<div class="pk-t">${this.chip(n.kind)}<b>${esc(n.name)}</b></div>${body}`;
      this.peekEl.hidden = false;
    }
    const pw = this.peekEl.offsetWidth, ph = this.peekEl.offsetHeight;
    let x = sx + 16, y = sy + 16;
    if (x + pw > W - 8) x = Math.max(8, sx - pw - 16);
    if (y + ph > H - 8) y = Math.max(8, sy - ph - 16);
    this.peekEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
}
