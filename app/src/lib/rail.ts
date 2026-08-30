/* ── Board #5 — the persistent call rail's logic. S2d seam ──────────────────
   SELLER_ACQUISITION_WORKFLOW.md L193: "The persistent call rail is the most
   important UI element in this document." L202: "Before Gate 1 resolves, the
   rail says what it is waiting for rather than showing a blank or a zero."
   THAT SENTENCE IS THE WHOLE CONTRACT: every state below states what is
   missing. No blank, no zero, no fake value, ever.

   WHY THIS FILE EXISTS. Both functions below lived inside ContactWorkspace.tsx
   and were unreachable by any test. That module is .tsx, pulls React, lucide
   and react-router, and imports src/lib/ghl.ts — whose MODULE SCOPE runs
   `const CONFIG = getRuntimeConfig()`, which THROWS unless setRuntimeConfig()
   ran first. So a .cjs runner could not load it, and the Ask precedence — the
   resolver.ts:329 mirror, the load-bearing decision on this whole surface —
   had no offline proof and could not get one.

   ⚠ THIS IS A MOVE PLUS A PARAMETERIZATION, NOT A CUT-AND-PASTE. The three id
   sets were module-scope `getRuntimeConfig()` reads in ContactWorkspace; here
   they arrive as an argument. That is the entire reason this module is
   loadable outside a browser, and it is the one structural difference from the
   code it replaces. Everything else — every branch, every string, every
   ordering — is verbatim.

   ⚠ KEEP EVERY IMPORT BELOW EITHER `import type` OR A MODULE THAT IS ITSELF
   RUNTIME-CLEAN. The ghl import is type-only and tsc erases it; resolver.ts
   and selectOpportunity.ts are both already compiled and required by existing
   .cjs runners. A plain (non-type) import of ./ghl here would re-break offline
   loading and take the rail's proof with it.

   S2 resolved the two Opportunity-backed cells. The other two did NOT become
   late — they became permanent until a carrier decision is made:

     Seller Ask / Seller MAO         a carrier EXISTS. Resolved from the
                                     Opportunity read; see deriveRailDeal.
     Current Seller Position         NO carrier exists.
     Current Investor Offer          SELLER_ACQUISITION_WORKFLOW L297-300 lists
                                     both under "No carrier exists for: ...
                                     negotiation state". Not a fetch away — a
                                     carrier decision nobody has made.

   ⚠ DO NOT "RESOLVE" THE LOWER TWO BY POINTING THEM AT A CONVENIENT FIELD.
   offer_price is the MAO calculator's saved-offer field, not "our current
   offer in this negotiation"; wiring it here would invent a semantic the data
   model does not carry. Their waiting strings are verbatim and stay verbatim
   until a carrier is ruled.

   ⚠ SELLER ASK: AGREEMENT WITH UNDERWRITING, NOT PURITY OF PROVENANCE.
   S2 mirrors resolver.ts:329 exactly — `opportunity.askingPrice ??
   contact.askingPrice`. Opportunity first; Contact only when the Opportunity
   has none. The earlier "never fall back to contact" contract was WITHDRAWN,
   and correctly: it would have made the rail say "unavailable" while the
   underwriting screen one click away showed the contact value. Two surfaces
   disagreeing about the ask is the defect; the fallback itself is a proven,
   currently legitimate resolver path.

   WHAT MAKES THE FALLBACK SAFE IS DISCLOSURE, NOT AVOIDANCE. Whenever the
   contact value is used the rail SAYS SO, in the cell, next to the number. A
   contact fallback must never be able to pass as an Opportunity-owned value.
   Do not remove the provenance line to tidy the layout.

   ⚠ SELLER MAO HAS NO CONTACT FALLBACK AND MUST NEVER BE GIVEN ONE. It is an
   Opportunity value that Approve writes. Absent means NOT YET APPROVED, which
   is a real and different state from "no opportunity" — see railCells(). */

import type { OpportunityRow } from "./ghl";
import type {
  ContactSeedIds,
  OpportunityFactIds,
  RawField,
} from "./underwriting/resolver-types";
import { parseContactSeeds, parseOpportunityValues } from "./underwriting/resolver";
import {
  opportunityCandidates,
  readOpportunityNumber,
  selectOpportunity,
} from "./underwriting/selectOpportunity";

/* Exported for §4B so the rail editor re-renders a saved value through THE SAME
   formatter the cell uses. A second local formatter would drift silently, and
   the first symptom would be the editor and the cell disagreeing about the
   number they both claim to show. */
export const RAIL_MONEY = (n: number): string =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Which source supplied the displayed Ask. Rendered, never inferred. */
export type AskSource = "opportunity" | "contact";

/** The rail's read of the deal. Every state is explicit; none is a blank. */
export type RailDeal =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "no_opportunity" }
  | { state: "awaiting_selection"; count: number }
  | {
      state: "resolved";
      opportunityName: string;
      /* Board #5 §4B. The id of the deal PB-D55 selected, carried so the
         component can write to it. PLAIN DATA, never a handle: the editor's
         save path lives in the component, not here, so railCells stays pure
         and this module stays loadable by the offline runner. */
      opportunityId: string;
      ask: { value: number; source: AskSource } | null;
      mao: number | null;
    };

export type RailCellView = {
  key: string;
  label: string;
  /** The value, or the statement of what is missing. NEVER blank, zero or "—". */
  primary: string;
  /** Provenance / qualifier line. Null when there is nothing to disclose. */
  provenance: string | null;
  /** "value" renders as a figure; "waiting" renders dim and italic. */
  tone: "value" | "waiting";
  /* ── Board #5 §4A — DELIBERATELY ASYMMETRIC DISCLOSURE ────────────────────
     A route appears ONLY where it can do what it claims.

     ⚠ THE OBVIOUS SYMMETRIC VERSION SENDS BRAD TO EDIT A VALUE THAT IS BEING
     IGNORED. The only hop IAOS has is ghlContactDetailUrl, which opens the
     CONTACT record. When the Opportunity carries an Ask it WINS
     (resolver.ts:329), so that page does not reach the authoritative field at
     all. Brad would edit contact.asking_price, return, D1 would revalidate
     correctly, and the rail would show the same number -- a refresh working
     perfectly while confirming the wrong conclusion. The opportunity
     deep-link is D4 and is blocked.

     So: CONTACT-FALLBACK state offers the hop, because in that state there IS
     no Opportunity Ask and the contact value genuinely is authoritative.

     ⚠ §4B CHANGES THE OPPORTUNITY BRANCH ONLY. It now offers an in-place edit
     instead of explaining why it cannot, because IAOS can finally write the
     authoritative field. The contact-fallback hop is UNCHANGED and must stay
     so: it still goes to the record that genuinely governs in that state.

     ⚠ THE ROUTE IS A KIND, NEVER A CALLBACK. The component maps the kind to
     behaviour. A function here would make RailCellView unassertable
     structurally and would take the offline seam with it. */
  route:
    | { kind: "contact-record"; label: string }
    | { kind: "edit-opportunity-ask"; label: string }
    | null;
  /* Stated when there is no route, so its absence is explained, never silent.
     ⚠ RETAINED DELIBERATELY THOUGH NO STATE SETS IT AFTER §4B. It is the
     mechanism for future no-route explanatory states. §4B retires the
     ASSERTION that a note and a route are mutually exclusive (that predicate
     became unsatisfiable); it does NOT retire the field. */
  authorityNote: string | null;
};

/**
 * The field identifiers the rail reads, supplied by the caller.
 *
 * PARAMETERS, NOT A MODULE-SCOPE CONFIG READ. See the header: this is what
 * makes the module loadable outside a browser. The caller binds them from
 * getRuntimeConfig() exactly as it did before, so the values are unchanged.
 *
 * oppFacts is the whole OpportunityFactIds set because parseOpportunityValues
 * takes the whole set; only askingPrice is consumed here, and passing a
 * partial one would mean reimplementing the parser. sellerMAO is separate: it
 * is an underwriting OUTPUT that Approve persists, not a deal fact.
 */
export type RailIds = {
  oppFacts: OpportunityFactIds;
  contactSeeds: ContactSeedIds;
  sellerMAO: string;
};

/**
 * THE RAIL'S DEAL READ. Pure — no fetch, no state, no effect, no writes.
 *
 * Order matters, exactly as toViewModel's does: each branch assumes every
 * branch above it failed.
 *
 * ⚠ The rail does not choose between deals. selectOpportunity is called with a
 * HARD null choice, so with more than one candidate it resolves to null and
 * the caller says so. PB-D55 forbids assuming the first is the deal, and a
 * read-only rail silently picking one would be the worst place to break that.
 */
export function deriveRailDeal(input: {
  opps: OpportunityRow[] | null;
  oppsError: string | null;
  /** The contact detail record, or null before it resolves. */
  detail: { customFields: RawField[] } | null;
  detailLoading: boolean;
  ids: RailIds;
}): RailDeal {
  const { opps, oppsError, detail, detailLoading, ids } = input;

  if (oppsError !== null) return { state: "error", message: oppsError };
  if (opps === null || detailLoading) return { state: "loading" };

  const candidates = opportunityCandidates(opps);
  if (candidates.length === 0) return { state: "no_opportunity" };

  const selected = selectOpportunity(candidates, null);
  if (selected === null) return { state: "awaiting_selection", count: candidates.length };

  const opp = opps.find((o) => o.id === selected.id);
  if (opp === undefined) return { state: "awaiting_selection", count: candidates.length };

  /* Ask — resolver.ts:329's contract, mirrored: Opportunity first, Contact
     only on absence. Both sides parsed by resolver.ts's OWN exported
     parsers, so "what counts as present" cannot drift between this rail and
     the underwriting screen. The branch that selects the value is the same
     branch that records the provenance, so the disclosure cannot disagree
     with the number it labels. */
  const oppAsk = parseOpportunityValues(opp.customFields, ids.oppFacts).askingPrice;
  const contactAsk = detail === null
    ? null
    : parseContactSeeds(detail.customFields, ids.contactSeeds).askingPrice;

  let ask: { value: number; source: AskSource } | null = null;
  if (oppAsk !== null) ask = { value: oppAsk, source: "opportunity" };
  else if (contactAsk !== null) ask = { value: contactAsk, source: "contact" };

  // MAO — Opportunity ONLY. No fallback exists and none may be added.
  const mao = readOpportunityNumber(opp.customFields, ids.sellerMAO);

  return { state: "resolved", opportunityName: selected.name, opportunityId: selected.id, ask, mao };
}

/**
 * PURE. The whole rail as four ordered cells, derived from one deal read.
 *
 * Position and Investor Offer are NOT part of the deal read at all — no
 * carrier exists for either (SELLER_ACQUISITION_WORKFLOW L297-300), so they
 * carry their S1 waiting strings verbatim in every state. They are not
 * "pending a fetch"; they are pending a carrier decision, and collapsing those
 * two reasons into one is what S1's comment forbade.
 */
export function railCells(deal: RailDeal): RailCellView[] {
  type CellBody = Pick<RailCellView, "primary" | "provenance" | "tone" | "route" | "authorityNote">;
  const waiting = (primary: string): CellBody =>
    ({ primary, provenance: null, tone: "waiting", route: null, authorityNote: null });

  let ask: CellBody;
  let mao: CellBody;

  switch (deal.state) {
    case "loading":
      ask = mao = waiting("reading Opportunity…");
      break;
    case "error":
      ask = mao = waiting(`Opportunity read failed — ${deal.message}`);
      break;
    case "no_opportunity":
      // Board #1 §3: a contact with no Seller Opportunity is an exception, not
      // a path. Say that, rather than implying a number is merely late.
      ask = mao = waiting("no Opportunity on this contact");
      break;
    case "awaiting_selection":
      // PB-D55. The rail is read-only and does not choose; it names the count
      // and sends the operator to the surface that CAN choose.
      ask = mao = waiting(`${deal.count} Opportunities — select one in Underwriting`);
      break;
    case "resolved":
      ask = deal.ask === null
        ? waiting("no ask on Opportunity or Contact")
        : deal.ask.source === "opportunity"
          ? {
              primary: RAIL_MONEY(deal.ask.value),
              /* The selected deal's name rides on the provenance it already
                 renders -- no new element, no new fetch, no new state. It is
                 the value deriveRailDeal already returns and railCells used to
                 discard. ⚠ It is therefore visible ONLY in this branch, which
                 no Production contact currently reaches: 0 of 43 opportunities
                 carry an Ask. */
              provenance: `Opportunity · ${deal.opportunityName}`,
              tone: "value",
              /* §4B. The authoritative value is now editable in place, so the
                 branch offers the edit instead of explaining its absence. */
              route: { kind: "edit-opportunity-ask", label: "Edit the Opportunity Ask" },
              authorityNote: null,
            }
          : {
              primary: RAIL_MONEY(deal.ask.value),
              /* WHY the Contact value governs, not merely that it does. The old
                 label read "Contact fallback" and left the reason unstated. */
              provenance: "Contact fallback — no Opportunity Ask",
              tone: "value",
              route: { kind: "contact-record", label: "Edit on the Contact in GHL" },
              authorityNote: null,
            };
      mao = deal.mao === null
        ? waiting("not yet approved — run Underwriting")
        : { primary: RAIL_MONEY(deal.mao), provenance: `Opportunity · ${deal.opportunityName}`, tone: "value", route: null, authorityNote: null };
      break;
  }

  return [
    { key: "seller-ask", label: "Seller Ask", ...ask },
    { key: "seller-mao", label: "Seller MAO", ...mao },
    { key: "seller-position", label: "Current Seller Position", ...waiting("WAITING on negotiation carrier") },
    { key: "investor-offer", label: "Current Investor Offer", ...waiting("WAITING on negotiation semantics / carrier contract") },
  ];
}
