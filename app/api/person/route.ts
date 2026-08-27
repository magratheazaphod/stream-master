/**
 * Who is looking. Identity, not authentication.
 *
 * The shared password already answered the only question that gates anything:
 * is this the family? This route answers a second one that gates nothing - which
 * of them is at the keyboard - and writes the answer to a cookie so nobody has
 * to say it twice.
 *
 * It validates the id against the people in the current dataset, which is not a
 * security check and is not pretending to be one. Anybody past the gate may pick
 * any name. It is there so a typo or a stale cookie cannot put a person on the
 * screen who does not exist.
 */

import { NextResponse } from 'next/server';
import { getStore } from '@/lib/store';
import {
  isKnownPerson,
  personCookieOptions,
  PERSON_COOKIE,
  PERSON_MAX_AGE_SECONDS,
  PERSON_SKIPPED,
} from '@/lib/identity';

export const dynamic = 'force-dynamic';

const production = () => process.env.NODE_ENV === 'production';

export async function POST(request: Request) {
  let personId: unknown;
  try {
    ({ personId } = (await request.json()) as { personId?: unknown });
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  // Skipping is an answer, and it has to be stored as one. A browser that
  // declined and a browser that was never asked would otherwise look the same,
  // and the picker would ask again on every single visit.
  if (personId === null) {
    const skipped = NextResponse.json({ person: null, skipped: true });
    skipped.cookies.set(
      PERSON_COOKIE,
      PERSON_SKIPPED,
      personCookieOptions(PERSON_MAX_AGE_SECONDS, production()),
    );
    return skipped;
  }

  const { catalog } = await getStore().load();
  if (!isKnownPerson(personId, catalog.people)) {
    return NextResponse.json(
      { error: 'Nobody by that name is in this data. Pick a name from the list.' },
      { status: 400 },
    );
  }

  const person = catalog.people.find((p) => p.id === personId)!;
  const response = NextResponse.json({ person: { id: person.id, name: person.name } });
  response.cookies.set(PERSON_COOKIE, person.id, personCookieOptions(PERSON_MAX_AGE_SECONDS, production()));
  return response;
}

/** Forget who this browser said it was. Skipping and changing both land here. */
export async function DELETE() {
  const response = NextResponse.json({ person: null });
  response.cookies.set(PERSON_COOKIE, '', personCookieOptions(0, production()));
  return response;
}
