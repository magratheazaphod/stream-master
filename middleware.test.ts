import { describe, expect, it } from 'vitest';
import { config, isPublic } from './middleware';

/**
 * A tripwire, not a unit test.
 *
 * Next 15.5.22 accepts `runtime: 'nodejs'` on a middleware config, compiles
 * without a warning and then emits an empty middleware-manifest. The app builds,
 * deploys, serves every page and has no gate on it. That is the single worst
 * outcome this work can produce, and it is invisible in the build log, so it
 * gets an assertion instead of a comment.
 *
 * Delete this test the day the middleware manifest is verified to carry a Node
 * entry on the Next version in package.json, and not before.
 */
describe('the middleware config', () => {
  it('sets no runtime, because setting one silently removes the gate', () => {
    expect((config as { runtime?: string }).runtime).toBeUndefined();
  });

  it('matches everything but Next static output', () => {
    expect(config.matcher).toEqual(['/((?!_next/static|_next/image|favicon.ico).*)']);
  });
});

/**
 * What may be read without signing in.
 *
 * The list grew to let a phone install the app: the manifest fetch carries no
 * credentials, so behind the gate it redirected and the home screen drew a
 * letter tile instead of the owl. Widening an auth gate to fix an icon is
 * exactly the change that quietly lets something else through, so the whole
 * allowance is asserted rather than described.
 */
describe('what is reachable without a session', () => {
  it('lets a phone read the install identity', () => {
    expect(isPublic('/manifest.webmanifest')).toBe(true);
    expect(isPublic('/icon.svg')).toBe(true);
    expect(isPublic('/apple-icon.png')).toBe(true);
    expect(isPublic('/icons/icon-192.png')).toBe(true);
    expect(isPublic('/icons/icon-maskable-512.png')).toBe(true);
  });

  it('still keeps every page and every data route behind the gate', () => {
    for (const path of [
      '/',
      '/api/subscriptions',
      '/api/catalog',
      '/api/lookup',
      '/api/lookup/suggest',
      '/api/person',
    ]) {
      expect(isPublic(path)).toBe(false);
    }
  });

  // The prefix is a directory, not a stem. `/icons-of-real-spend` must not slip
  // through on a startsWith that forgot its trailing slash.
  it('treats the icon allowance as a directory and nothing wider', () => {
    expect(isPublic('/icons')).toBe(false);
    expect(isPublic('/iconsomething')).toBe(false);
    expect(isPublic('/manifest.webmanifest.json')).toBe(false);
  });
});
