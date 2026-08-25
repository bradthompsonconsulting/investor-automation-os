# IAOS Priority Reset — Candidate Master List

**Captured:** 2026-08-25  
**Status:** DRAFT / NOT AUTHORIZED FOR IMPLEMENTATION  
**Purpose:** Preserve the full set of IAOS + GHL capability priorities discovered during the post-sandbox reset before final ranking.  
**Branch:** `planning/priority-reset-2026-08-25`  

This file is intentionally **not** a replacement for `PRODUCT_BACKLOG.md`. It is a recovery artifact so the ideas discovered during the priority reset cannot be lost while Jess reconstructs capability truth, Claude fact-checks it, and Brad makes the final priority decision.

# Reference Contract

When Brad, Jess, Claude, or Jeff says **Candidate #N**, the entire numbered section is the shared meaning. A candidate is not executable until its section is clear on: **Outcome, Existing foundation, Work type, Minimum scope, Not in scope, Dependencies/gates, and Proof/Definition of Done.** Investigation candidates end in a measured decision; they do not automatically authorize a build. Role boundaries remain unchanged: Brad authorizes/operates; Jess rules/recommends architecture and acceptance; Claude designs/briefs/authorizes Jeff; Jeff measures/builds/commits.

## True North

IAOS is the investor's operating cockpit. It should bring the right information, decisions, and actions into one workflow while allowing specialized systems to do the jobs they already do well:

- **PropStream:** lead/property sourcing, distressed-property discovery, specialized property data and comps where useful.
- **GHL:** CRM system of record, communications, workflows, nurture, telephony, AI conversations/voice, appointments and follow-up automation.
- **IAOS:** operator experience, prioritization, structured seller acquisition, decision support, underwriting/offer intelligence, next-action control and orchestration across the stack.

Guiding tests: Does this help Brad operate? Does it move a real seller/deal toward revenue? Can PropStream/GHL already do it well enough to integrate rather than rebuild? Is it needed now?

The order below is a **working priority hypothesis only**. It is not final and does not authorize implementation.

---

# Candidate Priority Order

## 1. Seller Acquisition / Call-Center Workspace — NOW candidate
**Outcome:** Brad works a live seller conversation from one IAOS screen, follows the call flow, captures answers once, and leaves with durable qualification/deal state ready for the next decision.  
**Existing foundation:** Contact Workspace; seller call-flow source; Seller Acquisition Workflow; GHL contact/opportunity fields; notes/call path; Underwriting Workspace.  
**Work type:** IAOS product/software + GHL field/write integration.  
**Minimum scope:** One seller-call workspace with script/conversation stages and editable qualification/property facts: motivation, timeline, occupancy, decision-makers, condition, debt/title concerns, asking price, seller position, outcome and next action. Save facts to authoritative carriers. Future repair/MAO/negotiation features may plug into this surface but need not block the first useful slice.  
**Not in scope:** PropStream replacement, autonomous AI negotiation, contracts, buyer/disposition, or requiring the full future MAO system before the call workspace ships.  
**Dependencies/gates:** Write authority must be known for fields edited; existing GHL dialer path may remain the initial calling mechanism.  
**Proof/DoD:** In Test then Production under normal release rules, Brad can open a seller, conduct the defined call stages, enter the minimum facts once, save them to intended carriers, record outcome/next action, reload, and see the same durable state without duplicate entry or unintended side effects.

## 2. IAOS-Native Calling Experience + GHL Record Sync — NOW investigation candidate
**Outcome:** Determine whether Brad can start a seller call from IAOS with a materially simpler one-click experience while retaining the GHL artifacts that matter.  
**Existing foundation:** Working fallback `IAOS → GHL → GHL dialer → seller`; GHL telephony/notes/dispositions/workflows.  
**Work type:** Architecture/technical investigation first; implementation only if worthwhile.  
**Minimum scope:** Measure viable cell/bridge/deep-link/GHL-supported launch options and exactly what can remain/write back: call record, recording, notes, disposition, timestamps, follow-up and structured facts.  
**Not in scope:** Custom telephony platform merely to remove one click.  
**Dependencies/gates:** Verify per-number recording, inbound callback routing and multiple-number configuration; do not assume audio can be retroactively attached to GHL.  
**Proof/DoD:** Measured recommendation identifies best path, exact GHL artifacts retained/lost, limitations/cost and whether it beats the fallback. Any recommended build gets explicit acceptance conditions before Jeff briefing.

## 3. GHL AI Seller Qualification — NOW/HIGH investigation candidate
**Outcome:** GHL AI gathers basic seller qualification so Brad spends personal call time on leads worth human attention.  
**Existing foundation:** GHL Voice AI capability; seller qualification fields/workflows; IAOS queues/call-flow design.  
**Work type:** GHL capability/config + compliance determination + IAOS surfacing; not an IAOS voice engine.  
**Minimum scope:** Bounded conversation collecting non-economic facts such as selling interest, occupancy, condition, motivation, timeline, asking price and decision-maker status; then qualify/escalate/book/transfer as approved.  
**Not in scope:** AI negotiation, ARV/repair/MAO approval, seller offers or contract commitments.  
**Dependencies/gates:** Verify GHL availability/cost/config; determine eligible/compliant populations/channels before outbound use; map answers to authoritative fields.  
**Proof/DoD:** On an approved test/eligible contact, AI completes the bounded flow, stores agreed facts correctly, produces intended qualification/escalation and IAOS surfaces the result without Brad re-entering it.

## 4. GHL Conversation AI Across SMS / Email / Chat — HIGH candidate
**Outcome:** Supported seller text replies can be qualified/routed without Brad manually handling every first exchange.  
**Existing foundation:** GHL communications/workflows, seller nurture/reply handling and qualification fields.  
**Work type:** GHL configuration + IAOS data/surfacing integration.  
**Minimum scope:** One bounded reply flow on operationally appropriate channels, collecting the same core facts as voice/human qualification and handing off when needed.  
**Not in scope:** IAOS-native messaging bot or autonomous economic negotiation.  
**Dependencies/gates:** Channel compliance/consent; shared field model with Candidates 1 and 3.  
**Proof/DoD:** Approved seller reply completes bounded AI flow, required facts persist once, booking/escalation occurs as specified and IAOS reflects resulting seller state.

## 5. AI Post-Conversation Extraction, Summaries and Pre-Call Briefing — HIGH candidate
**Outcome:** Brad does not reread every thread or retype facts already present before deciding what to do next.  
**Existing foundation:** GHL conversations/notes/call artifacts, structured seller fields, IAOS Contact Workspace/queues.  
**Work type:** GHL AI/workflow capability + IAOS presentation/integration.  
**Minimum scope:** Concise factual pre-call brief and/or post-interaction summary, extraction of a bounded qualification set, and missing-question flags. Start with one artifact type if necessary.  
**Not in scope:** Silent AI overwrite of authoritative economic facts or AI offers.  
**Dependencies/gates:** Reliable source artifacts (including recording/transcript if used), field mapping and error/confidence handling.  
**Proof/DoD:** Known test conversation yields an accurate brief/summary, agreed facts land/present as designed, missing information is identified, and Brad can act without rereading the full thread.

## 6. Lead Prioritization / "Who Should Brad Call Next?" — HIGH candidate
**Outcome:** IAOS gives Brad a trustworthy ranked work queue.  
**Existing foundation:** Dashboard queues, scoring/segmentation, call attempts/dispositions, seller fields and future AI qualification.  
**Work type:** IAOS decision logic/product surface.  
**Minimum scope:** Transparent ranking using facts already available; no speculative AI prediction required. Inputs may include motivation, timeline, engagement, qualification, attempts, property facts, completeness, follow-up dates and acquisition stage.  
**Not in scope:** Opaque autonomous deal decisions or removing Brad override.  
**Dependencies/gates:** Disposition/queue/fact semantics trustworthy enough to rank.  
**Proof/DoD:** Controlled leads produce expected explainable order, materially re-rank when facts change, and due/hot leads are not hidden by stale state.

## 7. Next-Action / Exception Management — HIGH candidate
**Outcome:** Every active seller/deal has an obvious next move and IAOS surfaces things needing Brad instead of requiring babysitting.  
**Existing foundation:** GHL workflows/nurture, IAOS queues, dispositions, callbacks/notes and opportunity stages.  
**Work type:** IAOS orchestration/attention model + GHL events.  
**Minimum scope:** Surface next action/due state plus a small set of high-value exceptions: call today, comps needed, repairs needed, missing fact, follow-up due, seller replied, AI failed to classify, appointment missed, offer follow-up overdue, workflow exception.  
**Not in scope:** General project-management system.  
**Dependencies/gates:** Authoritative disposition/queue/follow-up semantics and observable GHL events.  
**Proof/DoD:** Supported test scenarios surface correct seller/action at correct time, clear when resolved and do not create duplicate/conflicting work with GHL.

## 8. Property Intelligence: Practical ARV / Comps Workflow — HIGH candidate
**Outcome:** Brad can get from a seller/property record to a defensible approved ARV consumed by underwriting.  
**Existing foundation:** PropStream comps/property data; IAOS underwriting consumes ARV.  
**Work type:** IAOS operator workflow/integration; PropStream remains specialized research source.  
**Minimum scope:** Efficient path to research externally as needed, enter/select approved ARV in IAOS, and retain enough source/evidence context to know where it came from.  
**Not in scope:** Proprietary AVM, county-record aggregation platform or PropStream clone.  
**Dependencies/gates:** Authoritative ARV carrier/minimum evidence; measure integration/API limits before promising automatic comp retrieval.  
**Proof/DoD:** On a property, Brad can research/select ARV, store approved value/context, reload it and have underwriting consume that exact value without duplicate entry.

## 9. Repair Estimator / Condition-to-Repairs Workflow — HIGH candidate
**Outcome:** Seller condition answers become a useful repair estimate/range Brad can approve for underwriting.  
**Existing foundation:** Call-flow condition questions, structured condition fields, underwriting repairs input.  
**Work type:** IAOS decision-support/product logic.  
**Minimum scope:** Bounded repair builder using condition categories actually gathered; suggested range/number requires Brad review/edit/approval.  
**Not in scope:** Contractor/inspection replacement or silent AI-approved repair number.  
**Dependencies/gates:** Condition capture from Candidate 1; repair assumptions/source and authoritative approved-repair carrier.  
**Proof/DoD:** Known condition fixtures produce explainable outputs, Brad can adjust/approve, approved value persists and underwriting consumes only approved repairs.

## 10. New IAOS-Native MAO / Offer / Negotiation Experience — HIGH, downstream candidate
**Outcome:** Brad moves from approved ARV/repairs through existing underwriting to Seller MAO, opening offer and negotiation state without resurrecting the deleted legacy calculator.  
**Existing foundation:** Underwriting Workspace/core/resolver, policy hierarchy, Opportunity authority and approval path.  
**Work type:** IAOS UI/product around existing engine.  
**Minimum scope:** Surface approved inputs, End-Buyer Max, Seller MAO guardrail, seller ask/position, Proposed Opening Offer, Brad-approved Opening Offer and basic negotiation progression in/alongside Candidate 1.  
**Not in scope:** Restoring old `MaoCalculator.tsx`, AI making offers, or redesigning proven economics without a defect.  
**Dependencies/gates:** Approved ARV/repairs (Candidates 8/9 or equivalent), authoritative offer carriers and preserved underwriting contracts.  
**Proof/DoD:** Controlled deal progresses from approved inputs to Seller MAO, Brad-approved opening offer and durable negotiation state with no obsolete contact-offer authority and no economic commitment without Brad approval.

## 11. GHL Missed-Call / Inbound Recovery — HIGH/MEDIUM candidate
**Outcome:** Seller callbacks are not lost when Brad is unavailable.  
**Existing foundation:** GHL telephony/workflows/Voice AI; captured but partly unverified routing.  
**Work type:** GHL verification/config + IAOS surfacing.  
**Minimum scope:** Verify routing first; if inadequate, simplest supported recovery captures reason/context and gets seller back to Brad.  
**Not in scope:** Custom telephony if GHL solves it.  
**Dependencies/gates:** Actual routing, recording and AI availability/compliance.  
**Proof/DoD:** Controlled unanswered inbound call reaches intended recovery, leaves durable GHL artifact, captures minimum info and surfaces correct IAOS attention state.

## 12. GHL Nurture Reactivation / AI Escalation — MEDIUM/HIGH candidate
**Outcome:** A nurtured seller who becomes interested again automatically returns to active attention.  
**Existing foundation:** Seller follow-up, Long-Term Nurture and reply handling.  
**Work type:** GHL workflow/AI + IAOS queue/state integration.  
**Minimum scope:** Detect meaningful nurture reply, collect only missing basic qualification if appropriate, and return seller to active IAOS queue/next action.  
**Not in scope:** Rebuilding nurture or autonomous negotiation.  
**Dependencies/gates:** Verify existing reply/removal behavior and prevent workflow duplication.  
**Proof/DoD:** Controlled nurtured reply changes intended GHL state and reappears exactly once in IAOS with clear next action.

## 13. GHL Ringless Voicemail / Voicemail-Drop Campaigns — MEDIUM, compliance-sensitive
**Outcome:** Decide whether GHL voicemail is a useful, lawful, measurable seller outreach/follow-up tool.  
**Existing foundation:** GHL workflow/telephony and seller lists.  
**Work type:** Compliance/marketing investigation + GHL config if approved.  
**Minimum scope:** Identify eligible use case/population, cost, compliance requirements and measurement before sending.  
**Not in scope:** Bulk raw-list deployment without explicit eligibility/compliance decision.  
**Dependencies/gates:** Compliance determination and GHL capability/cost verification.  
**Proof/DoD:** Documented go/no-go; if go, bounded approved campaign proves delivery/tracking and responses enter normal IAOS/GHL flow.

## 14. GHL Human Call Bridge / Hot-Lead Transfer — MEDIUM/HIGH investigation candidate
**Outcome:** Determine whether GHL can connect Brad to a seller or transfer an AI-qualified hot seller in a materially better way.  
**Existing foundation:** GHL telephony/workflows/AI and Candidate 2.  
**Work type:** GHL/architecture investigation/config.  
**Minimum scope:** Test bridge/transfer and compare with existing dialer/other Candidate 2 options.  
**Not in scope:** Separate custom calling infrastructure if GHL solves it.  
**Dependencies/gates:** Candidate 2 findings and Voice AI/telephony config.  
**Proof/DoD:** Measured comparison states behavior, GHL artifacts, operator experience, cost/limits and adoption recommendation.

## 15. Easy Production Lead Import — MEDIUM / only if cheap
**Outcome:** Brad can get a PropStream list into Production without long technical ceremony, unless the current process remains the better tradeoff.  
**Existing foundation:** `import-propstream-csv.ts`, environment/credential safety and PropStream/GHL mapping; IAOS Import page is a stub.  
**Work type:** Small IAOS/operator tooling candidate or retain CLI/manual.  
**Minimum scope:** Measure smallest safe operator-friendly wrapper/process.  
**Not in scope:** General ETL/import platform.  
**Dependencies/gates:** Preserve environment/credential/dedup safety; resolve any identity behavior that makes simplification unsafe.  
**Proof/DoD:** Either documented repeatable manual invocation remains approved, or Brad can safely import a bounded file with clear preview/result reporting without Jeff operating the script.

## 16. GHL Marketing Execution / Existing Workflow Audit — MEDIUM candidate
**Outcome:** Know exactly what seller outreach GHL already performs and where AI/IAOS should plug in.  
**Existing foundation:** GHL Configuration Reference; Cold Seller Outreach; Seller Lead Submitted/Engagement; follow-up/nurture; mail and communication infrastructure.  
**Work type:** GHL factual/config audit + integration design.  
**Minimum scope:** Verify current production behavior of seller-acquisition workflows/channels relevant to immediate operation and insertion points for Candidates 3/4/11/12.  
**Not in scope:** PropStream recreation, new campaign platform or gratuitous workflow changes.  
**Dependencies/gates:** Direct current GHL read where capture is stale/NOT_CAPTURED.  
**Proof/DoD:** Current-state map identifies relevant workflow/channel trigger/outcome/gap/integration point with no UNKNOWN blocking immediate seller outreach.

## 17. Existing P1 Daily-Workflow Defects That Interfere With the New Core — MEDIUM / dynamic
**Outcome:** Fix old backlog defects when they materially damage the new seller-acquisition workflow.  
**Existing foundation:** `PRODUCT_BACKLOG.md` and shipped surfaces.  
**Work type:** IAOS/GHL fixes case-by-case.  
**Minimum scope:** Promote only the specific defect/chain blocking Candidates 1–10 or real daily operation. Examples: unanswered flag; disposition queue effect; PB-D48/FIELD_REGISTER; field editors; opportunity edit depth; contact search; navigation.  
**Not in scope:** Completing old P1/P2 wholesale before operating.  
**Dependencies/gates:** Each promoted row keeps its existing contract/dependencies.  
**Proof/DoD:** Original acceptance contract passes and the operator friction that justified promotion is gone.

## 18. Underwriting Engine Maintenance / Operator Proof — MEDIUM, not rebuild
**Outcome:** Preserve current underwriting, feed it good inputs and prove it on real seller work before redesigning math.  
**Existing foundation:** Routed Underwriting Workspace/core/resolver, Investor Policy/starter hierarchy, Opportunity authority, approval and fixture proof.  
**Work type:** Operator validation + targeted maintenance only when real use exposes a defect.  
**Minimum scope:** Feed approved ARV/repairs and exercise a real seller/deal.  
**Not in scope:** Rebuilding engine, resurrecting old calculator or speculative economic changes.  
**Dependencies/gates:** Defensible inputs and seller opportunity.  
**Proof/DoD:** Brad successfully underwrites a real seller opportunity; discovered defects become specific measured work.

## 19. Marketing / Lead-Source Expansion Beyond PropStream — FUTURE
**Outcome:** Preserve options for expanding seller sources when PropStream becomes limiting.  
**Existing foundation:** PropStream + seller-lead intake mechanism.  
**Work type:** Future marketing/integration.  
**Minimum scope now:** None. Future possibilities: county/public records, other providers, website/landing-page intake, paid inbound advertising.  
**Not in scope now:** Broad IAOS lead-generation/county-data platform.  
**Trigger:** Demonstrated PropStream limitation or new channel Brad chooses.  
**Proof/DoD when activated:** New source feeds normal IAOS/GHL intake with source attribution and no parallel operating process.

## 20. IAOS Campaign/Revenue Analytics Feedback Loop — FUTURE
**Outcome:** Learn which sources, seller signals, outreach, offers and underwriting assumptions actually produce contracts/revenue.  
**Existing foundation:** Source/workflow/seller/pipeline and future outcome data.  
**Work type:** Future IAOS analytics.  
**Minimum scope now:** Preserve clean source/outcome data where cheap; no dashboard ahead of volume.  
**Not in scope:** Replacing PropStream analytics.  
**Trigger:** Enough real volume to make patterns useful.  
**Proof/DoD when activated:** IAOS traces source/interactions through outcome and answers agreed performance questions from actual data.

## 21. Contracts / E-Sign / Contract Readiness Automation — LOW / MANUAL FOR NOW
**Outcome:** Eventually move accepted agreement into executable contract workflow without losing state.  
**Existing foundation:** Contract-readiness concept + opportunity/pipeline state.  
**Work type:** Future IAOS/integration; manual initially.  
**Minimum scope now:** Manual process; capture real friction.  
**Not in scope now:** Document-generation/e-sign platform build.  
**Trigger:** Real accepted deal or repeated contracting friction.  
**Proof/DoD when activated:** Accepted deal data enters chosen contract process, required facts/price persist, signature/status visible and no duplicate re-entry.

## 22. Buyer / Disposition Workflow — LOW / MANUAL FOR NOW
**Outcome:** Eventually move contracted wholesale deal to buyer/assignment efficiently.  
**Existing foundation:** Investor-side GHL concepts/pipelines.  
**Work type:** Future IAOS/GHL; manual initially.  
**Minimum scope now:** Manual; record pain points. Future: buyer list/qualification, deal package, matching, outreach, offers, assignment tracking.  
**Not in scope now:** Full buyer marketplace/disposition automation.  
**Trigger:** First real contract or repeated workload.  
**Proof/DoD when activated:** Contracted deal can be packaged, sent/matched, interest/offers tracked and assignment state advanced without losing seller/deal truth.

## 23. Closing / Revenue Management — OUT OF CURRENT SCOPE
**Outcome:** Eventually track title/closing, assignment, completion and revenue attribution.  
**Existing foundation:** Pipeline/deal state.  
**Work type:** Future IAOS/integration.  
**Minimum scope now:** None.  
**Not in scope now:** Title-company/accounting/closing platform.  
**Trigger:** Real contract/revenue volume.  
**Proof/DoD when activated:** Agreed closing milestones and actual revenue tie durably to the deal without second source of truth.

## 24. SaaS / Multi-Tenant / Productization — DEFERRED
**Outcome:** Eventually package proven IAOS for other investors/locations.  
**Existing foundation:** Single-operator IAOS + environment/auth work.  
**Work type:** Future platform/productization.  
**Minimum scope now:** None unless independently required for Brad's safe operation.  
**Not in scope:** SaaS ahead of proving Brad's operation.  
**Trigger:** Brad workflow is proven/repeatable/worth packaging.  
**Proof/DoD when activated:** Tenant/location isolation, auth, config and onboarding meet explicit multi-investor contracts without Brad-specific assumptions.

## 25. Low-Value Technical / Backlog Housekeeping — DEFER UNLESS BLOCKING
**Outcome:** Maintain the system without letting cleanup outrank operator/revenue capability.  
**Existing foundation:** P4/P5 housekeeping.  
**Work type:** Engineering/product housekeeping.  
**Minimum scope:** Only demonstrated blocker, safety problem or material confusion adjacent to authorized work. Examples: naming collision, old script retention, grooming, Map future work.  
**Not in scope:** Standalone infrastructure-polishing campaign.  
**Trigger:** Blocker/safety issue or cheap adjacent cleanup.  
**Proof/DoD:** Specific blocker/confusion removed under its technical acceptance checks.

---

# Cross-Cutting Architecture Rules

**A. One seller truth regardless of channel.** Facts from Brad, Voice AI, SMS/email AI, web form or future sources should land in the same authoritative seller/deal model where appropriate.

**B. Human economic approval gates.** AI may gather, summarize, classify and recommend. Brad retains authority for approved ARV, repairs, underwriting/Seller MAO, Opening Offer and negotiated agreement.

**C. System ownership.** PropStream owns specialized lead/property sourcing; GHL owns communications/CRM automation; IAOS owns investor cockpit, decision support and cross-system workflow.

**D. Operator proof versus machine proof.** Track harness/fixture proof separately from Brad successfully doing the thing on a real seller/deal.

**E. Build around the conversation.** The Seller Acquisition Workflow remains product-design authority: IAOS should help Brad listen, decide and act rather than become a data-entry clerk.

---

# Known Existing Foundation To Preserve

Dashboard/queues; Contact Workspace; Conversations read-only; Calendars read-only; Pipeline/Contacts; GHL seller workflows/nurture; existing IAOS→GHL dialer path; PropStream CSV importer and environment safety; Test sandbox/isolation; Underwriting Workspace/core/resolver; Investor Policy hierarchy; Opportunity underwriting authority; approval path; scoring/segmentation concepts; Seller Acquisition Workflow; Seller Call Flow; Foundational Principles; GHL Configuration Reference (captured 2026-08-20).

# Next Review Process

1. Jess maintains/reconciles this inventory against capability truth.
2. Claude adversarially reviews factual claims only and identifies omissions/errors with evidence.
3. Brad corrects from operator experience and decides what matters most.
4. Only then convert survivors into **NOW / NEXT / LATER / NOT YET** and reconcile `PRODUCT_BACKLOG.md`.
5. No implementation or backlog rewrite is authorized by this file.
