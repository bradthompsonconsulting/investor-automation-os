# Seller Acquisition Workflow

## What this document is

This is a product-design authority. It describes what IAOS is ultimately
being built toward, so that later decisions can be tested against a
stated intent rather than against whatever seemed reasonable that day.

It is not an implementation spec and it authorizes no code. Where it
describes a capability, that capability is a direction, not a
commitment. `UNDERWRITING_WORKSPACE_SPEC.md` answers what is being
built now; this document answers what that surface is growing into.

**Primary source.** `docs/CALL_FLOW_OF_WHOLESALER_TO_SELLER.txt`,
written by Brad. That document walks a complete seller call from prep
through contract readiness and states what IAOS should be doing at each
point. Where this document and that source differ, the differences are
marked and dated -- they are later decisions, not corrections of the
source.

The source entered the repository by transcription rather than by copy,
because the original existed only as a conversation attachment. Its
content is preserved; whitespace and a few non-ASCII marks are
normalized, so its line count differs from the original and no line
count is cited here. The file carries its own note saying the same.

**Scope discipline.** Nothing here expands current implementation
scope. The Underwriting Workspace remains the current deliverable and
remains bounded by PB-D55, PB-D56 and its own specification. This
document exists so that work does not accidentally architect itself
into a calculator-shaped corner.

---

## The product thesis

**IAOS should help the wholesaler listen more, not ask more questions.**

That single line governs everything below it. The unit of work is the
conversation, not the calculation. A seller call is a human exchange
that happens to produce underwriting inputs; it is not a form being
completed out loud.

The consequences are concrete. The rep should almost never have to
think "where do I go now" -- the software advances with the
conversation. The seller should never experience the call as a
questionnaire. And IAOS should interrupt only when something is
missing, contradictory, or outside underwriting parameters.

**Known, Needs Confirmation, Unknown.** The source names this as call-
prep behaviour and it generalises. IAOS distinguishes what it already
knows (do not ask again), what it holds but should verify naturally,
and what is genuinely absent. A system that asks a seller something it
already knows has failed at its job even if the field gets populated.

**Extract, then confirm.** Where transcription or extraction exists,
the rep confirms structured data rather than typing it. The source's
example: a seller describing an inherited, vacant property with
carrying costs should produce proposed values for occupancy,
motivation, timeline and key concern -- which the rep accepts or
corrects. This is how the software makes the rep more present in the
conversation rather than turning them into a data-entry clerk.

---

## Stage-driven, not call-count-driven

**Every seller interaction resumes from the last verified state and
advances the opportunity as far as the available information
legitimately supports.**

IAOS is optimised to make a one-call close possible and is never
designed to force a one-call process. A motivated seller with a
straightforward property may close in twenty-five minutes. Another deal
may run discovery, then research, then an offer the next day, then four
follow-ups, then agreement three weeks later. Same workspace, different
pace.

**Do not build screens named for call numbers.** There is no "Call 1
screen." The source originally framed three call stages -- discovery,
offer, follow-up -- and then corrected itself: design around stages of
information readiness instead. That correction is adopted here.

**Follow-up is not failure.** A large part of acquisitions is timing. A
seller who will not move today may move in thirty days when the
property has not sold, the carrying costs have continued, or another
buyer has fallen through. What matters is that the next conversation
does not start from zero.

**Negotiation state must survive the call.** Initial ask, last seller
position, our last offer, Seller MAO, unresolved gap, the seller's
stated objection, the follow-up reason and the next follow-up date. The
next rep -- who may be the same person six weeks later -- should not
have to rediscover the deal.

---

## The acquisition lifecycle

The master flow, from the source:

    PREP -> CONNECT -> SITUATION -> CONDITION -> OCCUPANCY ->
    DEBT/TITLE -> PRICE -> ARV + REPAIRS -> UNDERWRITE ->
    BUYER MAX -> SELLER MAO -> COMPARE TO ASK ->
    CHOOSE OPENING OFFER -> PRESENT -> LISTEN ->
    NEGOTIATE AGAINST FIXED MAO -> ACCEPT / FOLLOW-UP / PASS ->
    CONTRACT READINESS -> NEXT ACTION

Selected stages, with the behaviour that matters:

**Prep.** One compact screen of everything already known: seller,
property, existing financial information, prior research. Plus a
prominent underwriting status naming what is still missing. The rep
knows before dialling what IAOS still needs.

**Connect.** The purpose is permission to have a conversation, not
underwriting. Do not throw a property questionnaire on screen. The
software should get out of the way.

**Situation.** Where the rep should spend real time. Why sell, why now,
what happens if they do not, what matters most about the sale. Free
conversation first, structured data second.

**Condition.** Walk the house conversationally rather than reciting a
thirty-item checklist. "What have you updated in the last five or ten
years" is worth more than most direct condition questions. A running
repair estimate should be labelled honestly while incomplete --
preliminary with unresolved items named, never false precision.

**Occupancy and debt/title.** These rarely affect the MAO calculation
and frequently affect whether the transaction can be executed at all.
The source draws the distinction that matters: *required for MAO* is
not the same as *required before contract*.

**Price discovery.** The seller talks first. What were they hoping to
get, how did they arrive at it, how much flexibility do they have.
Seller Asking Price and Seller Stated Minimum are different facts and
neither may overwrite the other.

**Underwrite.** Calculate continuously once Gate 1 resolves rather than
behind a button. Display the waterfall.

**Compare to ask.** Automatic. Above range reports the gap; within
range reports the cushion. IAOS knows the economics. It does not know
the right negotiating number and does not pretend to.

**Opening offer.** The human's decision, entered by the human. IAOS
shows what it implies -- below ask, below MAO, resulting cushion --
and recalculates nothing upstream. Changing the opening offer never
changes Seller MAO.

**Present, then listen.** After the offer is made, do not cover the
screen with prompts. The source calls this LISTEN MODE: one field for
the seller's response, and otherwise quiet. This is a real UI
requirement, not a flourish.

**Negotiate.** Each movement recorded, the MAO always visible, and an
immediate read on whether the current seller position sits inside or
outside underwriting.

**Diagnose rather than manipulate.** When the seller's minimum sits
above Seller MAO, IAOS states the unresolved gap and offers legitimate
paths: follow-up or nurture, verify ARV, verify repair scope, an
alternative transaction structure, pass, or a deliberate
outside-parameters decision. What it must never do is present an
evidence change as a way to make the deal work.

**Agreement and contract readiness.** The negotiated result freezes.
IAOS then checks the non-MAO items that matter before paperwork:
correct legal owners, address, agreed price, closing timeline,
occupancy and possession, known liens and title complications,
delivery and signing information.

**Next action.** IAOS creates the next actions rather than relying on
the rep's memory, whether the outcome was a verbal acceptance or a
follow-up date.

---

## The workspace: six sections and a rail

The source is explicit that the rep must not navigate fifteen pages
corresponding to fifteen steps. One workspace, roughly six sections,
progressively unlocking as the conversation moves:

    Lead & Seller        identity, property, history, call context
    Situation            motivation, timeline, decision makers, goals
    Property             condition, repairs, occupancy, notes
    Price & Deal         ask, mortgage and liens, ARV, repairs
    Underwriting & Offer buyer economics through opening offer
    Negotiation & Close  counters, accepted price, readiness, next steps

**The persistent call rail is the most important UI element in this
document.** Whichever section the rep is in, a small panel stays
visible for the whole call. Four numbers matter most:

    Seller Ask                 what they want
    Seller MAO                 where we must stop
    Current Seller Position    where they are now
    Current Investor Offer     where we are now

Those four state the negotiation almost instantly. Before Gate 1
resolves, the rail says what it is waiting for rather than showing a
blank or a zero.

**The rail is the argument for giving underwriting its own screen.**
Seller MAO is a guardrail during negotiation. A guardrail that scrolls
out of view when the seller says a number is not a guardrail.

---

## Three readiness gates

The information required to calculate a MAO is not the information
required to intelligently acquire a property, and neither is the
information required to execute a transaction. Three distinct gates:

**Underwriting Readiness -- DEFINED.** Can IAOS calculate a defensible
Seller MAO? ARV and repairs present, and every required assumption
resolves through Deal Override, Investor Policy or IAOS Starter. This
gate is mathematically specified by PB-D56 and implemented today.

**Offer Readiness -- CONCEPT ESTABLISHED, CRITERIA UNDECIDED.** Do we
know enough about the seller and the property to negotiate responsibly
from that underwriting? The source sketches it as sufficient seller
understanding, sufficient property condition, and sufficient confidence
in ARV and repairs.

The concept is sound and the criteria are not decided. "ARV confidence:
Low" requires knowing what makes an ARV confident, and nothing in IAOS
knows that. FOUNDATIONAL_PRINCIPLES principle 19 forbids manufacturing
a recommendation from insufficient information, and inventing a
confidence score to satisfy a UI would be exactly that. Offer Readiness
becomes implementable when someone decides what evidence supports it,
and not before.

*Amendment 2026-09-03, PB-D61.* Board #7 locks the ARV evidence-classification
contract a future comp-retrieval mechanism must implement -- comp states,
primary-comp requirements, expansion levels, the valuation and
conflict-handling arithmetic, and categorical evidence states (HIGH /
MODERATE / LOW / INSUFFICIENT). PB-D61 narrows what "sufficient confidence
in ARV" could eventually mean; it does not decide Offer Readiness's
criteria, and it authorizes no comp-evidence carrier, importer, or
classification engine. This gate remains CONCEPT ESTABLISHED, CRITERIA
UNDECIDED until a future decision spends PB-D61's evidence states on it.

*Amendment 2026-09-04, B8-01 / INV-44.* Board #8's first RESET issue names
Offer Readiness's criteria at the category level -- supported knowledge of
property, repairs/condition, ARV, deal economics, transaction/deal-structure
assumptions, and seller price position, with no unresolved material unknown
that could significantly change the supported offer -- and locks a
UNKNOWN -> PRELIMINARY -> SUPPORTED evidence ladder per category, distinct
from PB-D61's ARV-specific HIGH/MODERATE/LOW/INSUFFICIENT states above.
`docs/DEAL_ECONOMICS_OFFER_READINESS_V1.md` is the full contract. This gate
is therefore no longer CRITERIA UNDECIDED at the category level, but the
mechanism that assigns any fact's evidence level -- rep judgment, derived
completeness, or a hybrid -- remains undecided there, named as a B8-02
reconciliation item rather than invented.

**Contract Readiness -- DISTINCT, DETAIL DEFERRED.** Do we have what is
needed to turn an agreement into an executable transaction? The source
lists the items; the gate's precise definition belongs to contracting
work that has not begun.

---

## Authority: what IAOS owns and what the investor owns

**IAOS governs underwriting policy. The investor owns deal facts.**

This is the line that reconciles a tension the source contains. Section
13 of the source argues IAOS should resist a rep changing ARV to make
the calculator green.

*Amendment 2026-08-14, Brad, Product Owner.* The investor determines
the ARV used for underwriting. Appraisal evidence and relevant
comparable sales are the standards that inform that judgment.
Automated valuations and third-party websites may eventually be inputs;
they are not authorities and never override the investor.

Therefore: **IAOS recalculates and does not editorialise.** If the
investor changes ARV, the software shows the new result. It does not
block, scold, ask why, or manufacture an optimism warning. The app is
advisory and must not get in the way of a sale.

**What IAOS must never do is suggest the change.** The software does
not propose an evidence change as a way to make a deal work, does not
present ARV as a negotiation lever, and does not compute what ARV would
be required to reach a seller's number. Evidence changes on evidence.
The rep may move a number; the software must not be the thing that
suggested moving it.

**Negotiation pressure never changes underwriting facts.** The source
states this and it is adopted verbatim as a product rule. It is
compatible with the amendment above: the investor changing an ARV
because they have better information is a fact changing on evidence,
while the software nudging an ARV because a deal is not closing is the
model corrupting itself.

**Seller debt does not make a property worth more.** Where a known
payoff exceeds Seller MAO, IAOS surfaces that as a closing constraint
and does not modify Seller MAO. The same principle as ARV, applied to a
different input: a fact about the seller's circumstances is not a fact
about the property's value.

**Out-of-parameters is flagged, never blocked.** Consistent with PB-D56
and the workspace specification. An above-MAO offer, a below-minimum
manual spread, a deliberate exception -- all visible, all permitted,
none prevented. Human authority is preserved and the software does not
make an out-of-parameters decision look ordinary.

---

## Capabilities this document describes that do not exist

Recorded so that nothing here is mistaken for something the data model
already supports. Each needs its own decision and, where persistent, a
carrier that PB-D56 section VI would create on first real need.

**No carrier exists for:**

    Current Seller Position       negotiation state
    Current Investor Offer        negotiation state
    Negotiation history           round-by-round movement
    Seller Stated Minimum         distinct from asking price
    Opening Offer                 human decision, not persisted today
    Manual assignment spread      the amount, not the mode
    Accepted price                contracting concern
    Stage / readiness state       derived or persisted, undecided

The manual assignment spread gap is already recorded in
`SESSION_HANDOFF.md`: Assignment Mode records which mode governs and
nothing records the manual dollar figure.

**No mechanism exists for:** transcription or AI extraction, a repair
builder, comp retrieval or ARV sourcing, confidence scoring of any
input, or contract generation. PB-D61 locks the evidence-classification
contract Board #7's comp-retrieval mechanism must implement; locking the
contract does not build the mechanism, and none of the items in this
paragraph is any less absent for it.

**Undecided and deliberately not decided here:** what evidence supports
Offer Readiness; whether ARV source or provenance is captured at all,
and if so by what carrier; whether stage state is derived or persisted;
and every question the workspace specification already lists as open.

---

## How to use this document

When a future capability is proposed -- transcription extraction, a
repair builder, seller-position tracking, an AI proposer, any of it --
the test is:

**Does this make the seller conversation easier, and does it move the
opportunity intelligently toward the next readiness state?**

If the answer is unclear, the feature is not ready to build. That test
sits alongside FOUNDATIONAL_PRINCIPLES principle 7 -- build toward the
sale -- and does not replace it.
