import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft, Phone, PhoneCall, MapPin, StickyNote, AlertCircle, Loader2,
  Flame, Sun, Snowflake, CalendarClock, ArrowDownLeft, ArrowUpRight,
} from "lucide-react";
import { ghl, getBucketTag, ghlContactDetailUrl, type ContactRow, type BucketTag, type ConvMessageRow } from "../lib/ghl";
import { CallbackPopover } from "../components/CallbackPopover";
import { scheduleCallbackGated, formatCallbackTime } from "../lib/callbackWrite";

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

// ── Main ─────────────────────────────────────────────────────────────────────

export default function ContactWorkspace() {
  const { id = "" } = useParams();

  const [contact, setContact]   = useState<ContactRow | null>(null);
  const [loading, setLoading]   = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError]       = useState<string | null>(null);

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

  useEffect(() => {
    setLoading(true);
    setContact(null);
    setNotes(null);
    setConversations(null);
    setConversationsError(null);
    setAttemptOverride(null);
    setCallbackOverride(undefined);
    setCallbackOpen(false);
    setCallbackError(null);
    loadContact();
    loadNotes();
    loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
      <div style={{
        display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", flexWrap: "wrap",
        background: "#0D1B3E", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", padding: "16px 18px", marginBottom: "18px",
      }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: "22px", fontWeight: 600, color: "#F1F5F9", fontFamily: "Space Grotesk, sans-serif", margin: "0 0 8px" }}>
            {loading ? "…" : contactName(contact!)}
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap", fontSize: "13px", color: "#94A3B8" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <Phone size={13} style={{ color: "#475569" }} /> {loading ? "…" : (contact!.phone || "—")}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <MapPin size={13} style={{ color: "#475569" }} /> {loading ? "…" : formatAddress(contact!)}
            </span>
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
