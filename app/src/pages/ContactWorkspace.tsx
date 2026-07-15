import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft, Phone, MapPin, StickyNote, AlertCircle, Loader2,
  Flame, Sun, Snowflake,
} from "lucide-react";
import { ghl, getBucketTag, type ContactRow, type BucketTag } from "../lib/ghl";

/**
 * Contact Workspace — docs/CONTACT_WORKSPACE_SPEC_v2.md §8 steps 1-2.
 *   Step 1: read-only detail (name/phone/address/tier/score), two-column shell.
 *   Step 2: note history (newest first) + new-note autosave-on-blur, reusing the
 *   Dashboard's exact note -> setLastCallAttempt sequence.
 *
 * Reads live from GHL every mount — NO app-side shadow copy (contact via the
 * same listAll() parsed ContactRow the Dashboard uses; notes via a read-only
 * GET). Right column (conversation history) is a placeholder until step 5.
 * Callback (step 3), Call button (step 4), and disposition (step 6) are NOT in
 * scope here.
 *
 * Writes on this page — both pre-existing, two of the three sanctioned (§4):
 *   ghl.notes.create() + ghl.contacts.setLastCallAttempt()
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

  const [draft, setDraft]         = useState("");
  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // In-session attempt override — immediate UX only. Verification uses a real
  // page.reload() to confirm the value actually persisted to GHL, since this
  // override would otherwise mask a bad round-trip.
  const [attemptOverride, setAttemptOverride] = useState<string | null>(null);

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

  useEffect(() => {
    setLoading(true);
    setContact(null);
    setNotes(null);
    setAttemptOverride(null);
    loadContact();
    loadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Effective last attempt: in-session override wins (just saved), then the
  // exact TEXT companion, then the truncated DATE field — same resolver shape
  // as the Dashboard's effectiveLastAttempt.
  const lastAttempt = useMemo(() => {
    if (attemptOverride) return attemptOverride;
    return contact?.lastCallAttemptPrecise ?? contact?.lastCallAttempt ?? null;
  }, [attemptOverride, contact]);

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

        {/* RIGHT — conversation history placeholder (step 5) */}
        <div style={{ flex: "1 1 420px", minWidth: "320px" }}>
          <h2 style={{ fontSize: "15px", fontWeight: 600, color: "#F1F5F9", margin: "0 0 10px", fontFamily: "Space Grotesk, sans-serif" }}>Conversation History</h2>
          <div style={{ background: "#0D1B3E", border: "1px dashed rgba(255,255,255,0.12)", borderRadius: "10px", padding: "24px 16px", color: "#334155", fontSize: "13px", textAlign: "center" }}>
            Conversation history — coming in step 5.
          </div>
        </div>
      </div>
    </div>
  );
}
