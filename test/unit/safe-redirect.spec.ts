import { describe, it, expect } from '@jest/globals';
import { safeReturnPath, isSafeReturnPath } from '../../src/common/utils/safe-redirect.utils';

describe('safe-redirect.utils', () => {
  describe('accepted paths', () => {
    it('accepts plain path', () => {
      expect(safeReturnPath('/dashboard', '/fallback')).toBe('/dashboard');
    });

    it('accepts nested path', () => {
      expect(safeReturnPath('/organizations/org_1/integrations', '/fallback')).toBe('/organizations/org_1/integrations');
    });

    it('accepts path with query', () => {
      expect(safeReturnPath('/settings?tab=billing', '/fallback')).toBe('/settings?tab=billing');
    });

    it('accepts path with hash', () => {
      expect(safeReturnPath('/settings#security', '/fallback')).toBe('/settings#security');
    });

    it('trims surrounding whitespace', () => {
      expect(safeReturnPath('  /dashboard  ', '/fallback')).toBe('/dashboard');
    });
  });

  describe('bypasses that motivated this', () => {
    it('rejects protocol-relative //host', () => {
      expect(safeReturnPath('//attacker.test', '/fallback')).toBe('/fallback');
    });

    it('rejects //host with path', () => {
      expect(safeReturnPath('//attacker.test/steal', '/fallback')).toBe('/fallback');
    });

    it('rejects backslash protocol-relative \\\\host', () => {
      expect(safeReturnPath('\\\\attacker.test', '/fallback')).toBe('/fallback');
    });

    it('rejects mixed slash /\\host', () => {
      expect(safeReturnPath('/\\attacker.test', '/fallback')).toBe('/fallback');
    });

    it('rejects mixed slash \\/host', () => {
      expect(safeReturnPath('\\/attacker.test', '/fallback')).toBe('/fallback');
    });
  });

  describe('absolute URLs', () => {
    it('rejects http URL', () => {
      expect(safeReturnPath('http://attacker.test/phish', '/fallback')).toBe('/fallback');
    });

    it('rejects https URL', () => {
      expect(safeReturnPath('https://attacker.test/phish', '/fallback')).toBe('/fallback');
    });

    it('rejects javascript: scheme', () => {
      expect(safeReturnPath('javascript:alert(1)', '/fallback')).toBe('/fallback');
    });

    it('rejects data: scheme', () => {
      expect(safeReturnPath('data:text/html,<script>alert(1)</script>', '/fallback')).toBe('/fallback');
    });
  });

  describe('edge cases', () => {
    it('rejects relative path without leading slash', () => {
      expect(safeReturnPath('dashboard', '/fallback')).toBe('/fallback');
    });

    it('rejects dot-relative path', () => {
      expect(safeReturnPath('./dashboard', '/fallback')).toBe('/fallback');
    });

    it('rejects parent-relative path', () => {
      expect(safeReturnPath('../dashboard', '/fallback')).toBe('/fallback');
    });

    it('rejects empty string', () => {
      expect(safeReturnPath('', '/fallback')).toBe('/fallback');
    });

    it('rejects whitespace-only string', () => {
      expect(safeReturnPath('   ', '/fallback')).toBe('/fallback');
    });

    it('rejects non-string input (null)', () => {
      expect(safeReturnPath(null as any, '/fallback')).toBe('/fallback');
    });

    it('rejects non-string input (undefined)', () => {
      expect(safeReturnPath(undefined as any, '/fallback')).toBe('/fallback');
    });

    it('falls back to default "/" when fallback is invalid', () => {
      expect(safeReturnPath('http://attacker.test', 'http://also-bad.test')).toBe('/');
    });
  });

  describe('boolean helper isSafeReturnPath', () => {
    it('returns true for valid path', () => {
      expect(isSafeReturnPath('/dashboard')).toBe(true);
    });

    it('returns false for protocol-relative bypass', () => {
      expect(isSafeReturnPath('//attacker.test')).toBe(false);
    });

    it('returns false for external URL', () => {
      expect(isSafeReturnPath('https://attacker.test')).toBe(false);
    });
  });
});

