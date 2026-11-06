/**
 * B15-16 (INV-116; Captain decision 2026-11-06) -- what the operator SEES for a contact's temperature.
 *
 * The scorer (netlify/functions/motivation-score.ts) writes exactly one of the hot/warm/low tags together with the
 * scores. A contact with none of them has not been scored. `getBucketTag` (ghl.ts, unchanged) still places such a
 * contact with Low for ORDERING (the Lead Queue, B15-19 counts); this module only decides the label: "unscored",
 * never an invented Low. Display only: no read or write.
 */
import { getBucketTag, type BucketTag, type ContactRow } from "./ghl";

export type DisplayTier = BucketTag | "unscored";

const BUCKET_TAGS: readonly BucketTag[] = ["hot", "warm", "low"];

/** True when the scorer has tagged this contact hot, warm or low. */
export function hasBucketTag(contact: ContactRow): boolean {
  return BUCKET_TAGS.some((t) => contact.tags.includes(t));
}

/** The tier to show: the scored tier, or "unscored" when no temperature tag is present. */
export function displayTier(contact: ContactRow): DisplayTier {
  return hasBucketTag(contact) ? getBucketTag(contact) : "unscored";
}
