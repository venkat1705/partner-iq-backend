/**
 * Streaming ZIP writer for bundle downloads. Each entry's object is streamed from storage straight into the response;
 * nothing is buffered beyond the current chunk. Entries are STORED (no compression — marketing files are already
 * compressed images/videos/PDFs), sizes and CRC-32 are written in data descriptors after each file.
 * Limits: no ZIP64 — the archive must stay below 4 GiB (organizations are limited to 3 GB by default).
 */
import { PassThrough, Readable } from 'stream';
import { crc32 } from 'zlib';
import type { StorageContext, StorageService } from './storage.service';

export interface ZipEntry {
  /** Name inside the archive (sanitized here). */
  name: string;
  key: string;
}

const MAX_ZIP32 = 0xffffffff;

/** Safe name inside a ZIP: no directories, no "..", no control characters, unique within the archive. */
export function safeZipNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((raw) => {
    let name = (raw || 'file').normalize('NFC').split(/[\\/]/).pop() || 'file';
    name = name.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').replace(/^\.+/, '').trim() || 'file';
    if (name.length > 180) {
      const dot = name.lastIndexOf('.');
      const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : '';
      name = name.slice(0, 180 - ext.length) + ext;
    }
    const lower = name.toLowerCase();
    const n = seen.get(lower) || 0;
    seen.set(lower, n + 1);
    if (n === 0) return name;
    const dot = name.lastIndexOf('.');
    return dot > 0 ? `${name.slice(0, dot)} (${n + 1})${name.slice(dot)}` : `${name} (${n + 1})`;
  });
}

function dosDateTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export function createZipStream(entries: ZipEntry[], storage: StorageService, ctx: StorageContext): Readable {
  const out = new PassThrough();
  const names = safeZipNames(entries.map((e) => e.name));
  const central: Buffer[] = [];
  let offset = 0;
  const { time, date } = dosDateTime(new Date());

  const write = (buf: Buffer) =>
    new Promise<void>((resolve, reject) => {
      offset += buf.length;
      if (out.destroyed) return reject(new Error('client closed the download'));
      if (out.write(buf)) resolve();
      else out.once('drain', resolve);
    });

  (async () => {
    for (let i = 0; i < entries.length; i++) {
      const nameBuf = Buffer.from(names[i], 'utf8');
      const headerOffset = offset;
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4); // version needed
      local.writeUInt16LE(0x0808, 6); // bit 3 data descriptor + bit 11 UTF-8 names
      local.writeUInt16LE(0, 8); // stored
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(date, 12);
      local.writeUInt32LE(0, 14); // crc in descriptor
      local.writeUInt32LE(0, 18);
      local.writeUInt32LE(0, 22);
      local.writeUInt16LE(nameBuf.length, 26);
      local.writeUInt16LE(0, 28);
      await write(local);
      await write(nameBuf);

      let crc = 0;
      let size = 0;
      const body = await storage.getObjectStream(entries[i].key, ctx);
      for await (const chunk of body as AsyncIterable<Buffer>) {
        crc = crc32(chunk, crc);
        size += chunk.length;
        await write(chunk);
      }
      if (offset > MAX_ZIP32) throw new Error('bundle is larger than 4 GiB; ZIP64 is not supported');

      const desc = Buffer.alloc(16);
      desc.writeUInt32LE(0x08074b50, 0);
      desc.writeUInt32LE(crc >>> 0, 4);
      desc.writeUInt32LE(size, 8);
      desc.writeUInt32LE(size, 12);
      await write(desc);

      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0);
      cd.writeUInt16LE(20, 4);
      cd.writeUInt16LE(20, 6);
      cd.writeUInt16LE(0x0808, 8);
      cd.writeUInt16LE(0, 10);
      cd.writeUInt16LE(time, 12);
      cd.writeUInt16LE(date, 14);
      cd.writeUInt32LE(crc >>> 0, 16);
      cd.writeUInt32LE(size, 20);
      cd.writeUInt32LE(size, 24);
      cd.writeUInt16LE(nameBuf.length, 28);
      cd.writeUInt16LE(0, 30);
      cd.writeUInt16LE(0, 32);
      cd.writeUInt16LE(0, 34);
      cd.writeUInt16LE(0, 36);
      cd.writeUInt32LE(0, 38);
      cd.writeUInt32LE(headerOffset, 42);
      central.push(cd, nameBuf);
    }
    const cdStart = offset;
    for (const part of central) await write(part);
    const cdSize = offset - cdStart;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(cdSize, 12);
    end.writeUInt32LE(cdStart, 16);
    await write(end);
    out.end();
  })().catch((err) => out.destroy(err));

  return out;
}
