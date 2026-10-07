import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try {
  ({ chromium } = await import(PW));
} catch {
  console.log('SKIP: playwright not found (set PLAYWRIGHT=/path/to/playwright/index.mjs)');
  process.exit(0);
}

const files = [];
for (const dir of ['src', 'tests']) {
  for (const name of fs.readdirSync(path.join(ROOT, dir))) {
    const p = path.join(ROOT, dir, name);
    if (fs.statSync(p).isFile() && /\.(m?js)$/.test(name)) files.push({ path: `${dir}/${name}`, text: fs.readFileSync(p, 'utf8') });
  }
}
files.push({ path: 'index.html', text: fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8') });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
let failed = 0;
const check = (name, ok, info) => {
  if (!ok) failed++;
  console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : JSON.stringify(info));
};

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function open(viewport, mobile, init, q = '') {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  if (init) await page.addInitScript(init);
  await page.route('http://app.local/**', r => {
    const u = new URL(r.request().url());
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname);
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: '' });
    r.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.route(/^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, r => r.abort());
  await page.goto('http://app.local/' + q);
  await page.waitForFunction(() => window.__rv);
  return { ctx, page, errors };
}

const settled = page => page.waitForFunction(() => { const a = window.__rv.app; return a.nb && a.lay.alpha < 0.01 && !a.pendingFit && !a.goto; }, null, { timeout: 60000 });
const state = page => page.evaluate(() => {
  const a = window.__rv.app;
  return { sel: a.g.nodes[a.view.ids[a.sel]].key, hl: a.hl >= 0 ? a.g.nodes[a.view.ids[a.hl]].key : null, depth: a.depth, map: a.mapType, nodes: a.nb.nodes.length };
});

{
  const { ctx, page, errors } = await open({ width: 1280, height: 800 }, false, () => {
    const pad = { id: 'fake', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    window.__pad = pad;
    navigator.getGamepads = () => [pad];
    window.__press = (i, on) => { pad.buttons[i] = { pressed: on, value: on ? 1 : 0 }; };
  });
  await page.evaluate(f => window.__rv.loadFiles(f), files);
  await settled(page);
  const s0 = await state(page);
  check('loads and selects a node', s0.nodes > 1, s0);

  const pt = await page.evaluate(() => {
    const a = window.__rv.app, i = a.nb.nodes[Math.min(3, a.nb.nodes.length - 1)];
    const r = document.querySelector('#stage').getBoundingClientRect();
    return [(a.lay.x[i] - a.cam.x) * a.cam.scale + r.width / 2 + r.left, (a.lay.y[i] - a.cam.y) * a.cam.scale + r.height / 2 + r.top, a.g.nodes[a.view.ids[i]].key];
  });
  await page.mouse.click(pt[0], pt[1]);
  await page.waitForTimeout(300);
  const s1 = await state(page);
  check('click selects node', s1.sel === pt[2], { want: pt[2], got: s1.sel });

  await page.click('[data-nav="back"]');
  await page.waitForTimeout(300);
  check('back button restores previous node', (await state(page)).sel === s0.sel);

  await page.click('#fit-btn');
  await page.waitForTimeout(200);
  check('HUD button does not change selection', (await state(page)).sel === s0.sel);

  await page.keyboard.press(']');
  check('] raises depth', (await state(page)).depth === s0.depth + 1);
  await page.keyboard.press('[');

  await page.evaluate(() => window.dispatchEvent(new Event('gamepadconnected')));
  const hold = async i => {
    await page.evaluate(i => window.__press(i, true), i);
    await page.waitForTimeout(350);
    await page.evaluate(i => window.__press(i, false), i);
    await page.waitForTimeout(150);
  };
  await hold(15);
  const g1 = await state(page);
  check('gamepad D-pad highlights a node', !!g1.hl, g1);
  await hold(0);
  check('gamepad A selects highlighted node', (await state(page)).sel === g1.hl);
  await hold(5);
  const g3 = await state(page);
  check('gamepad RB raises depth', g3.depth === s0.depth + 1, { before: s0.depth, after: g3.depth });
  await hold(4);

  await page.fill('#search', 'neighborhood');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  check('search selects match', (await state(page)).sel.includes('neighborhood'));

  await page.keyboard.press('g');
  check('G starts path mode', await page.evaluate(() => document.activeElement.id === 'search' && document.activeElement.placeholder.startsWith('Path from')));
  await page.fill('#search', 'readPalette');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const pth = await page.evaluate(() => {
    const a = window.__rv.app, p = a.pathNodes;
    return p && { len: p.length, first: a.g.nodes[a.view.ids[p[0]]].key, last: a.g.nodes[a.view.ids[p[p.length - 1]]].name, shown: p.every(i => a.nb.depth[i] >= 0), steps: document.querySelectorAll('#panel .rel.path li.step').length, ph: document.querySelector('#search').placeholder, url: new URLSearchParams(location.search).get('to') };
  });
  check('path to a searched node', pth && pth.len > 1 && pth.first.includes('neighborhood') && pth.last === 'readPalette' && pth.shown && pth.steps === pth.len - 1 && pth.ph === 'Search' && /readPalette$/.test(pth.url || ''), pth);
  await page.click('#panel [data-path-clear]');
  await page.waitForTimeout(200);
  check('path clears', await page.evaluate(() => window.__rv.app.pathNodes === null && !document.querySelector('#panel .rel.path') && !location.search.includes('to=')));
  const both = await page.evaluate(() => window.__rv.app.nb.nodes.length);
  await page.keyboard.press('u');
  await page.waitForTimeout(200);
  const dirOut = await page.evaluate(() => { const a = window.__rv.app, v = a.view, sel = a.sel; return { dir: a.dir, n: a.nb.nodes.length, tag: !!document.querySelector('#counts .dirtag'), url: location.search.includes('dir=out'), firstHop: [...a.nb.nodes].filter(i => a.nb.depth[i] === 1).every(i => { for (let k = v.start[sel]; k < v.start[sel + 1]; k++) { const e = v.adj[k]; if (v.eA[e] === sel && v.eB[e] === i) return true; } return false; }) }; });
  check('direction filter: uses only', dirOut.dir === 'out' && dirOut.n <= both && dirOut.tag && dirOut.url && dirOut.firstHop, dirOut);
  await page.keyboard.press('u');
  await page.keyboard.press('u');
  await page.waitForTimeout(200);
  check('direction filter cycles back', await page.evaluate(() => window.__rv.app.dir === 'both' && !document.querySelector('#counts .dirtag')));
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  await page.keyboard.press('g');
  await page.waitForTimeout(300);
  const ph = await page.evaluate(() => { const a = window.__rv.app; return { hl: a.hl, sel: a.sel, last: a.pathNodes ? a.pathNodes[a.pathNodes.length - 1] : null, focus: document.activeElement.id }; });
  check('G paths to the highlighted node', ph.hl >= 0 && ph.last === ph.hl && ph.focus !== 'search', ph);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  await page.evaluate(() => window.__rv.app.selectGlobal(window.__rv.app.g.byKey.get('f:src/graph.js')));
  await page.waitForTimeout(300);
  const ln = await page.evaluate(() => [...document.querySelectorAll('.code .ln')].findIndex(l => l.textContent.includes('export function buildView')));
  await page.click(`.code .ln >> nth=${ln}`, { position: { x: 20, y: 5 } });
  await page.waitForTimeout(300);
  check('clicking a code line selects its function', (await state(page)).sel === 's:src/graph.js#buildView', await state(page));

  await page.selectOption('#map-type', 'words');
  await page.waitForTimeout(500);
  const w = await state(page);
  check('keyword map keeps the file selected', w.map === 'words' && w.sel === 'f:src/graph.js' && w.nodes > 1, w);

  await page.selectOption('#map-type', 'files');
  await page.waitForTimeout(500);
  check('file map works', (await state(page)).map === 'files');
  await page.selectOption('#map-type', 'dirs');
  await page.waitForTimeout(500);
  const fm = await page.evaluate(() => { const a = window.__rv.app; return { map: a.mapType, kinds: [...new Set([...a.nb.nodes].map(i => a.g.nodes[a.view.ids[i]].kind))], uses: document.querySelectorAll('#panel .rel ul').length }; });
  check('folder map shows folders and libraries', fm.map === 'dirs' && fm.kinds.every(k => k === 'dir' || k === 'lib') && fm.kinds.includes('dir'), fm);

  check('no page errors (desktop)', errors.length === 0, errors);
  await ctx.close();
}

{
  const { ctx, page, errors } = await open({ width: 1100, height: 700 }, false);
  const evil = '<img src=x onerror=window.__pwned=1>';
  await page.evaluate(f => window.__rv.loadFiles(f), [
    { path: 'src/a.js', text: "import { helper } from './b.js'\nexport function main() { return helper() }\n" },
    { path: 'src/b.js', text: 'export function helper() { return 1 }\n' },
    { path: `${evil}/c.js`, text: 'export const x = 1\n' },
    { path: 'tests/a.test.js', text: "import { main } from '../src/a.js'\nfunction testThingy() { main() }\n" },
  ]);
  await settled(page);
  await page.selectOption('#map-type', 'files');
  await page.waitForTimeout(300);
  await page.evaluate(evil => { const a = window.__rv.app; const gid = a.g.byKey.get('d:' + evil); a.hover = a.view.local[gid]; a.dirty = true; }, evil);
  await page.waitForTimeout(400);
  check('folder names are escaped in the peek', await page.evaluate(() => window.__pwned === undefined && !document.querySelector('#peek img')));
  await page.fill('#search', 'testThingy');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const t = await state(page);
  check('search reveals a node hidden by the tests filter', t.sel === 's:tests/a.test.js#testThingy', t);
  check('no page errors (filters)', errors.length === 0, errors);
  await ctx.close();
}

{
  const { ctx, page, errors } = await open({ width: 320, height: 568 }, true);
  await page.setInputFiles('#zip-input', path.join(ROOT, 'tests/fixtures/basic.zip'));
  await settled(page);
  const s = await state(page);
  check('zip upload loads on phone', s.nodes >= 2, s);
  const hud = await page.evaluate(() => { const h = document.querySelector('#hud'); return h.scrollWidth <= h.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth; });
  check('no horizontal overflow at 320px', hud);
  await page.reload();
  await page.waitForFunction(() => window.__rv && window.__rv.app.nb, null, { timeout: 30000 });
  check('upload restored after reload', (await page.evaluate(() => window.__rv.app.meta.label)) === 'proj');
  check('no page errors (phone)', errors.length === 0, errors);
  await ctx.close();
}

{
  const { ctx, page, errors } = await open({ width: 900, height: 700 }, false, null, '?gl=0');
  await page.evaluate(f => window.__rv.loadFiles(f), files);
  await settled(page);
  const r = await page.evaluate(() => ({ flat: window.__rv.flat, nodes: window.__rv.app.nb.nodes.length }));
  check('canvas 2D fallback renders', r.flat === true && r.nodes > 1, r);
  check('no page errors (fallback)', !errors.length, errors);
  await ctx.close();
}

await browser.close();
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('all passed');
