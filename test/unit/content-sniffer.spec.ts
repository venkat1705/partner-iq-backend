import { ALLOWED_FILE_TYPES, FileTypeId, sniffFileType } from '../../src/common/storage/content-sniffer';

const ALL = Object.keys(ALLOWED_FILE_TYPES) as FileTypeId[];
const zipWith = (firstEntry: string) => {
  const name = Buffer.from(firstEntry);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(name.length, 26);
  return Buffer.concat([local, name, Buffer.from('payload')]);
};

describe('sniffFileType — Office Open XML', () => {
  it('accepts a .docx / .pptx whose ZIP has the [Content_Types].xml part', () => {
    expect(sniffFileType(zipWith('[Content_Types].xml'), 'a.docx', ALL, true)).toMatchObject({ ok: true, type: 'docx' });
    expect(sniffFileType(zipWith('[Content_Types].xml'), 'a.pptx', ALL, true)).toMatchObject({ ok: true, type: 'pptx' });
  });

  it('refuses any other ZIP renamed to .docx / .pptx (e.g. an archive carrying an .exe)', () => {
    expect(sniffFileType(zipWith('payload.exe'), 'report.docx', ALL, true)).toMatchObject({ ok: false });
    expect(sniffFileType(zipWith('a.txt'), 'deck.pptx', ALL, true)).toMatchObject({ ok: false });
  });
});

describe('sniffFileType — basics', () => {
  it('refuses executables and markup whatever the extension', () => {
    expect(sniffFileType(Buffer.from('MZ\x90\x00'), 'a.pdf', ALL, true).ok).toBe(false);
    expect(sniffFileType(Buffer.from('<svg onload=alert(1)>'), 'a.txt', ALL, true).ok).toBe(false);
  });
  it('requires the content to match the extension', () => {
    expect(sniffFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'a.jpg', ALL, true).ok).toBe(false);
    expect(sniffFileType(Buffer.from('%PDF-1.7'), 'a.pdf', ALL, true)).toMatchObject({ ok: true, type: 'pdf' });
  });
});
