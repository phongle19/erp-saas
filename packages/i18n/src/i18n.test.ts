import { describe, it, expect } from 'vitest';
import { messages, defaultLocale } from './index.js';
describe('i18n', () => {
  it('defaults to Vietnamese', () => { expect(defaultLocale).toBe('vi'); });
  it('vi and en share the same top-level keys', () => {
    expect(Object.keys(messages.vi).sort()).toEqual(Object.keys(messages.en).sort());
  });
});
