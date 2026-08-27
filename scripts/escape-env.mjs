#!/usr/bin/env node
/**
 * Re-escape the password digest in .env.local after a Vercel env pull.
 *
 * The digest is `scrypt$N$r$p$salt$key`. A .env file expands `$NAME` as a
 * variable reference, inside double quotes as well as bare, so an unescaped
 * digest reaches the app with its separators eaten and the gate refuses every
 * request. The Vercel dashboard does no expansion, so the value stored there is
 * correct and must stay unescaped - only the local file needs this.
 *
 * `vercel env pull` rewrites .env.local wholesale and undoes the escaping every
 * time, which is why this is a script rather than a one-off fix. Run it after
 * any pull, or via `npm run env:fix`.
 *
 * Idempotent. Never prints the value.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const PATH = '.env.local';
const VAR = 'FAMILY_PASSWORD_HASH';

const lines = readFileSync(PATH, 'utf8').split('\n');
let touched = 0;

const out = lines.map((line) => {
  if (!line.startsWith(`${VAR}=`)) return line;

  let value = line.slice(VAR.length + 1);

  // Strip surrounding quotes if the pull added them. They do not prevent
  // expansion, so they buy nothing and complicate the escaping.
  const quoted = value.length >= 2 && value[0] === value.at(-1) && (value[0] === '"' || value[0] === "'");
  if (quoted) value = value.slice(1, -1);

  if (value.includes('\\$')) return `${VAR}=${value}`; // already escaped
  touched = (value.match(/\$/g) ?? []).length;
  return `${VAR}=${value.replace(/\$/g, '\\$')}`;
});

writeFileSync(PATH, out.join('\n'));
console.log(
  touched === 0
    ? `${VAR} already escaped, nothing to do.`
    : `Escaped ${touched} "$" separators in ${VAR}.`,
);
