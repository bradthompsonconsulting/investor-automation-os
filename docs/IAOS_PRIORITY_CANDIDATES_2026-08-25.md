# IAOS Priority Reset — Candidate Master List

**Captured:** 2026-08-25  
**Status:** DRAFT / NOT AUTHORIZED FOR IMPLEMENTATION  
**Purpose:** Preserve the full set of IAOS + GHL capability priorities discovered during the post-sandbox reset before final ranking.  
**Branch:** `planning/priority-reset-2026-08-25`  

This file is intentionally **not** a replacement for `PRODUCT_BACKLOG.md`. It is a recovery artifact so the ideas discovered during the priority reset cannot be lost while Jess reconstructs capability truth, Claude fact-checks it, and Brad makes the final priority decision.

## True North

IAOS is the investor's operating cockpit. It should bring the right information, decisions, and actions into one workflow while allowing specialized systems to do the jobs they already do well:

- **PropStream:** lead/property sourcing, distressed-property discovery, specialized property data and comps where useful.
- **GHL:** CRM system of record, communications, workflows, nurture, telephony, AI conversations/voice, appointments and follow-up automation.
- **IAOS:** operator experience, prioritization, structured seller acquisition, decision support, underwriting/offer intelligence, next-action control and orchestration across the stack.

Guiding tests:

1. Does this materially help Brad operate as a wholesaler?
2. Does it move a real seller/deal toward revenue faster?
3. Can PropStream or GHL already do this well enough that IAOS should integrate/orchestrate rather than rebuild it?
4. Is this needed now, or are we building ahead of demonstrated need?

The order below is a **working priority hypothesis only**. It is not final and does not authorize implementation.

---

# Candidate Priority Order

## 1. Seller Acquisition / Call-Center Workspace — NOW candidate

Build the core IAOS operator cockpit around the real seller conversation rather than around disconnected CRM pages.

Desired experience:

- Open seller/lead and begin work from one screen.
- On-screen seller call script / conversation guidance.
- Known seller/property facts visible before and during the call.
- Questions and answer-entry fields appear in the natural call flow.
- Answers save as structured facts while Brad talks rather than requiring duplicate data entry later.
- Capture motivation, timeline, occupancy, decision-makers, condition, debt/title concerns, asking price and other qualification facts.
- Property-condition answers feed future repair-estimation logic.
- Qualification facts feed future underwriting/MAO logic.
- Persistent seller/deal context during the conversation.
- Seller Stated Minimum / seller position when learned.
- Current Investor Offer when one exists.
- Negotiation history / offer progression.
- Opening Offer state.
- Next action / follow-up state after the conversation.
- Eventually surface underwriting and offer guidance without leaving the seller workflow.

The product goal is a **call-center agent desktop for a wholesaler**, not merely another contact detail page.

## 2. IAOS-Native Calling Experience + GHL Record Sync — NOW investigation candidate

Investigate the lightest architecture that lets Brad initiate a seller call from IAOS with as close to one-click behavior as practical while preserving the GHL record that matters.

Desired behavior:

- Click Call from IAOS.
- Prefer a direct/simple phone experience, potentially including a cell-phone handoff/bridge if technically appropriate.
- Stay in IAOS for script, qualification and seller data capture.
- At call completion, write appropriate notes, disposition, timestamps, follow-up state and structured seller facts to GHL.
- Determine whether/how actual call audio can remain recorded and associated with GHL if the call is initiated outside the existing GHL dialer flow.
- Do not sacrifice reliable GHL system-of-record behavior merely to remove one click.

Existing fallback remains usable: **IAOS → GHL → GHL dialer → seller**.

Related GHL pre-flight checks discovered:

- Verify per-number call recording configuration.
- Verify inbound callback routing actually reaches Brad.
- Reconcile/understand multiple phone numbers used in templates, A2P sending and staff/call-forward configuration.

## 3. GHL AI Seller Qualification — NOW/HIGH investigation candidate

Use GHL AI to reduce the number of unqualified sellers Brad personally has to work, while keeping economic decisions and offers human-controlled.

Potential uses:

- **Outbound Voice AI qualification** where legally/compliantly permitted.
- **Inbound Voice AI answering** for missed/after-hours seller calls.
- Gather basic seller qualification facts: still interested in selling, occupancy, condition, motivation, timeline, asking price, decision-maker status, etc.
- AI should **not negotiate deals or make seller offers**.
- Write captured qualification data into the same GHL/IAOS structured fields used by the Seller Acquisition Workspace.
- Escalate qualified/hot sellers to Brad.
- Book appointments where appropriate.
- Potential live transfer/handoff to Brad for a hot seller.

Compliance/consent requirements for cold AI/prerecorded outreach must be verified before authorization.

## 4. GHL Conversation AI Across SMS / Email / Chat — HIGH candidate

Use GHL's communication layer instead of building IAOS-native messaging bots.

Potential uses:

- Seller responds to outreach by SMS/email/chat.
- AI conducts the first qualification exchange.
- Collects the same core facts used by voice qualification and Brad's call workflow.
- Updates structured seller fields.
- Books an appointment or hands off when appropriate.
- Re-engages Brad when a seller becomes active/hot.
- Keeps IAOS focused on intelligence and operator workflow rather than recreating GHL communications.

## 5. AI Post-Conversation Extraction, Summaries and Pre-Call Briefing — HIGH candidate

Reduce manual data entry and make every seller interaction useful to the next one.

Potential capabilities:

- Extract structured seller/property facts from call transcripts, notes, SMS and email conversations.
- Produce concise seller/conversation summaries.
- Identify unanswered qualification questions.
- Generate a pre-call brief from known property data, prior interactions, campaign/source, motivation, previous dispositions and outstanding questions.
- Recommend the next useful action without autonomously making economic commitments.

## 6. Lead Prioritization / "Who Should Brad Call Next?" — HIGH candidate

Evolve IAOS queues/scoring toward one operational answer:

> Who deserves Brad's attention next?

Potential inputs:

- Motivation.
- Timeline.
- Seller engagement/replies.
- AI qualification results.
- Previous call attempts/dispositions.
- Property/deal facts.
- Data completeness.
- Follow-up dates.
- Current acquisition stage.

Existing scoring and queue work should be reused rather than replaced blindly.

## 7. Next-Action / Exception Management — HIGH candidate

Every active seller/deal should have a clear next move, and IAOS should surface exceptions rather than require Brad to babysit the machine.

Examples:

- Call today.
- Research comps.
- Repair estimate needed.
- Missing qualification fact.
- Follow up Friday.
- Seller replied after nurture.
- AI could not classify response.
- Appointment missed.
- Offer follow-up overdue.
- Workflow/automation exception.

Goal: manage by exception and prevent opportunities from dying because the next action was forgotten.

## 8. Property Intelligence: Practical ARV / Comps Workflow — HIGH candidate

The existing underwriting engine consumes ARV but IAOS does not currently produce a defensible ARV.

Near-term principle:

- **Do not rebuild PropStream.**
- Use PropStream or other appropriate property-data/comps sources for specialized research.
- Give IAOS an efficient way to capture the selected ARV and, eventually, the evidence/confidence behind it.
- Determine the minimum workflow Brad needs to move from seller/property facts to an approved ARV without leaving loose numbers scattered across systems.

County/public-record and other lead/property sources are future possibilities, not immediate requirements.

## 9. Repair Estimator / Condition-to-Repairs Workflow — HIGH candidate

This may be especially IAOS-native because property-condition information is gathered during the seller conversation.

Desired progression:

Seller condition answers → structured condition facts → suggested repair range / repair builder → Brad review/adjustment → approved repair input → underwriting.

Do not treat AI/automation output as unquestioned truth. Brad retains approval authority over the repair number used for underwriting.

## 10. New IAOS-Native MAO / Offer / Negotiation Experience — HIGH, downstream candidate

The deleted legacy MAO Calculator is **not** to be restored as-is. It was deliberately removed so the future calculation experience can fit IAOS rather than forcing IAOS around the old calculator.

The existing Underwriting Workspace / economic engine is substantial and technically proven. Future work should build the operator experience around it.

Desired experience once required inputs exist:

- ARV.
- Repairs.
- Investor policy / deal overrides.
- End-Buyer Maximum Purchase Price.
- Seller MAO as the underwriting ceiling/guardrail.
- Seller asking price / seller position.
- Proposed Opening Offer / Brad-approved Opening Offer.
- Ask-to-MAO gap.
- Negotiation progression/history.
- Human approval gates before economic commitments.

Offer/negotiation should ultimately live naturally inside or alongside the Seller Acquisition Workspace rather than as an isolated calculator page.

## 11. GHL Missed-Call / Inbound Recovery — HIGH/MEDIUM candidate

Ensure a seller who calls back is not lost when Brad cannot answer.

Potential flow:

Inbound seller call → Brad unavailable → GHL Voice AI or appropriate recovery mechanism answers → captures reason/context/qualification → schedules or escalates → IAOS surfaces seller for Brad.

This includes verifying current inbound routing before building anything new.

## 12. GHL Nurture Reactivation / AI Escalation — MEDIUM/HIGH candidate

Use the substantial existing seller follow-up/nurture machinery rather than replacing it.

Potential improvement:

- Old seller replies months later.
- GHL/AI recognizes meaningful renewed interest.
- Basic qualification is gathered if needed.
- Seller automatically returns to active IAOS attention instead of remaining buried in Conversations or nurture.

## 13. GHL Ringless Voicemail / Voicemail-Drop Campaigns — MEDIUM candidate, compliance-sensitive

Evaluate GHL's existing voicemail capabilities for appropriate follow-up/reactivation campaigns.

Questions before use:

- Applicable consent/compliance rules.
- Which seller populations are eligible.
- Whether the tactic materially improves response versus existing outreach.

Do not build this capability in IAOS; orchestrate/track it if adopted.

## 14. GHL Human Call Bridge / Hot-Lead Transfer — MEDIUM/HIGH investigation candidate

Evaluate GHL's ability to call/alert Brad and then bridge or transfer to a seller.

Potential uses:

- Alternative to the current IAOS → GHL dialer extra-click path.
- AI qualifies seller and immediately transfers a hot lead to Brad.
- Workflow alerts Brad with context before connection.

This should be evaluated alongside Priority Candidate #2 rather than treated as a separate build by default.

## 15. Easy Production Lead Import — MEDIUM / "only if cheap" candidate

Lead import already works as a manual/CLI process. Do not turn it into a large project merely because the routed IAOS Import page is currently a stub.

Desired rule:

- If a safe operator-friendly PropStream import can be added quickly, do it.
- If it becomes a substantial project, continue using the working manual process until real volume proves the need.

## 16. GHL Marketing Execution / Existing Workflow Audit — MEDIUM candidate

Let GHL be GHL and PropStream be PropStream.

IAOS does **not** need to recreate PropStream's lead-generation engine or campaign tooling now.

What is worth understanding/configuring in GHL:

- Existing Seller Cold Outreach workflow.
- Seller Lead Submitted / Engagement workflows.
- Follow-up and Long-Term Nurture.
- Email/SMS/voice capabilities actually enabled.
- AI qualification insertion points.
- Appointment booking/rescheduling.
- Reply detection and escalation.
- Existing Hot/Warm/Low mail sequences.

Goal: integrate useful GHL capabilities into the IAOS operating flow, not rebuild them.

## 17. Existing P1 Daily-Workflow Defects That Interfere With the New Core — MEDIUM / dynamic candidate

Existing backlog work is not discarded. It is subordinated to the operator workflow.

Current known examples include:

- Call or note clears unanswered flag.
- Define disposition effect on queue placement.
- PB-D48 / FIELD_REGISTER classification work.
- Contact Workspace field editors.
- Opportunity create/edit depth.
- Contact search improvements.
- Navigation/cross-surface flow.

Rule: promote these when they materially block or degrade the Seller Acquisition Workspace, qualification, underwriting, offer workflow, or Brad's daily operation. Do not finish them merely because an old P1/P2 label says so.

## 18. Underwriting Engine Maintenance / Operator Proof — MEDIUM, not rebuild candidate

Current underwriting capability is much stronger than the backlog makes it appear:

- Underwriting Workspace is routed.
- Calculation core exists.
- Resolver exists.
- Investor Policy / starter policy hierarchy exists.
- Opportunity is underwriting authority.
- Approval path exists and has technical/fixture proof.

Near-term work should focus on feeding it defensible ARV/repair inputs and integrating it into the acquisition workflow, not rebuilding the engine for its own sake.

A real seller deal will provide the first meaningful **operator proof**.

## 19. Marketing / Lead-Source Expansion Beyond PropStream — FUTURE

Not necessary now or in the near future.

PropStream is a strong current source for distressed-property discovery. Possible future sources include:

- County/public records.
- Other specialized lead providers.
- Website/landing-page seller intake using the existing seller-lead mechanism.
- Paid advertising / inbound seller marketing.

Do not build a broad IAOS marketing engine simply to duplicate PropStream.

## 20. IAOS Campaign/Revenue Analytics Feedback Loop — FUTURE

Eventually IAOS should learn from its own outcomes without trying to replace PropStream's campaign tooling.

Potential questions:

- Which lead sources become conversations?
- Which seller situations become contracts?
- Which qualification signals predict deals?
- Which outreach creates responses?
- Which offers are accepted?
- Which underwriting assumptions correlate with successful/failed deals?

This becomes more valuable after real deal volume exists.

## 21. Contracts / E-Sign / Contract Readiness Automation — LOW / MANUAL FOR NOW

Manual process is acceptable initially.

Future IAOS capabilities could include:

- Contract-readiness checklist.
- Accepted-price freeze.
- Required seller/property data validation.
- Document generation/integration.
- Signature status.
- Durable contract state and next actions.

Do not prioritize ahead of generating and negotiating real seller opportunities.

## 22. Buyer / Disposition Workflow — LOW / MANUAL FOR NOW

Manual process is acceptable until real contracts and deal volume demonstrate the need.

Future possibilities:

- Buyer list / buyer qualification.
- Deal package creation.
- Buyer matching.
- Buyer outreach.
- Offer collection.
- Assignment tracking.

## 23. Closing / Revenue Management — OUT OF CURRENT SCOPE

Eventually IAOS may track title/closing, assignment, transaction completion and actual revenue attribution. Not a current build priority.

## 24. SaaS / Multi-Tenant / Productization — DEFERRED

Long-term goal remains to make IAOS usable/sellable to other investors, but Brad's own successful operation comes first.

Examples currently deferred:

- Multi-tenant OAuth.
- Agency Pro / SaaS packaging.
- Remaining inbound auth/productization work.
- `ghl-proxy` OAuth successor where productization rather than Brad's operation is the driver.

## 25. Low-Value Technical / Backlog Housekeeping — DEFER UNLESS IT BLOCKS WORK

Examples:

- Phase B naming collision cleanup.
- Old helper/apply script retention decisions.
- General backlog grooming.
- Map page future work.
- Other technical cleanup with no material operator impact.

The sandbox exists so important development can move safely; it should not become an excuse to keep polishing infrastructure instead of the product.

---

# Cross-Cutting Architecture Candidates

These are not separate priority projects by default; they are rules/questions that affect several projects above.

### A. One seller truth regardless of channel

Whether a fact comes from Brad's call, GHL Voice AI, SMS Conversation AI, email, a web form, or a future source, it should land in the same structured seller/deal model where appropriate.

### B. Human economic approval gates

AI may gather, summarize, classify and recommend. Brad retains authority for consequential deal economics, including approved ARV, approved repairs, Seller MAO/underwriting approval, Opening Offer and negotiated agreement.

### C. System ownership

Do not duplicate specialized systems without a demonstrated reason:

- PropStream owns specialized lead/property sourcing functions.
- GHL owns communications/CRM automation.
- IAOS owns the investor cockpit, decision support and cross-system operating workflow.

### D. Operator proof versus machine proof

Track separately:

- **Proven by harness / technical fixture**.
- **Proven by operator on a real seller/deal**.

A capability can be technically sound and still need field validation.

### E. Build around the conversation

Seller Acquisition Workflow remains the product-design authority: the conversation is the unit of work. IAOS should help Brad listen, decide and act rather than force him to become a data-entry clerk.

---

# Known Existing Foundation To Preserve

Do not mistake absence from the old backlog for absence from IAOS. Current known foundation includes, among other things:

- Dashboard / queue work.
- Contact Workspace.
- Conversations read-only.
- Calendars read-only.
- Pipeline/contacts surfaces.
- GHL seller workflows and nurture.
- Existing IAOS → GHL dialer seller-call path.
- PropStream CSV importer with Test/Production safety work.
- Test sandbox / environment isolation infrastructure.
- Underwriting Workspace.
- Underwriting calculation core and resolver.
- Investor Policy hierarchy.
- Opportunity-side underwriting authority.
- Underwriting approval path.
- Existing scoring/segmentation concepts.
- Seller Acquisition Workflow design authority.
- Seller Call Flow design source.
- Foundational Principles.
- GHL Configuration Reference captured 2026-08-20.

---

# Next Review Process

Before this becomes an authorized execution board:

1. **Jess:** maintain/reconcile this candidate inventory against actual capability truth.
2. **Claude:** adversarially review factual claims only; identify omissions or incorrect capability states with direct evidence.
3. **Brad:** correct from operator experience and decide what matters most.
4. Only then convert the surviving candidates into **NOW / NEXT / LATER / NOT YET** and reconcile `PRODUCT_BACKLOG.md`.
5. No implementation or backlog rewrite is authorized by this file.
