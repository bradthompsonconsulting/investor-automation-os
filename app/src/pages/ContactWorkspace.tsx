import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft, Phone, PhoneCall, MapPin, StickyNote, AlertCircle, Loader2, BellOff,
  Flame, Sun, Snowflake, CalendarClock, ArrowDownLeft, ArrowUpRight, ChevronDown, ChevronRight,
} from "lucide-react";
import { ghl, getBucketTag, ghlContactDetailUrl, PROPERTY_NOTES_ID, ARV_ID, type ContactRow, type ContactDetail, type CustomFieldDef, type BucketTag, type ConvMessageRow } from "../lib/ghl";
import { CallbackPopover } from "../components/CallbackPopover";
import { scheduleCallbackGated, formatCallbackTime } from "../lib/callbackWrite";
import { formatPhone } from "../lib/format";
import { ADDITIONAL_INFO_SUBGROUPS, type AdditionalInfoSubgroup } from "../config/additionalInfoSubgroups";

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

// ── Presentational helpers (replicated from Dashboard; purely visual, no
//    coupling — Dashboard.tsx is intentionally untouched this phase) ──────────

const TIER_COLOR: Record<BucketTag, string> = { hot: "#EF4444", warm: "#F59E0B", low: "#64748B" };
const TIER_ICON: Record<BucketTag, typeof Flame> = { hot: Flame, warm: Sun, low: Snowflake };

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

// Phase B PB-D16/D17/D19/D20/D21 — the ARV unlocked row. currency + inline.
// Model B display-to-edit swap: formatted currency at rest, raw number while editing.
// No Save/Cancel controls. Enter, Tab, or click-out commits; Escape cancels.
function ArvRow({ f, contactId }: { f: RecordField; contactId: string }) {
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
  async function verify(expected: number | ""): Promise<"saved" | "unconfirmed"> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) await new Promise((r) => setTimeout(r, 1000));
      const d = await ghl.contacts.getDetail(contactId);
      const entry = d.customFields.find((cf) => cf.id === ARV_ID);
      if (expected === "") {
        if (!entry) return "saved";
      } else if (entry && Number(entry.value) === expected) {
        return "saved";
      }
    }
    return "unconfirmed";
  }

  async function commit() {
    const raw = draft.trim();
    // PB-D20 — invalid input does NOT commit and does NOT cancel. The editor stays
    // open with the draft preserved. Focus is never forced back.
    if (raw !== "" && !CURRENCY_RE.test(raw)) { setInvalid(true); return; }
    setInvalid(false);
    const next: number | "" = raw === "" ? "" : Number(raw.replace(/[$,]/g, ""));
    // PB-D10 — unchanged value fires no PUT.
    if (next === current) { setEditing(false); return; }
    setEditing(false);
    setStatus("verifying");
    setErrMsg(null);
    try {
      await ghl.contacts.setARV(contactId, next);
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
    if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
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

function FieldRow({ f, contactId }: { f: RecordField; contactId: string }) {
  if (f.id === PROPERTY_NOTES_ID) return <PropertyNotesRow f={f} contactId={contactId} />;
  if (f.id === ARV_ID) return <ArvRow f={f} contactId={contactId} />;
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
  const [defs, setDefs]               = useState<CustomFieldDef[] | null>(null);
  const [defsLoading, setDefsLoading] = useState(true);
  const [defsError, setDefsError]     = useState<string | null>(null);

  // Folder display names (§5.4) — Map<parentId, name>, insertion-ordered to the
  // IAOS display order (Offer first, then remaining by folder position). Own
  // loading flag; a fetch failure sets the EXISTING defsError (no third error
  // state). `expanded` = the set of expanded folder ids; Offer starts open.
  const [folderNames, setFolderNames]               = useState<Map<string, string> | null>(null);
  const [folderNamesLoading, setFolderNamesLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["YslJ5oke73JrBOgaq0np"]));

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
    loadContact();
    loadDetail();
    loadDefs();
    loadNotes();
    loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Folder names (§5.4) — after defs resolve, fetch every distinct parentId in
  // parallel and build the display-ordered name map. ORDER is an IAOS
  // presentation decision (NOT GHL's): Offer first, then remaining folders
  // ascending by the FOLDER's own position from getFolder. A fetch failure sets
  // the existing defsError. The cancelled guard drops a stale in-flight result
  // when defs/id changes. getFolder is cache-first, so revisits don't refetch.
  useEffect(() => {
    if (defs == null) { setFolderNames(null); setFolderNamesLoading(true); return; }
    let cancelled = false;
    const OFFER_FOLDER_ID = "YslJ5oke73JrBOgaq0np";
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
  const CONVERSATION_TYPES = ["TYPE_EMAIL"];
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
    const OFFER_FOLDER_ID = "YslJ5oke73JrBOgaq0np";
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
    <div style={{ maxWidth: CONTENT_MAX_WIDTH }}>
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

      {/* Actions (§7). Call button (step 4) opens GHL's own dialer in a new tab —
          GHL's public API can't originate a call (§1). It writes NOTHING: no note,
          no last_call_attempt, no callback, so it NEVER greys a row (§6: "call +
          no disposition (no note) = no grey"). tabIndex=-1 + mousedown-prevent keep
          it from stealing focus from the note input (Dashboard parity). */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "18px" }}>
        <button
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => window.open(ghlContactDetailUrl(id), "_blank", "noopener,noreferrer")}
          disabled={loading}
          title="Open in GHL to call"
          style={{
            display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 600,
            padding: "8px 14px", borderRadius: "8px", border: "1px solid rgba(30,200,255,0.35)",
            background: "rgba(30,200,255,0.08)", color: "#1EC8FF", cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          <PhoneCall size={14} /> Call
        </button>
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
                    {parentId === "qYS1wakeOTmfgjyeSJ8M"
                      ? groupAdditionalInfo(folder?.fields ?? []).map(({ subgroup, fields }) => (
                          <div key={subgroup} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                            <div style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "#64748B", marginTop: "4px" }}>{subgroup}</div>
                            {fields.map((f) => (
                              <FieldRow key={f.id} f={f} contactId={id} />
                            ))}
                          </div>
                        ))
                      : (folder?.fields ?? []).map((f) => (
                          <FieldRow key={f.id} f={f} contactId={id} />
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
              {displayMessages.map((m) => {
                const outbound = m.direction === "outbound";
                return (
                  <div
                    key={m.id || `${m.conversationId}-${m.dateAdded}`}
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
                    <div style={{ fontSize: "13px", color: "#E2E8F0", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {m.body || <span style={{ color: "#475569", fontStyle: "italic" }}>({m.channel.toLowerCase()}, no text)</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
