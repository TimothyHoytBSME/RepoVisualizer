import { wanted, langOf } from './langs.js';
import { readZip } from './zip.js';

const MAX_FILES = 6000;
const MAX_BYTES = 60e6;
const aborted = () => new DOMException('Aborted', 'AbortError');
const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(aborted()); }, { once: true });
});
const safeDecode = s => { try { return decodeURIComponent(s); } catch { return s; } };
const encPath = p => p.split('/').map(encodeURIComponent).join('/');

export function parseRepo(input) {
  const s = String(input || '').trim().replace(/\/+$/, '');
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)(?:\/(tree|blob|commit|releases\/tag)\/([^?#\s]+))?/i.exec(s);
  if (m) {
    const parts = (m[4] || '').split('/').filter(Boolean).map(safeDecode);
    const kind = (m[3] || '').toLowerCase();
    const spec = { owner: m[1], repo: m[2].replace(/\.git$/, ''), ref: '', sub: '', focus: '' };
    if (kind === 'commit' || kind === 'releases/tag') spec.ref = parts[0] || '';
    else if (kind === 'blob') { spec.ref = parts[0] || ''; spec.focus = parts.slice(1).join('/'); }
    else if (kind === 'tree') { spec.ref = parts[0] || ''; spec.sub = parts.slice(1).join('/'); }
    return spec;
  }
  const b = /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(s);
  return b ? { owner: b[1], repo: b[2], ref: '', sub: '', focus: '' } : null;
}

const isCode = p => (langOf(p)?.defs ? 0 : 1);

function cap(items) {
  let bytes = 0;
  for (const it of items) bytes += it.size || 0;
  if (items.length <= MAX_FILES && bytes <= MAX_BYTES) return { items, skipped: 0 };
  const sorted = items.slice().sort((a, b) => isCode(a.path) - isCode(b.path) || a.path.split('/').length - b.path.split('/').length);
  const out = [];
  bytes = 0;
  for (const it of sorted) {
    if (out.length >= MAX_FILES) break;
    if (bytes + (it.size || 0) > MAX_BYTES) continue;
    bytes += it.size || 0;
    out.push(it);
  }
  return { items: out, skipped: items.length - out.length };
}

const choose = list => cap(list.filter(it => wanted(it.path, it.size)));

async function api(url, signal) {
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' }, signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error("Couldn't reach GitHub. Check your connection and try again.");
  }
  if (res.ok) return res.json();
  if (res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')) {
    const reset = +res.headers.get('x-ratelimit-reset');
    const when = reset ? ` It resets at ${new Date(reset * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : '';
    throw Object.assign(new Error(`GitHub's hourly limit for anonymous visitors was reached.${when}`), { status: res.status });
  }
  throw Object.assign(new Error(`GitHub returned an error (${res.status}).`), { status: res.status });
}

async function listTree(spec, signal) {
  const { owner, repo } = spec;
  const parts = [spec.ref, ...(spec.sub || '').split('/')].filter(Boolean);
  const splits = spec.ref ? Array.from({ length: Math.min(parts.length, 6) }, (_, k) => [parts.slice(0, k + 1).join('/'), parts.slice(k + 1).join('/')]) : [['HEAD', spec.sub || '']];
  let last = null;
  for (const [ref, sub] of splits) {
    const tree = sub ? `${ref}:${sub}` : ref;
    try {
      const data = await api(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(tree)}?recursive=1`, signal);
      return { data, ref, sub };
    } catch (e) {
      if (e.status !== 404 && e.status !== 422) throw e;
      last = e;
    }
  }
  if (last) throw new Error(`Couldn't find ${owner}/${repo}${spec.ref ? ' @ ' + [spec.ref, spec.sub].filter(Boolean).join('/') : ''}. Check the name; only public repositories work.`);
  return null;
}

async function fetchText(url, signal) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let r;
    try {
      r = await fetch(url, { signal });
    } catch (e) {
      if (signal?.aborted) throw e;
      await sleep(500 * 2 ** attempt, signal);
      continue;
    }
    if (r.ok) return { text: await r.text() };
    if (r.status === 429) return { limited: true };
    if (r.status < 500) return { failed: true };
    await sleep(500 * 2 ** attempt, signal);
  }
  return { failed: true };
}

export async function loadGitHub(spec, progress, signal) {
  const { owner, repo } = spec;
  progress({ phase: 'Listing files' });
  let listed;
  try {
    listed = await listTree(spec, signal);
  } catch (e) {
    if (e.status || signal?.aborted) throw e;
    const offline = await loadCachedGitHub(spec).catch(() => null);
    if (offline) return offline;
    throw e;
  }
  const { data, ref, sub } = listed;
  const blobs = data.tree.filter(t => t.type === 'blob').map(t => ({ path: sub ? `${sub}/${t.path}` : t.path, rel: t.path, size: t.size || 0, sha: t.sha }));
  const { items, skipped } = cap(blobs.filter(t => wanted(t.rel, t.size)));
  let cached = new Map();
  try {
    const { getBlobs } = await import('./cache.js');
    cached = await getBlobs(items.map(t => t.sha));
  } catch {}
  const files = [], fresh = [];
  let done = 0, failed = 0, limited = false, next = 0;
  const base = `https://raw.githubusercontent.com/${owner}/${repo}/${encPath(ref)}/`;
  const work = async () => {
    while (next < items.length) {
      const t = items[next++];
      let text = cached.get(t.sha);
      if (text === undefined) {
        if (limited) { failed++; continue; }
        const r = await fetchText(base + encPath(t.path), signal);
        if (r.limited) { limited = true; failed++; continue; }
        if (r.failed) { failed++; continue; }
        text = r.text;
        if (text.slice(0, 4000).includes('\u0000')) continue;
        fresh.push({ sha: t.sha, text });
      }
      files.push({ path: t.path, text });
      progress({ phase: 'Downloading', done: ++done, total: items.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(24, items.length) }, work));
  if (signal?.aborted) throw aborted();
  if (!files.length) {
    if (limited) throw new Error('GitHub is limiting downloads right now. Wait a few minutes and try again.');
    throw new Error(`No readable source files were found in ${owner}/${repo}${sub ? '/' + sub : ''}.`);
  }
  const label = `${owner}/${repo}${spec.ref ? '@' + ref : ''}${sub ? '/' + sub : ''}`;
  const meta = { kind: 'github', owner, repo, ref, sub, label, skipped, failed, truncated: !!data.truncated, focus: spec.focus || '' };
  const shaOf = new Map(items.map(t => [t.path, t.sha]));
  import('./cache.js').then(async c => {
    await c.putBlobs(fresh);
    await c.saveRepo(ghKey(spec), { kind: 'github', label, owner, repo, ref: spec.ref ? ref : '', sub, files: files.map(f => ({ path: f.path, sha: shaOf.get(f.path) })) });
  }).catch(() => {});
  return { name: repo, files, meta };
}

const ghKey = spec => `gh:${spec.owner}/${spec.repo}@${spec.ref || ''}:${spec.sub || ''}`;

async function loadCachedGitHub(spec) {
  const c = await import('./cache.js');
  const rec = await c.getRepo(ghKey(spec));
  if (!rec || !rec.files) return null;
  const blobs = await c.getBlobs(rec.files.map(f => f.sha).filter(Boolean));
  const files = rec.files.filter(f => blobs.has(f.sha)).map(f => ({ path: f.path, text: blobs.get(f.sha) }));
  if (!files.length) return null;
  return { name: rec.repo, files, meta: { kind: 'github', owner: rec.owner, repo: rec.repo, ref: rec.ref || 'HEAD', sub: rec.sub || '', label: rec.label, offline: true, focus: spec.focus || '' } };
}

export async function saveLocal(src) {
  try {
    const c = await import('./cache.js');
    const key = `local:${src.meta.label}`;
    await c.saveRepo(key, { kind: 'local', label: src.meta.label, files: src.files });
    return key;
  } catch {
    return null;
  }
}

export async function loadSaved(key) {
  const c = await import('./cache.js');
  const rec = await c.getRepo(key);
  if (!rec) throw new Error('That saved repository is no longer on this device.');
  if (rec.kind === 'github') {
    const spec = { owner: rec.owner, repo: rec.repo, ref: rec.ref || '', sub: rec.sub || '' };
    return { spec };
  }
  return { src: { name: rec.label, files: rec.files, meta: { kind: 'local', label: rec.label, saved: key } } };
}

export async function recent() {
  try {
    const c = await import('./cache.js');
    return await c.listRepos();
  } catch {
    return [];
  }
}

async function readFiles(list, progress, signal) {
  const { items, skipped } = choose(list);
  const files = [];
  let done = 0, failed = 0, next = 0;
  const work = async () => {
    while (next < items.length) {
      if (signal?.aborted) throw aborted();
      const x = items[next++];
      try {
        const text = await x.file.text();
        if (!text.slice(0, 4000).includes('\u0000')) files.push({ path: x.path, text });
      } catch { failed++; }
      if (++done % 25 === 0) progress({ phase: 'Reading files', done, total: items.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, items.length) }, work));
  return { files, skipped, failed };
}

export async function loadLocal(fileList, progress, signal) {
  const arr = [...fileList];
  if (arr.length === 1 && /\.zip$/i.test(arr[0].name)) {
    progress({ phase: 'Opening zip' });
    const name = arr[0].name.replace(/\.zip$/i, '');
    const { files, root, skipped, failed } = await readZip(arr[0], choose, progress, signal);
    if (!files.length) throw new Error('No readable source files were found in that zip.');
    return { name: root || name, files, meta: { kind: 'local', label: root || name, skipped, failed } };
  }
  let list = arr.map(f => ({ file: f, size: f.size, path: (f._path || f.webkitRelativePath || f.name).replace(/\\/g, '/').replace(/^\/+/, '') }));
  const first = list.length ? list[0].path.split('/')[0] : '';
  const shared = list.length > 0 && list.every(x => x.path.startsWith(first + '/'));
  if (shared) list = list.map(x => ({ ...x, path: x.path.slice(first.length + 1) }));
  const name = shared ? first : 'files';
  const { files, skipped, failed } = await readFiles(list, progress, signal);
  if (!files.length) throw new Error('No readable source files were found there.');
  return { name, files, meta: { kind: 'local', label: name, skipped, failed } };
}

export function dropEntries(dt) {
  const entries = [...(dt.items || [])].map(i => (i.kind === 'file' && i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
  return entries.length ? entries : null;
}

export async function scanEntries(entries, progress, signal) {
  const out = [];
  const single = entries.length === 1 && entries[0].isDirectory;
  const readAll = reader => new Promise(res => {
    const acc = [];
    const next = () => reader.readEntries(batch => { if (!batch.length) res(acc); else { acc.push(...batch); next(); } }, () => res(acc));
    next();
  });
  const walk = async (entry, rel) => {
    if (signal?.aborted) throw aborted();
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    const check = single ? path.split('/').slice(1).join('/') : path;
    if (entry.isFile) {
      if (!check || !wanted(check)) return;
      const f = await new Promise(res => entry.file(res, () => res(null)));
      if (f) {
        f._path = path;
        out.push(f);
        if (out.length % 50 === 0) progress({ phase: `Scanning folder · ${out.length} files` });
      }
    } else if (entry.isDirectory) {
      if (check && !wanted(check + '/x.txt')) return;
      const kids = await readAll(entry.createReader());
      for (let i = 0; i < kids.length; i += 8) await Promise.all(kids.slice(i, i + 8).map(c => walk(c, path)));
    }
  };
  progress({ phase: 'Scanning folder' });
  for (const e of entries) await walk(e, '');
  return out;
}
