import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft, Phone, PhoneCall, MapPin, StickyNote, AlertCircle, Loader2, BellOff,
  Flame, Sun, Snowflake, CalendarClock, ArrowDownLeft, ArrowUpRight, ChevronDown, ChevronRight,
  Calculator,
} from "lucide-react";
import { ghl, getBucketTag, ghlContactDetailUrl, PROPERTY_NOTES_ID, ARV_ID, ESTIMATED_REPAIRS_ID, OCCUPANCY_STATUS_ID, OCCUPANCY_OPTIONS, CONTACT_ASKING_PRICE_ID, type OccupancyStatus, type ContactRow, type ContactDetail, type CustomFieldDef, type BucketTag, type ConvMessageRow, type OpportunityRow } from "../lib/ghl";
/* Board #5 S2d — the rail's logic lives in ../lib/rail, a module with no React
   and no module-scope config read, so it is loadable by a .cjs runner and the
   Ask precedence can be proven offline. This page supplies the ids and renders
   what comes back; it decides nothing about the rail. Inside that module the
   ask precedence still mirrors resolver.ts:329 and still parses both sides
   through resolver.ts's own exported parsers. */
import { deriveRailDeal, railCells, railAuthorityReconciled, contactAskAuthority, RAIL_MONEY, type ContactAskAuthority, type RailDeal, type RailIds } from "../lib/rail";
import { opportunitiesForContact } from "../lib/underwriting/selectOpportunity";
import { CallbackPopover } from "../components/CallbackPopover";
import { DispositionControl } from "../components/DispositionControl";
import { scheduleCallbackGated, formatCallbackTime } from "../lib/callbackWrite";
import { formatPhone } from "../lib/format";
import { ADDITIONAL_INFO_SUBGROUPS, type AdditionalInfoSubgroup } from "../config/additionalInfoSubgroups";
import { getRuntimeConfig } from "../../shared/ghl-config";

/**
 * Contact Workspace — docs/CONTACT_WORKSPACE_SPEC_v2.md §8 steps 1-3.
 *   Step 1: read-only detail (name/phone/address/tier/score), two-column shell.
 *   Step 2: note history (newest first) + new-note autosave-on-blur.
 *   Step 3: callback scheduling via the shared CallbackPopover. Scheduling
 *   writes a note ("Callback scheduled for …"), which greys — §6's existing
 *   rule, gated callback → note → attempt (§6/§5.4 truthfulness).
 *
 * Reads live from GHL every mount — NO app-side shadow copy (contact via the
 * single-record getOne, §11; notes via a read-only GET). Right column
 * (conversation history) is a placeholder until step 5. Call button (step 4)
 * and disposition (step 6) are NOT in scope here.
 *
 * Writes on this page — all three sanctioned (§4), all pre-existing methods:
 *   ghl.notes.create() + ghl.contacts.setLastCallAttempt() + ghl.contacts.setCallbackDatetime()
 * No new write action. tags / stage / offer_ / workflows: never.
 */

const CONTENT_MAX_WIDTH = "1600px";

// D5 — email bodies clamp to this many rendered lines in the conversation
// history. Matches Conversations' CLAMP_LINES; SMS never clamps.
const CLAMP_LINES = 5;

// PB-D51 — both folder ids resolve from the shared config, once at module scope.
// These replace what were previously two function-local OFFER_FOLDER_ID
// declarations plus two bare inline literals. Values are unchanged.
const FOLDERS = getRuntimeConfig().folders;
const OFFER_FOLDER_ID           = FOLDERS.offer;
const ADDITIONAL_INFO_FOLDER_ID = FOLDERS.additionalInfo;

/* Board #5 S2 — rail id bindings. Same config keys UnderwritingWorkspace binds
   at its L44-56, so the two surfaces read the same fields by construction.
   oppFacts is shaped for parseOpportunityValues; only askingPrice is used by
   the rail, but the parser takes the whole set and passing a partial one would
   mean re-implementing it. sellerMAO is separate: it is an underwriting OUTPUT
   that Approve persists, not a deal fact.

   S2d — THE BINDING STAYS HERE; THE READING MOVED. ../lib/rail takes these as
   an argument rather than calling getRuntimeConfig() itself, which is what
   makes it loadable outside a browser. The config keys and therefore the values
   are unchanged. */
const RAIL_CONFIG = getRuntimeConfig();
const RAIL_IDS: RailIds = {
  oppFacts: {
    arv:            RAIL_CONFIG.opportunityFacts.arv,
    repairs:        RAIL_CONFIG.opportunityFacts.repairs,
    askingPrice:    RAIL_CONFIG.opportunityFacts.askingPrice,
    assignmentMode: RAIL_CONFIG.opportunityFields.assignmentMode,
  },
  contactSeeds: {
    arv:         RAIL_CONFIG.fields.arv,
    repairs:     RAIL_CONFIG.fields.estimatedRepairs,
    askingPrice: RAIL_CONFIG.fields.askingPrice,
  },
  sellerMAO: RAIL_CONFIG.opportunityFields.sellerMAO,
};

// ── Presentational helpers (replicated from Dashboard; purely visual, no
//    coupling — Dashboard.tsx is intentionally untouched this phase) ──────────

const TIER_COLOR: Record<BucketTag, string> = { hot: "#EF4444", warm: "#F59E0B", low: "#64748B" };
const TIER_ICON: Record<BucketTag, typeof Flame> = { hot: Flame, warm: Sun, low: Snowflake };

/* ── Board #5 D1 — THE EDITOR GATE ─────────────────────────────────────────
   Return revalidation must never redraw an editor underneath the operator,
   but "is an editor open" is state each row owns privately. Rather than lift
   every row's editing flag into the page, each row REPORTS while it is open
   and the page keeps the set.

   A context, not a module-level counter: two ContactWorkspace instances (a
   remount mid-transition) would share a module counter and one unmounting
   would clear the other's gate. The provider is per-page, so the set is too.

   Registration is by FIELD ID, so a row that unmounts while open — a
   navigation mid-edit — releases the gate through its effect cleanup rather
   than stranding it. A stranded gate would defer a refresh forever. */
type EditorGateApi = { open: (key: string) => void; close: (key: string) => void };
const EditorGateContext = createContext<EditorGateApi | null>(null);

function useEditorGate(key: string, editing: boolean) {
  const gate = useContext(EditorGateContext);
  useEffect(() => {
    if (!gate || !editing) return;
    gate.open(key);
    return () => gate.close(key);
  }, [gate, key, editing]);
}


function contactName(c: ContactRow): string {
  return [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unknown";
}

function formatAddress(c: ContactRow): string {
  const cityStateZip = [c.city, [c.state, c.postalCode].filter(Boolean).join(" ")]
    .filter(Boolean).join(", ");
  return [c.address1, cityStateZip].filter(Boolean).join(", ") || "—";
}

function TierBadge({ tier }: { tier: BucketTag }) {
  const color = TIER_COLOR[tier];
  const Icon = TIER_ICON[tier];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "12px", fontWeight: 600,
      padding: "4px 10px", borderRadius: "999px", whiteSpace: "nowrap",
      background: `${color}1A`, border: `1px solid ${color}44`, color,
    }}>
      <Icon size={12} /> {tier[0].toUpperCase()}{tier.slice(1)}
    </span>
  );
}

function ScoreChip({ label, score }: { label: string; score: number | null }) {
  let color = "#475569";
  if (score !== null) {
    if (score > 0 && score < 25)   color = "#EF4444";
    if (score >= 25 && score < 50) color = "#F59E0B";
    if (score >= 50 && score < 75) color = "#22C55E";
    if (score >= 75)               color = "#1EC8FF";
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        minWidth: "40px", padding: "3px 8px", borderRadius: "6px",
        background: score === null ? "transparent" : `${color}1A`,
        border: `1px solid ${score === null ? "#334155" : `${color}44`}`,
        color: score === null ? "#475569" : color,
        fontSize: "14px", fontWeight: 700, fontFamily: "Space Grotesk, monospace",
      }}>
        {score ?? "—"}
      </span>
      <span style={{ fontSize: "9px", color: "#334155", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
    </div>
  );
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "under 1h ago";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatNoteDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

// Callback display + note copy (§6.1 "Callback scheduled for {Mon D, h:mm A}")
// — the shared formatter, imported from ../lib/callbackWrite.

interface NoteRow { id: string; body: string; dateAdded: string }

// §5.4 Additional Info subdivision — one shape + one bucketer.
type RecordField = { id: string; fieldKey: string; name: string; dataType: string; value: unknown };
const SUBGROUP_ORDER: AdditionalInfoSubgroup[] = ["Reachability", "Property", "Investor", "System"];

// Buckets the Additional Info folder's (position-ordered) fields into the four
// IAOS subgroups via ADDITIONAL_INFO_SUBGROUPS (keyed by fieldKey). A fieldKey
// absent from the config is NEVER dropped — it appends to the END of System.
// Position order is preserved within each subgroup.
function groupAdditionalInfo(fields: RecordField[]): { subgroup: AdditionalInfoSubgroup; fields: RecordField[] }[] {
  const buckets: Record<AdditionalInfoSubgroup, RecordField[]> = { Reachability: [], Property: [], Investor: [], System: [] };
  const unknown: RecordField[] = [];
  for (const f of fields) {
    const sub = ADDITIONAL_INFO_SUBGROUPS[f.fieldKey];
    if (sub) buckets[sub].push(f);
    else unknown.push(f);
  }
  buckets.System.push(...unknown);
  return SUBGROUP_ORDER.map((subgroup) => ({ subgroup, fields: buckets[subgroup] }));
}

// §5.4 single-field render — extracted read-only, byte-identical to the prior inline
// block (same display derivation, same div/spans/styles). No edit capability.
// Phase B PB-D2/PB-D3 — the property_notes unlocked row. Owns its own draft,
// dirty, saving and error state so ContactWorkspace holds no per-field edit
// state. Save calls the named write setPropertyNotes (PB-D1) exactly once;
// Cancel restores the wire value and performs NO write. Empty draft is a real
// clear per PB-D1, not a skip.
function PropertyNotesRow({ f, contactId }: { f: RecordField; contactId: string }) {
  const wire = f.value == null ? "" : String(f.value);
  const [draft, setDraft] = useState(wire);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const current = saved == null ? wire : saved;
  const dirty = draft !== current;

  async function handleSave() {
    setSaving(true);
    setSaveErr(null);
    try {
      await ghl.contacts.setPropertyNotes(contactId, draft);
      setSaved(draft);
    } catch (e) {
      setSaveErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: "12px", fontSize: "13px" }}>
      <span style={{ flex: "0 0 200px", color: "#94A3B8" }}>{f.name}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
        <textarea
          data-testid={`field-input-${f.id}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          style={{ width: "100%", background: "#0F172A", color: "#E2E8F0", border: "1px solid #334155", borderRadius: "4px", padding: "6px", fontSize: "13px", fontFamily: "inherit" }}
        />
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button
            data-testid={`field-save-${f.id}`}
            onClick={handleSave}
            disabled={!dirty || saving}
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            data-testid={`field-cancel-${f.id}`}
            onClick={() => setDraft(current)}
            disabled={!dirty || saving}
          >
            Cancel
          </button>
          {saveErr && <span style={{ color: "#F87171" }}>{saveErr}</span>}
        </div>
      </div>
    </div>
  );
}

// PB-D20 — accepted currency syntax. Optional leading "-", optional "$", digits with
// EITHER correct thousands grouping OR no commas at all, optional single decimal.
// Malformed grouping is INVALID and is never silently stripped: 25,00,0 must not
// become 25000.
const CURRENCY_RE = /^-?\$?(\d{1,3}(,\d{3})*|\d+)(\.\d+)?$/;

// Phase B PB-D16/D17/D19/D20/D21 — the unlocked MONETORY row. currency + inline.
// Model B display-to-edit swap: formatted currency at rest, raw number while editing.
// No Save/Cancel controls. Enter, Tab, or click-out commits; Escape cancels.
//
// SHARED BY ARV AND ESTIMATED REPAIRS (board item #2B). Two consumers is the
// threshold at which this stops being a premature abstraction, and the two rows
// are behaviourally identical: same currency grammar, same display-to-edit swap,
// same three-attempt readback, same status vocabulary. A duplicate would have to
// be kept in step by hand, and the first divergence would be silent.
//
// ⚠ THE SETTER IS A PARAMETER; THE FIELD ID IS NOT A PARAMETER OF A SETTER.
// `save` is supplied by the caller as an already-named method — setARV or
// setEstimatedRepairs — so what travels is a decision that was made per field,
// not a field id handed to a generic writer. PB-D16 §4.4 forbids the latter.
// Sharing the ROW is a UI decision; sharing a WRITER would be a safety decision,
// and only the first one is being made here.
//
// The readback reads `f.id` rather than a module constant. Behaviourally identical
// — FieldRow dispatches this component only for the field whose row it is — and
// it removes the second place a field identity would have to be kept in step.
function MonetaryRow({ f, contactId, save }: {
  f: RecordField;
  contactId: string;
  save: (contactId: string, value: number | "") => Promise<unknown>;
}) {
  const wire: number | "" =
    typeof f.value === "number" ? f.value
    : f.value == null || f.value === "" ? ""
    : Number.isNaN(Number(f.value)) ? "" : Number(f.value);
  const [saved, setSaved] = useState<number | "" | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [status, setStatus] = useState<"idle" | "verifying" | "saved" | "unconfirmed" | "failed" | "unverified">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const cancelRef = useRef(false);
  useEditorGate(f.id, editing); // D1 — defer return revalidation while open
  const current: number | "" = saved == null ? wire : saved;

  const fmt = (v: number | "") =>
    v === ""
      ? "—"
      : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

  function beginEdit() {
    setDraft(current === "" ? "" : String(current));
    setInvalid(false);
    setErrMsg(null);
    setStatus("idle");
    setEditing(true);
  }

  // PB-D21 — "Saved" means GHL was read back and confirmed, never that the PUT
  // returned 2xx. Bounded poll of the SINGULAR contact read, never the PUT echo.
  // Equality is SEMANTIC: numeric compare for a save, KEY ABSENCE for a clear.
  // 0 and missing are different states. The PUT is NEVER repeated.
  async function verify(expected: number | ""): Promise<"saved" | "unconfirmed" | "unverified"> {
    // PB-D21 — a thrown read CONSUMES an attempt and the poll continues. The
    // transport helper throws on any non-2xx as well as on a rejected fetch, so a
    // transient proxy 5xx is indistinguishable from a dead socket; the bound exists
    // to absorb exactly that. The terminal state then depends on whether the
    // instrument ever worked: one COMPLETED read makes the weaker data claim
    // ("unconfirmed"); only a poll that never once reached GHL is "unverified".
    let anyCompleted = false;
    let lastErr: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) await new Promise((r) => setTimeout(r, 1000));
      try {
        const d = await ghl.contacts.getDetail(contactId);
        anyCompleted = true;
        const entry = d.customFields.find((cf) => cf.id === f.id);
        if (expected === "") {
          if (!entry) return "saved";
        } else if (entry && Number(entry.value) === expected) {
          return "saved";
        }
      } catch (e) {
        lastErr = e as Error;
      }
    }
    if (!anyCompleted) {
      setErrMsg(lastErr ? lastErr.message : null);
      return "unverified";
    }
    return "unconfirmed";
  }

  // PB-D20 — the accepted-syntax predicate, extracted so Enter can consult it
  // BEFORE causing a blur. Sets the invalid flag as a side effect; returns
  // whether the draft may proceed to commit. Empty is valid — it is a real clear.
  function draftIsValid(): boolean {
    const raw = draft.trim();
    if (raw !== "" && !CURRENCY_RE.test(raw)) { setInvalid(true); return false; }
    return true;
  }

  async function commit() {
    const raw = draft.trim();
    // PB-D20 — invalid input does NOT commit and does NOT cancel. The editor stays
    // open with the draft preserved. Focus is never forced back. Defensive gate:
    // Enter already screened the draft, but Tab and click-out reach commit directly.
    if (!draftIsValid()) return;
    setInvalid(false);
    // PB-D22 — an empty draft is NOT a clear. Exit edit mode and restore the
    // current persisted value; issue no PUT. Clearing is intentionally not
    // reachable from the inline editor. The API contract is unchanged: each
    // named setter still performs a real clear on "" for a future explicit
    // action. What this removes is the keystroke that reaches it.
    if (raw === "") { setEditing(false); return; }
    const next: number = Number(raw.replace(/[$,]/g, ""));
    // PB-D10 — unchanged value fires no PUT.
    if (next === current) { setEditing(false); return; }
    setEditing(false);
    setStatus("verifying");
    setErrMsg(null);
    try {
      await save(contactId, next);
    } catch (e) {
      setErrMsg((e as Error).message);
      setStatus("failed");
      return;
    }
    setSaved(next);
    try {
      setStatus(await verify(next));
    } catch (e) {
      setErrMsg((e as Error).message);
      setStatus("unverified");
    }
  }

  // PB-D19 — Escape sets a REF, not state. A state update is not visible to the
  // blur handler in the same event sequence, and blur is what commits.
  function handleBlur() {
    if (cancelRef.current) { cancelRef.current = false; setEditing(false); setInvalid(false); return; }
    void commit();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") { cancelRef.current = true; e.currentTarget.blur(); return; }
    // PB-D20 — "On Enter, focus stays in the field." Blur is the sole commit path,
    // so Enter must screen the draft FIRST and blur only if it will be accepted.
    // Blurring unconditionally removes focus even when the commit is rejected,
    // which is the violation this restores. Re-focusing after blur is forbidden.
    if (e.key === "Enter") { e.preventDefault(); if (draftIsValid()) e.currentTarget.blur(); }
  }

  return (
    <div style={{ display: "flex", gap: "12px", fontSize: "13px" }}>
      <span style={{ flex: "0 0 200px", color: "#94A3B8" }}>{f.name}</span>
      <div style={{ display: "flex", gap: "8px", alignItems: "center", flex: 1 }}>
        {editing ? (
          <input
            data-testid={`field-input-${f.id}`}
            value={draft}
            autoFocus
            onChange={(e) => { setDraft(e.target.value); setInvalid(false); }}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            style={{ width: "160px", background: "#0F172A", color: "#E2E8F0", border: `1px solid ${invalid ? "#F87171" : "#334155"}`, borderRadius: "4px", padding: "4px 6px", fontSize: "13px", fontFamily: "inherit" }}
          />
        ) : (
          <span
            data-testid={`field-display-${f.id}`}
            onClick={beginEdit}
            style={{ color: "#E2E8F0", cursor: "text" }}
          >
            {fmt(current)}
          </span>
        )}
        {invalid && <span style={{ color: "#F87171" }}>Not a valid amount</span>}
        {status === "verifying" && <span style={{ color: "#94A3B8" }}>Verifying...</span>}
        {status === "saved" && <span style={{ color: "#94A3B8" }}>Saved</span>}
        {status === "unconfirmed" && <span style={{ color: "#94A3B8" }}>Save accepted — not yet confirmed</span>}
        {status === "failed" && <span style={{ color: "#F87171" }}>Save failed{errMsg ? `: ${errMsg}` : ""}</span>}
        {status === "unverified" && <span style={{ color: "#F87171" }}>Couldn't verify save</span>}
      </div>
    </div>
  );
}

/* ═══ Board #5 §4B — THE OPPORTUNITY ASK EDITOR, ON THE RAIL ═══════════════
   PB-D17 Model B display-to-edit swap, PB-D19 Escape semantics, PB-D20 syntax
   gate, PB-D22 empty-draft rule. Behaviourally MonetaryRow's contract, applied
   to the authoritative Opportunity value instead of the Contact fallback.

   ⚠ IT DOES NOT REUSE MonetaryRow, AND THE REASON IS THE POINT. MonetaryRow's
   verify() polls ghl.contacts.getDetail (CW:339) -- a CONTACT read. Pointing
   that at an Opportunity field would be the right parser on the WRONG OBJECT:
   it would look up an opportunity's field id in a contact's customFields, find
   nothing, and report a landed write as unconfirmed. That is a DIFFERENT
   failure from reading the singular GET with a list-shaped parser, and neither
   guard catches the other.

   So there is NO readback here at all. ghl.opportunities.setAskingPrice does
   its own singular-GET readback via readSingularFieldValue and returns `ok`.
   This component consumes that verdict and never reads GHL itself.

   ⚠ NOTHING HERE WRITES contact.asking_price. The Contact value is a FALLBACK
   with deliberate precedence (resolver.ts:329), not a mirror. Making them agree
   would destroy the only signal that says which one governs.

   PB-D22 — an empty draft is NOT a clear. It exits and issues no PUT. The
   setter still performs a real clear on null for an explicit action (the wire
   proof calls it directly); what is withheld is the KEYSTROKE that reaches it.
   ⚠ This is the one place the editor is deliberately narrower than the setter. */
function RailAskEditor({ open, onOpen, onClose, opportunityId, seed, label, display,
                        confirmedWrite, authorityReconciled, onConfirmed, onRefresh }: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  opportunityId: string;
  /** §4C — null in ORIGINATION mode. The draft then opens EMPTY. */
  seed: number | null;
  label: string;
  display: string;
  confirmedWrite: number | null;
  authorityReconciled: boolean;
  onConfirmed: (sent: number) => void;
  onRefresh: () => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "refreshing" | "saved" | "unconfirmed" | "failed">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const cancelRef = useRef(false);
  useEditorGate(`rail-ask-${opportunityId}`, open); // D1 — defer return revalidation while open

  /* ⚠ §4C — NO LOCAL `saved`. The cell renders what RESOLVED STATE says, full
     stop. A private post-save value here would show the new Opportunity
     number beside the OLD Contact provenance -- the §4A mislabel, generated
     by the editor itself. Between save and reconciliation the cell keeps the
     old value AND the old provenance: internally consistent and truthful,
     with the warning below saying why. */
  const current: number | null = seed;
  const shown = display;
  /* Write confirmed, resolved authority has not observed it yet. */
  const authorityUnrefreshed = !authorityReconciled;

  useEffect(() => {
    if (!open) return;
    setDraft(current === null ? "" : String(current));
    setInvalid(false);
    setErrMsg(null);
    setStatus("idle");
    // Only when the editor opens; re-seeding on every `current` change would
    // overwrite what the operator is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function draftIsValid(): boolean {
    const raw = draft.trim();
    if (raw !== "" && !CURRENCY_RE.test(raw)) { setInvalid(true); return false; }
    return true;
  }

  async function commit() {
    const raw = draft.trim();
    if (!draftIsValid()) return;          // PB-D20 — stays open, draft preserved
    setInvalid(false);
    if (raw === "") { onClose(); return; } // PB-D22 — empty is not a clear
    const next = Number(raw.replace(/[$,]/g, ""));
    /* PB-D10 — unchanged fires no PUT. ⚠ confirmedWrite FIRST: in the
       post-save / pre-refetch window `current` is still the OLD value, so
       without it a second Enter on the same number would issue a redundant
       PUT. This is suppression only; it renders nothing. */
    if (next === (confirmedWrite ?? current)) { onClose(); return; }
    onClose();
    setStatus("saving");
    setErrMsg(null);
    let sent: number;
    try {
      const res = await ghl.opportunities.setAskingPrice(opportunityId, next);
      // A 200 is not success. `ok` is the singular readback's verdict.
      if (!res.ok) { setStatus("unconfirmed"); return; }
      // The ROUNDED value that actually went on the wire. ok guarantees
      // sent === observed, so this is what resolved state must come to hold.
      sent = typeof res.sent === "number" ? res.sent : next;
      onConfirmed(sent);
    } catch (e) {
      setErrMsg((e as Error).message);
      setStatus("failed");
      return;
    }
    /* The write is confirmed. Now let RESOLVED STATE catch up -- the cockpit
       never relabels authority from the PUT alone. */
    setStatus("refreshing");
    try {
      await onRefresh();
      setStatus("saved");
    } catch (e) {
      /* ⚠ NOT "the refresh failed" as a latched fact. The truthful state is
         derived: a confirmed write exists that resolved authority has not
         observed. Any later legitimate read clears it by itself. */
      setErrMsg((e as Error).message);
      setStatus("idle");
    }
  }

  // PB-D19 — Escape sets a REF, not state. A state update is not visible to the
  // blur handler in the same event sequence, and blur is what commits.
  function handleBlur() {
    if (cancelRef.current) { cancelRef.current = false; onClose(); setInvalid(false); return; }
    void commit();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") { cancelRef.current = true; e.currentTarget.blur(); return; }
    if (e.key === "Enter") { e.preventDefault(); if (draftIsValid()) e.currentTarget.blur(); }
  }

  /* §4C — ORIGINATION IS ADDITIVE, NOT A SWAP. ⚠ PB-D17's Model B swaps a
     display for an editor because they are the SAME value. In origination they
     are not: the display is the CONTACT ask and the edit targets the
     OPPORTUNITY ask. Swapping would tell Brad he is editing the number he can
     see. He is not -- he is using a truthfully displayed fallback to set a new
     Opportunity authority, so the fallback stays on screen beside the input. */
  const originating = seed === null;

  const warning = authorityUnrefreshed ? (
    <span
      data-testid="rail-ask-authority-unrefreshed"
      style={{ fontSize: "10px", color: "#F59E0B", maxWidth: "230px", display: "inline-block" }}
    >
      Saved to the Opportunity. The source label beside it is out of date — reload to see which value governs.
    </span>
  ) : null;

  if (open) {
    const input = (
      <input
        data-testid="rail-ask-input"
        value={draft}
        autoFocus
        onChange={(e) => { setDraft(e.target.value); setInvalid(false); }}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        style={{ width: "130px", background: "#0F172A", color: "#F1F5F9", border: `1px solid ${invalid ? "#F87171" : "#334155"}`, borderRadius: "4px", padding: "2px 6px", fontSize: "15px", fontWeight: 600, fontFamily: "inherit" }}
      />
    );
    /* Edit mode swaps (same value). Origination keeps the governing fallback
       visible beside the input (different carriers). */
    /* ⚠ ORIGINATION DOES NOT RENDER THE VALUE. rail-state already shows the
       Contact ask, and duplicating it here is what made that element a mixed
       container. Additive means "beside the value", not "a second copy of
       it". Edit mode returns the bare input because it IS the swap. */
    return originating ? (
      <span style={{ display: "inline-flex", gap: "8px", alignItems: "baseline", flexWrap: "wrap", marginTop: "3px" }}>
        {input}
        {warning}
      </span>
    ) : input;
  }

  return (
    <span style={{ display: "inline-flex", gap: "8px", alignItems: "baseline", flexWrap: "wrap",
                   marginTop: originating ? "3px" : undefined }}>
      {/* Edit mode: the clickable number, in rail-state, which the input
          replaces on open. Origination: no number here -- rail-state has it. */}
      {!originating && (
        <span data-testid="rail-ask-display" onClick={onOpen} style={{ cursor: "text" }}>{shown}</span>
      )}
      {originating && (
        <button
          data-testid="rail-ask-originate"
          onClick={onOpen}
          style={{ fontSize: "10px", fontWeight: 600, padding: "2px 7px", borderRadius: "5px",
                   border: "1px solid rgba(30,200,255,0.3)", background: "rgba(30,200,255,0.07)",
                   color: "#1EC8FF", cursor: "pointer" }}
        >{label}</button>
      )}
      {warning}
      {invalid && <span style={{ fontSize: "10px", color: "#F87171" }}>Not a valid amount</span>}
      {status === "saving" && <span style={{ fontSize: "10px", color: "#94A3B8" }}>Saving…</span>}
      {status === "saved" && <span style={{ fontSize: "10px", color: "#94A3B8" }}>Saved</span>}
      {status === "unconfirmed" && <span style={{ fontSize: "10px", color: "#F59E0B" }}>Save accepted — not confirmed</span>}
      {status === "failed" && <span style={{ fontSize: "10px", color: "#F87171" }}>Save failed{errMsg ? `: ${errMsg}` : ""}</span>}
    </span>
  );
}

/* ── Board #5 S3b — the occupancy editor. TEMPLATE: choice-single + immediate ──
   PB-D11 lists `choice + immediate` as the ONLY permitted pair for the choice
   editor, so the behaviour below is the taxonomy's, not a local invention.
   PB-D9's `choice` slot reached by the MULTIPLE_OPTIONS-by-override path.

   ⚠ THE -single SUFFIX IS LOAD-BEARING. Cardinality lives in the template KEY so
   no future multi-valued field inherits this by being MULTIPLE_OPTIONS. A field
   ruled multi-valued needs choice-multi, defined at its own first unlock, with
   its own serialization ruling. Nothing here generalises.

   PB-D17 Model B — display-to-edit swap. Model A (a permanently rendered form
   control on a 101-field record) stays rejected for the reason PB-D17 gave.

   ACCEPTED RISK ON `immediate`, as locked: a selection is a committed write with
   no moment to reconsider and no undo. It is acceptable here because the prior
   value is always reconstructible from what is on screen — three choices, all
   visible, plus Clear for the unset state — and because the measured workflow
   surface shows NO workflow watching this field, so a wrong write fires nothing.
   THAT IS AN OCCUPANCY FINDING, NOT A PROPERTY OF `immediate`. The next field to
   reach this behaviour earns it by its own review, not by citing this one.

   PB-D10's "Caution on `immediate`" applies: it is the only commit mode with no
   user-visible moment to reconsider, and its FIRST inert-proof carries a higher
   evidence bar. That proof is S3c and it has not run. */
function ChoiceRow({ f, contactId }: { f: RecordField; contactId: string }) {
  /* The wire shape is an ARRAY for MULTIPLE_OPTIONS — ["Vacant"] — but absence
     is the common case and a bare string is tolerated rather than trusted.

     THREE STATES, NOT TWO. An earlier draft collapsed "stored but unrecognised"
     into "empty", and that is a defect: OCCUPANCY_OPTIONS is a constant measured
     live at S3a and then FROZEN, so if the field's options ever change, or a
     legacy row carries a retired label, the operator would see — , click once,
     and overwrite a prior value THEY WERE NEVER SHOWN.

     That is precisely the circumstance the accepted risk on `immediate` forbids:
     it is permitted only where "the prior value is readily reconstructible from
     the editor's visible state and available controls". A value that was never
     rendered is not reconstructible, and the whole pairing rests on that
     invariant, so it is closed structurally rather than with a warning. */
  type Wire =
    | { kind: "empty" }
    | { kind: "recognised"; value: OccupancyStatus }
    | { kind: "unrecognised"; raw: string };
  const wireState: Wire = (() => {
    const raw = Array.isArray(f.value) ? f.value[0] : f.value;
    if (raw == null || raw === "") return { kind: "empty" };
    const s = String(raw);
    return (OCCUPANCY_OPTIONS as readonly string[]).includes(s)
      ? { kind: "recognised", value: s as OccupancyStatus }
      : { kind: "unrecognised", raw: s };
  })();
  const wire: OccupancyStatus | "" = wireState.kind === "recognised" ? wireState.value : "";

  const [saved, setSaved] = useState<OccupancyStatus | "" | null>(null);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<"idle" | "verifying" | "saved" | "unconfirmed" | "failed" | "unverified">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  /* Synchronous re-entrancy guard, checked BEFORE any await. Under `immediate`
     a double-click is two writes; this makes the second a no-op. */
  const inFlight = useRef(false);
  const editRef = useRef<HTMLDivElement | null>(null);
  useEditorGate(f.id, editing); // D1 — defer return revalidation while open
  const current: OccupancyStatus | "" = saved == null ? wire : saved;

  /* THE DECLINE PATH. Under `immediate` there is no provisional value awaiting
     save or cancel, so both exits mean exactly one thing: leave edit mode
     WITHOUT changing the persisted value and WITHOUT issuing a PUT. Opening the
     editor must never force a write — the accepted risk assumes the operator
     can decline, and before this there was no way to.

     ⚠ DOCUMENT-LEVEL, NOT A CONTAINER onKeyDown, AND THAT IS THE POINT.
     Activation is a click on a <span> that is not focusable and is removed on
     the same render, so focus almost certainly sits on <body>. A handler on the
     option container would never receive the key, and an Escape handler that
     never fires is indistinguishable from one that does nothing. A document
     listener makes no focus assumption at all.

     ⚠ FOCUSING THE FIRST OPTION WAS REJECTED as the alternative mechanism: a
     focused <button> turns Enter and Space into a click, and under `immediate` a
     click is a WRITE. That would trade a dead Escape for a stray-keystroke
     commit.

     mousedown, NOT click, for the outside path. The activation handler runs on
     `click`, which fires after that gesture's mousedown has already passed, so
     the listener installed during activation cannot be triggered by the very
     gesture that opened the editor. No timers, no flags, no re-entrancy hack.

     Neither exit fires while a write is in flight, so the Saving / failed state
     cannot be dismissed before the operator has seen it. */
  useEffect(() => {
    if (!editing) return;
    const close = () => { if (!inFlight.current) setEditing(false); };
    /* globalThis-qualified: this file imports React's KeyboardEvent type at the
       top, which shadows the DOM one, and these are DOM listeners. */
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") close(); };
    const onDown = (e: globalThis.MouseEvent) => {
      if (editRef.current && !editRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [editing]);

  /* PB-D21 — "Saved" means GHL was read back and confirmed, never that the PUT
     returned 2xx. Bounded poll of the SINGULAR contact read, never the PUT echo.
     Equality is SEMANTIC: for a selection the stored value must CONTAIN exactly
     the chosen option; for a clear it is KEY ABSENCE, because "" yields
     KEY_ABSENT while an empty array would leave the key present. The PUT is
     NEVER repeated. */
  async function verify(expected: OccupancyStatus | ""): Promise<"saved" | "unconfirmed" | "unverified"> {
    let anyCompleted = false;
    let lastErr: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) await new Promise((r) => setTimeout(r, 1000));
      try {
        const d = await ghl.contacts.getDetail(contactId);
        anyCompleted = true;
        const entry = d.customFields.find((cf) => cf.id === f.id);
        if (expected === "") {
          if (!entry) return "saved";
        } else if (entry) {
          const v = Array.isArray(entry.value) ? entry.value : [entry.value];
          if (v.length === 1 && String(v[0]) === expected) return "saved";
        }
      } catch (e) {
        lastErr = e as Error;
      }
    }
    if (!anyCompleted) { setErrMsg(lastErr ? lastErr.message : null); return "unverified"; }
    return "unconfirmed";
  }

  async function commit(next: OccupancyStatus | "") {
    if (inFlight.current) return;
    /* PB-D10 states the unchanged-value no-op for `inline`; the same courtesy is
       applied here. It reduces pointless writes and is NOT undo protection —
       PB-D10 says so explicitly and it is just as true under `immediate`. */
    if (next === current) { setEditing(false); return; }
    inFlight.current = true;
    setErrMsg(null);
    setStatus("verifying");
    try {
      await ghl.contacts.setOccupancyStatus(contactId, next);
    } catch (e) {
      inFlight.current = false;
      setErrMsg((e as Error).message);
      setStatus("failed");
      return; // stay in edit mode so the operator can retry or correct
    }
    const outcome = await verify(next);
    inFlight.current = false;
    setStatus(outcome);
    if (outcome === "saved") {
      setSaved(next);
      /* Return to the display so the operator SEES the committed value. That
         visibility is what the accepted risk rests on — a wrong write must be
         apparent immediately, because correcting it is the only undo. */
      setEditing(false);
    }
  }

  const label = (v: OccupancyStatus | "") => (v === "" ? "—" : v);

  /* ⚠ UNRECOGNISED VALUE — EARLY RETURN, READ-ONLY, NO COMMIT SURFACE.
     Placed as a RETURN rather than a branch inside the render so the editing
     JSX below is STRUCTURALLY UNREACHABLE in this state. "No commit surface"
     is then a property of the control flow, provable by reading it, rather
     than a rule someone has to keep honouring in a conditional.

     THE STATE IS A DIAGNOSTIC, NOT A WORKFLOW. It is currently unreachable —
     S3a measured both environments and the constant matches the live field —
     so its appearance would itself mean something upstream changed. Read-only
     forces that to be investigated rather than clicked past. Deliberately NO
     confirmation flow, NO drift system, NO new architecture: the value is
     shown, and the way to change it is to find out why it is there.

     The hooks are absent here BY DESIGN: no field-option-*, no field-clear-*,
     and the display is not activatable. The four template checks are scoped to
     the recognised-or-empty state and do not describe this branch.

     UNGUARDED, AND THAT IS THE INVARIANT: an unrecognised stored value is
     ALWAYS read-only in this component. There is no in-session escape and no
     condition under which this return is skipped — `saved` is written only
     inside commit(), commit() is reachable only from the editing JSX, and the
     editing JSX is below this return. The way out is to fix the value in GHL,
     which changes the wire on the next fetch. */
  if (wireState.kind === "unrecognised") {
    return (
      <div style={{ display: "flex", gap: "12px", fontSize: "13px", alignItems: "flex-start" }}>
        <span style={{ flex: "0 0 200px", color: "#94A3B8" }}>{f.name}</span>
        <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
          <span
            data-testid={`field-display-${f.id}`}
            data-unrecognised="true"
            style={{ color: "#F59E0B" }}
          >
            {wireState.raw}
          </span>
          <span style={{ fontSize: "11px", color: "#64748B" }}>
            Unrecognised stored value — read-only. Not one of this field's options.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: "12px", fontSize: "13px", alignItems: "flex-start" }}>
      <span style={{ flex: "0 0 200px", color: "#94A3B8" }}>{f.name}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
        {!editing ? (
          <span
            data-testid={`field-display-${f.id}`}
            onClick={() => { setStatus("idle"); setErrMsg(null); setEditing(true); }}
            style={{ color: current === "" ? "#475569" : "#E2E8F0", cursor: "pointer", borderBottom: "1px dashed rgba(148,163,184,0.35)" }}
          >
            {label(current)}
          </span>
        ) : (
          <div ref={editRef} style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
            {OCCUPANCY_OPTIONS.map((opt, n) => {
              const isSel = current === opt;
              return (
                <button
                  key={opt}
                  data-testid={`field-option-${f.id}-${n}`}
                  data-selected={isSel ? "true" : "false"}
                  onClick={() => void commit(opt)}
                  disabled={status === "verifying"}
                  style={{
                    fontSize: "12px", fontWeight: 600, padding: "4px 10px", borderRadius: "6px",
                    cursor: status === "verifying" ? "wait" : "pointer",
                    border: `1px solid ${isSel ? "rgba(30,200,255,0.55)" : "rgba(255,255,255,0.14)"}`,
                    background: isSel ? "rgba(30,200,255,0.18)" : "rgba(255,255,255,0.04)",
                    color: isSel ? "#1EC8FF" : "#CBD5E1",
                  }}
                >
                  {opt}
                </button>
              );
            })}
            {/* The unset affordance. NOT a fourth option — it writes "", which
                yields KEY_ABSENT, and the display then reads —. It is the
                operator's own undo for the empty case, which is bradt75's
                current state and the state S3c must restore. */}
            <button
              data-testid={`field-clear-${f.id}`}
              onClick={() => void commit("")}
              disabled={status === "verifying"}
              style={{
                fontSize: "12px", padding: "4px 10px", borderRadius: "6px",
                cursor: status === "verifying" ? "wait" : "pointer",
                border: "1px dashed rgba(255,255,255,0.18)", background: "transparent", color: "#64748B",
              }}
            >
              Clear
            </button>
          </div>
        )}
        {status !== "idle" && status !== "saved" && (
          <span style={{ fontSize: "11px", color: status === "verifying" ? "#64748B" : "#F59E0B" }}>
            {status === "verifying" ? "Saving…"
              : status === "failed" ? `Write failed${errMsg ? ` — ${errMsg}` : ""}`
              : status === "unconfirmed" ? "Write sent but not confirmed — reload to check"
              : "Could not reach GHL to confirm — reload to check"}
          </span>
        )}
      </div>
    </div>
  );
}

/* §4B item 7 — `askAuthority` is threaded as a PROP, not a context.
   EditorGateContext is genuinely ambient (any row may register). Authority is
   consumed by exactly ONE row, so a prop keeps the dependency visible at the
   call site; a context would hide which rows depend on it. It is the same
   already-resolved state the rail renders -- one authority source, two
   surfaces, no second read. */
/* §4B item 7, CORRECTED IN §4D — the Contact Asking Price row, DISPLAY-ONLY,
   never hidden. It states its own authority rather than leaving the operator to
   infer it from a rail two sections away.

   ⚠ FIVE STATES, NOT TWO. The original comment here enumerated two and the code
   under it was a two-branch ternary; the underlying value carries FIVE rail
   states, so everything that was not "Opportunity Ask present" fell into
   "governing fallback" -- measured at 47 of 47 Production contacts, 46 of them
   beside an empty value. A two-state comment above a five-state row IS the debt
   that produced that defect. The mapping now lives in ONE place,
   contactAskAuthority() in lib/rail.ts, where the discriminated union makes it
   exhaustive at compile time. This component chooses PRESENTATION only:

     opportunity          the Contact value is a fallback and is NOT being obeyed
     contact              the Contact value IS what governs
     resolved_no_ask      a deal resolved and neither carrier holds a value
     no_opportunity       no Opportunity exists, so nothing to fall back FROM
     loading/error/       authority genuinely unknown -- the row must not claim
       awaiting_selection  it either way

   ⚠ The note renders in EVERY state. A row that goes quiet when it stops being
   authoritative is worse than one that never spoke: silence reads as agreement.

   ⚠ COLOUR IS A CLAIM, SO THE UNDETERMINED STATES ARE AMBER, NOT SLATE. Slate
   reads as "settled, nothing to see". Leaving loading/error/awaiting_selection
   slate would preserve visually the exact lie §4D removes from the text. */
const ASK_AUTHORITY_AMBER = new Set(["opportunity", "loading", "error", "awaiting_selection"]);

function ContactAskRow({ f, askAuthority }: { f: RecordField; askAuthority: ContactAskAuthority }) {
  const note = askAuthority.label;
  return (
    <div style={{ display: "flex", gap: "12px", fontSize: "13px" }}>
      <span style={{ flex: "0 0 200px", color: "#94A3B8" }}>{f.name}</span>
      <div style={{ display: "flex", gap: "8px", alignItems: "baseline", flex: 1, minWidth: 0 }}>
        <span data-testid={`field-display-${f.id}`} style={{ color: "#E2E8F0" }}>
          {f.value == null ? "—" : String(f.value)}
        </span>
        <span
          data-testid="contact-ask-authority"
          data-ask-authority={askAuthority.token}
          style={{ fontSize: "10px", fontStyle: "italic", color: ASK_AUTHORITY_AMBER.has(askAuthority.token) ? "#F59E0B" : "#64748B" }}
        >
          {note}
        </span>
      </div>
    </div>
  );
}

function FieldRow({ f, contactId, askAuthority }: {
  f: RecordField;
  contactId: string;
  askAuthority: ContactAskAuthority;
}) {
  if (f.id === PROPERTY_NOTES_ID) return <PropertyNotesRow f={f} contactId={contactId} />;
  /* ⚠ DISPLAY-ONLY, AND DELIBERATELY SO. This row LABELS which carrier governs;
     it never writes. §4B changes the authoritative Opportunity value and does
     NOT mirror it here — the two carriers have precedence, and synchronizing
     them would erase the only signal that says which one is being obeyed. */
  if (f.id === CONTACT_ASKING_PRICE_ID) return <ContactAskRow f={f} askAuthority={askAuthority} />;
  // The two unlocked MONETORY fields. Same row, different named setter — the
  // dispatch is where each field's write decision is spent, and it is one line
  // per field so an unlock cannot happen by accident.
  if (f.id === ARV_ID) return <MonetaryRow f={f} contactId={contactId} save={ghl.contacts.setARV} />;
  if (f.id === ESTIMATED_REPAIRS_ID) return <MonetaryRow f={f} contactId={contactId} save={ghl.contacts.setEstimatedRepairs} />;
  /* Board #5 S3b — the first `choice` unlock, N 3 -> 4. One line, like the two
     above: the dispatch is where each field's write decision is spent, and it is
     one line per field so an unlock cannot happen by accident. ChoiceRow takes no
     `save` prop — occupancy's setter is named INSIDE it, because the one-element
     serialization is that field's ruling and must not travel as a parameter. */
  if (f.id === OCCUPANCY_STATUS_ID) return <ChoiceRow f={f} contactId={contactId} />;
  const display =
    f.value == null
      ? "—"
      : f.dataType === "DATE"
        ? String(f.value)
        : f.dataType === "MONETORY"
          ? String(f.value)
          : String(f.value);
  return (
    <div style={{ display: "flex", gap: "12px", fontSize: "13px" }}>
      <span style={{ flex: "0 0 200px", color: "#94A3B8" }}>{f.name}</span>
      <span style={{ color: "#E2E8F0" }}>{display}</span>
    </div>
  );
}

// One conversation bubble (D5, docs/CONTACTS_DETAIL_SPEC.md). EMAIL bodies clamp
// to CLAMP_LINES via CSS line-clamp — line-based, not character count, so it is
// width-independent and never breaks mid-word — with the control shown ONLY when
// the body actually overflows. SMS never clamps, matching Conversations.
//
// D5 parity is the MECHANISM, not the layout: same clamp and same overflow test
// as Conversations' MessageBubble, but this bubble keeps the Workspace's 85%
// direction-aligned form rather than adopting Conversations' full-width email.
// The line count matches; the visible content does not, and that is accepted.
//
// This is local to this file BY DECISION. Extraction is forced only because hooks
// cannot be called inside the .map() callback the bubble used to live in — it is a
// mechanical consequence of adding per-bubble state, NOT a shared component.
// CONVERSATIONS_SPEC §7 holds that a shared MessageBubble waits for a third
// consumer; there are still two.
function ConversationBubble({ m }: { m: ConvMessageRow }) {
  const outbound = m.direction === "outbound";
  const isSms = m.messageType === "TYPE_SMS";
  const collapsible = !isSms;

  const [expanded, setExpanded]       = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Measure WHILE clamped (mount + body change; NOT on expand, so the control
  // stays visible after expanding). scrollHeight > clientHeight ⇒ the clamp is
  // truncating → the control is warranted. `expanded` is deliberately NOT reset by
  // any effect: bubbles are keyed by message id, so a contact change remounts them
  // collapsed. Key-based remount is the reset, same as Conversations.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!collapsible || !el) return;
    setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, [m.body, collapsible]);

  const clamp = collapsible && !expanded;
  const bodyStyle: CSSProperties = {
    fontSize: "13px", color: "#E2E8F0", whiteSpace: "pre-wrap", wordBreak: "break-word",
    ...(clamp
      ? { display: "-webkit-box", WebkitLineClamp: CLAMP_LINES, WebkitBoxOrient: "vertical", overflow: "hidden" }
      : {}),
  };

  return (
    <div
      style={{
        alignSelf: outbound ? "flex-end" : "flex-start",
        maxWidth: "85%",
        background: outbound ? "rgba(30,200,255,0.10)" : "#0D1B3E",
        border: `1px solid ${outbound ? "rgba(30,200,255,0.25)" : "rgba(255,255,255,0.08)"}`,
        borderRadius: "10px", padding: "8px 12px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "10px", color: "#475569", marginBottom: "4px" }}>
        {outbound ? <ArrowUpRight size={11} style={{ color: "#1EC8FF" }} /> : <ArrowDownLeft size={11} style={{ color: "#64748B" }} />}
        <span style={{ fontWeight: 600, color: outbound ? "#1EC8FF" : "#94A3B8" }}>{outbound ? "Sent" : "Received"}</span>
        <span>· {m.channel}</span>
        <span>· {formatNoteDate(m.dateAdded)}</span>
      </div>
      <div ref={bodyRef} style={bodyStyle}>
        {m.body || <span style={{ color: "#475569", fontStyle: "italic" }}>({m.channel.toLowerCase()}, no text)</span>}
      </div>
      {collapsible && overflowing && (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{ marginTop: "6px", background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: "11px", fontWeight: 600, color: "#1EC8FF" }}
        >
          {expanded ? "Show less" : "Expand"}
        </button>
      )}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function ContactWorkspace() {
  const { id = "" } = useParams();

  const [contact, setContact]   = useState<ContactRow | null>(null);
  const [loading, setLoading]   = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // Detail record (getDetail) — SEPARATE from the getOne-backed `contact` above.
  // Own loading/error; a failure here is section-scoped (D3) and must NOT touch
  // the identity header, actions, notes, or conversation history. Consumed only
  // by the Offer section (touchpoint 4).
  const [detail, setDetail]               = useState<ContactDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError]     = useState<string | null>(null);

  // Render-config field definitions (§5.4) — LIVE all-fields superset. Own
  // loading/error, section-scoped (D3); consumed only by the Offer section
  // (touchpoint 4). A defs failure touches nothing else.
  /* Board #5 S2 — the rail's Opportunity read. Its OWN loading/error, section-
     scoped like detail and defs (D3): an Opportunity read that fails must
     degrade the rail's two Opportunity cells and NOTHING else on this page. */
  const [opps, setOpps]           = useState<OpportunityRow[] | null>(null);
  const [oppsError, setOppsError] = useState<string | null>(null);

  /* ── Board #5 D1 — RETURN REVALIDATION ───────────────────────────────────
     The contact fetch is keyed on [id] and nothing revalidates, so a tab-hop
     to GHL and back left the page showing PRE-CALL data with no mechanism to
     notice. Measured, not inferred: 13 function calls at mount, 0 after a
     hide/show + blur/focus cycle.

     S2 made that materially worse. Seller Ask and Seller MAO now sit on a
     STICKY bar, and the rail's own justification is that a guardrail which
     scrolls out of view is not a guardrail. One that is silently stale fails
     the same test.

     READ-ONLY. Returning to the tab must never write. No autosave, no editor
     reset, no server-wins-while-editing. */
  const [openEditors, setOpenEditors]   = useState<Set<string>>(() => new Set());
  const [refreshCount, setRefreshCount] = useState(0);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshDeferred, setRefreshDeferred] = useState(false);

  const [defs, setDefs]               = useState<CustomFieldDef[] | null>(null);
  const [defsLoading, setDefsLoading] = useState(true);
  const [defsError, setDefsError]     = useState<string | null>(null);

  // Folder display names (§5.4) — Map<parentId, name>, insertion-ordered to the
  // IAOS display order (Offer first, then remaining by folder position). Own
  // loading flag; a fetch failure sets the EXISTING defsError (no third error
  // state). `expanded` = the set of expanded folder ids; Offer starts open.
  const [folderNames, setFolderNames]               = useState<Map<string, string> | null>(null);
  const [folderNamesLoading, setFolderNamesLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([OFFER_FOLDER_ID]));

  const [notes, setNotes]           = useState<NoteRow[] | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);

  // Step 5 — conversation history (read-only, scoped by explicit contactId).
  const [conversations, setConversations]           = useState<ConvMessageRow[] | null>(null);
  const [conversationsError, setConversationsError] = useState<string | null>(null);

  const [draft, setDraft]         = useState("");
  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // In-session attempt override — immediate UX only. Verification uses a real
  // page.reload() to confirm the value actually persisted to GHL, since this
  // override would otherwise mask a bad round-trip.
  const [attemptOverride, setAttemptOverride] = useState<string | null>(null);

  // Callback state — reuses the shared CallbackPopover. Override: undefined =
  // use the contact's stored value; null = cleared this session; string =
  // scheduled this session.
  const [callbackOverride, setCallbackOverride] = useState<string | null | undefined>(undefined);
  const [callbackOpen, setCallbackOpen]         = useState(false);
  const [callbackSaving, setCallbackSaving]     = useState(false);
  const [callbackError, setCallbackError]       = useState<string | null>(null);

  function loadContact() {
    setError(null);
    // Single-record read (immediate, no list-index lag — §11). A 404 means the
    // contact genuinely doesn't exist; any other failure is a real error.
    ghl.contacts.getOne(id)
      .then((c) => { setContact(c); setNotFound(false); })
      .catch((e: Error) => {
        if (/→ 404/.test(e.message)) setNotFound(true);
        else setError(e.message);
      })
      .finally(() => setLoading(false));
  }

  function loadNotes() {
    setNotesError(null);
    ghl.notes.list(id)
      .then((res) => {
        const rows = (res.notes ?? []).slice().sort(
          (a, b) => new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime(),
        );
        setNotes(rows);
      })
      .catch((e: Error) => setNotesError(e.message));
  }

  // Read-only, GET-only. Scoped by explicit contactId via the conversations API
  // (§8 step 5) — never listAll, so §11's list lag/drop does not apply here.
  function loadConversations() {
    setConversationsError(null);
    ghl.conversations.forContact(id)
      .then((res) => setConversations(res.messages))
      .catch((e: Error) => setConversationsError(e.message));
  }

  // Detail record read (D3) — own loading/error, section-scoped. getOne stays the
  // identity-header source; getDetail feeds only the Offer section (touchpoint 4).
  // A failure here sets detailError and touches nothing else.
  function loadDetail() {
    setDetailError(null);
    ghl.contacts.getDetail(id)
      .then((d) => setDetail(d))
      .catch((e: Error) => setDetailError(e.message))
      .finally(() => setDetailLoading(false));
  }

  /* Board #5 S2 — the rail's Opportunity read. READ ONLY.
     ghl.opportunities.listPipeline() is the SAME accessor UnderwritingWorkspace
     calls; no new accessor was needed and none was added. The whole-pipeline
     read then narrows through opportunitiesForContact — the extracted filter,
     not a second one written here. */
  function loadOpportunities() {
    setOppsError(null);
    ghl.opportunities.listPipeline()
      .then((p) => setOpps(opportunitiesForContact(p.opportunities, id)))
      .catch((e: Error) => setOppsError(e.message));
  }

  // Render-config read (§5.4 / §6 failure contract) — own loading/error,
  // section-scoped (D3). SHAPE assertion, never a count: malformed (non-array,
  // or any entry missing parentId/position) sets defsError and does NOT set
  // defs. 96 is never checked at runtime — runtime renders what GHL returns.
  function loadDefs() {
    setDefsError(null);
    ghl.customFields.list()
      .then((body) => {
        const arr = body?.customFields;
        if (!Array.isArray(arr)) {
          setDefsError("Malformed render-config: customFields is not an array");
          return;
        }
        const bad = arr.find((f) => f.parentId == null || f.position == null);
        if (bad) {
          const which = bad.parentId == null ? "parentId" : "position";
          setDefsError(`Malformed render-config: field ${bad.id ?? "(unknown id)"} missing ${which}`);
          return;
        }
        setDefs(arr);
      })
      .catch((e: Error) => setDefsError(e.message))
      .finally(() => setDefsLoading(false));
  }

  /* The gate api is stable, so the rows' registration effect does not re-run
     on every page render. */
  const editorGate = useMemo<EditorGateApi>(() => ({
    open:  (k) => setOpenEditors((s) => (s.has(k) ? s : new Set(s).add(k))),
    close: (k) => setOpenEditors((s) => { if (!s.has(k)) return s; const n = new Set(s); n.delete(k); return n; }),
  }), []);

  /* The CallbackPopover is page-level state rather than a registered row, so
     it joins the gate here. An open popover is an active interaction surface
     for the same reason a field editor is.
     PropertyNotesRow is deliberately NOT gated: its textarea is rendered at
     rest by the textarea+explicit template, so it has no open/closed
     transition and would defer every refresh forever. Its draft is local
     state that a refetch does not touch, so it needs no protection. */
  const anyEditorOpen = openEditors.size > 0 || callbackOpen;
  const anyEditorOpenRef = useRef(anyEditorOpen);
  anyEditorOpenRef.current = anyEditorOpen;

  /* COMMIT-ON-SUCCESS-ONLY. All three reads must resolve before anything is
     replaced, so a failed refresh RETAINS THE SCREEN rather than blanking it.
     That matters most for the rail: railDeal turns oppsError into an error
     state, so routing a refresh failure through setOppsError would replace a
     stale guardrail with no guardrail — and an empty guardrail is worse than
     a stale one.
     Field DEFINITIONS are not refetched: the 101-field schema does not change
     between a tab-hop, and re-reading it would add six folder requests for
     nothing. Notes and conversations refresh after the commit because a GHL
     disposition writes a note. The in-session overrides are left alone; they
     are newer-of by design and clearing them could revert a write GHL has
     not yet surfaced. */
  const refreshAll = useCallback(async () => {
    setRefreshError(null);
    try {
      const [c, d, pipeline] = await Promise.all([
        ghl.contacts.getOne(id),
        ghl.contacts.getDetail(id),
        ghl.opportunities.listPipeline(),
      ]);
      setContact(c);
      setDetail(d);
      setOpps(opportunitiesForContact(pipeline.opportunities, id));
      loadNotes();
      loadConversations();
      setRefreshCount((n) => n + 1);
    } catch (e) {
      setRefreshError((e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* ONE RETURN, ONE REFRESH. focus and visibilitychange both fire coming back
     from another tab. The `wasHidden` latch is what coalesces them: only a
     transition through hidden counts as a return, and the first handler to
     see it clears the latch, so the second is a no-op. */
  useEffect(() => {
    const wasHidden = { current: false };
    const onReturn = () => {
      if (document.visibilityState !== "visible") return;
      if (!wasHidden.current) return;
      wasHidden.current = false;
      if (anyEditorOpenRef.current) { setRefreshDeferred(true); return; }
      void refreshAll();
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") { wasHidden.current = true; return; }
      onReturn();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onReturn);
    };
  }, [refreshAll]);

  /* The deferred half: the editor closed, so take the reading now. Exactly
     one, because the flag is cleared before the fetch is issued. */
  useEffect(() => {
    if (!refreshDeferred || anyEditorOpen) return;
    setRefreshDeferred(false);
    void refreshAll();
  }, [refreshDeferred, anyEditorOpen, refreshAll]);

  useEffect(() => {
    setLoading(true);
    setContact(null);
    setDetailLoading(true);
    setDetail(null);
    setDetailError(null);
    setDefsLoading(true);
    setDefs(null);
    setDefsError(null);
    setNotes(null);
    setConversations(null);
    setConversationsError(null);
    setAttemptOverride(null);
    setCallbackOverride(undefined);
    setCallbackOpen(false);
    setCallbackError(null);
    // S2 — reset BOTH rail-read states on navigation. Leaving `opps` populated
    // would render the previous contact's deal under this contact's name for
    // one paint, which is the misattribution the name in the rail exists to
    // prevent.
    setOpps(null);
    setOppsError(null);
    setOpenEditors(new Set());
    setRefreshDeferred(false);
    setRefreshError(null);
    setRefreshCount(0);
    loadContact();
    loadDetail();
    loadDefs();
    loadNotes();
    loadConversations();
    loadOpportunities();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* Board #5 S2d — THE RAIL'S DEAL READ, now delegated to ../lib/rail.
     Still a pure derivation with no effect and no write; the memo exists only
     so the derivation does not re-run on unrelated renders. Every branch, the
     ask precedence, the provenance and the PB-D55 hard-null choice live in
     deriveRailDeal, where they are reachable by a test. */
  const railDeal: RailDeal = useMemo(
    () => deriveRailDeal({ opps, oppsError, detail, detailLoading, ids: RAIL_IDS }),
    [opps, oppsError, detail, detailLoading],
  );

  /* §4B — the editor's activation flag and the two impure values it needs.
     ⚠ THESE STAY OUT OF rail.ts DELIBERATELY. railCells is pure and its output
     is asserted structurally by the offline harness; putting an id or a save
     handle in a cell would end that. The cell declares a route KIND, the page
     supplies the target. */
  const [askEditorOpen, setAskEditorOpen] = useState(false);
  /* §4C — the target. ANY resolved deal, not just an Opportunity-sourced one:
     origination is the whole point. Unresolved states carry no opportunityId at
     all, so there is nothing to guess with. */
  const railAskOpportunityId =
    railDeal.state === "resolved" ? railDeal.opportunityId : null;

  /* ⚠ §4C — THE ONLY NEW DATUM, AND ITS BOUNDARY IS THE WHOLE POINT.
     confirmedWrite is what the setter told us it wrote (its ROUNDED `sent`,
     never the raw draft -- roundCurrency runs before the PUT, so an unrounded
     draft would never match and the warning would never clear).

     It has exactly two READ-ONLY uses:
       1. PB-D10 write suppression during the post-save / pre-refetch window,
          where `current` is still the OLD prop and a second Enter on the same
          number would otherwise issue a redundant PUT.
       2. the left half of railAuthorityReconciled.

     ⚠ IT DRIVES NOTHING RENDERED -- not the displayed value, not provenance,
     not the source marker, not the route, not the Contact row's authority. Its
     only render-adjacent effect is a boolean that shows a WARNING, which is the
     opposite of asserting authority. Remembering what we just wrote is allowed;
     pretending that memory is authoritative cockpit state is not. */
  const [confirmedWrite, setConfirmedWrite] = useState<number | null>(null);
  const authorityReconciled = railAuthorityReconciled(railDeal, confirmedWrite);

  /* ⚠ CLEARING IS REQUIRED, NOT TIDINESS. A permanently retained confirmedWrite
     would suppress a LEGITIMATE later write of the same number. Once resolved
     authority has observed it, PB-D10 goes back to comparing the prop. */
  useEffect(() => {
    if (confirmedWrite !== null && authorityReconciled) setConfirmedWrite(null);
  }, [confirmedWrite, authorityReconciled]);

  /* ⚠ §4C — A SAVE-TRIGGERED READ IS A DIFFERENT CAUSE FROM A RETURN, AND IS
     KEPT STRUCTURALLY SEPARATE FROM D1. It never touches refreshDeferred, never
     calls refreshAll, and never runs through the focus/visibility listeners, so
     it cannot increment or satisfy D1's return-refresh accounting. Targeted: it
     re-reads the Opportunity list only, because that is the one thing the write
     changed.

     ⚠ ON FAILURE IT DOES NOT FABRICATE THE FLIP. The setter's readback proves
     the write landed; it does not entitle the cockpit to relabel authority.
     Authority comes from the same resolved state as everywhere else, or the
     editor says it could not refresh. */
  const [saveRefreshCount, setSaveRefreshCount] = useState(0);
  const refreshOpportunities = useCallback(async () => {
    const pipeline = await ghl.opportunities.listPipeline();
    setOpps(opportunitiesForContact(pipeline.opportunities, id));
    setSaveRefreshCount((n) => n + 1);
  }, [id]);

  /* Authority for the record row (§4B item 7, corrected in §4D). ⚠ THE SAME
     ALREADY-RESOLVED STATE THE RAIL RENDERS -- not a second read, not a second
     resolution. One source feeds both surfaces, so the cockpit and the record
     cannot disagree about which carrier governs.
     ⚠ THE PROJECTION MOVED INTO rail.ts AND MUST STAY THERE. This was a local
     `state === "resolved" && ask !== null ? ask.source : null`, which collapsed
     FIVE rail states into a single null and let the row below claim authority
     on every contact that was not resolved-with-an-Ask. rail.ts owns the
     mapping because only there does the discriminated union make totality a
     compile-time property. */
  const askAuthority: ContactAskAuthority = contactAskAuthority(railDeal);

  // Folder names (§5.4) — after defs resolve, fetch every distinct parentId in
  // parallel and build the display-ordered name map. ORDER is an IAOS
  // presentation decision (NOT GHL's): Offer first, then remaining folders
  // ascending by the FOLDER's own position from getFolder. A fetch failure sets
  // the existing defsError. The cancelled guard drops a stale in-flight result
  // when defs/id changes. getFolder is cache-first, so revisits don't refetch.
  useEffect(() => {
    if (defs == null) { setFolderNames(null); setFolderNamesLoading(true); return; }
    let cancelled = false;
    const distinct = [...new Set(defs.map((d) => d.parentId))];
    Promise.all(distinct.map((pid) => ghl.customFields.getFolder(pid)))
      .then((folders) => {
        if (cancelled) return;
        const ordered = [...folders].sort((a, b) =>
          a.id === OFFER_FOLDER_ID ? -1 : b.id === OFFER_FOLDER_ID ? 1 : a.position - b.position);
        const map = new Map<string, string>();
        ordered.forEach((f) => map.set(f.id, f.name));
        setFolderNames(map);
      })
      .catch((e: Error) => { if (!cancelled) setDefsError(e.message); })
      .finally(() => { if (!cancelled) setFolderNamesLoading(false); });
    return () => { cancelled = true; };
  }, [defs]);

  // Effective last attempt: in-session override wins (just saved), then the
  // exact TEXT companion, then the truncated DATE field — same resolver shape
  // as the Dashboard's effectiveLastAttempt.
  const lastAttempt = useMemo(() => {
    if (attemptOverride) return attemptOverride;
    return contact?.lastCallAttemptPrecise ?? contact?.lastCallAttempt ?? null;
  }, [attemptOverride, contact]);

  // Effective callback: in-session override wins, then precise, then the
  // truncated DATE field — same precise→DATE fallback as effectiveCallback on
  // the Dashboard.
  const callback = useMemo(() => {
    if (callbackOverride !== undefined) return callbackOverride;
    return contact?.callbackDatetimePrecise ?? contact?.callbackDatetime ?? null;
  }, [callbackOverride, contact]);

  // Displayable transcript (§8 step 5): the function returns the COMPLETE, ascending
  // transcript — real messages AND GHL pipeline-activity rows (TYPE_ACTIVITY_OPPORTUNITY
  // "Opportunity created/updated" etc.). Those are noise, not conversation. Allowlist
  // on messageType — NOT the numeric `type` field — so SMS (TYPE_SMS) just joins the
  // set later. Already oldest→newest from the function; do not re-sort.
  const CONVERSATION_TYPES = ["TYPE_EMAIL", "TYPE_SMS"];
  const displayMessages = useMemo(
    () => (conversations ?? []).filter((m) => CONVERSATION_TYPES.includes(m.messageType)),
    [conversations],
  );

  // Record render model (§5.4 join) — generalizes the Offer join to ALL folders.
  // Groups every def by parentId (grouping hardcodes NO folder id), position-
  // orders each folder, and left-joins detail's sparse values by id (superset
  // preserved; an unmatched def is INCLUDED with value absent — == null test,
  // never falsiness, so 0 and wire null survive). recordModel emits the Offer
  // folder (YslJ5oke73JrBOgaq0np) FIRST, but its emission order is NOT the
  // display order — the render maps [...folderNames], never recordModel, so this
  // order never reaches the DOM. Display order is the DECIDED IAOS rule, owned
  // by the folder-names effect's sort: Offer first, then the remaining folders
  // ascending by each folder's own GHL position. Null until defs load; does NOT
  // wait on detail.
  const recordModel = useMemo(() => {
    if (defs == null) return null;
    const values = detail?.customFields ?? [];
    const byFolder = new Map<string, CustomFieldDef[]>();
    for (const d of defs) {
      const arr = byFolder.get(d.parentId);
      if (arr) arr.push(d);
      else byFolder.set(d.parentId, [d]);
    }
    const parentIds = [...byFolder.keys()];
    const ordered = [
      ...parentIds.filter((p) => p === OFFER_FOLDER_ID),
      ...parentIds.filter((p) => p !== OFFER_FOLDER_ID),
    ];
    return ordered.map((parentId) => ({
      parentId,
      fields: byFolder.get(parentId)!
        .sort((a, b) => a.position - b.position)
        .map((d) => {
          const entry = values.find((v) => v.id === d.id);
          return { id: d.id, fieldKey: d.fieldKey, name: d.name, dataType: d.dataType, value: entry == null ? undefined : entry.value };
        }),
    }));
  }, [defs, detail]);

  // The note IS the attempt (§4/§6). Empty/whitespace notes do nothing. Same
  // two-call sequence the Dashboard uses: create note, then mark attempt. After
  // saving, re-read notes from GHL (not a local prepend) so the displayed list
  // is what GHL actually holds — no shadow copy.
  async function handleNoteBlur() {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await ghl.notes.create(id, text);
      setDraft("");
      const nowIso = new Date().toISOString();
      try {
        await ghl.contacts.setLastCallAttempt(id, nowIso);
        setAttemptOverride(nowIso);
      } catch (e) {
        setSaveError(`Note saved, but couldn't mark attempted: ${(e as Error).message}`);
      }
      loadNotes();
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // Scheduling a callback writes a note; a note greys (§6). Gated per Brad: the
  // callback must persist before the note asserts it exists, and the note must
  // persist before the attempt is marked — never a note claiming an unproven
  // callback. Still exactly three writes (setCallbackDatetime + notes.create +
  // setLastCallAttempt), no new method.
  async function handleSaveCallback(iso: string) {
    setCallbackSaving(true);
    setCallbackError(null);
    const result = await scheduleCallbackGated(ghl, id, iso);
    setCallbackSaving(false);

    if (result.ok) {
      setCallbackOverride(iso);
      setAttemptOverride(result.attemptIso);
      setCallbackOpen(false);
      loadNotes();
      return;
    }

    // A persisted callback (note/attempt stage) still shows as scheduled; a
    // callback-stage failure never wrote it, so the override stays put.
    if (result.callbackPersisted) setCallbackOverride(iso);
    setCallbackError(result.error);
    if (result.stage === "callback") return; // gate held: no note, no attempt; popover stays open
    // Note failed → popover stays open. Attempt failed → callback+note saved, close it.
    if (result.stage === "attempt") setCallbackOpen(false);
    loadNotes();
  }

  // Clearing is not scheduling — no note, no attempt. Clears the field only.
  async function handleClearCallback() {
    setCallbackSaving(true);
    setCallbackError(null);
    try {
      await ghl.contacts.setCallbackDatetime(id, null);
      setCallbackOverride(null);
      setCallbackOpen(false);
    } catch (e) {
      setCallbackError(`Couldn't clear callback: ${(e as Error).message}`);
    } finally {
      setCallbackSaving(false);
    }
  }

  if (error) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "300px", gap: "12px" }}>
        <AlertCircle size={32} style={{ color: "#EF4444" }} />
        <p style={{ color: "#F87171", fontWeight: 500 }}>Failed to load contact</p>
        <p style={{ color: "#64748B", fontSize: "13px", maxWidth: "400px", textAlign: "center" }}>{error}</p>
        <Link to="/contacts" style={{ color: "#1EC8FF", fontSize: "13px" }}>← Back to Contacts</Link>
      </div>
    );
  }

  if (!loading && notFound) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "300px", gap: "12px" }}>
        <AlertCircle size={32} style={{ color: "#F59E0B" }} />
        <p style={{ color: "#F1F5F9", fontWeight: 500 }}>Contact not found</p>
        <p style={{ color: "#64748B", fontSize: "13px" }}>No contact with id {id}</p>
        <Link to="/contacts" style={{ color: "#1EC8FF", fontSize: "13px" }}>← Back to Contacts</Link>
      </div>
    );
  }

  const tier: BucketTag = contact ? getBucketTag(contact) : "low";

  return (
    /* D1 — the provider is per-page, so the gate set cannot outlive or be
       shared across a remount. data-* are the harness's only handles on
       asynchronous refresh state: a counter it can compare across a return,
       and the gate size it must see fall to zero before expecting the
       deferred read. */
    <EditorGateContext.Provider value={editorGate}>
    <div
      style={{ maxWidth: CONTENT_MAX_WIDTH }}
      data-testid="contact-workspace"
      data-refresh-count={refreshCount}
      /* §4C — a SEPARATE counter for the save-triggered read. D1 accounting
         must never be satisfied by a save, and a save must never be mistaken
         for a return. Two causes, two counters, both visible. */
      data-save-refresh-count={saveRefreshCount}
      data-open-editors={openEditors.size + (callbackOpen ? 1 : 0)}
      data-refresh-deferred={refreshDeferred ? "true" : "false"}
    >
      {/* Back link */}
      <Link to="/contacts" style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "12px", color: "#64748B", marginBottom: "14px", textDecoration: "none" }}>
        <ArrowLeft size={13} /> Contacts
      </Link>

      {/* Identity header */}
      <div data-testid="identity-header" style={{
        display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", flexWrap: "wrap",
        background: "#0D1B3E", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", padding: "16px 18px", marginBottom: "18px",
      }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: "22px", fontWeight: 600, color: "#F1F5F9", fontFamily: "Space Grotesk, sans-serif", margin: "0 0 8px" }}>
            {loading ? "…" : contactName(contact!)}
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap", fontSize: "13px", color: "#94A3B8" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <Phone size={13} style={{ color: "#475569" }} /> {loading ? "…" : (formatPhone(contact!.phone) || "—")}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <MapPin size={13} style={{ color: "#475569" }} /> {loading ? "…" : formatAddress(contact!)}
            </span>
            {detail?.dndSettings && Object.keys(detail.dndSettings).length > 0 &&
              Object.entries(detail.dndSettings).map(([channel, v]) => (
                <span key={channel} style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "#F59E0B" }}>
                  <BellOff size={13} /> {channel}: {v?.status ?? "—"}
                </span>
              ))}
          </div>
        </div>
        {!loading && contact && (
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <TierBadge tier={tier} />
            <ScoreChip label="Combined" score={contact.combinedScore} />
            <ScoreChip label="Mot" score={contact.motivationScore} />
            <ScoreChip label="Deal" score={contact.dealScore} />
          </div>
        )}
      </div>

      {/* Board #5 — persistent call rail. Content comes from railCells() above.

          PLACEMENT is the §D measurement, re-derived here: a FLAT SIBLING
          between the identity header and Actions. Nothing existing is
          re-nested or modified — the three blocks were already siblings under
          one maxWidth wrapper, so this is a pure insert, the same shape as the
          Board 4 DispositionControl mount below Actions.

          ABOVE Actions, not below: deal economics are the context for the call,
          so they precede the actions taken on that context. Below Actions would
          also push the rail under DispositionControl, separating the ask from
          the disposition that answers it.

          RENDERS UNCONDITIONALLY — no `loading` gate, no `contact` gate. The
          rail owns its own per-cell states, so gating the whole block would
          replace four honest "reading…" cells with an empty space. The
          identity header above renders unconditionally for the same reason.

          READ-ONLY BY CONSTRUCTION. S2 added exactly one GET
          (ghl.opportunities.listPipeline, the accessor UnderwritingWorkspace
          already used) and no setter, no PUT, no note, no tag, no stage move.
          It cannot grey a row and cannot fire a workflow. It CAN now disagree
          with another surface, which it could not before — so the ask
          precedence and the field parsers are borrowed from resolver.ts rather
          than reimplemented, and the opportunity selection is the shared
          PB-D55 rule. See railDeal below.

          STICKY, DELIBERATELY — `position: "sticky"`, `top: 0`, `zIndex: 1` on
          the style object below. SELLER_ACQUISITION_WORKFLOW.md L207-208 is the
          authority: "A guardrail that scrolls out of view when the seller says
          a number is not a guardrail." Seller MAO lands in this rail at S2, and
          a MAO that has scrolled off during a live call is not a guardrail — so
          the rail outlives the scroll or it fails its only job. The scroll
          container is <main className="flex-1 overflow-auto p-6"> in
          Layout.tsx:22; nothing between it and this div sets `overflow`, so
          nothing clips the sticky.

          ⚠ `top: 0` PINS TO THE SCROLLPORT TOP, ABOVE main's p-6 — so the stuck
          rail sits flush under the Header, and both are near #0D1B3E. THAT
          OUTCOME IS KNOWN AND ACCEPTED, not an oversight. Do NOT "fix" it with
          a bottom border, a top offset or a separator.

          ⚠ `zIndex: 1`, NOT HIGHER. CallbackPopover renders at zIndex 20
          (CallbackPopover.tsx:50) and MUST draw over a stuck rail; raising this
          value hides the callback popover behind it.

          Decided in the S1 amendment — see claude/board-5-s1-review-2026-08-28.md. */}
      <div
        data-testid="deal-rail"
        style={{
          display: "flex", flexWrap: "wrap", gap: "28px",
          background: "#0D1B3E", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "10px", padding: "12px 18px", marginBottom: "18px",
          position: "sticky", top: 0, zIndex: 1,
        }}
      >
        {/* Board #5 S2 — WHOSE DEAL THIS IS. Closes the S1 risk that a sticky
            $210k/$165k bar outlives the identity header and leaves four
            figures attached to no seller. NAME ONLY, from state this page
            already holds — no new fetch, no phone, no address. */}
        <div data-testid="rail-identity" style={{ minWidth: 0, paddingRight: "4px", borderRight: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{
            fontSize: "11px", fontWeight: 600, letterSpacing: "0.05em",
            textTransform: "uppercase", color: "#64748B", marginBottom: "3px",
          }}>
            Seller
          </div>
          <div data-testid="rail-contact-name" style={{ fontSize: "13px", fontWeight: 600, color: "#F1F5F9" }}>
            {loading || !contact ? "…" : contactName(contact)}
          </div>
        </div>

        {railCells(railDeal).map((cell) => (
          <div key={cell.key} data-testid={`rail-cell-${cell.key}`} style={{ minWidth: 0 }}>
            <div
              data-testid={`rail-label-${cell.key}`}
              style={{
                fontSize: "11px", fontWeight: 600, letterSpacing: "0.05em",
                textTransform: "uppercase", color: "#64748B", marginBottom: "3px",
              }}
            >
              {cell.label}
            </div>
            {/* A waiting state renders dimmer than its own label and italic, so
                it can never be misread as a value. NO ZERO, NO DASH, NO BLANK —
                the cell states what is missing, per L202. A value renders
                bright and upright; the two are never the same shape. */}
            <div
              data-testid={`rail-state-${cell.key}`}
              data-rail-tone={cell.tone}
              style={cell.tone === "value"
                ? { fontSize: "15px", fontWeight: 600, color: "#F1F5F9" }
                : { fontSize: "12px", fontStyle: "italic", color: "#475569" }}
            >
              {/* §4B — ONLY the Opportunity-sourced Ask becomes editable. Every
                  other cell, and the Contact-fallback Ask, render exactly as
                  before: same element, same testid, same text. The fallback
                  branch is deliberately untouched — it is the branch every
                  Production contact reaches, and it still routes to the record
                  that genuinely governs there. */}
              {/* ⚠ EDIT MODE ONLY LIVES HERE. PB-D17 Model B is a display-to-edit
                  SWAP, so the input must REPLACE the number, in the element that
                  IS the number. §4B put it here and that is correct.
                  ⚠ ORIGINATION MUST NOT BE HERE. It is ADDITIVE -- the Contact
                  ask stays on screen beside it -- so rendering it inside would
                  turn this from a VALUE element into a value+action container.
                  It did, and rail-ask-value caught it: the element read
                  "$115,000Set Opportunity Ask". This div contains the value, or
                  the thing that replaces the value. Nothing additive. */}
              {cell.editor !== null && cell.editor.seed !== null && railAskOpportunityId !== null ? (
                <RailAskEditor
                  open={askEditorOpen}
                  onOpen={() => setAskEditorOpen(true)}
                  onClose={() => setAskEditorOpen(false)}
                  opportunityId={railAskOpportunityId}
                  seed={cell.editor.seed}
                  label={cell.editor.label}
                  display={cell.primary}
                  confirmedWrite={confirmedWrite}
                  authorityReconciled={authorityReconciled}
                  onConfirmed={setConfirmedWrite}
                  onRefresh={refreshOpportunities}
                />
              ) : (
                cell.primary
              )}
            </div>
            {/* ⚠ PROVENANCE. Whenever a number is shown, the source that
                supplied it is shown beside it. This is what makes the
                Opportunity→Contact ask fallback safe: a contact value is
                LABELLED a contact value and cannot pass as Opportunity-owned.
                Do not remove this line to tidy the layout. */}
            {cell.provenance !== null && (
              <div
                data-testid={`rail-provenance-${cell.key}`}
                data-rail-source={cell.provenance.startsWith("Opportunity") ? "opportunity" : "contact"}
                style={{ fontSize: "10px", letterSpacing: "0.04em", color: cell.provenance.startsWith("Opportunity") ? "#64748B" : "#F59E0B", marginTop: "1px" }}
              >
                {cell.provenance}
              </div>
            )}
            {/* ⚠ ORIGINATION RENDERS HERE, OUTSIDE rail-state, as a sibling --
                the same structural position every other rail action already
                uses. Ordering is ruled: "Set Opportunity Ask" (primary) BEFORE
                "Edit on the Contact in GHL" (secondary), with provenance still
                sitting immediately under the value it labels.
                ⚠ THE TWO MODES ARE MUTUALLY EXCLUSIVE (seed null XOR not null),
                so this is ONE component in ONE position at a time -- never two
                instances, never split state. */}
            {cell.editor !== null && cell.editor.seed === null && railAskOpportunityId !== null && (
              <RailAskEditor
                open={askEditorOpen}
                onOpen={() => setAskEditorOpen(true)}
                onClose={() => setAskEditorOpen(false)}
                opportunityId={railAskOpportunityId}
                seed={cell.editor.seed}
                label={cell.editor.label}
                display={cell.primary}
                confirmedWrite={confirmedWrite}
                authorityReconciled={authorityReconciled}
                onConfirmed={setConfirmedWrite}
                onRefresh={refreshOpportunities}
              />
            )}
            {/* §4A — THE ROUTE APPEARS ONLY WHERE IT REACHES THE AUTHORITATIVE
                FIELD. Contact-fallback means the Opportunity carries no Ask, so
                the contact record IS the right place to change it and the
                existing hop lands exactly there. Reuses ghlContactDetailUrl —
                NO new URL surface; the opportunity deep-link is D4 and blocked.
                Read-only: window.open writes nothing, exactly like the Call
                button, so it can never grey a row. */}
            {cell.route !== null && (
              <button
                data-testid={`rail-route-${cell.key}`}
                data-rail-route={cell.route.kind}
                /* §4C — NAVIGATION ONLY again. The in-place editor moved to
                   cell.editor, so this button has exactly one behaviour and
                   window.open still writes nothing. */
                onClick={() => window.open(ghlContactDetailUrl(id), "_blank", "noopener,noreferrer")}
                style={{
                  marginTop: "3px", fontSize: "10px", fontWeight: 600, padding: "2px 7px",
                  borderRadius: "5px", border: "1px solid rgba(30,200,255,0.3)",
                  background: "rgba(30,200,255,0.07)", color: "#1EC8FF", cursor: "pointer",
                }}
              >
                {cell.route.label}
              </button>
            )}
            {/* Stated so the ABSENCE of a route is explained rather than silent. */}
            {cell.authorityNote !== null && (
              <div
                data-testid={`rail-authority-note-${cell.key}`}
                style={{ fontSize: "10px", fontStyle: "italic", color: "#64748B", marginTop: "2px", maxWidth: "220px" }}
              >
                {cell.authorityNote}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* D1 — a FAILED return refresh reports itself here and changes nothing
          above. The rail keeps its last good figures: railDeal turns oppsError
          into an error state, so routing this through the section errors would
          replace a stale guardrail with no guardrail. Stale-and-flagged beats
          empty. */}
      {refreshError !== null && (
        <div
          data-testid="refresh-error"
          style={{ fontSize: "11px", color: "#F59E0B", marginTop: "-10px", marginBottom: "14px" }}
        >
          Couldn't refresh after returning — showing the last loaded values. {refreshError}
        </div>
      )}

      {/* Actions (§7). The Call button opens this contact's GHL RECORD in a new
          tab. NOT a dialer, and the label says so: Brad lands on the record and
          still originates the call from there. That extra step is the platform's,
          not a gap in this button.

          The limitation behind it is real and now verified from primary source
          rather than cited: GHL's Conversation Providers documentation states
          call providers "cannot be used to place or receive calls within the CRM
          and can only be used to log calls via inbound and outbound apis."
          Corroborated independently by data IAOS already reads — calls arrive as
          TYPE_CALL log entries, which Conversations filters out as non-messages.

          It writes NOTHING: no note, no last_call_attempt, no callback, so it
          NEVER greys a row (§6: "call + no disposition (no note) = no grey").
          tabIndex=-1 + mousedown-prevent keep it from stealing focus from the
          note input (Dashboard parity). */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "18px" }}>
        <button
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => window.open(ghlContactDetailUrl(id), "_blank", "noopener,noreferrer")}
          disabled={loading}
          title="Opens this contact's record in GHL, where the call is placed"
          style={{
            display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 600,
            padding: "8px 14px", borderRadius: "8px", border: "1px solid rgba(30,200,255,0.35)",
            background: "rgba(30,200,255,0.08)", color: "#1EC8FF", cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          <PhoneCall size={14} /> Open GHL to Call
        </button>
        {/* Board item #2A — the only entry point to /contacts/:id/underwriting.
            The route has existed since the Underwriting Workspace shipped and was
            reachable only by typing the URL, so the surface was effectively
            unreachable from inside the product.

            <Link>, not window.open: this is an in-app route and the Call button
            above is the exception, not the pattern — it hands off to GHL's
            contact record because GHL's API cannot originate a call. A new tab
            here would drop the SPA's loaded state for no gain.

            READ-ONLY. Navigation writes nothing: no note, no last_call_attempt,
            no callback. Same rule as the Call button and the step-7 name-click
            deep link -- it can never grey a row. */}
        <Link
          to={`/contacts/${id}/underwriting`}
          data-testid="contact-underwriting-link"
          style={{
            display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 600,
            padding: "8px 14px", borderRadius: "8px", border: "1px solid rgba(30,200,255,0.35)",
            background: "rgba(30,200,255,0.08)", color: "#1EC8FF", textDecoration: "none",
          }}
        >
          <Calculator size={14} /> Underwriting
        </Link>
        <div style={{ position: "relative" }}>
          <button
            onClick={() => { setCallbackOpen((v) => !v); setCallbackError(null); }}
            disabled={loading}
            style={{
              display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 600,
              padding: "8px 14px", borderRadius: "8px", border: "1px solid rgba(30,200,255,0.35)",
              background: callback ? "rgba(30,200,255,0.18)" : "rgba(30,200,255,0.08)",
              color: "#1EC8FF", cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            <CalendarClock size={14} /> {callback ? "Reschedule Callback" : "Schedule Callback"}
          </button>
          {callbackOpen && (
            <CallbackPopover
              current={callback}
              saving={callbackSaving}
              error={callbackError}
              onSave={handleSaveCallback}
              onClear={handleClearCallback}
              onClose={() => setCallbackOpen(false)}
            />
          )}
        </div>
        {callback && (
          <span style={{ fontSize: "12px", fontWeight: 500, color: "#1EC8FF" }}>
            Callback: {formatCallbackTime(callback)}
          </span>
        )}
      </div>

      {/* Board 4 Tranche A — native disposition capture (R1). Sits directly
          under Actions because it records the outcome of the call the Call
          button above hands off to GHL for. onAttempt fires only on a CONFIRMED
          attempt write, so the in-session override never claims a write that
          did not land — the same rule the note→attempt path at L738 follows. */}
      {contact && (
        <DispositionControl
          contactId={id!}
          contact={detail}
          onAttempt={(iso) => setAttemptOverride(iso)}
        />
      )}

      {/* Record section (§5.4) — all six folders, collapsible. Live field defs +
          folder names from GHL; ORDER is an IAOS presentation decision (Offer
          first, then remaining folders ascending by GHL folder position), NOT
          GHL's own order (see the folder-names effect). Section-scoped states
          (D3), precedence unchanged: defsError/detailError → error; defs or
          folder-names loading → loading; else fields. Collapsed bodies stay
          MOUNTED (display:none) — every field row is in the DOM regardless of
          collapse state. Nothing else on the page depends on defs/detail. */}
      <div style={{ marginBottom: "18px" }}>
        {(defsError || detailError) ? (
          <div style={{ background: "#0D1B3E", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "10px", padding: "14px 16px", color: "#F87171", fontSize: "13px" }}>
            Couldn't load fields: {defsError || detailError}
          </div>
        ) : (defsLoading || folderNamesLoading) ? (
          <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#334155", fontSize: "12px" }}>
            <Loader2 size={13} className="animate-spin" /> Loading fields…
          </div>
        ) : (recordModel && folderNames) && (
          <div data-testid="record-section" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {[...folderNames].map(([parentId, folderName]) => {
              const folder = recordModel.find((r) => r.parentId === parentId);
              const open = expanded.has(parentId);
              return (
                <div key={parentId} style={{ background: "#0D1B3E", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", overflow: "hidden" }}>
                  <button
                    onClick={() => setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(parentId)) next.delete(parentId); else next.add(parentId);
                      return next;
                    })}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: "8px", padding: "10px 16px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}
                  >
                    {open ? <ChevronDown size={14} style={{ color: "#64748B" }} /> : <ChevronRight size={14} style={{ color: "#64748B" }} />}
                    <span style={{ fontSize: "14px", fontWeight: 600, color: "#F1F5F9", fontFamily: "Space Grotesk, sans-serif" }}>{folderName}</span>
                  </button>
                  <div style={{ display: open ? "flex" : "none", flexDirection: "column", gap: "6px", padding: "0 16px 12px" }}>
                    {parentId === ADDITIONAL_INFO_FOLDER_ID
                      ? groupAdditionalInfo(folder?.fields ?? []).map(({ subgroup, fields }) => (
                          <div key={subgroup} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                            <div style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "#64748B", marginTop: "4px" }}>{subgroup}</div>
                            {fields.map((f) => (
                              <FieldRow key={f.id} f={f} contactId={id} askAuthority={askAuthority} />
                            ))}
                          </div>
                        ))
                      : (folder?.fields ?? []).map((f) => (
                          <FieldRow key={f.id} f={f} contactId={id} askAuthority={askAuthority} />
                        ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Two-column: left = work, right = context */}
      <div style={{ display: "flex", gap: "18px", alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* LEFT — notes / the work */}
        <div style={{ flex: "1 1 420px", minWidth: "320px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
            <h2 style={{ fontSize: "15px", fontWeight: 600, color: "#F1F5F9", margin: 0, fontFamily: "Space Grotesk, sans-serif" }}>Notes</h2>
            <span style={{ fontSize: "11px", color: lastAttempt ? "#F59E0B" : "#334155" }}>
              {lastAttempt ? `Last attempted ${relativeTime(lastAttempt)}` : "Not yet contacted"}
            </span>
          </div>

          {/* New-note input — autosave on blur */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "12px" }}>
            <StickyNote size={14} style={{ color: "#475569", flexShrink: 0 }} />
            <input
              value={draft}
              disabled={saving || loading}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={handleNoteBlur}
              placeholder={saving ? "Saving…" : "New note (any text = attempted)…"}
              style={{
                width: "100%", fontSize: "13px", padding: "8px 10px", borderRadius: "8px",
                border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)", color: "#F1F5F9",
              }}
            />
          </div>
          {saveError && <div style={{ fontSize: "11px", color: "#F87171", marginBottom: "10px" }}>{saveError}</div>}

          {/* History, newest first */}
          {notesError ? (
            <div style={{ fontSize: "12px", color: "#F87171" }}>Failed to load notes: {notesError}</div>
          ) : notes === null ? (
            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#334155", fontSize: "12px" }}>
              <Loader2 size={13} className="animate-spin" /> Loading notes…
            </div>
          ) : notes.length === 0 ? (
            <div style={{ background: "#0D1B3E", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", padding: "18px 16px", color: "#334155", fontSize: "13px", textAlign: "center" }}>
              No notes yet.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {notes.map((n) => (
                <div key={n.id} style={{ background: "#0D1B3E", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", padding: "10px 14px" }}>
                  <div style={{ fontSize: "10px", color: "#475569", marginBottom: "4px" }}>{formatNoteDate(n.dateAdded)}</div>
                  <div style={{ fontSize: "13px", color: "#E2E8F0", whiteSpace: "pre-wrap" }}>{n.body}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT — conversation history (step 5). Read-only transcript, oldest→newest
            (reads the way the call prep needs it). Scoped by explicit contactId; no writes. */}
        <div style={{ flex: "1 1 420px", minWidth: "320px" }}>
          <h2 style={{ fontSize: "15px", fontWeight: 600, color: "#F1F5F9", margin: "0 0 10px", fontFamily: "Space Grotesk, sans-serif" }}>Conversation History</h2>
          {conversationsError ? (
            <div style={{ fontSize: "12px", color: "#F87171" }}>Failed to load conversation history: {conversationsError}</div>
          ) : conversations === null ? (
            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#334155", fontSize: "12px" }}>
              <Loader2 size={13} className="animate-spin" /> Loading conversation history…
            </div>
          ) : displayMessages.length === 0 ? (
            <div style={{ background: "#0D1B3E", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", padding: "18px 16px", color: "#334155", fontSize: "13px", textAlign: "center" }}>
              No conversation history.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "60vh", overflowY: "auto" }}>
              {displayMessages.map((m) => (
                <ConversationBubble key={m.id || `${m.conversationId}-${m.dateAdded}`} m={m} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
    </EditorGateContext.Provider>
  );
}
