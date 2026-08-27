/**
 * The write path for adding data.
 *
 * Until this route existed the app could flip one field, which meant every row
 * arrived because Jesse typed it into a file. Peter owns the Netflix plan and
 * had no way to say so from the app he was looking at.
 *
 * Everything worth arguing about lives one layer down. `withAddition` runs the
 * whole proposed dataset past `checkFamilyData`, the same checker `data/family.json`
 * goes through on every read, so this route cannot write a row the loader would
 * refuse. It never sets pause terms: nobody has walked a new service's flow, so
 * the app offers no pause button for it and says why on the row.
 */

import { NextResponse } from 'next/server';
import { AdditionError, type CatalogAddition } from '@/lib/family-add';
import { EPHEMERAL_WRITE_MESSAGE, isEphemeralFilesystem } from '@/lib/deployment';
import { getStore } from '@/lib/store';
import { hasDatabase } from '@/lib/store/db';

export const dynamic = 'force-dynamic';

const KINDS = ['household', 'person', 'service', 'subscription'];

export async function POST(request: Request) {
  let body: Partial<CatalogAddition>;
  try {
    body = (await request.json()) as Partial<CatalogAddition>;
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  if (typeof body.kind !== 'string' || !KINDS.includes(body.kind)) {
    return NextResponse.json(
      { error: `Say what is being added: one of ${KINDS.join(', ')}.` },
      { status: 400 },
    );
  }

  // Refuse before writing, not after failing. A hosted deployment with no
  // database has nowhere to put this, and a form that appears to work and keeps
  // nothing is the one outcome this product cannot afford.
  if (isEphemeralFilesystem() && !hasDatabase()) {
    return NextResponse.json({ error: EPHEMERAL_WRITE_MESSAGE }, { status: 503 });
  }

  try {
    const written = await getStore().addToCatalog(body as CatalogAddition);
    return NextResponse.json({ added: written.added, source: written.source });
  } catch (e) {
    // A refused addition wrote nothing, on either backend, so the faults are
    // the whole answer and the previous data is untouched. They go back as a
    // list because a half-filled form usually has more than one thing wrong
    // with it and one round trip should surface them all.
    if (e instanceof AdditionError) {
      return NextResponse.json({ error: e.faults.join(' '), faults: e.faults }, { status: 400 });
    }
    return NextResponse.json({ error: `Nothing was saved. ${(e as Error).message}` }, { status: 400 });
  }
}
