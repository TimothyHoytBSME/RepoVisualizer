const UTF8 = new TextDecoder();
const UTF8_STRICT = new TextDecoder('utf-8', { fatal: true });
const CP437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
const invalid = () => new Error('That file is not a valid .zip archive.');
const aborted = () => new DOMException('Aborted', 'AbortError');

function decodeName(bytes, utf8) {
  if (utf8) return UTF8.decode(bytes);
  try { return UTF8_STRICT.decode(bytes); } catch {}
  let s = '';
  for (const b of bytes) s += b < 128 ? String.fromCharCode(b) : CP437[b - 128];
  return s;
}

async function slice(blob, a, b) {
  return new Uint8Array(await blob.slice(a, b).arrayBuffer());
}

async function centralDirectory(blob) {
  const size = blob.size;
  const tailStart = Math.max(0, size - 65557);
  const tail = await slice(blob, tailStart, size);
  const tv = new DataView(tail.buffer);
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw invalid();
  let count = tv.getUint16(e + 10, true), cdSize = tv.getUint32(e + 12, true), off = tv.getUint32(e + 16, true);
  if (off === 0xffffffff || count === 0xffff || cdSize === 0xffffffff) {
    const loc = e - 20;
    if (loc < 0 || tv.getUint32(loc, true) !== 0x07064b50) throw invalid();
    const z = Number(tv.getBigUint64(loc + 8, true));
    const zb = await slice(blob, z, z + 56);
    if (zb.length < 56) throw invalid();
    const zv = new DataView(zb.buffer);
    if (zv.getUint32(0, true) !== 0x06064b50) throw invalid();
    count = Number(zv.getBigUint64(32, true));
    cdSize = Number(zv.getBigUint64(40, true));
    off = Number(zv.getBigUint64(48, true));
  }
  if (off + cdSize > size) throw invalid();
  return { cd: await slice(blob, off, off + cdSize), count };
}

function parseEntries(cd, count) {
  const dv = new DataView(cd.buffer);
  const entries = [];
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cd.length; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true);
    let csize = dv.getUint32(p + 20, true), size = dv.getUint32(p + 24, true), lo = dv.getUint32(p + 42, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    if (p + 46 + nlen + elen > cd.length) break;
    let name = decodeName(cd.subarray(p + 46, p + 46 + nlen), flags & 0x800);
    let q = p + 46 + nlen;
    const qEnd = q + elen;
    while (q + 4 <= qEnd) {
      const id = dv.getUint16(q, true), len = dv.getUint16(q + 2, true), body = q + 4;
      if (body + len > qEnd) break;
      if (id === 1) {
        let r = body;
        const take = () => { const v = r + 8 <= body + len ? Number(dv.getBigUint64(r, true)) : null; r += 8; return v; };
        if (size === 0xffffffff) size = take() ?? size;
        if (csize === 0xffffffff) csize = take() ?? csize;
        if (lo === 0xffffffff) lo = take() ?? lo;
      } else if (id === 0x7075 && len > 5) {
        name = UTF8.decode(cd.subarray(body + 5, body + len));
      }
      q = body + len;
    }
    p = qEnd + clen;
    name = name.replace(/\\/g, '/').replace(/^(?:\.\/|\/)+/, '');
    if (name && !name.endsWith('/')) entries.push({ name, method, csize, size, lo, encrypted: flags & 1 });
  }
  return entries;
}

export async function readZip(blob, choose, progress, signal) {
  if (typeof DecompressionStream === 'undefined') throw new Error("This browser can't open .zip files. Open the folder instead, or update the browser.");
  const { cd, count } = await centralDirectory(blob);
  const entries = parseEntries(cd, count);
  const first = entries.length ? entries[0].name.split('/')[0] + '/' : '';
  const strip = first.length > 1 && entries.every(x => x.name.startsWith(first)) ? first.length : 0;
  const list = entries.filter(x => x.name.length > strip).map(x => ({ path: x.name.slice(strip), size: x.size, x }));
  const { items, skipped } = choose(list);
  const files = [];
  let done = 0, bad = 0, next = 0;
  const work = async () => {
    while (next < items.length) {
      if (signal?.aborted) throw aborted();
      const it = items[next++], x = it.x;
      try {
        if (x.encrypted || (x.method !== 0 && x.method !== 8)) throw 0;
        const h = await slice(blob, x.lo, x.lo + 30);
        const hv = new DataView(h.buffer);
        if (h.length < 30 || hv.getUint32(0, true) !== 0x04034b50) throw 0;
        const start = x.lo + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
        const part = blob.slice(start, start + x.csize);
        const data = x.method === 0
          ? new Uint8Array(await part.arrayBuffer())
          : new Uint8Array(await new Response(part.stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
        const text = UTF8.decode(data);
        if (text.slice(0, 4000).includes('\u0000')) throw 0;
        files.push({ path: it.path, text });
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        bad++;
      }
      if (++done % 25 === 0) progress?.({ phase: 'Unzipping', done, total: items.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, items.length) }, work));
  return { files, root: strip ? first.slice(0, -1) : '', skipped, failed: bad };
}
