#!/usr/bin/env node
/**
 * Turn a password into the two values the deployment needs.
 *
 * Reads the password from stdin rather than argv, so it never lands in shell
 * history or in the process list where anybody on the machine can read it.
 *
 *   npm run auth:hash
 *
 * Prints FAMILY_PASSWORD_HASH and a fresh SESSION_SECRET. Paste both into the
 * Vercel dashboard and into .env.local. Neither belongs in a commit.
 */

import { createInterface } from 'node:readline';
import { randomBytes, scrypt as scryptCb } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

const N = 16384;
const R = 8;
const P = 1;

/** Long enough that a wordlist is the wrong attack. Say so, do not assume it. */
const MIN_LENGTH = 12;

/**
 * Ask on a terminal, with the echo suppressed so the password never appears on
 * screen or in a scrollback buffer somebody scrolls up through later.
 */
function askHidden(question) {
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  // readline writes each keystroke back; swallow everything after the prompt.
  const write = rl._writeToOutput.bind(rl);
  rl._writeToOutput = (s) => write(s.startsWith(question) ? question : '');
  return new Promise((resolve) => rl.question(question, (answer) => (rl.close(), resolve(answer))));
}

/** Read a piped password, for the case where a terminal is not available. */
function readPiped() {
  return new Promise((resolve, reject) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (buf += d));
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', reject);
  });
}

/**
 * A non-TTY stdin cannot be prompted. Saying so beats hanging on a promise that
 * will never settle, which is what this did when run from a non-interactive
 * shell.
 */
const password = (
  process.stdin.isTTY ? await askHidden('Family password: ') : await readPiped()
).trim();

if (password === '') {
  console.error(
    '\nNo password was read. This needs a real terminal - run it in Terminal.app, or pipe one in with a leading space so it stays out of your shell history:\n\n   printf %s \'your password\' | npm run auth:hash\n',
  );
  process.exit(1);
}

if (password.length < MIN_LENGTH) {
  console.error(
    `\nThat password is ${password.length} characters. The sign-in rate limit is in-memory and resets on every redeploy, so the password itself is the whole defence. Use at least ${MIN_LENGTH}, and prefer four unrelated words.\n`,
  );
  process.exit(1);
}

const salt = randomBytes(16);
const key = await scrypt(password, salt, 32, { N, r: R, p: P, maxmem: 256 * N * R });
const hash = `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
const secret = randomBytes(32).toString('base64url');

console.log(`\nFAMILY_PASSWORD_HASH=${hash}`);
console.log(`SESSION_SECRET=${secret}`);
console.error(
  '\nSet both in Vercel (Settings -> Environment Variables) and in .env.local. Rotating SESSION_SECRET signs everybody out.',
);
console.error(
  'In .env.local, escape every "$" in the hash as "\\$". A .env file expands "$NAME" as a variable, so an unescaped digest arrives stripped and the app refuses every request. Paste it unescaped into the Vercel dashboard, which does no expansion.\n',
);
