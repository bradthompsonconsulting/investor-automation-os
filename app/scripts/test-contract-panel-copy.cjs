/**
 * Board 15 follow-up (proposed; no issue number) — Contract Workspace
 * "Verify Execution & Under Contract" panel copy.
 *
 * Offline, source-text checks. The old -> new table lives in
 * fixtures/contract-panel-copy-pairs.json (applied in that order to
 * ContractWorkspace.tsx at 2c07d75). This suite proves:
 *
 *   1. every new string is present exactly as often as the table says, and
 *      every old string is gone;
 *   2. copy only: undoing the table (new -> old, reverse order) reproduces
 *      the base file byte-for-byte (LF-normalized SHA-256 pinned below), so
 *      no other character of the file changed -- no handler, gate, test id,
 *      persisted note string or payload;
 *   3. row 18 (Preserve executed PDF success) and the strings IAOS writes
 *      into GHL notes are unchanged;
 *   4. the new wording adds no claim of permanence, of PDF-content
 *      validation, or of PDF storage in GHL.
 *
 *   node scripts/test-contract-panel-copy.cjs [--file=<path to a ContractWorkspace.tsx>]
 *
 * --file runs the same checks against another copy (negative control:
 * the base file must FAIL).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const FX = require('./fixtures/contract-panel-copy-pairs.json');
/* sha256 of app/src/pages/ContractWorkspace.tsx at 2c07d75, CRLF -> LF. */
const BASE_SHA256 = 'a731a0d191eaf7148aa0233d6a3aa9a9ece1b0c0c40dfbd6aab2ad9e36aad7ff';
const FLOOR = 12;

const fileArg = process.argv.find((a) => a.startsWith('--file='));
const FILE = fileArg ? path.resolve(fileArg.slice('--file='.length)) : path.join(APP, 'src/pages/ContractWorkspace.tsx');
const src = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');

let checks = 0;
let failures = 0;
function check(label, ok, detail) {
  checks++;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : `\n      ${JSON.stringify(detail)}`}`);
}
const count = (hay, needle) => hay.split(needle).length - 1;
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

// ── 1. The table is fully applied ───────────────────────────────────────────
check('fixture: 28 rows, row 18 absent (held), base pinned to 2c07d75',
  FX.pairs.length === 28 && !FX.pairs.some((p) => p.row === '18') && FX.base === '2c07d75ab27db8a45d6bba919e150bfbc9760411', FX.pairs.length);
/* Row 3's new text ("Read this document from GHL") also occurs inside rows 5, 9, 11, 13 and 21;
   occurrences that sit inside another row's new text are not counted for the shorter row. */
const own = (p) => count(src, p.new) - FX.pairs.filter((q) => q !== p && q.new.includes(p.new)).reduce((n, q) => n + count(q.new, p.new) * count(src, q.new), 0);
const wrongNew = FX.pairs.filter((p) => own(p) !== p.count).map((p) => ({ row: p.row, want: p.count, got: own(p) }));
check('every new string is present exactly as often as the table says', wrongNew.length === 0, wrongNew);
const leftOld = FX.pairs.filter((p) => count(src, p.old) !== 0).map((p) => p.row);
check('no old string remains', leftOld.length === 0, leftOld);

// ── 2. Copy only: undoing the table reproduces the base file exactly ────────
let undone = src;
/* B15-30 guided navigation (Captain 2026-11-20; later, separately reviewed): ContractWorkspace honours `?deal=` from
   Seller Call's "Next: open Contract Ready" (lib/requested-deal.ts) -- exactly the 4 hunks of
   `git diff 53b7298 -- app/src/pages/ContractWorkspace.tsx`. Undone first (newest), new -> old, each exact text
   expected once (absent -> skipped), so the sha256 below still fails on anything not modelled here. */
const B15_30_NAV_UNDO = [
  [
    "import { useReadRecovered } from \"../components/access-status\";\nimport { UNNAMED_CONTACT, contractTemplateDisplayName, AGREEMENT_REACHED_OPERATOR_MEANING } from \"../lib/operator-display\";\nimport { Link, useParams, useSearchParams } from \"react-router-dom\";\nimport { resolveRequestedDeal, requestedDealNotice } from \"../lib/requested-deal\";\nimport { ArrowLeft, AlertCircle, Loader2, ShieldCheck, ShieldAlert, ArrowRight } from \"lucide-react\";\nimport { ghl, type ContactDetail, type OpportunityRow } from \"../lib/ghl\";\n",
    "import { useReadRecovered } from \"../components/access-status\";\nimport { UNNAMED_CONTACT, contractTemplateDisplayName, AGREEMENT_REACHED_OPERATOR_MEANING } from \"../lib/operator-display\";\nimport { Link, useParams } from \"react-router-dom\";\nimport { ArrowLeft, AlertCircle, Loader2, ShieldCheck, ShieldAlert, ArrowRight } from \"lucide-react\";\nimport { ghl, type ContactDetail, type OpportunityRow } from \"../lib/ghl\";\n"
  ],
  [
    "  const [notes, setNotes] = useState<{ id: string; body: string; dateAdded: string }[] | null>(null);\n  const [fetchError, setFetchError] = useState<string | null>(null);\n  /* B15-30 navigation (Captain 2026-11-20): Seller Call's \"Next: open Contract Ready\" opens THIS deal (`?deal=`) --\n     honoured exactly or reported unavailable, never silently replaced (lib/requested-deal.ts, as B15-30 R1). Nothing\n     named keeps the existing single-deal rule. */\n  const [searchParams] = useSearchParams();\n  const dealParam = searchParams.get(\"deal\");\n  const [chosenId, setChosenId] = useState<string | null>(() => dealParam);\n\n  const [checklistBusy, setChecklistBusy] = useState<ContractReadyItemKey | null>(null);\n",
    "  const [notes, setNotes] = useState<{ id: string; body: string; dateAdded: string }[] | null>(null);\n  const [fetchError, setFetchError] = useState<string | null>(null);\n  const [chosenId, setChosenId] = useState<string | null>(null);\n\n  const [checklistBusy, setChecklistBusy] = useState<ContractReadyItemKey | null>(null);\n"
  ],
  [
    "    // Board 15 cleanup: re-read (never remount) when read sign-in returns after a lapse.\n  }, [contactId, readRecovered]);\n  /* B15-30 navigation: a later `?deal=` (another Contract Ready link while mounted) selects that deal. */\n  useEffect(() => { if (dealParam !== null) setChosenId(dealParam); }, [dealParam]);\n\n  const loading = fetchError === null && (contact === null || opps === null || notes === null);\n  const candidates = useMemo(() => opportunityCandidates(opps), [opps]);\n  const requestedDeal = useMemo(\n    () => resolveRequestedDeal(candidates, chosenId, dealParam, opps !== null && contact?.id === contactId),\n    [candidates, chosenId, dealParam, opps, contact, contactId],\n  );\n  const selected = requestedDeal.selected;\n  const dealNotice = requestedDealNotice(requestedDeal.requested);\n  const propertyAddress = useMemo(() => formatAddress(contact), [contact]);\n\n",
    "    // Board 15 cleanup: re-read (never remount) when read sign-in returns after a lapse.\n  }, [contactId, readRecovered]);\n\n  const loading = fetchError === null && (contact === null || opps === null || notes === null);\n  const candidates = useMemo(() => opportunityCandidates(opps), [opps]);\n  const selected = useMemo(() => selectOpportunity(candidates, chosenId), [candidates, chosenId]);\n  const propertyAddress = useMemo(() => formatAddress(contact), [contact]);\n\n"
  ],
  [
    "            testId=\"contract-awaiting-selection\"\n            tone=\"info\"\n            title={dealNotice ? dealNotice.title : \"Select the deal\"}\n            body={dealNotice ? dealNotice.body : \"This contact holds more than one opportunity. IAOS does not assume the first one is the deal.\"}\n          />\n          <div data-testid=\"deal-chooser\" data-requested={requestedDeal.requested} style={{ display: \"flex\", flexDirection: \"column\", gap: \"8px\" }}>\n            {requestedDeal.requested === \"pending\" ? null : screen.candidates.map((c) => (\n              <button\n                key={c.id}\n",
    "            testId=\"contract-awaiting-selection\"\n            tone=\"info\"\n            title=\"Select the deal\"\n            body=\"This contact holds more than one opportunity. IAOS does not assume the first one is the deal.\"\n          />\n          <div style={{ display: \"flex\", flexDirection: \"column\", gap: \"8px\" }}>\n            {screen.candidates.map((c) => (\n              <button\n                key={c.id}\n"
  ]
];
for (const [now, before] of B15_30_NAV_UNDO) if (count(undone, now) === 1) undone = undone.split(now).join(before);
/* B15-21 / INV-130 (later, separately reviewed; Bones ACCEPT 23d93d6, integrated in c026442): the Contract Workspace
   current-status display -- commits 5deab52, b082897, 0127362, 23d93d6, i.e. exactly the six hunks of
   `git diff c7b09bc c026442 -- app/src/pages/ContractWorkspace.tsx` (+52/-8). Undone first, new -> old, each exact
   text expected once (absent -> skipped), so the sha256 below still fails on anything not modelled here. Undoing
   these rows is not proof the B15-21 display is present; its own suite (test-b15-21-contract-current-status) checks that. */
const B15_21_UNDO = [
  [
    "  formatUnderContractNote, parseUnderContractNote, allUnderContractRecordsForOpportunity,\n} from \"../lib/contract-execution-carriers\";\nimport { allContractLifecycleRecordsForOpportunity } from \"../lib/contract-lifecycle-carriers\";\nimport { allowsNewSend, deriveContractCurrentStatus, LOWER_NO_RESEND, needsReadinessFirst, notReadyLowerText, notReadyRecordText, RECORD_SEND_NO_RESEND, resolvedSendAttemptsForOpportunity } from \"../lib/contract-current-status\";\nimport { matchingArvApprovalForOpportunity } from \"../lib/arv-approval-note\";\nimport { DISPOSITION_ARV_LABEL, DISPOSITION_REPAIRS_LABEL } from \"../lib/authoritative-figures\";\nimport {\n",
    "  formatUnderContractNote, parseUnderContractNote, allUnderContractRecordsForOpportunity,\n} from \"../lib/contract-execution-carriers\";\nimport { allContractLifecycleRecordsForOpportunity } from \"../lib/contract-lifecycle-carriers\";\nimport { matchingArvApprovalForOpportunity } from \"../lib/arv-approval-note\";\nimport { DISPOSITION_ARV_LABEL, DISPOSITION_REPAIRS_LABEL } from \"../lib/authoritative-figures\";\nimport {\n"
  ],
  [
    "    }).ok) ?? null;\n  }, [screen, documentVersion, currentUnderContractRecord, existingDispositionHandoffs]);\n\n  /** B15-21 (Bones B2): every send attempt, each resolved within itself -- display only; existingSend and its gates are unchanged. */\n  const sendAttemptsForDisplay = useMemo(() => {\n    if (screen.state !== \"ready\" || !notes) return [];\n    return resolvedSendAttemptsForOpportunity(notes, screen.opportunity.id);\n  }, [screen, notes]);\n\n  /** B15-21 (INV-130): the top status and next instruction follow the latest SUBSTANTIATED state (display only). */\n  const contractCurrentStatus = useMemo(() => {\n    if (screen.state !== \"ready\") return null;\n    return deriveContractCurrentStatus({\n      opportunityId: screen.opportunity.id, agreementAt: screen.economics.agreementAt, version: documentVersion,\n      readinessReady: screen.readiness.ready, underContract: currentUnderContractRecord,\n      dispositionHandoff: currentDispositionHandoff, lifecycleHistory: dispositionLifecycleHistory, sendAttempts: sendAttemptsForDisplay,\n    });\n  }, [screen, documentVersion, currentUnderContractRecord, currentDispositionHandoff, dispositionLifecycleHistory, sendAttemptsForDisplay]);\n  /** B15-21: what remains before Contract Ready -- the same reasons the readiness status lists at the top. */\n  const readinessRemaining = screen.state === \"ready\" ? screen.readiness.reasons : [];\n\n  const dispositionEligibility = useMemo(() => {\n    if (screen.state !== \"ready\" || !documentVersion) return null;\n    return evaluateDispositionHandoffEligibility({\n",
    "    }).ok) ?? null;\n  }, [screen, documentVersion, currentUnderContractRecord, existingDispositionHandoffs]);\n\n  const dispositionEligibility = useMemo(() => {\n    if (screen.state !== \"ready\" || !documentVersion) return null;\n    return evaluateDispositionHandoffEligibility({\n"
  ],
  [
    "            />\n          ) : null}\n\n          {contractCurrentStatus && contractCurrentStatus.headline ? (\n            <div data-testid=\"contract-current-status\" data-kind={contractCurrentStatus.kind} style={{ marginBottom: \"12px\" }}>\n              <div style={{ display: \"flex\", alignItems: \"center\", gap: \"8px\", fontSize: \"15px\", fontWeight: 700, color: contractCurrentStatus.kind === \"under_contract\" || contractCurrentStatus.kind === \"disposition_started\" ? \"#22C55E\" : \"#F59E0B\" }}>\n                {contractCurrentStatus.kind === \"under_contract\" || contractCurrentStatus.kind === \"disposition_started\" ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}\n                {contractCurrentStatus.headline}\n              </div>\n              <div data-testid=\"contract-current-status-detail\" style={{ fontSize: \"12px\", color: \"#94A3B8\", marginTop: \"4px\" }}>{contractCurrentStatus.detail}</div>\n            </div>\n          ) : null}\n\n          <div\n            data-testid=\"contract-ready-status\"\n            style={{\n",
    "            />\n          ) : null}\n\n          <div\n            data-testid=\"contract-ready-status\"\n            style={{\n"
  ],
  [
    "            </div>\n          </div>\n\n          <div data-testid=\"contract-next-action\" data-kind={contractCurrentStatus?.kind ?? \"\"} style={{ fontSize: \"12px\", color: \"#94A3B8\" }}>\n            {contractCurrentStatus?.next}\n          </div>\n\n          {sellerContractFactsReport && sellerContractFactsReadiness ? (\n",
    "            </div>\n          </div>\n\n          <div data-testid=\"contract-next-action\" style={{ fontSize: \"12px\", color: \"#94A3B8\" }}>\n            {screen.readiness.ready\n              ? \"Contract Ready. Review the populated PDF, then upload and send it manually in GHL.\"\n              : \"Complete the checklist above to reach Contract Ready.\"}\n          </div>\n\n          {sellerContractFactsReport && sellerContractFactsReadiness ? (\n"
  ],
  [
    "            <div data-testid=\"contract-manual-send-notice\"\n              style={{ marginTop: \"24px\" }}>\n              <h3>Manual GHL upload and send</h3>\n              {allowsNewSend(contractCurrentStatus) ? (\n                <p data-testid=\"contract-manual-send-instruction\" data-allows-send=\"true\">Review the populated PDF, then upload it to GHL\n                  Documents &amp; Contracts and send it manually.</p>\n              ) : needsReadinessFirst(contractCurrentStatus) ? (\n                <div data-testid=\"contract-manual-send-instruction\" data-allows-send=\"false\" data-kind=\"not_ready\">\n                  <p>{notReadyLowerText(readinessRemaining.length)}</p>\n                  {readinessRemaining.length > 0 ? (\n                    <ul data-testid=\"contract-manual-send-remaining\">\n                      {readinessRemaining.map((r) => <li key={r.code}>{r.message}</li>)}\n                    </ul>\n                  ) : null}\n                </div>\n              ) : (\n                <p data-testid=\"contract-manual-send-instruction\" data-allows-send=\"false\">{LOWER_NO_RESEND}</p>\n              )}\n              <p>IAOS V1 does not sync contract merge fields, request\n                a GHL template draft, or send contracts automatically.\n                This notice does not record a contract as sent.</p>\n",
    "            <div data-testid=\"contract-manual-send-notice\"\n              style={{ marginTop: \"24px\" }}>\n              <h3>Manual GHL upload and send</h3>\n              <p>Review the populated PDF, then upload it to GHL\n                Documents &amp; Contracts and send it manually.</p>\n              <p>IAOS V1 does not sync contract merge fields, request\n                a GHL template draft, or send contracts automatically.\n                This notice does not record a contract as sent.</p>\n"
  ],
  [
    "              <div style={{ fontSize: \"14px\", fontWeight: 700, color: \"#E2E8F0\", marginBottom: \"4px\" }}>\n                Record GHL Send\n              </div>\n              <div data-testid=\"contract-manual-send-explanation\" data-allows-send={allowsNewSend(contractCurrentStatus) ? \"true\" : \"false\"} style={{ fontSize: \"11px\", color: \"#64748B\", marginBottom: \"12px\" }}>\n                {allowsNewSend(contractCurrentStatus)\n                  ? \"After you manually upload the authorized PDF to GHL Documents & Contracts and send it, enter exactly what GHL shows you below. IAOS validates this against the currently-authorized PDF's revision and hash before recording it -- nothing is sent to GHL from here.\"\n                  : needsReadinessFirst(contractCurrentStatus)\n                    ? notReadyRecordText(readinessRemaining.length)\n                    : RECORD_SEND_NO_RESEND}\n              </div>\n              <div style={{ ...groupCardStyle, marginBottom: \"12px\" }}>\n                <label style={{ display: \"block\", fontSize: \"11px\", color: \"#94A3B8\", marginBottom: \"10px\" }}>\n",
    "              <div style={{ fontSize: \"14px\", fontWeight: 700, color: \"#E2E8F0\", marginBottom: \"4px\" }}>\n                Record GHL Send\n              </div>\n              <div style={{ fontSize: \"11px\", color: \"#64748B\", marginBottom: \"12px\" }}>\n                After you manually upload the authorized PDF to GHL Documents &amp; Contracts and send it, enter exactly what GHL shows you below. IAOS validates this against the currently-authorized PDF's revision and hash before recording it -- nothing is sent to GHL from here.\n              </div>\n              <div style={{ ...groupCardStyle, marginBottom: \"12px\" }}>\n                <label style={{ display: \"block\", fontSize: \"11px\", color: \"#94A3B8\", marginBottom: \"10px\" }}>\n"
  ]
];
for (const [now, before] of B15_21_UNDO) if (count(undone, now) === 1) undone = undone.split(now).join(before);
/* B15-22 / INV-131 (later, separate change): the disposition preview's two
   frozen-snapshot lines were relabelled "ARV / Repairs at acceptance". Undo
   exactly that first, each expected once, so this proof still isolates the
   copy table; anything else changed in the file still fails it. */
const B15_22_UNDO = [
  ['import { DISPOSITION_ARV_LABEL, DISPOSITION_REPAIRS_LABEL } from "../lib/authoritative-figures";\n', ''],
  ['                            {/* B15-22 / INV-131: these are the frozen snapshot captured at Agreement Reached\n'
    + '                                (screen.economics.economics), so they are labelled as the banner labels them. */}\n'
    + '                            <li data-testid="disposition-handoff-preview-arv">{DISPOSITION_ARV_LABEL}: ', '                            <li>Approved ARV: '],
  ['<li data-testid="disposition-handoff-preview-repairs">{DISPOSITION_REPAIRS_LABEL}: ', '<li>Approved repairs: '],
];
for (const [now, before] of B15_22_UNDO) if (count(undone, now) === 1) undone = undone.split(now).join(before);
/* Later, separately reviewed changes to the same file, undone the same way
   (each exact text expected once; absent -> skipped, so the sha256 below still
   fails on anything not modelled here):
   - B15-10 / INV-109 (f5683ec, merged 6188f97): the no-opportunity Notice became
     the shared NoDealYet card (same test id).
   - B15-17 / INV-126 (66980f5, pending integration): the disposition preview's
     Photos/documents display line; the persisted documentReferencesNote is
     unchanged and is still checked in section 3. */
const LATER_REVIEWED_UNDO = [
  ['import NoDealYet from "../components/NoDealYet";\n', ''],
  ['      {/* B15-10 / Pass 1 F19 (INV-109): the same no-deal card as the Contact, Seller Call and Underwriting\n'
    + '          pages, with the way to fix it: "Open this contact in GHL". Navigation only; IAOS creates no deal.\n'
    + '          (F19 replaced the other pages\' "Create an opportunity in GHL" notices; this one was missed.) */}\n', ''],
  ['        <div data-testid="contract-no-opportunity">\n'
    + '          <NoDealYet contactId={contactId} reason="A seller contract belongs to the deal, not the person." />\n'
    + '        </div>\n',
   '        <Notice\n'
    + '          testId="contract-no-opportunity"\n'
    + '          tone="info"\n'
    + '          title="No opportunity on this contact"\n'
    + '          body="A seller contract belongs to the deal, not the person. Create an opportunity in GHL first."\n'
    + '        />\n'],
  ['/** B15-17 (INV-126): what the disposition preview shows when no photos/documents exist. Display only -- the\n'
    + ' *  handoff record\'s documentReferencesNote (written to GHL) is unchanged. */\n'
    + 'const DISPOSITION_NO_DOCUMENTS_TEXT = "not stored in IAOS yet.";\n'
    + '\n', ''],
  ['                              {/* B15-17 (INV-126): operator wording; the persisted documentReferencesNote is unchanged. */}\n'
    + '                              <li data-testid="disposition-handoff-preview-documents">Photos/documents: {pkg.documentReferences.length === 0 ? DISPOSITION_NO_DOCUMENTS_TEXT : pkg.documentReferencesNote}</li>',
   '                              <li>Photos/documents: {pkg.documentReferencesNote}</li>'],
];
for (const [now, before] of LATER_REVIEWED_UNDO) if (count(undone, now) === 1) undone = undone.split(now).join(before);
for (const p of [...FX.pairs].reverse()) undone = undone.split(p.new).join(p.old);
check('undoing the table reproduces the 2c07d75 file byte-for-byte (LF-normalized sha256)', sha(undone) === BASE_SHA256, sha(undone));
const idPattern = /data-testid|testId|\bon[A-Z][a-zA-Z]+=|disabled=|setUnderContractWriteState|setDispositionWriteState|kind:/;
const touchingCode = FX.pairs.filter((p) => idPattern.test(p.old) || idPattern.test(p.new)).map((p) => p.row);
check('no row touches a test id, handler, disabled condition or state transition', touchingCode.length === 0, touchingCode);
const interp = FX.pairs.filter((p) => JSON.stringify(p.old.match(/\$\{[^}]*\}/g) || []) !== JSON.stringify(p.new.match(/\$\{[^}]*\}/g) || [])).map((p) => p.row);
check('every interpolated server/model message is carried over unchanged (${e?.message ...}, ${readbackCheck.reason})', interp.length === 0, interp);

// ── 3. Held and persisted text unchanged ─────────────────────────────────────
check('row 18 held: Preserve success text unchanged',
  count(src, '"Preserved and independently re-verified by fresh readback."') === 1 && count(src, '"Already preserved -- identical bytes, no duplicate written."') === 1);
const persisted = [
  'evidenceSummary: "Brad\'s own factual, visually-verified mapping of each required signer to its GHL provider recipient id."',
  'evidenceSummary: "Manual in-browser verification: authenticated server-side provider readback (signer completion, buyer identity, provider completion), Brad\'s own recorded signer-recipient mapping, a manually selected executed-artifact hash, and Brad\'s own recorded executed-terms attestation."',
  'documentReferencesNote: "No photo/document carrier exists in IAOS today -- this list is honestly empty, not omitted."',
  'evidenceSummary: "No-reentry disposition-start handoff to Board #10, assembled from already-canonical Board #9 upstream sources."',
];
check('strings written into GHL notes are unchanged (3 evidenceSummary + documentReferencesNote)', persisted.every((s) => count(src, s) === 1), persisted.map((s) => count(src, s)));
check('raw ARV approval values still rendered as-is (Q5)', count(src, '`(${pkg.approvedArv.approvalEvidenceState}, ${pkg.approvedArv.approvalDecision})`') === 1);

// ── 4. No broadened claims ───────────────────────────────────────────────────
const added = FX.pairs.map((p) => p.new).join('\n');
check('no new claim of permanence', !/permanen/i.test(added));
check('no new claim that the PDF is stored in or uploaded to GHL', !/(stor\w*|upload\w*|sav\w*)[^.;]{0,40}\bin GHL\b[^.;]{0,20}PDF|PDF[^.;]{0,60}\b(stored|uploaded|saved) (in|to) GHL/i.test(added));
check('no new claim that IAOS checks the PDF content', !/(check|validat|verif|read)\w*[^.;]{0,30}(PDF'?s? )?content/i.test(added));
check('Q4 and Q8 wording present: "which verification stage"; two-layer success on both note writes',
  count(src, 'which verification stage this evidence reaches') === 1
  && count(src, "GHL confirmed this exact note was saved, and IAOS's fresh read found the matching record.") === 1
  && count(src, "GHL confirmed this exact note was saved, and IAOS's fresh read found the matching handoff.") === 1);

console.log(`\nContract panel copy: ${checks - failures}/${checks} checks passed`);
if (checks < FLOOR) { console.log(`FAIL  only ${checks} checks ran (floor ${FLOOR})`); process.exit(1); }
process.exit(failures === 0 ? 0 : 1);
