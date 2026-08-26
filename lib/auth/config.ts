/**
 * The two secrets the gate runs on, and the refusal when they are absent.
 *
 * There is no default password and no fallback secret anywhere in this repo. A
 * fallback is worse than no gate at all, because a gate that opens for a value
 * printed in a public git history looks locked to the family and is not. So the
 * only thing this module does when the environment is incomplete is say so.
 *
 * Edge-safe. It reads `process.env` and nothing else, so middleware can import
 * it without dragging Node's crypto into the Edge runtime.
 */

/** The scrypt digest of the family password. Never the password itself. */
export const PASSWORD_HASH_VAR = 'FAMILY_PASSWORD_HASH';

/** The HMAC key the session cookie is signed with. Independent of the password. */
export const SESSION_SECRET_VAR = 'SESSION_SECRET';

/** Thirty days. Re-authenticating your mother every week is a product failure. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export const SESSION_COOKIE = 'sm_session';

/** Just enough of an environment to read variables out of. `process.env`
 *  satisfies it, and so does a plain object in a test. */
export type Env = Record<string, string | undefined>;

/** What is wrong with the environment, in the words the operator needs. */
export interface ConfigProblem {
  variable: string;
  message: string;
}

/**
 * Check the environment without revealing it.
 *
 * Returns the list of problems. Empty means the gate can run. Callers treat a
 * non-empty list as "refuse every request", never as "carry on".
 */
export function configProblems(env: Env = process.env): ConfigProblem[] {
  const problems: ConfigProblem[] = [];

  const hash = env[PASSWORD_HASH_VAR];
  if (!hash || hash.trim() === '') {
    problems.push({
      variable: PASSWORD_HASH_VAR,
      message: `${PASSWORD_HASH_VAR} is not set. Generate one with "npm run auth:hash" and set it in the environment.`,
    });
  } else if (hash.startsWith('scrypt') && hash.split('$').length !== 6) {
    // The overwhelmingly likely cause, and worth naming outright rather than
    // making somebody guess. Next expands `$NAME` inside .env files, so the
    // digest's own `$` separators get read as variable references and eaten.
    // The value in the file is right and the value the app receives is not.
    problems.push({
      variable: PASSWORD_HASH_VAR,
      message: `${PASSWORD_HASH_VAR} arrived with its "$" separators stripped. A .env file expands "$NAME" as a variable, so escape each one as "\\$" in .env.local. Dashboard-set variables need no escaping.`,
    });
  } else if (!hash.startsWith('scrypt$')) {
    problems.push({
      variable: PASSWORD_HASH_VAR,
      message: `${PASSWORD_HASH_VAR} is not a hash this app produced. Regenerate it with "npm run auth:hash".`,
    });
  }

  const secret = env[SESSION_SECRET_VAR];
  if (!secret || secret.length < 32) {
    problems.push({
      variable: SESSION_SECRET_VAR,
      message: `${SESSION_SECRET_VAR} is missing or shorter than 32 characters. Generate one with "npm run auth:hash".`,
    });
  }

  return problems;
}

/** True when the gate is configured well enough to let anybody in. */
export function isConfigured(env: Env = process.env): boolean {
  return configProblems(env).length === 0;
}

/**
 * The one sentence a misconfigured deployment shows. It names the variables,
 * because the person reading it is the person who can set them, and it carries
 * no value from the environment.
 */
export function configErrorMessage(problems: ConfigProblem[]): string {
  return `The sign-in gate is not configured, so this app refuses every request. ${problems
    .map((p) => p.message)
    .join(' ')}`;
}
