/**
 * Raw multipart uploads with full control over the headers and the body (tests for 411/413, lying about the size,
 * killed connections, slow uploads). Uses node:http so nothing is buffered by a client library.
 */
import http from 'node:http';
import { Readable } from 'node:stream';
import { ENV } from './env';

export interface UploadOptions {
  token?: string;
  fileName: string;
  /** file content (Buffer) or a function producing a stream of `size` bytes */
  content: Buffer | { size: number; chunk?: number; byte?: number; head?: Buffer };
  fields?: Record<string, string>;
  /** value of X-File-Size; null = header not sent; undefined = real size */
  declaredSize?: number | null;
  /** 'auto' = exact Content-Length; 'none' = chunked transfer (no Content-Length) */
  contentLength?: 'auto' | 'none';
  /** destroy the socket after this many body bytes were written */
  killAfterBytes?: number;
  /** pause this many ms between 64 KiB chunks (slow connection) */
  throttleMs?: number;
  onProgress?: (sent: number, total: number) => void;
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
}

export interface UploadResult {
  status: number;
  body: any;
  data: any;
  ms: number;
  sentBytes: number;
  error?: string;
}

function* generated(size: number, chunk: number, byte: number, head?: Buffer) {
  let left = size;
  if (head) {
    yield head;
    left -= head.length;
  }
  const block = Buffer.alloc(chunk, byte);
  while (left > 0) {
    const n = Math.min(chunk, left);
    yield n === chunk ? block : block.subarray(0, n);
    left -= n;
  }
}

export function upload(path: string, opts: UploadOptions): Promise<UploadResult> {
  const boundary = `----e2eassets${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(opts.fields || {})) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  const fileHead = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${opts.fileName.replace(/"/g, '%22')}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const fileSize = Buffer.isBuffer(opts.content) ? opts.content.length : opts.content.size;
  const preamble = Buffer.concat([...parts, fileHead]);
  const total = preamble.length + fileSize + tail.length;
  const url = new URL(`${ENV.API}${path}`);
  const headers: Record<string, string | number> = { 'content-type': `multipart/form-data; boundary=${boundary}`, accept: 'application/json', ...(opts.extraHeaders || {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.declaredSize !== null) headers['x-file-size'] = String(opts.declaredSize ?? fileSize);
  if ((opts.contentLength || 'auto') === 'auto') headers['content-length'] = total;
  else headers['transfer-encoding'] = 'chunked';

  return new Promise((resolve) => {
    const t0 = performance.now();
    let sent = 0;
    let settled = false;
    const finish = (r: Omit<UploadResult, 'ms' | 'sentBytes'>) => {
      if (settled) return;
      settled = true;
      resolve({ ...r, ms: performance.now() - t0, sentBytes: sent });
    };
    const req = http.request({ method: 'POST', hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (text += d));
      res.on('end', () => {
        let json: any = text;
        try {
          json = text ? JSON.parse(text) : undefined;
        } catch {
          /* raw */
        }
        finish({ status: res.statusCode || 0, body: json, data: json?.data });
      });
    });
    req.setTimeout(opts.timeoutMs ?? 300_000, () => req.destroy(new Error('client timeout')));
    req.on('error', (e) => finish({ status: 0, body: undefined, data: undefined, error: e.message }));

    const body = Readable.from(
      (function* () {
        yield preamble;
        if (Buffer.isBuffer(opts.content)) {
          for (let i = 0; i < opts.content.length; i += 65536) yield opts.content.subarray(i, i + 65536);
        } else yield* generated(opts.content.size, opts.content.chunk ?? 65536, opts.content.byte ?? 0x41, opts.content.head);
        yield tail;
      })(),
    );
    (async () => {
      for await (const chunk of body) {
        if (opts.killAfterBytes !== undefined && sent + chunk.length > opts.killAfterBytes) {
          const n = Math.max(0, opts.killAfterBytes - sent);
          if (n) req.write(chunk.subarray(0, n));
          sent += n;
          await new Promise((r) => setTimeout(r, 300));
          req.destroy(new Error('connection killed by test'));
          return;
        }
        const ok = req.write(chunk);
        sent += chunk.length;
        opts.onProgress?.(sent, total);
        if (!ok) await new Promise((r) => req.once('drain', r));
        if (opts.throttleMs) await new Promise((r) => setTimeout(r, opts.throttleMs));
        if (settled) return; // server already answered (early rejection)
      }
      req.end();
    })().catch((e) => finish({ status: 0, body: undefined, data: undefined, error: String(e?.message || e) }));
  });
}

/** A valid PNG of roughly the requested size (random pixels compress badly, so size ≈ w*h*3). */
export async function makePng(width: number, height: number, seed = 1): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const raw = Buffer.alloc(width * height * 3);
  let x = seed * 2654435761;
  for (let i = 0; i < raw.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    raw[i] = x & 0xff;
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
}

/** Plain text file of exactly `size` bytes. */
export function makeText(size: number, label = 'e2e'): Buffer {
  const line = Buffer.from(`${label} line of text, 0123456789 abcdefghijklmnopqrstuvwxyz\n`);
  const out = Buffer.alloc(size);
  for (let i = 0; i < size; i += line.length) line.copy(out, i, 0, Math.min(line.length, size - i));
  return out;
}
