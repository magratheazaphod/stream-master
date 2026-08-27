import { describe, expect, it } from 'vitest';
import {
  PASSWORD_HASH_VAR,
  SESSION_SECRET_VAR,
  configErrorMessage,
  configProblems,
  isConfigured,
} from './config';

/** A secret long enough to pass, so each test varies one thing at a time. */
const SECRET = 'x'.repeat(43);
const HASH = 'scrypt$16384$8$1$c2FsdA==$a2V5';

describe('configProblems', () => {
  it('accepts a complete environment', () => {
    const env = { [PASSWORD_HASH_VAR]: HASH, [SESSION_SECRET_VAR]: SECRET };
    expect(configProblems(env)).toEqual([]);
    expect(isConfigured(env)).toBe(true);
  });

  // The whole point of the module. An empty environment must never look like
  // a configured one, and there is no default anywhere to fall back to.
  it('refuses an empty environment', () => {
    const problems = configProblems({});
    expect(problems).toHaveLength(2);
    expect(problems.map((p) => p.variable)).toEqual([PASSWORD_HASH_VAR, SESSION_SECRET_VAR]);
    expect(isConfigured({})).toBe(false);
  });

  it('treats an empty string and whitespace as missing', () => {
    expect(isConfigured({ [PASSWORD_HASH_VAR]: '', [SESSION_SECRET_VAR]: SECRET })).toBe(false);
    expect(isConfigured({ [PASSWORD_HASH_VAR]: '   ', [SESSION_SECRET_VAR]: SECRET })).toBe(false);
  });

  // Somebody pasting the plaintext password into the hash variable is the
  // likeliest operator mistake, and it must fail loudly rather than lock
  // everybody out with no explanation.
  it('rejects a hash that is not in this app format', () => {
    const problems = configProblems({
      [PASSWORD_HASH_VAR]: 'correct-horse-battery-staple',
      [SESSION_SECRET_VAR]: SECRET,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].variable).toBe(PASSWORD_HASH_VAR);
  });

  it('rejects a session secret under 32 characters', () => {
    const problems = configProblems({ [PASSWORD_HASH_VAR]: HASH, [SESSION_SECRET_VAR]: 'short' });
    expect(problems).toHaveLength(1);
    expect(problems[0].variable).toBe(SESSION_SECRET_VAR);
  });
});

describe('configErrorMessage', () => {
  it('names every missing variable and leaks no value', () => {
    const message = configErrorMessage(configProblems({}));
    expect(message).toContain(PASSWORD_HASH_VAR);
    expect(message).toContain(SESSION_SECRET_VAR);
    expect(message).toContain('refuses every request');
  });

  it('never echoes a configured value back', () => {
    const message = configErrorMessage(
      configProblems({ [PASSWORD_HASH_VAR]: 'plaintext-oops', [SESSION_SECRET_VAR]: SECRET }),
    );
    expect(message).not.toContain('plaintext-oops');
  });
});
