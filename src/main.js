import { parseRepo, loadGitHub, loadLocal, dropEntries, scanEntries, saveLocal, loadSaved, recent } from './source.js';
import { indexGraph, buildView, neighborhood, defaultNode } from './graph.js';
import { LayoutHost } from './layout-host.js';
import { Renderer, readPalette, nodeStyle } from './render.js';
import { attachControls, makeGamepad } from './controls.js';
import { Panel } from './panel.js';

const $ = s => document.querySelector(s);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = n => n.toLocaleString();
const narrow = () => matchMedia('(max-width: 760px)').matches;
const MAPS = ['code', 'files', 'words'];

const stage = $('#stage'), panelEl = $('#panel'), dlg = $('#src-dialog');
const MAX_DEPTH = +$('#depth').max;
const app = {
  g: null, files: null, meta: null, view: null, lay: null, nb: null, style: null,
  mapType: ['files', 'words'].includes(store.get('rv:map')) ? store.get('rv:map') : 'code',
  sel: -1, hl: -1, hover: -1, touchPeek: -1,
  depth: clamp(+store.get('rv:depth') || 2, 1, MAX_DEPTH),
  cam: { x: 0, y: 0, scale: narrow() ? 0.85 : 1 },
  follow: false, goto: null, dirty: true, pal: readPalette(), ver: 0,
  limit: (() => { const v = store.get('rv:limit'); return v === null ? (narrow() ? 500 : 1200) : +v; })(),
  filters: Object.assign({ tests: false, vars: true, libs: true }, (() => { try { return JSON.parse(store.get('rv:filters')) || {}; } catch { return {}; } })()),
};
const panel = new Panel(panelEl, $('#peek'), app);

let renderer = null;
try {
  renderer = new Renderer($('#gl'), $('#labels'), () => { app.dirty = true; });
} catch (e) {
  showStatus(e.message || 'Graphics are not available in this browser.');
}

function fit() {
  if (!renderer) return;
  const r = stage.getBoundingClientRect();
  renderer.resize(r.width, r.height, Math.min(window.devicePixelRatio || 1, 3));
  app.dirty = true;
  if (app.nb) paint();
}
new ResizeObserver(fit).observe(stage);
fit();
(function watchDpr() {
  const mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
  const on = () => { mq.removeEventListener('change', on); fit(); watchDpr(); };
  mq.addEventListener('change', on);
})();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { app.pal = readPalette(); app.dirty = true; });

function showStatus(text, frac) {
  $('#status').hidden = false;
  $('#status-text').textContent = text;
  const bar = $('#status-bar');
  bar.parentElement.classList.toggle('busy', frac == null);
  bar.style.width = frac == null ? '30%' : `${Math.round(frac * 100)}%`;
}
const hideStatus = () => { $('#status').hidden = true; };
const progress = p => showStatus(p.total ? `${p.phase} ${fmt(p.done)} / ${fmt(p.total)}` : `${p.phase}…`, p.total ? p.done / p.total : null);

function analyzeAsync(files, name, onProgress, signal) {
  const local = () => import('./analyze.js').then(m => m.analyze(files, name, onProgress));
  return new Promise((resolve, reject) => {
    let w;
    try { w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); } catch { local().then(resolve, reject); return; }
    signal?.addEventListener('abort', () => { w.terminate(); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    w.onmessage = e => {
      const d = e.data;
      if (d.progress) { onProgress(d.progress); return; }
      w.terminate();
      if (d.error) reject(new Error(d.error)); else resolve(d.graph);
    };
    w.onerror = e => { e.preventDefault?.(); w.terminate(); local().then(resolve, reject); };
    w.postMessage({ files, name });
  });
}

let loadSeq = 0, abort = null;
async function load(getSource, nodeKey) {
  const seq = ++loadSeq;
  abort?.abort();
  abort = new AbortController();
  const signal = abort.signal;
  const live = p => { if (seq === loadSeq) progress(p); };
  try {
    const src = await getSource(live, signal);
    if (seq !== loadSeq) return;
    live({ phase: 'Analyzing' });
    const g = await analyzeAsync(src.files, src.name, live, signal);
    if (seq !== loadSeq) return;
    indexGraph(g);
    Object.assign(app, { g, files: new Map(src.files.map(f => [f.path, f.text])), meta: src.meta, hl: -1, hover: -1, touchPeek: -1 });
    $('#repo-name').textContent = src.meta.label;
    document.title = `${src.meta.label} · RepoVisualizer`;
    hideStatus();
    if (dlg.open) dlg.close();
    const m = src.meta;
    if (m.kind === 'github') store.set('rv:last', JSON.stringify({ owner: m.owner, repo: m.repo, ref: m.ref === 'HEAD' ? '' : m.ref, sub: m.sub }));
    else if (m.saved) store.set('rv:last', JSON.stringify({ saved: m.saved }));
    else saveLocal(src).then(key => { if (key && seq === loadSeq) { m.saved = key; store.set('rv:last', JSON.stringify({ saved: key })); } });
    if (!nodeKey && m.focus) nodeKey = 'f:' + m.focus;
    const gid = nodeKey ? g.byKey.get(nodeKey) : undefined;
    setMap(app.mapType, gid ?? -1);
    app.pendingFit = gid === undefined;
    showHint();
    const notes = [];
    if (m.skipped) notes.push(`${fmt(m.skipped)} files skipped (too large)`);
    if (m.failed) notes.push(`${fmt(m.failed)} couldn't be read`);
    if (m.truncated) notes.push('GitHub cut the file list short');
    if (m.offline) notes.push('offline copy');
    toast([`${fmt(g.stats.files)} files · ${fmt(g.stats.symbols)} symbols · ${fmt(g.stats.libs)} libraries`, ...notes].join(' · '));
  } catch (e) {
    if (seq !== loadSeq || e.name === 'AbortError') return;
    hideStatus();
    openSource(e.message || String(e));
  }
}

const loadRepo = (spec, nodeKey) => load((p, signal) => loadGitHub(spec, p, signal), nodeKey);
const loadFiles = list => load((p, signal) => loadLocal(list, p, signal));
const openSaved = key => load(async (p, signal) => {
  const r = await loadSaved(key);
  return r.spec ? loadGitHub(r.spec, p, signal) : r.src;
});

function mapInto(gid) {
  const v = app.view, n = app.g.nodes[gid];
  if (v.local[gid] >= 0) return v.local[gid];
  if (n.file >= 0 && v.local[n.file] >= 0) return v.local[n.file];
  return -1;
}

function setMap(type, gid = -1, push = false) {
  app.mapType = type;
  $('#map-type').value = type;
  store.set('rv:map', type);
  app.view = buildView(app.g, type, app.filters);
  app.style = nodeStyle(app.g, app.view);
  app.lay?.dispose();
  app.lay = new LayoutHost(app.view);
  app.lay.onFresh = kick;
  app.sel = app.hl = app.hover = app.touchPeek = -1;
  let i = gid >= 0 ? mapInto(gid) : -1;
  if (i < 0) i = defaultNode(app.g, app.view);
  app.cam.x = app.cam.y = 0;
  select(i, true, push);
}

function refresh() {
  const { cam } = app;
  app.nb = neighborhood(app.view, app.sel, app.depth, app.limit || Infinity);
  app.lay.set(app.nb, app.sel, cam.x, cam.y);
  renderer?.setLabelOrder(app.nb, app.style.rad);
  for (const k of ['hl', 'hover', 'touchPeek']) if (app[k] >= 0 && app.nb.depth[app[k]] < 0) app[k] = -1;
  const { nodes, edges, total } = app.nb;
  const part = (shown, all, word) => (all > shown ? `${fmt(shown)} of ${fmt(all)} ${word}` : `${fmt(shown)} ${word}`);
  $('#counts').innerHTML = `<span>${part(nodes.length, total.nodes, 'nodes')}</span><span class="sep"> · </span><span>${part(edges.length, total.edges, 'edges')}</span>`;
  $('#counts').title = total.nodes > nodes.length ? `Showing the ${fmt(nodes.length)} most connected of ${fmt(total.nodes)} nodes in range. Change the limit in the filter menu.` : '';
  app.dirty = true;
}

function select(i, instant, push = !instant) {
  if (i < 0 || !app.view) return;
  if (push) app.pendingFit = false;
  app.sel = i;
  app.hl = -1;
  refresh();
  if (instant) { app.cam.x = app.lay.x[i]; app.cam.y = app.lay.y[i] - viewOffset() / app.cam.scale; }
  app.follow = true;
  app.goto = null;
  panel.show(app.view.ids[i]);
  syncURL(push);
}

app.selectGlobal = (gid, push = true) => {
  let i = app.view.local[gid];
  if (i < 0) {
    const k = app.g.nodes[gid].kind;
    const want = k === 'dir' ? 'files' : k === 'keyword' ? 'words' : 'code';
    if (want !== app.mapType) { setMap(want, gid, push); return; }
    i = mapInto(gid);
    if (i < 0) return;
  }
  if (i !== app.sel) select(i, false, push); else app.follow = true;
  if (narrow()) panelEl.classList.add('collapsed');
};

function setDepth(d) {
  d = clamp(d, 1, MAX_DEPTH);
  if (d === app.depth && app.nb) return;
  app.depth = d;
  $('#depth').value = d;
  $('#depth-val').textContent = d;
  store.set('rv:depth', d);
  if (app.view) { refresh(); syncURL(); }
}
$('#depth').addEventListener('input', e => setDepth(+e.target.value));
$('#depth').value = app.depth;
$('#depth-val').textContent = app.depth;
$('#map-type').value = app.mapType;
$('#map-type').addEventListener('change', e => { if (app.g) setMap(e.target.value, app.view.ids[app.sel]); });

let navCur = history.state?.n ?? 0, navMax = navCur;

function syncURL(push = false) {
  const q = new URLSearchParams();
  const m = app.meta;
  if (m && m.kind === 'github') {
    q.set('repo', `${m.owner}/${m.repo}`);
    if (m.ref && m.ref !== 'HEAD') q.set('ref', m.ref);
    if (m.sub) q.set('path', m.sub);
  }
  if (app.view && app.sel >= 0) {
    const key = app.g.nodes[app.view.ids[app.sel]].key;
    q.set('node', key);
    store.set('rv:node', key);
  }
  q.set('map', app.mapType);
  q.set('depth', app.depth);
  const url = `${location.pathname}?${q}`;
  if (push && url !== location.pathname + location.search) {
    navMax = ++navCur;
    history.pushState({ n: navCur }, '', url);
  } else history.replaceState({ n: navCur }, '', url);
  panel.nav(navCur > 0, navCur < navMax);
}

window.addEventListener('popstate', e => {
  navCur = e.state?.n ?? 0;
  if (navCur > navMax) navMax = navCur;
  if (!app.g) return;
  const q = new URLSearchParams(location.search);
  const m = app.meta, repo = q.get('repo');
  if (repo && m && m.kind === 'github' && repo.toLowerCase() !== `${m.owner}/${m.repo}`.toLowerCase()) {
    const spec = parseRepo(repo);
    if (spec) {
      spec.ref = q.get('ref') || '';
      spec.sub = q.get('path') || '';
      loadRepo(spec, q.get('node'));
      return;
    }
  }
  const key = q.get('node'), gid = key ? app.g.byKey.get(key) : undefined;
  const map = q.get('map');
  if (MAPS.includes(map) && map !== app.mapType) setMap(map, gid ?? -1, false);
  else if (gid !== undefined) app.selectGlobal(gid, false);
  panel.nav(navCur > 0, navCur < navMax);
});

function viewOffset() {
  if (!narrow() || !app.g) return 0;
  const s = stage.getBoundingClientRect(), p = panelEl.getBoundingClientRect();
  const top = Math.max(s.top, $('#hud').getBoundingClientRect().bottom);
  const bottom = Math.min(s.bottom, p.height ? p.top : s.bottom);
  return (top + bottom) / 2 - (s.top + s.bottom) / 2;
}

function toScreen(i) {
  const { cam, lay } = app;
  return [(lay.x[i] - cam.x) * cam.scale + renderer.W / 2, (lay.y[i] - cam.y) * cam.scale + renderer.H / 2];
}

function pick(sx, sy, slop) {
  if (!app.nb || !renderer) return -1;
  const { cam, lay, style } = app;
  const wx = (sx - renderer.W / 2) / cam.scale + cam.x, wy = (sy - renderer.H / 2) / cam.scale + cam.y;
  let best = -1, bd = Infinity;
  for (const i of app.nb.nodes) {
    const d = Math.hypot(lay.x[i] - wx, lay.y[i] - wy) * cam.scale;
    if (d < Math.max(style.rad[i] * cam.scale, 2.5) + slop && d < bd) { bd = d; best = i; }
  }
  return best;
}

function fitView(min = 0.03) {
  if (!app.nb || !renderer) return;
  const { x, y } = app.lay;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of app.nb.nodes) {
    if (x[i] < x0) x0 = x[i]; if (x[i] > x1) x1 = x[i];
    if (y[i] < y0) y0 = y[i]; if (y[i] > y1) y1 = y[i];
  }
  const pad = 50, H = renderer.H - Math.abs(viewOffset()) * 2;
  const s = clamp(Math.min((renderer.W - pad * 2) / Math.max(1, x1 - x0), (H - pad * 2) / Math.max(1, y1 - y0)), min, 2.5);
  app.follow = false;
  app.goto = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, scale: s };
  app.dirty = true;
}

function setFilter(k, v) {
  app.filters[k] = v;
  store.set('rv:filters', JSON.stringify(app.filters));
  syncFilters();
  if (app.g) setMap(app.mapType, app.view.ids[app.sel]);
}

function syncFilters() {
  for (const box of document.querySelectorAll('#filters input[data-f]')) box.checked = app.filters[box.dataset.f] !== false;
  $('#filter-btn').classList.toggle('on', Object.values(app.filters).some(v => v === false));
}

function togglePanel(force) {
  panelEl.classList.toggle('collapsed', force);
  if (narrow()) app.follow = true;
  app.dirty = true;
}

const api = {
  pan(dx, dy) {
    app.pendingFit = false;
    app.cam.x -= dx / app.cam.scale;
    app.cam.y -= dy / app.cam.scale;
    app.follow = false;
    app.goto = null;
    app.dirty = true;
  },
  zoomAt(f, sx, sy) {
    app.pendingFit = false;
    if (!renderer) return;
    const { cam } = app;
    const centered = sx === undefined;
    if (centered) { sx = renderer.W / 2; sy = renderer.H / 2; }
    const s = clamp(cam.scale * f, 0.03, 8);
    const ox = sx - renderer.W / 2, oy = sy - renderer.H / 2;
    const wx = ox / cam.scale + cam.x, wy = oy / cam.scale + cam.y;
    cam.scale = s;
    if (!centered) {
      cam.x = wx - ox / s; cam.y = wy - oy / s;
      if (Math.abs(ox) + Math.abs(oy) > 40) { app.follow = false; app.goto = null; }
    }
    app.dirty = true;
  },
  hoverAt(sx, sy) {
    const i = sx < 0 ? -1 : pick(sx, sy, 5);
    if (i !== app.hover) { app.hover = i; app.dirty = true; }
    stage.style.cursor = i >= 0 ? 'pointer' : '';
  },
  tapAt(sx, sy, type) {
    const i = pick(sx, sy, type === 'mouse' ? 5 : 14);
    if (i < 0) { if (app.hl >= 0) { app.hl = -1; app.dirty = true; } return; }
    if (i !== app.sel) select(i);
    else if (narrow()) togglePanel(false);
    else app.follow = true;
  },
  peekAt(sx, sy) { app.touchPeek = pick(sx, sy, 14); app.dirty = true; },
  peekEnd() { app.touchPeek = -1; app.dirty = true; },
  move(dx, dy) {
    if (!app.nb) return;
    const from = app.hl >= 0 ? app.hl : app.sel;
    const { x, y } = app.lay;
    let best = -1, bs = Infinity;
    for (const i of app.nb.nodes) {
      if (i === from) continue;
      const vx = x[i] - x[from], vy = y[i] - y[from];
      const d = Math.hypot(vx, vy) || 1e-6;
      const cos = (vx * dx + vy * dy) / d;
      if (cos < 0.5) continue;
      const s = d * (1.7 - cos);
      if (s < bs) { bs = s; best = i; }
    }
    if (best < 0) return;
    app.hl = best;
    const [sx, sy] = toScreen(best);
    const m = 70;
    if (sx < m || sy < m || sx > renderer.W - m || sy > renderer.H - m) { app.follow = false; app.goto = { i: best }; }
    app.dirty = true;
  },
  activate() {
    if (app.hl >= 0 && app.hl !== app.sel) select(app.hl);
    else if (narrow()) togglePanel();
  },
  depth: d => setDepth(app.depth + d),
  focusSearch() { $('#search').focus(); },
  escape() {
    app.hl = app.touchPeek = -1;
    closeResults();
    if (narrow()) togglePanel(true);
    app.dirty = true;
  },
  recenter() { app.follow = true; app.goto = null; app.dirty = true; },
  back() { if (navCur > 0) history.back(); },
  fit: () => fitView(),
  toggleTests() { setFilter('tests', !app.filters.tests); },
  togglePanel: () => togglePanel(),
  cycleMap() { if (app.g) setMap(MAPS[(MAPS.indexOf(app.mapType) + 1) % MAPS.length], app.view.ids[app.sel]); },
  openSource: () => openSource(),
};
app.togglePanel = api.togglePanel;
attachControls(stage, api);
$('#panel-btn').addEventListener('click', () => togglePanel());
$('#fit-btn').addEventListener('click', () => fitView());
$('#filter-btn').addEventListener('click', e => {
  e.stopPropagation();
  const box = $('#filters');
  box.hidden = !box.hidden;
  $('#filter-btn').setAttribute('aria-expanded', String(!box.hidden));
});
document.addEventListener('pointerdown', e => {
  if (!$('#filters').hidden && !e.target.closest('#filters, #filter-btn')) { $('#filters').hidden = true; $('#filter-btn').setAttribute('aria-expanded', 'false'); }
});
for (const box of document.querySelectorAll('#filters input[data-f]')) box.addEventListener('change', () => setFilter(box.dataset.f, box.checked));
$('#limit').value = String(app.limit);
$('#limit').addEventListener('change', e => {
  app.limit = +e.target.value;
  store.set('rv:limit', app.limit);
  if (app.view) refresh();
});
syncFilters();
if (narrow()) togglePanel(true);

let gamepadOn = false;
const pollPad = makeGamepad(api);
let lastPoll = 0;
setInterval(() => {
  if (gamepadOn && app.nb && performance.now() - lastPoll > 90) { lastPoll = performance.now(); pollPad(lastPoll); }
}, 50);
window.addEventListener('gamepadconnected', () => { gamepadOn = true; kick(); toast('Gamepad connected: left stick pans, D-pad moves, A selects, LB/RB depth'); });

function updatePeek() {
  const i = app.touchPeek >= 0 ? app.touchPeek : app.hl >= 0 ? app.hl : app.hover;
  if (i < 0 || !app.nb || app.nb.depth[i] < 0) { panel.peek(-1); return; }
  const [sx, sy] = toScreen(i);
  panel.peek(app.view.ids[i], sx, sy, renderer.W, renderer.H);
}

let running = false, dirtyFlag = true;
Object.defineProperty(app, 'dirty', { get: () => dirtyFlag, set: v => { dirtyFlag = v; if (v) kick(); } });

function kick() {
  if (running) return;
  running = true;
  requestAnimationFrame(frame);
}

function frame(t) {
  running = false;
  let busy = false;
  if (gamepadOn) {
    busy = true;
    if (app.nb) { pollPad(t); lastPoll = performance.now(); }
  }
  if (app.nb && renderer) {
    if (app.lay.run(9)) { dirtyFlag = true; app.ver++; if (app.lay.local) busy = true; }
    const { cam, lay } = app;
    const go = app.goto;
    const ti = app.follow ? app.sel : go && go.i != null ? go.i : -1;
    if (ti >= 0 || go) {
      const before = cam.x + ',' + cam.y + ',' + cam.scale;
      let ts = null;
      if (ti < 0 && go.scale) {
        ts = go.scale;
        cam.scale += (ts - cam.scale) * 0.2;
        if (Math.abs(ts - cam.scale) < ts * 0.002) cam.scale = ts;
      }
      const tx = ti >= 0 ? lay.x[ti] : go.x, ty = (ti >= 0 ? lay.y[ti] : go.y) - viewOffset() / cam.scale;
      const dx = tx - cam.x, dy = ty - cam.y;
      if (Math.abs(dx) * cam.scale < 0.4 && Math.abs(dy) * cam.scale < 0.4 && (ts === null || cam.scale === ts)) {
        cam.x = tx; cam.y = ty;
        app.goto = null;
      } else {
        cam.x += dx * 0.2; cam.y += dy * 0.2;
        busy = true;
      }
      if (before !== cam.x + ',' + cam.y + ',' + cam.scale) dirtyFlag = true;
    }
    if (app.pendingFit) {
      if (app.lay.alpha < 0.08) { app.pendingFit = false; fitView(0.35); }
      busy = true;
    }
    if (dirtyFlag) paint();
  }
  if (busy || dirtyFlag) kick();
}

function paint() {
  dirtyFlag = false;
  renderer.draw({ g: app.g, view: app.view, nb: app.nb, lay: app.lay, cam: app.cam, pal: app.pal, style: app.style, sel: app.sel, hl: app.hl, hover: app.hover, ver: app.ver });
  updatePeek();
}
kick();

const search = $('#search'), results = $('#results');
let hits = [], hitIdx = 0, searchTimer = 0;
function closeResults() { results.hidden = true; hits = []; }
function renderResults() {
  if (!hits.length) { results.innerHTML = '<div class="none">No matches</div>'; results.hidden = false; return; }
  results.innerHTML = `<ul>${hits.map((id, k) => {
    const n = app.g.nodes[id];
    const sub = n.kind === 'lib' ? 'library' : n.kind === 'dir' || n.kind === 'file' ? n.path : `${n.path}:${n.line + 1}`;
    return `<li class="${k === hitIdx ? 'on' : ''}" data-n="${id}">${panel.chip(n.kind)}<span class="nm">${n.name.replace(/[&<>]/g, c => `&#${c.charCodeAt(0)};`)}</span><span class="sub">${sub.replace(/[&<>]/g, c => `&#${c.charCodeAt(0)};`)}</span></li>`;
  }).join('')}</ul>`;
  results.hidden = false;
  results.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
}
function subseq(q, s) {
  let j = 0;
  for (let i = 0; i < s.length && j < q.length; i++) if (s[i] === q[j]) j++;
  return j === q.length;
}

function runSearch() {
  const q = search.value.trim().toLowerCase();
  if (!q || !app.g) { closeResults(); return; }
  const found = [];
  for (const n of app.g.nodes) {
    const nm = n.name.toLowerCase();
    const i = nm.indexOf(q);
    let s;
    if (i >= 0) s = nm === q ? 0 : i === 0 ? 1 : 2;
    else if (n.kind === 'file' && n.path.toLowerCase().includes(q)) s = 3;
    else if (q.length > 1 && subseq(q, nm)) s = 4;
    else continue;
    found.push([s, nm.length, n.id]);
  }
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  hits = found.slice(0, 50).map(f => f[2]);
  hitIdx = 0;
  renderResults();
}
function choose(id) {
  search.value = '';
  closeResults();
  search.blur();
  app.selectGlobal(id);
}
search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 70); });
search.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!hits.length) return;
    hitIdx = (hitIdx + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
    renderResults();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    clearTimeout(searchTimer);
    if (!hits.length) runSearch();
    if (hits.length) choose(hits[hitIdx]);
  } else if (e.key === 'Escape') { closeResults(); search.blur(); }
});
search.addEventListener('blur', () => setTimeout(closeResults, 150));
results.addEventListener('pointerdown', e => {
  const li = e.target.closest('[data-n]');
  if (li) { e.preventDefault(); choose(+li.dataset.n); }
});

function openSource(err = '') {
  const el = $('#src-error');
  el.textContent = err;
  el.hidden = !err;
  $('#src-close').hidden = !app.g;
  if (!dlg.open) dlg.showModal();
  if (!matchMedia('(pointer: coarse)').matches) $('#repo-input').focus();
  recent().then(list => {
    const box = $('#recent');
    box.replaceChildren();
    if (!list.length) { box.hidden = true; return; }
    box.append('Recent');
    for (const r of list.slice(0, 6)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = r.label + (r.kind === 'local' ? ' · device' : '');
      b.addEventListener('click', () => { dlg.close(); openSaved(r.key); });
      box.append(b);
    }
    box.hidden = false;
  });
}
dlg.addEventListener('cancel', e => { if (!app.g) e.preventDefault(); });
$('#src-btn').addEventListener('click', () => openSource());
$('#src-close').addEventListener('click', () => dlg.close());
$('#src-form').addEventListener('submit', e => {
  e.preventDefault();
  const spec = parseRepo($('#repo-input').value);
  if (!spec) { openSource('Enter a GitHub repository like owner/name, or paste its link.'); return; }
  dlg.close();
  loadRepo(spec);
});
for (const b of document.querySelectorAll('[data-repo]')) {
  b.addEventListener('click', () => { $('#repo-input').value = b.dataset.repo; dlg.close(); loadRepo(parseRepo(b.dataset.repo)); });
}
$('#zip-btn').addEventListener('click', () => $('#zip-input').click());
$('#dir-btn').addEventListener('click', () => $('#dir-input').click());
if (!('webkitdirectory' in document.createElement('input')) || matchMedia('(pointer: coarse)').matches) $('#dir-btn').hidden = true;
for (const id of ['#zip-input', '#dir-input']) {
  $(id).addEventListener('change', e => {
    const list = [...e.target.files];
    e.target.value = '';
    if (!list.length) return;
    dlg.close();
    loadFiles(list);
  });
}
window.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dropping'); });
window.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dropping'); });
window.addEventListener('drop', e => {
  e.preventDefault();
  document.body.classList.remove('dropping');
  const entries = dropEntries(e.dataTransfer);
  const files = [...(e.dataTransfer.files || [])];
  if (!entries && !files.length) return;
  if (dlg.open) dlg.close();
  if (!entries) { loadFiles(files); return; }
  if (entries.length === 1 && entries[0].isFile && /\.zip$/i.test(entries[0].name)) { loadFiles(files); return; }
  load(async (p, signal) => loadLocal(await scanEntries(entries, p, signal), p, signal));
});

function showHint() {
  if (store.get('rv:hinted')) return;
  store.set('rv:hinted', '1');
  const touch = matchMedia('(pointer: coarse)').matches;
  const el = $('#hint');
  el.innerHTML = touch
    ? '<b>Tap</b> a node to select it · <b>drag</b> to move · <b>pinch</b> to zoom · <b>press and hold</b> to peek'
    : '<b>Click</b> a node to select it · <b>drag</b> to pan · <b>scroll</b> to zoom · <b>arrows + Enter</b> to move by keyboard';
  el.hidden = false;
  const hide = () => { el.hidden = true; stage.removeEventListener('pointerdown', hide); };
  stage.addEventListener('pointerdown', hide);
  setTimeout(hide, 9000);
}

app.share = () => {
  const url = location.href;
  if (navigator.share) navigator.share({ title: document.title, url }).catch(() => {});
  else navigator.clipboard?.writeText(url).then(() => toast('Link copied'), () => toast(url));
};

let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
}

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

const q = new URLSearchParams(location.search);
if (MAPS.includes(q.get('map'))) app.mapType = q.get('map');
if (q.get('depth')) setDepth(+q.get('depth'));
const r = q.get('repo') && parseRepo(q.get('repo'));
if (r) {
  r.ref = q.get('ref') || r.ref;
  r.sub = q.get('path') || r.sub;
  $('#repo-input').value = q.get('repo');
  loadRepo(r, q.get('node'));
} else {
  let last = null;
  try { last = JSON.parse(store.get('rv:last')); } catch {}
  if (last && last.owner) loadRepo(last, store.get('rv:node'));
  else if (last && last.saved) load(async () => (await loadSaved(last.saved)).src, store.get('rv:node'));
  else openSource();
}
window.__rv = { app, loadFiles: files => load(async () => ({ name: 'test', files, meta: { kind: 'local', label: 'test' } })) };
