import { availability } from './availability';
import {
  households,
  interests,
  people,
  services,
  subscriptions,
  titles,
} from './mock-data';
import type { Catalog } from './domain';

/**
 * The single place the app reads its data. Swapping fixtures for Postgres means
 * changing this function and nothing else.
 */
export function getCatalog(): Catalog {
  return { households, people, services, subscriptions, titles, interests, availability };
}
