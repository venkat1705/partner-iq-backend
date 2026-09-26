import { describe, it, expect } from '@jest/globals';
import { dbStore } from '../../src/database/store';

describe('Sanity Check', () => {
  it('should run in unit mode and access dbStore in-memory', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(process.env.UNIT_TEST).toBe('true');
    expect(process.env.TEST_MEMORY_ONLY).toBe('true');
    expect(Array.isArray(dbStore.users)).toBe(true);
  });
});

