const UTF8 = new TextDecoder();

async function inflate(data) {
  const s = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export async function readZip(blob, accept, progress) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('That file is not a valid .zip archive.');
  let count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  if (off === 0xffffffff || count === 0xffff) {
    const loc = eocd - 20;
    if (loc >= 0 && dv.getUint32(loc, true) === 0x07064b50) {
      const z = Number(dv.getBigUint64(loc + 8, true));
      count = Number(dv.getBigUint64(z + 32, true));
      off = Number(dv.getBigUint64(z + 48, true));
    }
  }
  const entries = [];
  let p = off;
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    let csize = dv.getUint32(p + 20, true), size = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    let lo = dv.getUint32(p + 42, true);
    const name = UTF8.decode(buf.subarray(p + 46, p + 46 + nlen));
    let e = p + 46 + nlen;
    const eEnd = e + elen;
    while (e + 4 <= eEnd) {
      const id = dv.getUint16(e, true), len = dv.getUint16(e + 2, true);
      if (id === 1) {
        let q = e + 4;
        if (size === 0xffffffff) { size = Number(dv.getBigUint64(q, true)); q += 8; }
        if (csize === 0xffffffff) { csize = Number(dv.getBigUint64(q, true)); q += 8; }
        if (lo === 0xffffffff) { lo = Number(dv.getBigUint64(q, true)); }
      }
      e += 4 + len;
    }
    p = eEnd + clen;
    if (!name.endsWith('/')) entries.push({ name, method, csize, size, lo });
  }
  const names = entries.map(x => x.name);
  const first = names.length ? names[0].split('/')[0] + '/' : '';
  const strip = first.length > 1 && names.every(nm => nm.startsWith(first)) ? first.length : 0;
  const picked = entries.filter(x => x.name.length > strip && accept(x.name.slice(strip), x.size));
  const files = [];
  let done = 0;
  for (const x of picked) {
    const h = x.lo;
    if (dv.getUint32(h, true) !== 0x04034b50) continue;
    const start = h + 30 + dv.getUint16(h + 26, true) + dv.getUint16(h + 28, true);
    const raw = buf.subarray(start, start + x.csize);
    let data = null;
    try {
      if (x.method === 0) data = raw;
      else if (x.method === 8) data = await inflate(raw);
    } catch { data = null; }
    if (data) {
      const text = UTF8.decode(data);
      if (!text.slice(0, 4000).includes('\u0000')) files.push({ path: x.name.slice(strip), text });
    }
    if (++done % 25 === 0) progress?.({ phase: 'Unzipping', done, total: picked.length });
  }
  return { files, root: strip ? first.slice(0, -1) : '' };
}
