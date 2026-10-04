import { formatBytesForMessage } from '../../src/modules/storage-quota/storage-quota.service';

// must match the UI (partner-iq-frontend src/lib/format/storage.ts): binary units, one decimal, ".0" dropped
describe('formatBytesForMessage', () => {
  it('shows the 3 GB default as "3 GB" (same as the storage bar)', () => {
    expect(formatBytesForMessage(3221225472)).toBe('3 GB');
    expect(formatBytesForMessage(10 * 1024 * 1024)).toBe('10 MB');
  });
  it('keeps one decimal when needed and whole bytes below 1 KB', () => {
    expect(formatBytesForMessage(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatBytesForMessage(1)).toBe('1 B');
    expect(formatBytesForMessage(0)).toBe('0 B');
  });
});
