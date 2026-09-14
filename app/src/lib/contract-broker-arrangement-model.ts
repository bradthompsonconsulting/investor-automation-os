/**
 * Broker-arrangement classification -- INV-67 checkbox-marker / broker-
 * model repair.
 *
 * Pure. No I/O, no React. TREC 20-19 page 11 supports exactly two
 * configurations IAOS is authorized to populate in V1: a separate
 * Seller-broker block and a separate Buyer-broker block. A third, real
 * configuration printed on the form -- one broker acting as an
 * intermediary for both parties -- is explicitly OUT of V1 scope per
 * Brad's ruling this session: IAOS must fail closed rather than populate
 * the separate-side blocks with intermediary information. Intermediary
 * support is future, separately authorized scope -- not designed further
 * here, and no template/GHL work toward it is in this repair.
 *
 * MANDATORY ARCHITECT CORRECTION (Jess Gate, this session):
 * `{kind:"represented", sellerAgent:null, buyerAgent:null}` must NOT
 * classify as `no_broker`. Only the explicit `{kind:"none"}` variant may
 * produce `no_broker`. The represented-but-empty state is its own,
 * distinct, ALSO fail-closed classification -- it means the canonical fact
 * claims representation exists without naming who represents whom, which
 * is not the same fact as "no broker on this deal" and must never be
 * silently treated as it.
 */

import type { RepresentationFact } from "./seller-contract-facts-carriers";

export type BrokerArrangementClassification =
  | "no_broker"
  | "seller_broker_only"
  | "buyer_broker_only"
  | "separate_brokers_both_sides"
  | "intermediary"
  | "represented_but_empty";

/**
 * Exhaustive over `RepresentationFact`'s three kinds. `"none"` is the ONLY
 * input that ever produces `"no_broker"` -- a `"represented"` fact with
 * both agents `null` produces `"represented_but_empty"` instead, per the
 * mandatory correction above.
 */
export function classifyBrokerArrangement(fact: RepresentationFact): BrokerArrangementClassification {
  if (fact.kind === "none") return "no_broker";
  if (fact.kind === "intermediary") return "intermediary";
  // fact.kind === "represented"
  const hasSeller = fact.sellerAgent !== null;
  const hasBuyer = fact.buyerAgent !== null;
  if (hasSeller && hasBuyer) return "separate_brokers_both_sides";
  if (hasSeller) return "seller_broker_only";
  if (hasBuyer) return "buyer_broker_only";
  return "represented_but_empty";
}

/** The two classifications this repair must refuse to sync/request over -- never populated, never partially populated, each with its own distinct operator-facing message (see `brokerArrangementBlockingReason`). */
export const BROKER_ARRANGEMENT_BLOCKING: readonly BrokerArrangementClassification[] = [
  "intermediary",
  "represented_but_empty",
] as const;

export function isBrokerArrangementBlocking(classification: BrokerArrangementClassification): boolean {
  return (BROKER_ARRANGEMENT_BLOCKING as readonly string[]).includes(classification);
}

/** `null` for any non-blocking classification. Each blocking classification gets its own distinct message -- never a shared generic string. */
export function brokerArrangementBlockingReason(classification: BrokerArrangementClassification): string | null {
  if (classification === "intermediary") {
    return 'Broker arrangement is "intermediary" -- unsupported in V1. The separate Seller-broker and Buyer-broker blocks cannot be populated with intermediary information; intermediary support is future, separately authorized scope. Refusing to sync.';
  }
  if (classification === "represented_but_empty") {
    return 'Representation is recorded as "represented" but names no broker on either side -- this is not the same fact as "no broker" and must be corrected (or explicitly recorded as "none") before syncing. Refusing to sync.';
  }
  return null;
}
