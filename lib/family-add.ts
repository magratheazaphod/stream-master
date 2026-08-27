/**
 * Adding to the family's data from the screen.
 *
 * Until now the app could flip one field and nothing else, which meant the data
 * arrived because Jesse put it there by hand. Peter owns the Netflix plan and
 * had no way to say so. This module is how a family member says so.
 *
 * Three rules govern everything below.
 *
 * **One checker.** Every addition is applied to a copy of the whole dataset and
 * the result goes through `checkFamilyData`, the same function that guards
 * `data/family.json` and the same one the Postgres store runs over its selects.
 * A form must not be able to write something the file loader would refuse,
 * because the day it does is the day the app cannot read its own data back.
 *
 * **No invented pause terms.** A service added here gets no `PauseTerms`, ever.
 * Nobody has walked its stop-billing flow, so there is no `manageUrl` to send an
 * agent to and no `method` to walk. The app then offers no pause button for it,
 * which is the honesty rule working rather than a gap to paper over. There is no
 * field here to supply one and adding one would need a walkthrough, not a form.
 *
 * **Forgiving in, exact out.** A family member types `$12.99`, `12,99` or
 * `9/1/2026`. What lands is a number and an ISO date, or a refusal naming the
 * field. Guessing at an ambiguous value would put a wrong renewal date in front
 * of somebody who trusts it.
 */

import { checkFamilyData, type FamilyFile } from './family-file';
import type {
  BillingCycle,
  Household,
  Person,
  Service,
  SharingPolicy,
  Subscription,
} from './types';

/** Everything a family member may add, and nothing else. */
export type CatalogAddition =
  | {
      kind: 'household';
      name: string;
      location: string;
      /** A household with nobody in it can pay for nothing, so one person comes with it. */
      firstPersonName: string;
    }
  | { kind: 'person'; name: string; householdId: string }
  | {
      kind: 'service';
      name: string;
      monthlyPrice: string | number;
      sharingPolicy: string;
      extraMemberPrice?: string | number;
    }
  | {
      kind: 'subscription';
      serviceId: string;
      householdId: string;
      payerId: string;
      monthlyCost: string | number;
      billingCycle: string;
      renewsOn: string;
    };

/** The ids the addition created, so the caller can select what it just made. */
export interface AdditionResult {
  file: FamilyFile;
  added: { households?: string[]; people?: string[]; services?: string[]; subscriptions?: string[] };
}

/**
 * An addition the app refused, carrying every fault at once.
 *
 * Separate from `FamilyFileError` on purpose: that one talks about a file and
 * tells the reader to fix or remove it, which is the wrong sentence entirely for
 * somebody who has just filled in a form.
 */
export class AdditionError extends Error {
  constructor(readonly faults: string[]) {
    super(faults.join(' '));
    this.name = 'AdditionError';
  }
}

const SHARING_POLICIES: SharingPolicy[] = ['household-only', 'extra-member', 'two-adults'];
const BILLING_CYCLES: BillingCycle[] = ['monthly', 'annual'];

/* -- Forgiving input -------------------------------------------------------- */

/**
 * Money as a person types it.
 *
 * Accepts a currency symbol, thousands separators and surrounding space, and a
 * comma used as the decimal point where that is unambiguous. Refuses anything
 * else rather than guessing: a price read wrong is a spend total read wrong for
 * as long as nobody notices.
 */
export function parseMoney(input: string | number, field: string): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) throw new AdditionError([`${field} must be a positive amount.`]);
    return Math.round(input * 100) / 100;
  }
  let text = input.trim().replace(/^[$£€]/, '').replace(/\s/g, '');
  if (text === '') throw new AdditionError([`${field} is required. Enter what it costs per month.`]);

  // "12,99" is a decimal comma. "1,299" and "1,299.00" are thousands separators.
  if (/^\d+,\d{2}$/.test(text)) text = text.replace(',', '.');
  text = text.replace(/,/g, '');

  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw new AdditionError([
      `${field} does not read as an amount of money. Write it like 12.99, with no words.`,
    ]);
  }
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) {
    throw new AdditionError([`${field} must be a positive amount.`]);
  }
  return Math.round(value * 100) / 100;
}

const isRealDate = (y: number, m: number, d: number): boolean => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A date as a person types it, out as `YYYY-MM-DD`.
 *
 * Two shapes and no more: ISO, and the US slashed form this family writes. A
 * two-digit year is refused rather than assumed, and `3/4/2026` is read as
 * March the fourth because every household here is in the United States. That
 * assumption is stated rather than silent, and it is the reason the field label
 * shows the format it expects.
 */
export function parseDate(input: string, field: string): string {
  const text = input.trim();
  if (text === '') throw new AdditionError([`${field} is required. Write it as 2026-09-01.`]);

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);

  let y: number, m: number, d: number;
  if (iso) [, y, m, d] = [0, Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (slashed) [, m, d, y] = [0, Number(slashed[1]), Number(slashed[2]), Number(slashed[3])];
  else {
    throw new AdditionError([
      `${field} does not read as a date. Write it as 2026-09-01, or as 9/1/2026.`,
    ]);
  }

  if (!isRealDate(y, m, d)) {
    throw new AdditionError([`${field} is not a real date. Check the day and the month.`]);
  }
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** A required piece of text, trimmed, or a fault naming the field. */
function text(input: unknown, field: string): string {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new AdditionError([`${field} is required.`]);
  }
  const value = input.trim();
  if (value.length > 120) throw new AdditionError([`${field} is too long. Keep it under 120 characters.`]);
  return value;
}

function oneOf<T extends string>(input: unknown, allowed: T[], field: string): T {
  if (typeof input !== 'string' || !allowed.includes(input as T)) {
    throw new AdditionError([`${field} must be one of ${allowed.join(', ')}.`]);
  }
  return input as T;
}

/* -- Ids -------------------------------------------------------------------- */

/**
 * A readable id from a name, unique against what already exists.
 *
 * Readable because these ids show up in `data/family.json`, in the pause queue
 * and in a Cowork run summary, and `p-7f3a` there tells a reader nothing. A
 * name that slugs to nothing at all falls back to the prefix and a number.
 */
export function makeId(prefix: string, name: string, taken: Iterable<string>): string {
  const slug =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'new';
  const used = new Set(taken);
  const base = `${prefix}-${slug}`;
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/* -- The addition itself ---------------------------------------------------- */

/**
 * A copy of the dataset with one addition applied, checked in full.
 *
 * Pure, so the decision is testable without a disk or a database, and the same
 * function runs behind both stores. The check at the end is the whole point: it
 * catches a payer in the wrong household, a duplicate name that collides on id
 * and a renewal date that is not a date, and it catches them identically
 * wherever the data lives.
 */
export function withAddition(file: FamilyFile, addition: CatalogAddition): AdditionResult {
  const next: FamilyFile = { ...file };
  const added: AdditionResult['added'] = {};

  switch (addition.kind) {
    case 'household': {
      const name = text(addition.name, 'The household name');
      const location = text(addition.location, 'Where the household lives');
      const personName = text(addition.firstPersonName, 'The first person in the household');
      const householdId = makeId('h', name, file.households.map((h) => h.id));
      const personId = makeId('p', personName, file.people.map((p) => p.id));
      const household: Household = { id: householdId, name, location };
      const person: Person = { id: personId, name: personName, householdId };
      next.households = [...file.households, household];
      next.people = [...file.people, person];
      added.households = [householdId];
      added.people = [personId];
      break;
    }

    case 'person': {
      const name = text(addition.name, 'The name');
      const householdId = text(addition.householdId, 'The household');
      const id = makeId('p', name, file.people.map((p) => p.id));
      next.people = [...file.people, { id, name, householdId }];
      added.people = [id];
      break;
    }

    case 'service': {
      const name = text(addition.name, 'The service name');
      const monthlyPrice = parseMoney(addition.monthlyPrice, 'The monthly price');
      const sharingPolicy = oneOf(addition.sharingPolicy, SHARING_POLICIES, 'The sharing rule');
      const id = makeId('svc', name, file.services.map((s) => s.id));
      // No `pause` key, and there is no way to set one from here. Nobody has
      // walked this provider's flow, so the app will offer no pause button for
      // it and will say why on the row.
      const service: Service = { id, name, monthlyPrice, sharingPolicy };
      if (addition.extraMemberPrice !== undefined && String(addition.extraMemberPrice).trim() !== '') {
        service.extraMemberPrice = parseMoney(addition.extraMemberPrice, 'The extra-member price');
      }
      next.services = [...file.services, service];
      added.services = [id];
      break;
    }

    case 'subscription': {
      const serviceId = text(addition.serviceId, 'The service');
      const householdId = text(addition.householdId, 'The household');
      const payerId = text(addition.payerId, 'Who pays');
      const monthlyCost = parseMoney(addition.monthlyCost, 'What it costs per month');
      const billingCycle = oneOf(addition.billingCycle, BILLING_CYCLES, 'The billing cycle');
      const renewsOn = parseDate(addition.renewsOn, 'The next renewal date');

      // One subscription per service per household. A second row is somebody
      // adding what is already there, and two rows double the spend total
      // silently, which is the one number this app exists to get right.
      const clash = file.subscriptions.find(
        (s) => s.serviceId === serviceId && s.householdId === householdId,
      );
      if (clash) {
        throw new AdditionError([
          'That household already has this service. Edit the row that is there rather than adding a second one.',
        ]);
      }

      const id = makeId('sub', `${serviceId}-${householdId}`, file.subscriptions.map((s) => s.id));
      const subscription: Subscription = {
        id,
        serviceId,
        householdId,
        payerId,
        monthlyCost,
        billingCycle,
        renewsOn,
      };
      next.subscriptions = [...file.subscriptions, subscription];
      added.subscriptions = [id];
      break;
    }
  }

  // The same checker the file path uses, over the whole dataset rather than the
  // new row alone. Referential faults only exist between rows.
  try {
    checkFamilyData(next, 'this change');
  } catch (e) {
    const faults = (e as { faults?: string[] }).faults;
    throw new AdditionError(faults ?? [(e as Error).message]);
  }

  return { file: next, added };
}
