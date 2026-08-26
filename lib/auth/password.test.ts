import { timingSafeEqual } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashPassword, parseHash, verifyPassword } from './password';

describe('hashPassword', () => {
  it('produces the documented format and never the password', async () => {
    const stored = await hashPassword('four unrelated words');
    const parts = stored.split('$');
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe('scrypt');
    expect(stored).not.toContain('four unrelated words');
  });

  it('salts, so the same password hashes differently every time', async () => {
    const a = await hashPassword('same password');
    const b = await hashPassword('same password');
    expect(a).not.toBe(b);
    await expect(verifyPassword('same password', a)).resolves.toBe(true);
    await expect(verifyPassword('same password', b)).resolves.toBe(true);
  });
});

describe('verifyPassword', () => {
  it('accepts the right password', async () => {
    const stored = await hashPassword('open sesame please');
    await expect(verifyPassword('open sesame please', stored)).resolves.toBe(true);
  });

  it('rejects the wrong password, including a near miss', async () => {
    const stored = await hashPassword('open sesame please');
    await expect(verifyPassword('open sesame pleas', stored)).resolves.toBe(false);
    await expect(verifyPassword('Open sesame please', stored)).resolves.toBe(false);
    await expect(verifyPassword('', stored)).resolves.toBe(false);
  });

  // Every malformed hash returns false rather than throwing. A 500 on the
  // sign-in route would tell an attacker the environment is broken; a "no"
  // tells them nothing.
  it('returns false for a malformed hash rather than throwing', async () => {
    for (const bad of [
      '',
      'plaintext',
      'scrypt$16384$8$1$onlyfourparts',
      'bcrypt$16384$8$1$c2FsdA==$a2V5',
      'scrypt$notanumber$8$1$c2FsdA==$a2V5',
      'scrypt$16384$8$1$$a2V5',
    ]) {
      await expect(verifyPassword('anything', bad)).resolves.toBe(false);
    }
  });

  it('rejects a digest of a different password', async () => {
    const stored = await hashPassword('the real one');
    const other = await hashPassword('the other one');
    await expect(verifyPassword('the real one', other)).resolves.toBe(false);
    await expect(verifyPassword('the other one', stored)).resolves.toBe(false);
  });

  // The guard in verifyPassword rests on this: node:crypto throws rather than
  // returning false when the two buffers differ in length.
  it('rests on timingSafeEqual throwing for unequal lengths', () => {
    expect(() => timingSafeEqual(Buffer.alloc(8), Buffer.alloc(32))).toThrow();
  });
});

describe('parseHash', () => {
  it('round-trips the parameters it was given', async () => {
    const parsed = parseHash(await hashPassword('parameters travel'));
    expect(parsed).not.toBeNull();
    expect(parsed!.N).toBe(16384);
    expect(parsed!.r).toBe(8);
    expect(parsed!.p).toBe(1);
    expect(parsed!.salt).toHaveLength(16);
    expect(parsed!.key).toHaveLength(32);
  });
});
