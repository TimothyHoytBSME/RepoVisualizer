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

async function open(viewport, mobile, init) {
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
  await page.goto('http://app.local/');
  await page.waitForFunction(() => window.__rv);
  return { ctx, page, errors };
}

const settled = page => page.waitForFunction(() => window.__rv.app.nb && window.__rv.app.lay.alpha < 0.01, null, { timeout: 60000 });
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

  await page.selectOption('#map-type', 'words');
  await page.waitForTimeout(500);
  const w = await state(page);
  check('keyword map keeps the file selected', w.map === 'words' && w.sel === 'f:src/graph.js' && w.nodes > 1, w);

  await page.selectOption('#map-type', 'files');
  await page.waitForTimeout(500);
  check('file map works', (await state(page)).map === 'files');

  check('no page errors (desktop)', errors.length === 0, errors);
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

await browser.close();
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('all passed');
