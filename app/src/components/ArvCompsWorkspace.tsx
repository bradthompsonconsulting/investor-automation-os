import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, ChevronDown, ChevronRight, Copy, ExternalLink, Upload } from "lucide-react";
import { ghl, type ContactDetail, type CustomFieldDef } from "../lib/ghl";
import { runArvWorkspace, subjectSeedFromContact } from "../lib/arv-workspace-model";
import type { CompAssessment, MarketRelationship, SearchLevel, TransactionReliability } from "../lib/comp-classification";
import { importPropStreamCompCsv } from "../lib/propstream-comp-csv";
import {
  browserHandoffEnvironment,
  copyAddressAgain,
  handoffToPropStream,
  PROPSTREAM_LOGIN_URL,
  subjectAddress,
  type HandoffResult,
} from "../lib/propstream";

type Props = { contact: ContactDetail };
type Approval =
  | { kind: "none" }
  | { kind: "approved"; amount: number }
  | { kind: "overridden"; computed: number | null; amount: number };

const card = { background: "#0F172A", border: "1px solid #1E293B", borderRadius: "10px" } as const;
const inputStyle = { background: "#0A0E1A", color: "#E2E8F0", border: "1px solid #334155", borderRadius: "6px", padding: "7px 9px", fontSize: "12px" } as const;

function money(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function numeric(raw: string): number | null {
  const value = Number(raw.replace(/[$,]/g, "").trim());
  return Number.isFinite(value) && value > 0 ? value : null;
}

function defaultAssessment(evidenceId: string): CompAssessment {
  return {
    evidenceId,
    marketRelationship: "UNKNOWN",
    marketReason: "",
    transactionReliability: "UNKNOWN",
    transactionReason: "",
  };
}

export default function ArvCompsWorkspace({ contact }: Props) {
  const [seedStatus, setSeedStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [subject, setSubject] = useState({
    propertyType: "", squareFeet: "", subdivision: "", beds: "", baths: "", yearBuilt: "",
  });
  const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [level, setLevel] = useState<SearchLevel>("STANDARD");
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [importedAt, setImportedAt] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [assessments, setAssessments] = useState<Record<string, CompAssessment>>({});
  const [showComps, setShowComps] = useState(false);
  const [approval, setApproval] = useState<Approval>({ kind: "none" });
  const [overrideDraft, setOverrideDraft] = useState("");
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<HandoffResult | null>(null);
  const [handoffBusy, setHandoffBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ghl.customFields.list()
      .then((body) => {
        if (cancelled) return;
        const next = Array.isArray(body?.customFields) ? body.customFields as CustomFieldDef[] : [];
        const seed = subjectSeedFromContact(contact, next);
        setSubject({
          propertyType: seed.propertyType,
          squareFeet: seed.squareFeet == null ? "" : String(seed.squareFeet),
          subdivision: seed.subdivision,
          beds: seed.beds == null ? "" : String(seed.beds),
          baths: seed.baths == null ? "" : String(seed.baths),
          yearBuilt: seed.yearBuilt == null ? "" : String(seed.yearBuilt),
        });
        setSeedStatus("ready");
      })
      .catch(() => { if (!cancelled) setSeedStatus("unavailable"); });
    return () => { cancelled = true; };
  }, [contact]);

  const subjectSquareFeet = numeric(subject.squareFeet);
  const importPreview = useMemo(
    () => csv ? importPropStreamCompCsv(csv, { fileName, importedAt }) : null,
    [csv, fileName, importedAt],
  );
  const run = useMemo(() => {
    if (!csv || !subject.propertyType.trim() || subjectSquareFeet == null) return null;
    return runArvWorkspace({
      csv,
      metadata: { fileName, importedAt },
      subject: {
        asOfDate,
        propertyType: subject.propertyType,
        squareFeet: subjectSquareFeet,
        subdivision: subject.subdivision,
        beds: numeric(subject.beds),
        baths: numeric(subject.baths),
        yearBuilt: numeric(subject.yearBuilt),
      },
      assessments: Object.values(assessments),
      level,
    });
  }, [asOfDate, assessments, csv, fileName, importedAt, level, subject, subjectSquareFeet]);

  useEffect(() => { setApproval({ kind: "none" }); }, [run]);

  const classificationById = useMemo(
    () => new Map((run?.search?.classifications ?? []).map((item) => [item.evidenceId, item])),
    [run],
  );
  const preliminaryArv = run?.reconciliation?.recommendedArv ?? null;
  const imported = run?.imported ?? importPreview;
  const address = subjectAddress(contact);

  function updateSubject(key: keyof typeof subject, value: string) {
    setSubject((current) => ({ ...current, [key]: value }));
  }

  function updateAssessment(evidenceId: string, patch: Partial<CompAssessment>) {
    setAssessments((current) => ({
      ...current,
      [evidenceId]: { ...(current[evidenceId] ?? defaultAssessment(evidenceId)), ...patch },
    }));
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    setFileError(null);
    try {
      const nextCsv = await file.text();
      const now = new Date().toISOString();
      setCsv(nextCsv);
      setFileName(file.name);
      setImportedAt(now);
      setAssessments({});
      setApproval({ kind: "none" });
      setShowComps(true);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "CSV could not be read.");
    }
  }

  async function getComps() {
    if (!address || handoffBusy) return;
    setHandoffBusy(true);
    setHandoff(await handoffToPropStream(address, browserHandoffEnvironment()));
    setHandoffBusy(false);
  }

  async function copyAgain() {
    if (!handoff) return;
    setHandoffBusy(true);
    const clipboard = await copyAddressAgain(handoff.address, browserHandoffEnvironment().clipboard);
    setHandoff({ ...handoff, clipboard });
    setHandoffBusy(false);
  }

  function approveArv() {
    if (preliminaryArv != null) setApproval({ kind: "approved", amount: preliminaryArv });
  }

  function overrideArv() {
    const amount = numeric(overrideDraft);
    if (amount == null) { setOverrideError("Enter a positive ARV amount."); return; }
    setOverrideError(null);
    setApproval({ kind: "overridden", computed: preliminaryArv, amount });
  }

  const reconciliation = run?.reconciliation;
  const acceptedCount = run?.search?.acceptedCount ?? 0;
  const conflict = reconciliation?.outcome === "ARV EVIDENCE CONFLICT" ||
    reconciliation?.outcome === "OUTLIER REVIEW REQUIRED" ||
    reconciliation?.outcome === "INSUFFICIENT EVIDENCE";

  return (
    <section data-testid="arv-comps-workspace" style={{ marginBottom: "22px", ...card, padding: "18px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "16px", alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: "11px", color: "#1EC8FF", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>ARV evidence</div>
          <h2 style={{ margin: "4px 0 3px", color: "#E2E8F0", fontSize: "18px" }}>Preliminary ARV workspace</h2>
          <div style={{ color: "#64748B", fontSize: "12px" }}>Comp evidence for Brad’s review — not an appraisal report.</div>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button data-testid="arv-get-comps" disabled={!address || handoffBusy} onClick={getComps} style={{ ...inputStyle, color: "#1EC8FF", cursor: address ? "pointer" : "not-allowed" }}>
            <ExternalLink size={12} style={{ verticalAlign: "middle", marginRight: "5px" }} />{csv ? "Get More Comps" : "Get Comps"}
          </button>
          <label data-testid="arv-import-label" style={{ ...inputStyle, color: "#1EC8FF", cursor: "pointer" }}>
            <Upload size={12} style={{ verticalAlign: "middle", marginRight: "5px" }} />Import PropStream CSV
            <input data-testid="arv-csv-input" type="file" accept=".csv,text/csv" onChange={(event) => void importFile(event.target.files?.[0])} style={{ display: "none" }} />
          </label>
        </div>
      </div>

      {handoff ? (
        <div data-testid="arv-handoff-helper" style={{ marginTop: "12px", padding: "10px 12px", borderRadius: "8px", background: "#0A0E1A", color: "#94A3B8", fontSize: "12px", display: "flex", gap: "9px", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ color: handoff.clipboard === "copied" ? "#22C55E" : "#F59E0B" }}>{handoff.clipboard === "copied" ? "Subject address copied" : "Copy was denied — select the address here"}</span>
          <span style={{ color: "#E2E8F0", userSelect: "all" }}>{handoff.address}</span>
          <button onClick={copyAgain} disabled={handoffBusy} style={inputStyle}><Copy size={11} /> Copy Again</button>
          <a href={PROPSTREAM_LOGIN_URL} target="_blank" rel="noopener noreferrer" style={{ color: "#1EC8FF" }}>Open PropStream</a>
        </div>
      ) : null}

      <div data-testid="arv-session-only" style={{ marginTop: "12px", color: "#F59E0B", fontSize: "11px" }}>
        Session only: B7-07 writes nothing. Approval, override, CSV evidence, and assessments are not persisted until a separately gated persistence step.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: "9px", marginTop: "14px" }}>
        {([
          ["Property type", "propertyType"], ["Living sqft", "squareFeet"], ["Subdivision", "subdivision"],
          ["Beds", "beds"], ["Baths", "baths"], ["Year built", "yearBuilt"],
        ] as const).map(([label, key]) => (
          <label key={key} style={{ display: "flex", flexDirection: "column", gap: "4px", color: "#64748B", fontSize: "10px" }}>
            {label}<input data-testid={`arv-subject-${key}`} value={subject[key]} onChange={(event) => updateSubject(key, event.target.value)} style={inputStyle} />
          </label>
        ))}
        <label style={{ display: "flex", flexDirection: "column", gap: "4px", color: "#64748B", fontSize: "10px" }}>
          As-of date<input data-testid="arv-as-of-date" type="date" value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: "4px", color: "#64748B", fontSize: "10px" }}>
          Search level
          <select data-testid="arv-search-level" value={level} onChange={(event) => setLevel(event.target.value as SearchLevel)} style={inputStyle}>
            <option value="STANDARD">Level 1 · STANDARD</option><option value="EXPANDED">Level 2 · EXPANDED</option>
          </select>
        </label>
      </div>
      <div style={{ marginTop: "6px", fontSize: "10px", color: seedStatus === "unavailable" ? "#F59E0B" : "#475569" }}>
        {seedStatus === "loading" ? "Reading existing subject-property carriers…" : seedStatus === "ready" ? "Subject facts loaded from existing GHL carriers where present; edits stay in this session." : "Existing subject facts could not be read; enter them for this session."}
      </div>

      {fileError ? <div style={{ color: "#F87171", fontSize: "12px", marginTop: "10px" }}>{fileError}</div> : null}
      {imported?.issues.filter((issue) => issue.severity === "error").map((issue, index) => (
        <div key={`${issue.code}-${index}`} style={{ color: "#F87171", fontSize: "12px", marginTop: "8px" }}>{issue.code}: {issue.message}</div>
      ))}

      <div data-testid="arv-summary" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: "10px", marginTop: "16px" }}>
        {[
          ["Preliminary ARV", money(preliminaryArv)],
          ["Evidence state", reconciliation?.evidenceState ?? "—"],
          ["Accepted comps", run?.search ? String(acceptedCount) : "—"],
          ["Median sale", money(reconciliation?.primaryMedianSoldPrice)],
          ["PPSF cross-check", money(reconciliation?.pricePerSquareFootCrossCheck)],
        ].map(([label, value]) => (
          <div key={label} style={{ padding: "11px 12px", background: "#0A0E1A", borderRadius: "8px" }}>
            <div style={{ color: "#475569", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
            <div style={{ color: label === "Preliminary ARV" ? "#1EC8FF" : "#E2E8F0", fontWeight: 700, fontSize: "17px", marginTop: "3px" }}>{value}</div>
          </div>
        ))}
      </div>

      {run?.search?.nextInstruction ? (
        <div data-testid="arv-search-instruction" style={{ marginTop: "12px", padding: "12px", border: "1px solid rgba(245,158,11,.35)", borderRadius: "8px", color: "#FBBF24", fontSize: "12px" }}>
          <strong>Get More Comps:</strong> {run.search.nextInstruction}
        </div>
      ) : null}
      {conflict ? (
        <div data-testid="arv-manual-review" style={{ marginTop: "12px", padding: "12px", border: "1px solid rgba(239,68,68,.35)", borderRadius: "8px", color: "#FCA5A5", fontSize: "12px" }}>
          <AlertCircle size={13} style={{ verticalAlign: "middle", marginRight: "5px" }} />
          <strong>{reconciliation?.outcome}</strong> · Manual review required. {reconciliation?.reasons.join(" ")}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "14px", alignItems: "center" }}>
        <button data-testid="arv-view-comps" disabled={!imported?.evidence.length} onClick={() => setShowComps((value) => !value)} style={inputStyle}>
          {showComps ? <ChevronDown size={12} /> : <ChevronRight size={12} />} View Comps
        </button>
        <button data-testid="arv-approve" disabled={preliminaryArv == null} onClick={approveArv} style={{ ...inputStyle, background: preliminaryArv == null ? "#1E293B" : "#1EC8FF", color: preliminaryArv == null ? "#64748B" : "#0B1220", fontWeight: 700 }}>
          <Check size={12} /> Approve ARV
        </button>
        <input data-testid="arv-override-input" value={overrideDraft} onChange={(event) => setOverrideDraft(event.target.value)} placeholder="Override ARV" style={{ ...inputStyle, width: "120px" }} />
        <button data-testid="arv-override" onClick={overrideArv} style={inputStyle}>Override</button>
        {approval.kind !== "none" ? (
          <span data-testid="arv-approval-state" style={{ color: "#22C55E", fontSize: "12px" }}>
            {approval.kind === "approved" ? `Approved ${money(approval.amount)} for this session.` : `Override ${money(approval.amount)} selected for this session${approval.computed == null ? "" : `; preliminary ARV was ${money(approval.computed)}`}.`}
          </span>
        ) : null}
        {overrideError ? <span style={{ color: "#F87171", fontSize: "11px" }}>{overrideError}</span> : null}
      </div>

      {showComps && imported ? (
        <div data-testid="arv-comp-detail" style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "14px" }}>
          {imported.evidence.map((comp) => {
            const assessment = assessments[comp.evidenceId] ?? defaultAssessment(comp.evidenceId);
            const classification = classificationById.get(comp.evidenceId);
            return (
              <article key={comp.evidenceId} style={{ ...card, padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
                  <div><strong style={{ color: "#E2E8F0" }}>{comp.address.formatted || `Source row ${comp.rowNumber}`}</strong><div style={{ color: "#64748B", fontSize: "11px" }}>{comp.saleSource} · {comp.saleDate ?? "date unavailable"} · {money(comp.salePrice)}</div></div>
                  <span data-testid={`arv-disposition-${comp.evidenceId}`} style={{ color: classification?.disposition === "ACCEPTED" ? "#22C55E" : classification?.disposition === "SUPPORTING" ? "#F59E0B" : "#F87171", fontSize: "12px", fontWeight: 700 }}>{classification?.disposition ?? "REJECTED"}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "8px", marginTop: "10px" }}>
                  <select value={assessment.marketRelationship} onChange={(event) => updateAssessment(comp.evidenceId, { marketRelationship: event.target.value as MarketRelationship })} style={inputStyle} aria-label="Market relationship">
                    <option value="UNKNOWN">Market · Not reviewed</option><option value="LOCAL_COMPETITIVE_MARKET">Local competitive market</option><option value="IMMEDIATE_COMPETITIVE_AREA">Immediate competitive area</option><option value="OUTSIDE_COMPETITIVE_AREA">Outside competitive area</option>
                  </select>
                  <input value={assessment.marketReason} onChange={(event) => updateAssessment(comp.evidenceId, { marketReason: event.target.value })} placeholder="Market reason / source" style={inputStyle} />
                  <select value={assessment.transactionReliability} onChange={(event) => updateAssessment(comp.evidenceId, { transactionReliability: event.target.value as TransactionReliability })} style={inputStyle} aria-label="Transaction reliability">
                    <option value="UNKNOWN">Transaction · Not reviewed</option><option value="CREDIBLE">Credible transaction</option><option value="UNRELIABLE">Unreliable transaction</option>
                  </select>
                  <input value={assessment.transactionReason} onChange={(event) => updateAssessment(comp.evidenceId, { transactionReason: event.target.value })} placeholder="Transaction reason / source" style={inputStyle} />
                  <input value={assessment.obviousAnomaly ?? ""} onChange={(event) => updateAssessment(comp.evidenceId, { obviousAnomaly: event.target.value })} placeholder="Anomaly / outlier reason (optional)" style={inputStyle} />
                </div>
                <div data-testid={`arv-reasons-${comp.evidenceId}`} style={{ color: "#94A3B8", fontSize: "11px", marginTop: "9px" }}><strong>Reasons:</strong> {classification?.reasons.join(" ") ?? "Required market and transaction assessment is missing."}</div>
                <div data-testid={`arv-warnings-${comp.evidenceId}`} style={{ color: "#FBBF24", fontSize: "11px", marginTop: "5px" }}><strong>Warnings:</strong> {classification?.warnings.length ? classification.warnings.join(" ") : "None"}</div>
                <details style={{ marginTop: "7px", color: "#64748B", fontSize: "11px" }}><summary>Imported source evidence</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "#94A3B8" }}>{JSON.stringify(comp.raw, null, 2)}</pre></details>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
