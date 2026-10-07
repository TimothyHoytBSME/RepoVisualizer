const NAME = 'repovisualizer';
const KEEP = 6;
let dbp = null;

function open() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined') { rej(new Error('IndexedDB unavailable')); return; }
      const r = indexedDB.open(NAME, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
        if (!db.objectStoreNames.contains('repos')) db.createObjectStore('repos');
      };
      r.onsuccess = () => {
        const db = r.result;
        db.onversionchange = () => { db.close(); dbp = null; };
        res(db);
      };
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('IndexedDB blocked'));
    }).catch(e => { dbp = null; throw e; });
  }
  return dbp;
}

async function run(stores, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(stores, mode);
    let out;
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('aborted'));
    out = fn(t);
  });
}

const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

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
  return run('repos', 'readonly', t => req(t.objectStore('repos').get(key))).then(p => p);
}

export async function saveRepo(key, record) {
  await run('repos', 'readwrite', t => { t.objectStore('repos').put({ ...record, key, savedAt: Date.now() }, key); });
  prune().catch(() => {});
}

export async function listRepos() {
  const all = await run('repos', 'readonly', t => req(t.objectStore('repos').getAll()));
  return (await all).map(({ key, kind, label, savedAt, owner, repo, ref, sub }) => ({ key, kind, label, savedAt, owner, repo, ref, sub })).sort((a, b) => b.savedAt - a.savedAt);
}

export async function deleteRepo(key) {
  await run('repos', 'readwrite', t => { t.objectStore('repos').delete(key); });
}

async function prune() {
  const all = await (await run('repos', 'readonly', t => req(t.objectStore('repos').getAll())));
  all.sort((a, b) => b.savedAt - a.savedAt);
  const keep = all.slice(0, KEEP), drop = all.slice(KEEP);
  const live = new Set();
  for (const r of keep) if (r.files) for (const f of r.files) if (f.sha) live.add(f.sha);
  await run(['repos', 'blobs'], 'readwrite', t => {
    const repos = t.objectStore('repos');
    for (const r of drop) repos.delete(r.key);
    const c = t.objectStore('blobs').openKeyCursor();
    c.onsuccess = () => {
      const cur = c.result;
      if (!cur) return;
      if (!live.has(cur.key)) t.objectStore('blobs').delete(cur.key);
      cur.continue();
    };
  });
}
