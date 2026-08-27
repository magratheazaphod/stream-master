import { describe, expect, it } from 'vitest';
import { config } from './middleware';

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
