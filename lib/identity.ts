/**
 * Who is looking, and the distinction the whole feature rests on.
 *
 * **This is identity, not authentication.** The shared family password is the
 * gate and it answers one question: is this the family? Everybody who gets past
 * it sees everything, because shared visibility across four households is the
 * product rather than a leak in it.
 *
 * What this module adds is a name to attribute things to. Anybody holding the
 * shared password can pick any name on the list, so a chosen person proves
 * nothing and secures nothing. It records who says they are doing something, so
 * an irreversible action carries an actor instead of an anonymous `true`.
 *
 * Two consequences follow and neither is negotiable:
 *
 * - No screen may hide data because of who is picked. Leading with a person's
 *   own subscriptions is ordering. Removing another household's rows would be
 *   a different product and a worse one.
 * - Every surface that shows the picked name says plainly that anyone could
 *   have picked it. `IDENTITY_CAVEAT` is that sentence, written once.
 *
 * The cookie is deliberately unsigned. Signing it would buy nothing - the value
 * is a person id anybody past the gate may legitimately set to anything - and
 * would imply a guarantee this design does not make.
 */

import type { Person, PersonId } from './types';

/** The picked person. Plain, unsigned, and worthless to forge. */
export const PERSON_COOKIE = 'sm_person';

/**
 * A year. The picker asks once and then gets out of the way; re-asking his
 * mother who she is every fortnight is the failure this feature exists to avoid.
 */
export const PERSON_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/**
 * The one sentence every surface that names a person has to carry. Written once
 * so it cannot drift into something that overstates what the picker does.
 */
export const IDENTITY_CAVEAT =
  'This names you, it does not prove you. Everybody shares one password, so anybody could pick any name here.';

/**
 * The value that means "asked, and declined to say".
 *
 * A skip has to be storable, otherwise skipping and never being asked look
 * identical and the picker asks again on every visit. It is not a person id and
 * `resolvePerson` never returns anything for it - a skipped browser gets the
 * everyone-view, which is exactly what it had before this feature existed.
 */
export const PERSON_SKIPPED = 'skipped';

/** True when this browser has answered the question, either way. */
export function hasAnswered(cookieValue: string | undefined): boolean {
  return typeof cookieValue === 'string' && cookieValue.trim() !== '';
}

/**
 * Turn a cookie value into a person, or into nobody.
 *
 * An id nobody recognises resolves to nobody rather than throwing. People get
 * renamed and rows get reimported, and a stale cookie must degrade to the
 * everyone-view instead of taking the page down. Nobody is always a legal
 * answer, because skipping the picker is a supported choice.
 */
export function resolvePerson(
  cookieValue: string | undefined,
  people: readonly Person[],
): Person | undefined {
  if (!cookieValue) return undefined;
  const id = cookieValue.trim();
  if (id === '' || id === PERSON_SKIPPED) return undefined;
  return people.find((p) => p.id === id);
}

/** True when this id names somebody in the current dataset. The write guard. */
export function isKnownPerson(id: unknown, people: readonly Person[]): id is PersonId {
  return typeof id === 'string' && people.some((p) => p.id === id);
}

/**
 * How the cookie is set and cleared. Not `secure` unconditionally: locally the
 * app serves plain HTTP and a secure cookie would never come back, so the flag
 * follows the environment exactly as the session cookie's does.
 */
export function personCookieOptions(maxAge: number, production: boolean) {
  return {
    httpOnly: true,
    secure: production,
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

/**
 * People grouped by household, in the order the picker lists them.
 *
 * Households sort by name and people sort within them, so the list is stable
 * between visits. A list that reorders itself is a list somebody's mother has
 * to read twice.
 */
export function peopleByHousehold(
  people: readonly Person[],
  households: readonly { id: string; name: string }[],
): { household: { id: string; name: string }; members: Person[] }[] {
  return [...households]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((household) => ({
      household,
      members: people
        .filter((p) => p.householdId === household.id)
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((group) => group.members.length > 0);
}
