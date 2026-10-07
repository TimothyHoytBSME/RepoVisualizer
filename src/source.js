import { wanted, langOf } from './langs.js';
import { readZip } from './zip.js';

const MAX_FILES = 6000;
const MAX_BYTES = 60e6;

export function parseRepo(input) {
  const s = input.trim().replace(/\.git$/, '').replace(/\/+$/, '');
  let m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)(?:\/(?:tree|blob)\/([^/\s?#]+)(?:\/([^?#\s]*))?)?/i.exec(s);
  if (!m) m = /^([\w.-]+)\/([\w.-]+)$/.exec(s);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, ''), ref: m[3] || '', sub: m[4] ? decodeURIComponent(m[4]) : '' };
}

async function pool(items, n, fn) {
  let i = 0;
  const run = async () => { while (i < items.length) await fn(items[i++]); };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
}

const isCode = p => {
  const L = langOf(p);
  return L && L.defs ? 0 : 1;
};

function cap(items, sizeOf) {
  if (items.length <= MAX_FILES && items.reduce((a, b) => a + sizeOf(b), 0) <= MAX_BYTES) return { items, skipped: 0 };
  const sorted = items.slice().sort((a, b) => isCode(a.path) - isCode(b.path) || a.path.split('/').length - b.path.split('/').length);
  const out = [];
  let bytes = 0;
  for (const it of sorted) {
    if (out.length >= MAX_FILES) break;
    if (bytes + sizeOf(it) > MAX_BYTES) continue;
    bytes += sizeOf(it);
    out.push(it);
  }
  return { items: out, skipped: items.length - out.length };
}

export async function loadGitHub(spec, progress, signal) {
  const { owner, repo, ref, sub } = spec;
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref || 'HEAD')}?recursive=1`;
  progress({ phase: 'Listing files' });
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' }, signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error("Couldn't reach GitHub. Check your connection and try again.");
  }
  if (!res.ok) {
    if (res.status === 404 || res.status === 422) throw new Error(`Couldn't find ${owner}/${repo}${ref ? ' @ ' + ref : ''}. Check the name, and note that only public repositories work.`);
    if (res.status === 403 || res.status === 429) {
      const reset = +res.headers.get('x-ratelimit-reset');
      const when = reset ? ` It resets at ${new Date(reset * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : '';
      throw new Error(`GitHub's hourly limit for anonymous visitors was reached.${when}`);
    }
    throw new Error(`GitHub returned an error (${res.status}).`);
  }
  const data = await res.json();
  let blobs = data.tree.filter(t => t.type === 'blob');
  if (sub) blobs = blobs.filter(t => t.path === sub || t.path.startsWith(sub + '/'));
  blobs = blobs.filter(t => wanted(t.path, t.size));
  const { items, skipped } = cap(blobs, t => t.size || 0);
  const rawRef = ref || 'HEAD';
  const files = [];
  let done = 0;
  await pool(items, 16, async t => {
    const u = `https://raw.githubusercontent.com/${owner}/${repo}/${rawRef.split('/').map(encodeURIComponent).join('/')}/${t.path.split('/').map(encodeURIComponent).join('/')}`;
    try {
      const r = await fetch(u, { signal });
      if (r.ok) {
        const text = await r.text();
        if (!text.slice(0, 4000).includes('\u0000')) files.push({ path: t.path, text });
      }
    } catch (e) {
      if (signal?.aborted) throw e;
    }
    progress({ phase: 'Downloading', done: ++done, total: items.length });
  });
  if (!files.length) throw new Error(`No readable source files were found in ${owner}/${repo}.`);
  return {
    name: repo, files,
    meta: { kind: 'github', owner, repo, ref: rawRef, sub, label: `${owner}/${repo}${ref ? '@' + ref : ''}${sub ? '/' + sub : ''}`, skipped: skipped + (data.truncated ? 1 : 0) },
  };
}

async function readFiles(list, progress) {
  const { items, skipped } = cap(list.filter(x => wanted(x.path, x.file.size)), x => x.file.size);
  const files = [];
  let done = 0;
  await pool(items, 8, async x => {
    try {
      const text = await x.file.text();
      if (!text.slice(0, 4000).includes('\u0000')) files.push({ path: x.path, text });
    } catch {}
    if (++done % 25 === 0) progress({ phase: 'Reading files', done, total: items.length });
  });
  return { files, skipped };
}

export async function loadLocal(fileList, progress) {
  const arr = [...fileList];
  if (arr.length === 1 && /\.zip$/i.test(arr[0].name)) {
    progress({ phase: 'Opening zip' });
    const name = arr[0].name.replace(/\.zip$/i, '');
    const { files, root } = await readZip(arr[0], wanted, progress);
    if (!files.length) throw new Error('No readable source files were found in that zip.');
    return { name: root || name, files, meta: { kind: 'local', label: root || name } };
  }
  let list = arr.map(f => ({ file: f, path: (f._path || f.webkitRelativePath || f.name).replace(/^\/+/, '') }));
  const first = list.length ? list[0].path.split('/')[0] : '';
  const shared = list.length > 0 && list.every(x => x.path.startsWith(first + '/'));
  if (shared) list = list.map(x => ({ file: x.file, path: x.path.slice(first.length + 1) }));
  const name = shared ? first : 'files';
  const { files, skipped } = await readFiles(list, progress);
  if (!files.length) throw new Error('No readable source files were found there.');
  return { name, files, meta: { kind: 'local', label: name, skipped } };
}

export async function filesFromDrop(dt) {
  const items = [...(dt.items || [])].map(i => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
  if (!items.length) return [...(dt.files || [])];
  const out = [];
  const readAll = reader => new Promise(res => {
    const acc = [];
    const next = () => reader.readEntries(batch => { if (!batch.length) res(acc); else { acc.push(...batch); next(); } }, () => res(acc));
    next();
  });
  const walk = async (entry, prefix) => {
    if (entry.isFile) {
      const f = await new Promise(res => entry.file(res, () => res(null)));
      if (f) { f._path = prefix + entry.name; out.push(f); }
    } else if (entry.isDirectory) {
      if (prefix && !wanted(prefix + entry.name + '/x.txt')) return;
      for (const c of await readAll(entry.createReader())) await walk(c, prefix + entry.name + '/');
    }
  };
  for (const e of items) await walk(e, '');
  return out;
}
