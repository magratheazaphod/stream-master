/**
 * The person picker's cookie.
 *
 * What is worth asserting here is not that a string round-trips. It is that
 * every way the cookie can be wrong degrades to nobody, because nobody is the
 * everyone-view the app had before this feature existed, and a stale cookie must
 * never take a page down or name somebody who is not in the data.
 */

import { describe, expect, it } from 'vitest';
import {
  hasAnswered,
  isKnownPerson,
  peopleByHousehold,
  personCookieOptions,
  PERSON_MAX_AGE_SECONDS,
  PERSON_SKIPPED,
  resolvePerson,
  IDENTITY_CAVEAT,
} from './identity';
import type { Person } from './types';

const people: Person[] = [
  { id: 'p-jesse', name: 'Jesse', householdId: 'h-one' },
  { id: 'p-shan', name: 'Shan', householdId: 'h-one' },
  { id: 'p-peter', name: 'Peter', householdId: 'h-two' },
];

describe('resolvePerson', () => {
  it('resolves a known id', () => {
    expect(resolvePerson('p-peter', people)?.name).toBe('Peter');
  });

  it('trims what the cookie carries', () => {
    expect(resolvePerson(' p-shan ', people)?.id).toBe('p-shan');
  });

  it('is nobody when no cookie was sent', () => {
    expect(resolvePerson(undefined, people)).toBeUndefined();
  });

  it('is nobody when the cookie is empty', () => {
    expect(resolvePerson('', people)).toBeUndefined();
    expect(resolvePerson('   ', people)).toBeUndefined();
  });

  // A person can be renamed or reimported out from under a browser that has
  // been sitting on this cookie for months. That falls back to the everyone
  // view rather than throwing, because skipping is already a supported answer
  // and this is indistinguishable from it.
  it('is nobody when the id no longer names anybody', () => {
    expect(resolvePerson('p-someone-deleted', people)).toBeUndefined();
  });

  it('is nobody for the skip sentinel, which is never a person id', () => {
    expect(resolvePerson(PERSON_SKIPPED, people)).toBeUndefined();
  });
});

describe('hasAnswered', () => {
  // The distinction that stops the picker asking on every single visit.
  it('separates a skip from never having been asked', () => {
    expect(hasAnswered(PERSON_SKIPPED)).toBe(true);
    expect(hasAnswered('p-jesse')).toBe(true);
    expect(hasAnswered(undefined)).toBe(false);
    expect(hasAnswered('')).toBe(false);
  });
});

describe('isKnownPerson', () => {
  it('accepts only ids in the current dataset', () => {
    expect(isKnownPerson('p-jesse', people)).toBe(true);
    expect(isKnownPerson('p-nobody', people)).toBe(false);
    expect(isKnownPerson(null, people)).toBe(false);
    expect(isKnownPerson(7, people)).toBe(false);
  });
});

describe('personCookieOptions', () => {
  it('forgets the person with a zero max age', () => {
    expect(personCookieOptions(0, true).maxAge).toBe(0);
  });

  it('remembers for a year and never crosses a site boundary', () => {
    const options = personCookieOptions(PERSON_MAX_AGE_SECONDS, true);
    expect(options.maxAge).toBe(365 * 24 * 60 * 60);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/');
  });

  // Locally the app serves plain HTTP, where a secure cookie would be set and
  // never sent back, and the picker would silently forget on every request.
  it('follows the environment for the secure flag', () => {
    expect(personCookieOptions(60, true).secure).toBe(true);
    expect(personCookieOptions(60, false).secure).toBe(false);
  });
});

describe('peopleByHousehold', () => {
  const households = [
    { id: 'h-two', name: 'Fairhaven' },
    { id: 'h-one', name: 'Ashby' },
    { id: 'h-empty', name: 'Nobody Here' },
  ];

  it('groups and sorts both levels, and drops empty households', () => {
    const groups = peopleByHousehold(people, households);
    expect(groups.map((g) => g.household.name)).toEqual(['Ashby', 'Fairhaven']);
    expect(groups[0].members.map((p) => p.name)).toEqual(['Jesse', 'Shan']);
  });
});

describe('the caveat', () => {
  // The sentence is the feature's honesty rule. It is written once so it cannot
  // drift into implying the picker checks anything.
  it('says the picker names rather than proves', () => {
    expect(IDENTITY_CAVEAT).toMatch(/does not prove/);
    expect(IDENTITY_CAVEAT).toMatch(/one password/);
  });
});
