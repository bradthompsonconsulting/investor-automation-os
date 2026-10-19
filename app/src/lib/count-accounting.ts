/**
 * Count accounting -- B15-19 (INV-128), Pass 1 F6 / F7 / F8 / F26.
 *
 * Pure. No I/O, no React, no GHL. Each helper only explains a count the
 * Dashboard, Pipeline or Contacts page ALREADY shows, from data that page
 * already read. None of them changes what an existing count includes; they
 * say what it measures and account for what it leaves out, so a difference
 * between screens is visible instead of unexplained.
 *
 * What the screens measure (see the B15-19 handoff for the full matrix):
 *   Contacts page    every contact the contacts read returned.
 *   Pipeline page    every deal the Seller Leads pipeline read returned,
 *                    whatever its stage; a contact can have several deals.
 *   Dashboard tiers  every contact, by temperature tag; a contact with no
 *                    temperature tag counts as Low (getBucketTag).
 *   Dashboard stages deals per configured Seller Leads stage.
 *   Lead Queue       contacts to cold-call: a phone and none of the
 *                    cold-outreach exclusions.
 *
 * None of these reads reports a server-side total, so no screen can prove
 * its list is complete; the contacts list read can also lag a recent change
 * (CONTACT_WORKSPACE_SPEC_v2.md §11). Nothing here claims otherwise.
 */

/* Structural shapes of ghl.ts's ContactRow / OpportunityRow / PipelineStage,
   so this module carries no dependency on the read client. */
type ContactRow = { id: string; phone?: string | null; tags: readonly string[] };
type OpportunityRow = { contactId: string; stageId: string };
type PipelineStage = { id: string; name: string; position: number };

/** Contacts whose tags include none of the three temperature tags. They are counted as Low. */
export function untaggedTemperatureCount(contacts: readonly ContactRow[], bucketTags: readonly string[]): number {
  return contacts.filter((c) => !bucketTags.some((t) => c.tags.includes(t))).length;
}

export type StageAccounting<S extends PipelineStage = PipelineStage> = {
  stages: { stage: S; count: number }[];
  /** Deals whose stage is not one of the configured stages. Counted on Pipeline (as "Unknown"), not in any stage pill. */
  otherStage: number;
  total: number;
};

/**
 * Deals per configured stage, plus the deals no configured stage holds, so the
 * pills account for every deal in the set this screen LOADED. Another screen's
 * read is a separate snapshot and may differ; no equality with it is claimed.
 */
export function stageAccounting<S extends PipelineStage>(stages: readonly S[], opportunities: readonly OpportunityRow[]): StageAccounting<S> {
  const known = new Set(stages.map((s) => s.id));
  return {
    stages: [...stages]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({ stage: s, count: opportunities.filter((o) => o.stageId === s.id).length })),
    otherStage: opportunities.filter((o) => !known.has(o.stageId)).length,
    total: opportunities.length,
  };
}

export type DealCoverage = {
  deals: number;
  /** Distinct contacts that have at least one deal and appear in the contacts read. */
  contactsWithDeal: number;
  /** Loaded contacts with no Seller Leads deal in the loaded deals (not proof the contact has no deal). */
  contactsWithoutDeal: number;
  /** Deals whose contact is missing from the contacts read, or that name no contact. */
  dealsWithoutListedContact: number;
};

/** How the Pipeline deal count and the Contacts count relate (F26). */
export function dealCoverage(contacts: readonly ContactRow[], opportunities: readonly OpportunityRow[]): DealCoverage {
  const listed = new Set(contacts.map((c) => c.id));
  const withDeal = new Set<string>();
  let dealsWithoutListedContact = 0;
  for (const o of opportunities) {
    if (o.contactId && listed.has(o.contactId)) withDeal.add(o.contactId);
    else dealsWithoutListedContact++;
  }
  return {
    deals: opportunities.length,
    contactsWithDeal: withDeal.size,
    contactsWithoutDeal: contacts.length - withDeal.size,
    dealsWithoutListedContact,
  };
}

/** Distinct contacts across a set of deals (Pipeline header: "N deals for M contacts"). */
export function distinctDealContacts(opportunities: readonly OpportunityRow[]): number {
  return new Set(opportunities.map((o) => o.contactId).filter(Boolean)).size;
}

export type ColdCallAccounting = { inQueue: number; noPhone: number; excluded: number; total: number };

/**
 * Where every contact went relative to the Lead Queue (F7). Uses the Lead
 * Queue's own two conditions -- a phone, and not in the exclusion set -- so
 * inQueue + noPhone + excluded always equals the contact count.
 */
export function coldCallAccounting(contacts: readonly ContactRow[], excludedIds: ReadonlySet<string>): ColdCallAccounting {
  let inQueue = 0, noPhone = 0, excluded = 0;
  for (const c of contacts) {
    if (!c.phone?.trim()) noPhone++;
    else if (excludedIds.has(c.id)) excluded++;
    else inQueue++;
  }
  return { inQueue, noPhone, excluded, total: contacts.length };
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function coldCallAccountingText(a: ColdCallAccounting): string {
  return `${a.inQueue.toLocaleString()} of ${plural(a.total, "loaded contact", "loaded contacts")} to cold-call; `
    + `${a.excluded.toLocaleString()} handled elsewhere or left out, ${a.noPhone.toLocaleString()} with no phone.`;
}

export function dealCoverageText(c: DealCoverage): string {
  const base = `${plural(c.deals, "loaded deal", "loaded deals")} for ${plural(c.contactsWithDeal, "loaded contact", "loaded contacts")}; `
    + `${plural(c.contactsWithoutDeal, "loaded contact has", "loaded contacts have")} no Seller Leads deal in the loaded results.`;
  return c.dealsWithoutListedContact > 0
    ? `${base} ${plural(c.dealsWithoutListedContact, "loaded deal's contact is", "loaded deals' contacts are")} not among the loaded contacts.`
    : base;
}
