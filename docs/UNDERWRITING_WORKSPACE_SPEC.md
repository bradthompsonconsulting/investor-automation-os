# Underwriting Workspace Specification

## What this document is

This specification defines how IAOS exposes and operates the underwriting
decisions already made. It implements PB-D55 and PB-D56. It decides no
economics and creates no authority of its own.

**Inherited from PB-D55.** Underwriting authority belongs to the
Opportunity. Proposed, approved, and presented are distinct states with
distinct authority. Approved values are not mirrored to the Contact.

**Inherited from PB-D56.** The economic model, the six deductions, the
eleven investor-policy assumptions and their starter values, the
three-level resolution hierarchy, the carriers, and the rule that unknown
is never zero.

**Established here.** The four-zone surface. The acquisition-position
states. Opening Offer as a human decision the workspace does not
calculate. The Working / Approved / Contracting-ready progression. The
separation of negotiation levers from underwriting evidence. The
displayed economic lifecycle below.

Where a rule below is inherited, it is marked. Everything unmarked is
established by this document and is open to revision without amending a
PB decision.

---

## The economic lifecycle

Five named quantities, in the order they come to exist. Naming them
separately is the point: several are close in value and none is
substitutable for another.

    Assignment Spread
        The effective wholesaler spread reserved on this deal. It is
        produced by PB-D56's three assignment modes:

            Standard Minimum
            25% of Buyer Profit
            Manual

        Standard Minimum and 25% derive the value from policy. Manual is
        the human override path. All three produce one effective
        Assignment Spread; there is no separate Planned Assignment Fee.

    End-Buyer Maximum Purchase Price
        The modeled ceiling. What a representative flip buyer could pay
        and still meet their return requirement.

    Seller MAO
        = End-Buyer Maximum Purchase Price - Assignment Spread
        The acquisition ceiling. The most the wholesaler can pay while
        preserving the effective assignment economics.

    Opening Offer
        A human decision. What the wholesaler actually offers. IAOS does
        not calculate it in V1.

    Actual Contract Price
        A fact, once a contract exists. Owned by contracting, not by
        this workspace.

**One spread, three modes.** PB-D56's assignment modes are the complete
V1 mechanism for determining the Assignment Spread. Manual is not a
second layer on top of a required value; it is the explicit human
override mode. When Manual produces an Assignment Spread below the
configured Standard Minimum Assignment Spread, the workspace flags the
deal as outside standard parameters and does not block it.

**The chain runs one direction only.** Deal facts and assumptions produce
End-Buyer Maximum Purchase Price. The effective Assignment Spread then
produces Seller MAO. Nothing downstream of Seller MAO can change it:

    Changing Opening Offer NEVER changes Seller MAO.

Seller MAO moves only when deal facts change, when an underwriting
assumption changes, or when the effective Assignment Spread changes.
This invariant exists because a calculator whose ceiling moves when you
decide what to offer is not a ceiling.

---

## The four zones

### Zone 1 -- Deal Inputs

**What do we know?** Editable, at the top.

    ARV                     required for underwriting
    Repairs                 required for underwriting
    Seller Asking Price     not required; enables acquisition position

*Inherited:* ARV and Repairs are Gate 1. Every other underwriting input
resolves from policy (PB-D56).

**When Gate 1 cannot resolve, say what is missing.** Not "unable to
calculate" but:

    Missing: ARV
    Underwriting cannot begin until ARV and Repairs are available.

The workspace's most useful output when it cannot compute is the name of
the input it needs.

Asking price is absent on most new leads and its absence is a normal
state, not a defect.

### Zone 2 -- Decision Panel

**Does this work?** Readable at a glance. The three headline numbers:

    End-Buyer Maximum Purchase Price
    Seller MAO
    Acquisition Position

Then the supporting figures:

    Assignment Spread
    Assignment Mode
    Acquisition Cushion  or  Gap to Underwriting
    Opening Offer                once entered

**Opening Offer appears here once it exists.** It is edited in zone 3
and displayed here, because on a live seller call it is one of the two
numbers that matter most and the wholesaler should not have to look away
from the decision panel to recall what they just decided.

**Acquisition position has three states, not two.**

    ASKING PRICE UNKNOWN
        Underwriting may be complete. Acquisition position is
        undetermined. Not a defect and not a warning.

    WITHIN UNDERWRITING RANGE          Ask <= Seller MAO
        Acquisition Cushion = Seller MAO - Asking Price
        The seller's price is inside what the economics support.

    ABOVE UNDERWRITING RANGE           Ask > Seller MAO
        Gap to Underwriting = Asking Price - Seller MAO
        The seller must move this amount for the deal to meet standard
        parameters.

**Above Range is not deal failed.** It is a statement about the seller's
current position relative to standard underwriting. The wholesaler may
negotiate the seller down, revise an assumption on new evidence,
deliberately accept thinner economics, or pass. The workspace reports the
condition; the human makes the judgment.

**No "Near Range" band in V1.** A near threshold requires a number, and
no evidence supports one. Cushion and Gap are objective; a band boundary
would be invented.

**A parameters status accompanies the position.** Outside standard
parameters means an effective value or a resulting decision violates a
defined investor-policy guardrail -- a Manual Assignment Spread below
the configured Standard Minimum Assignment Spread, or an Opening Offer
above Seller MAO. Outside is never blocked, always visible.

**A deal override is not by itself outside parameters.** Overriding hold
period from five months to three because this rehab is cosmetic is
better information, not a policy violation. Overrides are labeled with
their provenance in zone 4 and do not raise a warning on their own.

### Zone 3 -- Work the Deal

**What can I change?** Everything recalculates immediately. Two kinds of
change, visually separated, because conflating them is how a calculator
teaches its user to lie to themselves.

**Negotiation and decision levers.** Things the wholesaler controls.

    Assignment Spread and mode
    Opening Offer

**Underwriting evidence.** Things that are true or false about the world.

    ARV
    Repairs
    Selling cost percentage
    Closing cost estimate
    Hold period and monthly carry
    Buyer profit percentage
    Financing switch, LTV, rate, points

**Changing evidence is not a negotiation move.** The workspace shows the
mathematical effect of any change, and it never presents an evidence
change as a way to improve a deal. Raising ARV twenty thousand dollars
makes the numbers work and makes the deal no better. Evidence changes are
justified by new information, not by the answer they produce.

*Inherited:* every assumption resolves Deal Override, then Investor
Policy, then IAOS Starter Policy, then unresolved (PB-D56). A deal
override never modifies policy.

**Opening Offer above Seller MAO warns and does not block.**

    Outside underwriting parameters -- Opening Offer is $7,500 above
    Seller MAO.

Human authority is preserved; the software does not make an above-ceiling
offer look ordinary.

### Zone 4 -- Explain the Math

**Why does IAOS say this?** Collapsed by default so zone 2 stays legible.

    ARV                                     $315,000
      - Repairs                              -41,000
      - End-Buyer Selling Costs              -31,500
      - End-Buyer Purchase/Closing Costs      -2,500
      - End-Buyer Holding Costs               -2,500
      - Required Buyer Profit                -47,250
      = Base Buyer Capacity                 $190,250

      / financing factor (1 + k)
      = End-Buyer Maximum Purchase Price    $181,363

      - Assignment Spread                     -5,000
      = Seller MAO                          $176,363

**Every assumption shows its provenance.**

    Selling costs      10%        IAOS Starter
    Monthly carry      $500       Investor Policy
    Hold period        8 months   Deal Override

*Inherited:* provenance is derived from which levels hold a value, not
stored (PB-D56).

**Financing shows as a factor, not a subtraction.** It divides. Rendering
it in the subtraction column would misrepresent the arithmetic, and the
value would not reconcile.

---

## State progression

    WORKING
        The wholesaler is changing numbers. Nothing downstream treats
        these as authoritative. Not persisted as approved underwriting.

    APPROVED
        An explicit human action. The approved values are written to the
        selected Opportunity and become the durable state anything
        downstream may rely on.

    CONTRACTING-READY
        Contracting consumes the Opportunity's approved values.

*Inherited:* approval is an explicit human action and the Opportunity
holds approved underwriting (PB-D55).

**No publish-to-Contact step, and no staleness carrier.** An earlier
design mirrored approved values onto the Contact for contracting to read,
which required detecting when the mirror went stale. Contracting reading
the Opportunity directly removes the mirror, the staleness problem, and
the PB-D55 amendment that a mirror would have required.

**Contracting reading Opportunity fields is the architectural direction,
not an observed capability.** OBSERVED: HighLevel's published
documentation describes Documents and Contracts templates that can merge
Opportunity values, and public APIs for generating documents. UNKNOWN:
whether this location has Documents and Contracts enabled, whether its
template editor exposes the specific per-deal opportunity custom fields
this model writes, and whether "Opportunity Custom Values" in that
documentation means per-record custom fields or the location-scoped
Custom Values store, which are different mechanisms in GHL. Verify in the
location before building against it. If GHL cannot merge per-deal
opportunity fields, the options are a Contact projection -- which needs a
PB-D55 amendment and a staleness carrier -- or IAOS generating the
document itself. Neither is chosen here.

**Re-approval after contracting has begun is not specified.** What
happens when underwriting changes after a contract exists is a
contracting concern and is out of scope.

---

## Downstream display

Once contracting owns an Actual Contract Price, the workspace may display
what the deal actually became:

    Available Wholesale Spread   = End-Buyer Max Purchase Price
                                     - Actual Contract Price
    Actual Acquisition Cushion   = Seller MAO - Actual Contract Price

**Displayed, not owned.** Actual Contract Price is a fact about an
executed agreement. The workspace reads it; contracting is authoritative
for it. The question changes at that point from "can I buy this" to "what
did I buy," and the second question is not underwriting.

---

## What the workspace never does

**It never manufactures a recommendation from insufficient information.**
IAOS calculates what the economics support, identifies the seller's
position relative to that support, and leaves negotiation judgment to the
human until sufficient seller-specific evidence exists to support a
defensible recommendation.

This is why V1 has no Proposed Opening Offer. Asking price and Seller MAO
together establish the acquisition position and do not establish an
opening number. Every generic rule considered -- a percentage of MAO, a
flat cushion, a tiered band -- recommends offering *more than the seller
is asking* whenever asking price falls below Seller MAO. That is not a
tuning problem; it is evidence the inputs are insufficient. A defensible
recommendation would need seller motivation, timeline, mortgage balance,
stated flexibility, prior reductions, and conversation history. When IAOS
has those, a proposed opening offer with a stated basis becomes
defensible and earns its own decision.

**It never writes `offer_` fields.** *Inherited:* §4.1 HARD NO, and
PB-D55's structural separation of underwriting from presented offer.

**It never treats an evidence change as a negotiation tactic.**

**It never blocks a deliberate exception.** Out-of-parameters states are
flagged and permitted.

---

## V1 exclusions, with reasons

**Proposed Opening Offer** -- insufficient information, above.

**Multiple buyer profiles** -- cash, hard money, private. V1 has one
representative flip buyer. A second profile is built when a second is
needed, not anticipated.

**Rehab financing** -- *inherited* from PB-D56, including its known
direction: omitting it overstates Seller MAO for a buyer who finances
rehab.

**Scenario matrices and sensitivity tables** -- what-if grids across
ranges of assumptions. The workspace recalculates on every change, which
covers the practical need without a display nobody reads.

**A negotiation ladder** -- opening offer, target acquisition, walk-away.
The concept is sound and V1 needs only the ceiling and the human's
offer.

**AI-adjusted ARV or repairs** -- no mechanism may alter underwriting
evidence to make a deal viable. Evidence changes on evidence.

**Near Range threshold** -- requires an invented number.

---

## Open questions

**The acquisition-strategy policy.** If a Proposed Opening Offer is ever
built, its method and starter value are undecided, and it is acquisition
strategy rather than underwriting policy -- it does not join PB-D56's
eleven.

**Where the workspace lives -- DECIDED 2026-08-14.** A dedicated
Contact-context sub-route at `/contacts/{contactId}/underwriting`, with
the selected Opportunity named on screen. Not a section of the existing
Contact page, and not a separate top-level surface.

*Why a sub-route rather than the Contact page.* The persistent call rail
is the deciding argument. `SELLER_ACQUISITION_WORKFLOW.md` establishes
that Seller Ask, Seller MAO, the current seller position and the current
investor offer stay visible for the whole seller call, because Seller MAO
is a guardrail during live negotiation. A guardrail that scrolls out of
view when the seller says a number is not a guardrail. The Contact page
already renders six folders and ninety-eight fields; four underwriting
zones plus a persistent rail do not fit inside it without the rail
losing the one property that makes it useful.

*Why not a separate top-level surface.* Underwriting happens during or
immediately after a seller conversation. The rep is already looking at
the contact -- notes, conversation history, asking price. A separate
destination breaks the workflow the tool exists to serve, and re-solves
contact-to-opportunity linkage that the contact context already has.

*Designed to grow.* `SELLER_ACQUISITION_WORKFLOW.md` describes a broader
Seller Acquisition Workspace of roughly six sections, of which
underwriting is one. This route is chosen so that surface can emerge
around it rather than replacing it. That is a direction, not a
commitment: this decision expands no current implementation scope, and
the deliverable remains the four zones specified above.

**Opportunity selection UI -- DECIDED 2026-08-14.** *Inherited* from
PB-D55: the workspace operates on one identified Opportunity and does not
assume the first is the deal. The presentation, which PB-D55 left open:

    exactly one    auto-selected, and named on screen regardless.
                   There is nothing to guess between, so selection is
                   not a question put to the operator -- but PB-D55
                   requires the deal under underwriting to be named,
                   and one candidate does not relax that.

    more than one  an explicit selector. Never first-match, never
                   most-recent, never any other silent rule. PB-D55
                   exists because a seller may hold two properties or
                   sell the same one twice, and the collision it
                   guards against is silent.

    none           the workspace reports the absence and underwriting
                   cannot proceed. *Inherited* from PB-D55: nothing is
                   written to the Contact as a substitute.

OBSERVED 2026-08-12 (PB-D52): 41 of the 43 contacts carrying a phone hold
exactly one Seller Leads opportunity, so the auto-select path is today's
normal case. That is a fact about the current population and not a
property of the model; the selector is built because the model requires
it, not because two records happen to need it today.

**Whether approval requires more than Gate 1.** *Inherited* from PB-D56:
ARV and repairs produce proposed underwriting. Whether a human should be
able to approve on two inputs alone is a separate question.

The question now has a name. `SELLER_ACQUISITION_WORKFLOW.md` calls it
Offer Readiness and separates it from Underwriting Readiness: the first
asks whether IAOS can calculate a defensible Seller MAO, the second
whether we know enough about the seller and the property to negotiate
responsibly from it. Gate 1 answers the first and says nothing about
the second.

Its criteria remain UNDECIDED and are deliberately not invented here.
Sufficient confidence in an ARV requires knowing what makes an ARV
confident, and nothing in IAOS knows that. FOUNDATIONAL_PRINCIPLES
principle 19 forbids manufacturing a recommendation from insufficient
information; a confidence score invented to satisfy a readiness
indicator would be exactly that. Naming the gate is progress. Filling
it in is a separate decision with its own evidence.
