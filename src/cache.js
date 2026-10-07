const NAME = 'repovisualizer';
const KEEP = 6;
let dbp = null;

function open() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined') { rej(new Error('IndexedDB unavailable')); return; }
      const r = indexedDB.open(NAME, 2);
      r.onupgradeneeded = e => {
        const db = r.result;
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
        if (!db.objectStoreNames.contains('repos')) db.createObjectStore('repos');
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
        if (e.oldVersion === 1) r.transaction.objectStore('repos').clear();
      };
      r.onsuccess = () => {
        const db = r.result;
        db.onversionchange = () => { db.close(); dbp = null; };
        db.onclose = () => { dbp = null; };
        res(db);
      };
      r.onerror = () => rej(r.error || new Error('IndexedDB error'));
      r.onblocked = () => rej(new Error('IndexedDB blocked'));
    }).catch(e => { dbp = null; throw e; });
  }
  return dbp;
}

async function run(stores, mode, fn, retry = true) {
  const db = await open();
  let t;
  try {
    t = db.transaction(stores, mode);
  } catch (e) {
    dbp = null;
    if (retry && e && e.name === 'InvalidStateError') return run(stores, mode, fn, false);
    throw e;
  }
  return new Promise((res, rej) => {
    let out;
    t.oncomplete = () => res(out);
    t.onerror = e => rej(t.error || e.target?.error || new Error('IndexedDB error'));
    t.onabort = e => rej(t.error || e.target?.error || new Error('IndexedDB transaction aborted'));
    out = fn(t);
  });
}

const req = r => new Promise((res, rej) => {
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error || new Error('IndexedDB error'));
});

export async function getBlobs(shas) {
  const found = new Map();
  if (!shas.length) return found;
  await run('blobs', 'readonly', t => {
    const s = t.objectStore('blobs');
    for (const sha of shas) {
      const r = s.get(sha);
      r.onsuccess = () => { if (typeof r.result === 'string') found.set(sha, r.result); };
    }
  });
  return found;
}

export async function putBlobs(entries) {
  if (!entries.length) return;
  await run('blobs', 'readwrite', t => {
    const s = t.objectStore('blobs');
    for (const { sha, text } of entries) s.put(text, sha);
  });
}

export async function getRepo(key) {
  return run('repos', 'readonly', t => req(t.objectStore('repos').get(key)));
}

export async function getFiles(key) {
  return run('files', 'readonly', t => req(t.objectStore('files').get(key)));
}

export async function saveRepo(key, record, files) {
  await run(['repos', 'files'], 'readwrite', t => {
    t.objectStore('repos').put({ ...record, key, savedAt: Date.now() }, key);
    if (files) t.objectStore('files').put(files, key);
  });
  prune().catch(() => {});
}

export async function listRepos() {
  const all = await run('repos', 'readonly', t => req(t.objectStore('repos').getAll()));
  return all.map(({ key, kind, label, savedAt, owner, repo, ref, sub }) => ({ key, kind, label, savedAt, owner, repo, ref, sub })).sort((a, b) => b.savedAt - a.savedAt);
}

async function prune() {
  const all = await run('repos', 'readonly', t => req(t.objectStore('repos').getAll()));
  all.sort((a, b) => b.savedAt - a.savedAt);
  const keep = all.slice(0, KEEP), drop = all.slice(KEEP);
  const live = new Set();
  for (const r of keep) {
    if (r.kind !== 'github') continue;
    const list = await getFiles(r.key).catch(() => null);
    if (list) for (const f of list) if (f.sha) live.add(f.sha);
  }
  await run(['repos', 'files', 'blobs'], 'readwrite', t => {
    for (const r of drop) {
      t.objectStore('repos').delete(r.key);
      t.objectStore('files').delete(r.key);
    }
    const blobs = t.objectStore('blobs');
    const c = blobs.openKeyCursor();
    c.onsuccess = () => {
      const cur = c.result;
      if (!cur) return;
      if (!live.has(cur.key)) blobs.delete(cur.key);
      cur.continue();
    };
  });
}
