/**
 * File type detection from the first bytes of a file (magic bytes). The extension and the browser's content type are
 * never trusted: the detected type must be allowed AND match the family of the file name's extension, otherwise the
 * upload is rejected before anything is stored.
 *
 * Script-capable formats (SVG, HTML, XML, JavaScript, executables) are never accepted.
 */

export type FileTypeId =
  | 'jpeg' | 'png' | 'gif' | 'webp'
  | 'mp4' | 'mov' | 'webm'
  | 'pdf' | 'doc' | 'ppt' | 'docx' | 'pptx'
  | 'txt' | 'csv';

export interface FileTypeInfo {
  extensions: string[];
  contentType: string;
  /** Safe to show inline in a browser (only raster images). Everything else is always an attachment. */
  inline: boolean;
  image: boolean;
}

export const ALLOWED_FILE_TYPES: Record<FileTypeId, FileTypeInfo> = {
  jpeg: { extensions: ['jpg', 'jpeg'], contentType: 'image/jpeg', inline: true, image: true },
  png: { extensions: ['png'], contentType: 'image/png', inline: true, image: true },
  gif: { extensions: ['gif'], contentType: 'image/gif', inline: true, image: true },
  webp: { extensions: ['webp'], contentType: 'image/webp', inline: true, image: true },
  mp4: { extensions: ['mp4'], contentType: 'video/mp4', inline: false, image: false },
  mov: { extensions: ['mov'], contentType: 'video/quicktime', inline: false, image: false },
  webm: { extensions: ['webm'], contentType: 'video/webm', inline: false, image: false },
  pdf: { extensions: ['pdf'], contentType: 'application/pdf', inline: false, image: false },
  doc: { extensions: ['doc'], contentType: 'application/msword', inline: false, image: false },
  ppt: { extensions: ['ppt'], contentType: 'application/vnd.ms-powerpoint', inline: false, image: false },
  docx: { extensions: ['docx'], contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', inline: false, image: false },
  pptx: { extensions: ['pptx'], contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', inline: false, image: false },
  txt: { extensions: ['txt'], contentType: 'text/plain; charset=utf-8', inline: false, image: false },
  csv: { extensions: ['csv'], contentType: 'text/csv; charset=utf-8', inline: false, image: false },
};

export const IMAGE_FILE_TYPES: FileTypeId[] = ['jpeg', 'png', 'gif', 'webp'];

/** Bytes needed before a decision can be made. */
export const SNIFF_BYTES = 4100;

export type SniffResult =
  | { ok: true; type: FileTypeId; info: FileTypeInfo }
  | { ok: false; reason: string };

const startsWith = (buf: Buffer, bytes: number[], offset = 0) => bytes.every((b, i) => buf[offset + i] === b);
const ascii = (buf: Buffer, start: number, end: number) => buf.subarray(start, end).toString('latin1');

/** Known dangerous or unsupported signatures, reported by name so the error explains what was found. */
function dangerousSignature(buf: Buffer): string | null {
  if (startsWith(buf, [0x4d, 0x5a])) return 'a Windows executable (MZ)';
  if (startsWith(buf, [0x7f, 0x45, 0x4c, 0x46])) return 'a Linux executable (ELF)';
  if (startsWith(buf, [0xcf, 0xfa, 0xed, 0xfe]) || startsWith(buf, [0xfe, 0xed, 0xfa, 0xcf]) || startsWith(buf, [0xca, 0xfe, 0xba, 0xbe])) return 'a macOS executable (Mach-O)';
  if (startsWith(buf, [0x23, 0x21])) return 'a script (#!)';
  const head = buf.subarray(0, 512).toString('utf8').replace(/^﻿/, '').trimStart().toLowerCase();
  if (/^<(!doctype|html|head|body|script|svg|\?xml|iframe|object|embed|meta|link|style)/.test(head)) return 'HTML/SVG/XML markup';
  return null;
}

function detectBinary(buf: Buffer): FileTypeId | 'zip' | 'ole' | 'isobmff' | null {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (ascii(buf, 0, 6) === 'GIF87a' || ascii(buf, 0, 6) === 'GIF89a') return 'gif';
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return 'webp';
  if (ascii(buf, 4, 8) === 'ftyp') return 'isobmff';
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return 'webm';
  if (ascii(buf, 0, 5) === '%PDF-') return 'pdf';
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole';
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) return 'zip';
  return null;
}

/** Plain text: valid UTF-8 (a cut-off multi-byte character at the end of the window is fine), no NUL bytes, no
 * control characters other than tab/CR/LF/form feed. */
function looksLikeText(buf: Buffer, complete: boolean): boolean {
  if (buf.length === 0) return true;
  for (const b of buf) {
    if (b === 0) return false;
    if (b < 0x20 && ![0x09, 0x0a, 0x0d, 0x0c].includes(b)) return false;
  }
  let end = buf.length;
  if (!complete) {
    // drop a possibly cut multi-byte sequence at the end of the sniff window
    let i = buf.length - 1;
    let back = 0;
    while (i >= 0 && back < 4 && (buf[i] & 0xc0) === 0x80) { i--; back++; }
    if (i >= 0 && buf[i] >= 0xc0) end = i;
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, end));
    return true;
  } catch {
    return false;
  }
}

/** The extension of an original file name, lowercase, without the dot ("" when none). */
export function extensionOf(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() || '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/**
 * Decide the type of a file from its first bytes and its original name.
 * @param head first ≤ SNIFF_BYTES bytes
 * @param complete true when `head` is the whole file
 */
export function sniffFileType(head: Buffer, fileName: string, allowed: FileTypeId[], complete: boolean): SniffResult {
  const ext = extensionOf(fileName);
  if (!ext) return { ok: false, reason: 'The file name has no extension.' };
  const claimed = (Object.keys(ALLOWED_FILE_TYPES) as FileTypeId[]).find((t) => ALLOWED_FILE_TYPES[t].extensions.includes(ext));
  if (!claimed || !allowed.includes(claimed)) {
    return { ok: false, reason: `.${ext} files are not allowed. Allowed: ${allowed.flatMap((t) => ALLOWED_FILE_TYPES[t].extensions).map((e) => '.' + e).join(', ')}.` };
  }
  if (head.length === 0) return { ok: false, reason: 'The file is empty.' };

  const danger = dangerousSignature(head);
  if (danger) return { ok: false, reason: `The file content is ${danger}, not a .${ext} file.` };

  const binary = detectBinary(head);
  let detected: FileTypeId | null = null;
  if (binary === 'isobmff') {
    // ISO base media: QuickTime brand → mov, everything else → mp4; either extension is accepted for either brand
    detected = ['mp4', 'mov'].includes(claimed) ? claimed : (ascii(head, 8, 12) === 'qt  ' ? 'mov' : 'mp4');
  } else if (binary === 'ole') {
    detected = ['doc', 'ppt'].includes(claimed) ? claimed : 'doc';
  } else if (binary === 'zip') {
    detected = ['docx', 'pptx'].includes(claimed) ? claimed : null;
    if (!detected) return { ok: false, reason: `The file content is a ZIP archive, not a .${ext} file.` };
  } else if (binary) {
    detected = binary;
  } else if (['txt', 'csv'].includes(claimed) && looksLikeText(head, complete)) {
    detected = claimed;
  }

  if (!detected) return { ok: false, reason: `The file content does not match a .${ext} file.` };
  if (detected !== claimed) return { ok: false, reason: `The file content is ${ALLOWED_FILE_TYPES[detected].contentType}, not a .${ext} file.` };
  if (!allowed.includes(detected)) return { ok: false, reason: `${ALLOWED_FILE_TYPES[detected].contentType} files are not allowed.` };
  return { ok: true, type: detected, info: ALLOWED_FILE_TYPES[detected] };
}
