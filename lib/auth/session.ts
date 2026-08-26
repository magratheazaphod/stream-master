/**
 * The session cookie: what it says, how it is signed and how it is checked.
 *
 * Signing uses Web Crypto, which has been global in Node since 18 and is the
 * same API in every runtime this could ever be asked to run in. One
 * implementation of the token format, no runtime-specific branch. `node:crypto`
 * would work equally well now that middleware runs on Node; it would just be a
 * second way to do the identical thing.
 *
 * The token carries an expiry and nothing else. There are no accounts, so there
 * is no identity to put in it, and a cookie that names nobody is a cookie that
 * leaks nothing if it is read off a shared laptop.
 */

const TOKEN_VERSION = 'v1';

export interface SessionPayload {
  /** Unix seconds. The cookie's own Max-Age is a hint; this is the authority. */
  exp: number;
  /** Unix seconds the session was issued. Kept for debugging, never trusted. */
  iat: number;
}

function b64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/**
 * Compare two byte strings without letting the clock say where they diverged.
 *
 * The length is compared with the same accumulator as the bytes, so a wrong
 * length costs the same as a wrong byte. `node:crypto`'s `timingSafeEqual`
 * refuses unequal lengths outright, which makes it the wrong shape for two
 * base64 strings that may legitimately differ in length; this accepts them and
 * still gives away nothing.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i += 1) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

/** Mint a signed token good for `maxAgeSeconds` from `now`. */
export async function signSession(
  secret: string,
  maxAgeSeconds: number,
  now: Date = new Date(),
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  const payload: SessionPayload = { iat, exp: iat + maxAgeSeconds };
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const message = `${TOKEN_VERSION}.${body}`;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(message));
  return `${message}.${b64urlEncode(new Uint8Array(sig))}`;
}

/**
 * Verify a token. Returns the payload, or null for anything at all wrong:
 * a bad shape, a bad signature, an expired session, a token signed with a
 * secret that has since been rotated. One return value for every failure,
 * because the caller has one response to all of them.
 */
export async function verifySession(
  secret: string,
  token: string | undefined,
  now: Date = new Date(),
): Promise<SessionPayload | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [version, body, sig] = parts;
  if (version !== TOKEN_VERSION) return null;

  let expected: string;
  try {
    const raw = await crypto.subtle.sign(
      'HMAC',
      await hmacKey(secret),
      new TextEncoder().encode(`${version}.${body}`),
    );
    expected = b64urlEncode(new Uint8Array(raw));
  } catch {
    return null;
  }
  if (!timingSafeEqualString(sig, expected)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload?.exp !== 'number') return null;
  if (payload.exp <= Math.floor(now.getTime() / 1000)) return null;
  return payload;
}
