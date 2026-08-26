import { describe, expect, it } from 'vitest';
import { EPHEMERAL_WRITE_MESSAGE, isEphemeralFilesystem } from './deployment';

describe('isEphemeralFilesystem', () => {
  it('is true on Vercel, where the bundle is read-only', () => {
    expect(isEphemeralFilesystem({ VERCEL: '1' })).toBe(true);
  });

  it('is false on a laptop, where data/ is a real directory', () => {
    expect(isEphemeralFilesystem({})).toBe(false);
    expect(isEphemeralFilesystem({ VERCEL: '0' })).toBe(false);
  });
});

describe('EPHEMERAL_WRITE_MESSAGE', () => {
  // The failure this whole module exists to prevent is a button that quietly
  // does nothing. The message has to say nothing happened, in those words.
  it('states that nothing was recorded and nothing was queued', () => {
    expect(EPHEMERAL_WRITE_MESSAGE).toContain('Nothing was recorded');
    expect(EPHEMERAL_WRITE_MESSAGE).toContain('nothing was queued');
  });
});
