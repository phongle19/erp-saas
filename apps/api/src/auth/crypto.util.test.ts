import { describe, it, expect } from 'vitest';
import { encryptField, decryptField } from './crypto.util.js';

describe('field encryption', () => {
  it('round-trips a sensitive value', () => {
    const key = Buffer.alloc(32, 7);
    const ct = encryptField('123456789', key);
    expect(ct).not.toContain('123456789');
    expect(decryptField(ct, key)).toBe('123456789');
  });
  it('fails to decrypt with the wrong key', () => {
    const ct = encryptField('secret', Buffer.alloc(32, 1));
    expect(() => decryptField(ct, Buffer.alloc(32, 2))).toThrow();
  });
});
