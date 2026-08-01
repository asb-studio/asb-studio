/* ==========================================================================
   export/zip.js
   --------------------------------------------------------------------------
   A minimal ZIP writer, written here rather than pulled in as a dependency.

   An EPUB is a ZIP with one very specific rule: the first entry must be a
   file called "mimetype", stored uncompressed, with no extra field. General
   purpose ZIP libraries make that awkward and cost a hundred kilobytes to do
   it. Writing the format directly is about a page of code and gives exact
   control over that first entry.

   Compression uses the browser's own CompressionStream where it exists and
   falls back to storing the bytes as they are. A stored EPUB is a larger
   file, never an invalid one.

   This module must never touch the DOM.
   ========================================================================== */

/* --------------------------------------------------------------------------
   CRC-32, the checksum every ZIP entry carries
   -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* --------------------------------------------------------------------------
   Byte helpers
   -------------------------------------------------------------------------- */

const encoder = new TextEncoder();

function bytesOf(data) {
  return typeof data === 'string' ? encoder.encode(data) : new Uint8Array(data);
}

/** DOS time and date, as the format has required since 1989. */
function dosStamp(date = new Date()) {
  const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) |
               (Math.floor(date.getSeconds() / 2) & 31);
  const day = (((date.getFullYear() - 1980) & 127) << 9) |
              (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
  return { time, day };
}

async function deflate(bytes) {
  if (typeof CompressionStream !== 'function') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;   // storing is always valid
  }
}

/* --------------------------------------------------------------------------
   Writer
   -------------------------------------------------------------------------- */

class ByteWriter {
  constructor() { this.chunks = []; this.length = 0; }

  push(bytes) { this.chunks.push(bytes); this.length += bytes.length; }

  u16(value) { this.push(new Uint8Array([value & 0xff, (value >>> 8) & 0xff])); }

  u32(value) {
    this.push(new Uint8Array([
      value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff,
    ]));
  }

  toBlob(type) { return new Blob(this.chunks, { type }); }
}

/**
 * Builds a ZIP archive.
 *
 * @param {Array<{name: string, data: string|Uint8Array, store?: boolean}>} entries
 *   Written in the order given. `store` forces no compression, which the
 *   EPUB mimetype entry requires.
 * @param {string} mimeType  the type of the resulting Blob
 * @returns {Promise<Blob>}
 */
export async function makeZip(entries, mimeType = 'application/zip') {
  const out = new ByteWriter();
  const central = [];
  const { time, day } = dosStamp();

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const raw = bytesOf(entry.data);
    const crc = crc32(raw);

    let method = 0;
    let payload = raw;

    if (!entry.store) {
      const packed = await deflate(raw);
      if (packed && packed.length < raw.length) { method = 8; payload = packed; }
    }

    const offset = out.length;

    /* --- local file header --- */
    out.u32(0x04034b50);
    out.u16(20); out.u16(0); out.u16(method);
    out.u16(time); out.u16(day);
    out.u32(crc); out.u32(payload.length); out.u32(raw.length);
    out.u16(name.length); out.u16(0);
    out.push(name);
    out.push(payload);

    central.push({ name, crc, method, comp: payload.length, size: raw.length, offset });
  }

  /* --- central directory --- */
  const directoryStart = out.length;

  for (const item of central) {
    out.u32(0x02014b50);
    out.u16(20); out.u16(20); out.u16(0); out.u16(item.method);
    out.u16(time); out.u16(day);
    out.u32(item.crc); out.u32(item.comp); out.u32(item.size);
    out.u16(item.name.length); out.u16(0); out.u16(0);
    out.u16(0); out.u16(0); out.u32(0);
    out.u32(item.offset);
    out.push(item.name);
  }

  const directorySize = out.length - directoryStart;

  /* --- end of central directory --- */
  out.u32(0x06054b50);
  out.u16(0); out.u16(0);
  out.u16(central.length); out.u16(central.length);
  out.u32(directorySize); out.u32(directoryStart);
  out.u16(0);

  return out.toBlob(mimeType);
}
