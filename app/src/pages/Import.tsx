/**
 * Pass 1 F12 (INV-125) — the Import page was an empty heading.
 *
 * IAOS has no import: the only importer is a developer command-line script,
 * and no named IAOS write creates a contact or an opportunity
 * (docs/INV95_WRITE_BOUNDARIES.md). Until the team establishes and proves an
 * operator path, this page says plainly where leads are brought in today
 * (GHL itself) instead of looking like a broken feature. It links nowhere it
 * has not verified and writes nothing.
 *
 * Per Jess (2026-10-04) this is a proposed workaround; it does not close the
 * F12 blocker, which stays open until the GHL/manual path is shown usable.
 *
 * Walkthrough 2 (2026-10-07): renamed "Add Leads" (the route stays /import)
 * and the GHL steps are numbered. Still guidance only, not an importer. No
 * GHL shortcut yet: IAOS has no verified GHL destination for adding a
 * contact (its one verified link opens an EXISTING contact).
 */
export default function Import() {
  return (
    <div style={{ padding: "24px 28px", maxWidth: "720px" }}>
      <h1 className="text-2xl font-semibold text-white font-display">Add Leads</h1>
      <div data-testid="import-in-ghl" style={{
        marginTop: "14px", padding: "16px 18px", borderRadius: "10px",
        background: "#0D1B3E", border: "1px solid rgba(255,255,255,0.08)",
      }}>
        <div style={{ fontSize: "14px", fontWeight: 600, color: "#E2E8F0" }}>Leads are added in GHL, not here</div>
        <div style={{ fontSize: "13px", color: "#94A3B8", marginTop: "6px", lineHeight: 1.6 }}>
          IAOS doesn't import or create leads. Add each seller in GHL, in this order:
        </div>
        <ol data-testid="add-leads-steps" style={{ fontSize: "13px", color: "#CBD5E1", margin: "8px 0 0", paddingLeft: "20px", lineHeight: 1.7 }}>
          <li>Add the seller as a contact, with the property's full address (street, city and state).</li>
          <li>Create an opportunity (deal) for that contact in the Seller Leads Pipeline.</li>
        </ol>
        <div style={{ fontSize: "13px", color: "#94A3B8", marginTop: "8px", lineHeight: 1.6 }}>
          IAOS shows them on its next read. A contact without an opportunity can be found here, but its
          offer and underwriting screens stay empty until the deal exists in GHL.
        </div>
      </div>
    </div>
  );
}
