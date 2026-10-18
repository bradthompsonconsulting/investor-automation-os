/**
 * B15-04 Rev 6 -- the sole-eligible-deal evaluation (design r3 §2 / §2A as
 * amended for the controlled Test evaluation by Option B, proposal r4).
 *
 * Pure: the caller supplies the raw search page, a FRESH single-record read
 * (or "unreadable") for every candidate, and the known-deal ledger ids.
 *
 * What this does NOT claim (Jess J1): completeness. GHL search is used only to
 * DISCOVER ids; every classification comes from the deal's own fresh
 * single-record read. Under Option B (Test only) the bounded checks below are
 * accepted with the named residual: a deal that neither search nor the ledger
 * has surfaced, and any outside change after the boundary's own pre-read.
 */
import { createHash } from "node:crypto";
import type { GhlConfig } from "../../../shared/ghl-config";

export type DealClass = "ELIGIBLE" | "NOT_ELIGIBLE" | "CONFLICT" | "UNKNOWN";
export type DealView = { id: string; cls: DealClass; pipelineId: string | null; stageId: string | null; status: string | null; contactId: string | null; createdAt: string | null };
export type DealSetReason =
  | "allowed"
  | "search_incomplete"     // the search page fails the completeness rule
  | "list_updating"         // search disagrees with a fresh read (L2)
  | "no_eligible"
  | "several_eligible"
  | "unresolved_deal"       // a CONFLICT or UNKNOWN deal (never excluded)
  | "target_not_eligible";
export type DealSetVerdict = { allowed: boolean; reason: DealSetReason; deals: DealView[]; digest: string };

const sha = (v: string) => createHash("sha256").update(v).digest("hex");

export function eligibleStageIds(config: GhlConfig): string[] {
  const s = config.stages;
  return [s.newLeadSeller, s.contactInitiated, s.sellerCallBooked, s.noShow, s.sellerCallCompleted, s.sellerFollowUp, s.sellerOfferSent, s.underContract, s.longTermNurture];
}

/** r3 §2, on one fresh single-record read. A deal of another contact or pipeline is UNKNOWN for this contact (J2: fail closed). */
export function classifyDeal(opp: any, contactId: string, config: GhlConfig): DealClass {
  if (!opp || typeof opp !== "object") return "UNKNOWN";
  if (opp.contactId !== contactId || opp.pipelineId !== config.pipelines.sellerLeads) return "UNKNOWN";
  if (opp.status === "won" || opp.status === "lost" || opp.status === "abandoned") return "NOT_ELIGIBLE";
  if (opp.status !== "open") return "UNKNOWN";
  if (eligibleStageIds(config).includes(opp.pipelineStageId)) return "ELIGIBLE";
  if (opp.pipelineStageId === config.stages.sellerClosedWon || opp.pipelineStageId === config.stages.lostNotInterested) return "CONFLICT";
  return "UNKNOWN";
}

export type SearchCheck = { complete: boolean; ids: string[]; items: Map<string, any> };

/** r3 §2A completeness rule on ONE search page. "complete" here means only that the page passes these checks -- not that the set is complete. */
export function checkSearchPage(body: any, contactId: string, pipelineId: string, targetId: string): SearchCheck {
  const fail = { complete: false, ids: [] as string[], items: new Map<string, any>() };
  if (!body || typeof body !== "object" || !Array.isArray(body.opportunities)) return fail;
  const items = new Map<string, any>();
  for (const o of body.opportunities) {
    if (!o || typeof o.id !== "string" || items.has(o.id)) return fail;
    if (o.contactId !== contactId || o.pipelineId !== pipelineId) return fail;
    items.set(o.id, o);
  }
  const ids = [...items.keys()];
  const meta = body.meta ?? {};
  const noNextPage = (meta.nextPage === null || meta.nextPage === undefined) && (meta.nextPageUrl === null || meta.nextPageUrl === undefined);
  const complete = items.has(targetId) && typeof meta.total === "number" && meta.total === ids.length && ids.length < 100 && noNextPage;
  return { complete, ids, items };
}

/** L2: the search's own pipeline, stage and status must equal the fresh read, or the index is visibly behind. */
export function coherent(searchItem: any, fresh: any): boolean {
  return searchItem.pipelineId === fresh.pipelineId && searchItem.pipelineStageId === fresh.pipelineStageId && searchItem.status === fresh.status;
}

export function dealSetDigest(deals: DealView[]): string {
  const rows = [...deals].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((d) => [d.id, d.cls, d.pipelineId, d.stageId, d.status]);
  return sha(JSON.stringify(rows));
}

/**
 * Candidates = search ids ∪ ledger ids (L1). Every candidate is classified
 * from its fresh read only. The verdict allows a save only if: the search page
 * passes, every listed deal is coherent with its fresh read, exactly one deal
 * is ELIGIBLE and it is the target, and none is CONFLICT or UNKNOWN.
 */
export function evaluateDealSet(input: {
  search: any; fresh: Map<string, any | "unreadable">; ledgerIds: string[];
  targetId: string; contactId: string; config: GhlConfig;
}): DealSetVerdict {
  const { search, fresh, ledgerIds, targetId, contactId, config } = input;
  const page = checkSearchPage(search, contactId, config.pipelines.sellerLeads, targetId);
  const candidates = [...new Set([...page.ids, ...ledgerIds, targetId])];
  const deals: DealView[] = candidates.map((id) => {
    const f = fresh.get(id);
    if (!f || f === "unreadable") return { id, cls: "UNKNOWN", pipelineId: null, stageId: null, status: null, contactId: null, createdAt: null };
    return { id, cls: classifyDeal(f, contactId, config), pipelineId: f.pipelineId ?? null, stageId: f.pipelineStageId ?? null, status: f.status ?? null, contactId: f.contactId ?? null, createdAt: typeof f.createdAt === "string" ? f.createdAt : null };
  });
  const digest = dealSetDigest(deals);
  const verdict = (allowed: boolean, reason: DealSetReason): DealSetVerdict => ({ allowed, reason, deals, digest });
  if (!page.complete) return verdict(false, "search_incomplete");
  for (const id of page.ids) {
    const f = fresh.get(id);
    if (!f || f === "unreadable" || !coherent(page.items.get(id), f)) return verdict(false, "list_updating");
  }
  if (deals.some((d) => d.cls === "CONFLICT" || d.cls === "UNKNOWN")) return verdict(false, "unresolved_deal");
  const eligible = deals.filter((d) => d.cls === "ELIGIBLE");
  if (eligible.length === 0) return verdict(false, "no_eligible");
  if (eligible.length > 1) return verdict(false, "several_eligible");
  if (eligible[0].id !== targetId) return verdict(false, "target_not_eligible");
  return verdict(true, "allowed");
}

export const DEAL_SET_MESSAGE: Record<DealSetReason, string> = {
  allowed: "One eligible seller deal.",
  search_incomplete: "Deal list could not be confirmed. Nothing was saved.",
  list_updating: "The deal list is still updating in GHL. Try again shortly. Nothing was saved.",
  no_eligible: "No eligible seller deal. Nothing was saved.",
  several_eligible: "More than one eligible seller deal. Resolve in GHL. Nothing was saved.",
  unresolved_deal: "Another seller deal for this contact has an unresolved status or stage. Resolve in GHL. Nothing was saved.",
  target_not_eligible: "This deal is not the contact's eligible seller deal. Nothing was saved.",
};
