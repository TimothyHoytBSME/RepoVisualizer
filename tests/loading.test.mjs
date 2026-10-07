import { readFile } from 'node:fs/promises';
import { readZip } from '../src/zip.js';
import { parseRepo } from '../src/source.js';
import { wanted } from '../src/langs.js';

let failed = 0;
const T = async (name, fn) => {
  let ok;
  try { ok = await fn(); } catch (e) { ok = 'ERR ' + e.message; }
  if (ok !== true) failed++;
  console.log(ok === true ? 'PASS' : 'FAIL', name, ok === true ? '' : JSON.stringify(ok));
};
const zip = async f => new Blob([await readFile(new URL(`./fixtures/${f}`, import.meta.url))]);
const choose = list => ({ items: list.filter(it => wanted(it.path, it.size)), skipped: 0 });

await T('basic zip', async () => {
  const r = await readZip(await zip('basic.zip'), choose);
  const paths = r.files.map(f => f.path).sort();
  return r.root === 'proj' && JSON.stringify(paths) === '["index.js","lib/a.js","stored.txt"]' || { r: r.root, paths };
});
await T('windows zip backslashes + cp437', async () => {
  const r = await readZip(await zip('windows.zip'), choose);
  const paths = r.files.map(f => f.path).sort();
  return r.root === 'express' && JSON.stringify(paths) === '["café.js","index.js"]' || { r: r.root, paths };
});
await T('zip64', async () => {
  const r = await readZip(await zip('zip64.zip'), choose);
  return r.files.length === 1 && r.files[0].text.startsWith('def f') || r;
});
await T('corrupt zip gives friendly result', async () => {
  try {
    const r = await readZip(await zip('corrupt.zip'), choose);
    return r.files.length < 3 || r;
  } catch (e) { return /valid \.zip/.test(e.message) || e.message; }
});
await T('not a zip', async () => {
  try { await readZip(new Blob(['hello']), choose); return 'no error'; } catch (e) { return /valid \.zip/.test(e.message) || e.message; }
});
const P = (s, exp) => T(`parse ${s}`, async () => {
  const r = parseRepo(s);
  const got = r && { owner: r.owner, repo: r.repo, ref: r.ref, sub: r.sub, focus: r.focus };
  return JSON.stringify(got) === JSON.stringify(exp) || got;
});
await P('pallets/flask', { owner: 'pallets', repo: 'flask', ref: '', sub: '', focus: '' });
await P('https://github.com/pallets/flask.git', { owner: 'pallets', repo: 'flask', ref: '', sub: '', focus: '' });
await P('github.com/microsoft/vscode/tree/release/1.80/src', { owner: 'microsoft', repo: 'vscode', ref: 'release', sub: '1.80/src', focus: '' });
await P('https://github.com/o/r/tree/v1.0%2Bx', { owner: 'o', repo: 'r', ref: 'v1.0+x', sub: '', focus: '' });
await P('https://github.com/o/r/tree/main/100%', { owner: 'o', repo: 'r', ref: 'main', sub: '100%', focus: '' });
await P('https://github.com/o/r/commit/abc123', { owner: 'o', repo: 'r', ref: 'abc123', sub: '', focus: '' });
await P('https://github.com/o/r/releases/tag/v2.0', { owner: 'o', repo: 'r', ref: 'v2.0', sub: '', focus: '' });
await P('https://github.com/o/r/blob/main/src/a.js', { owner: 'o', repo: 'r', ref: 'main', sub: '', focus: 'src/a.js' });
await T('parse garbage', async () => parseRepo('not a repo') === null);

if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('all passed');
