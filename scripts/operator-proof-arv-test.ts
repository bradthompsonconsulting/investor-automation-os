/**
 * B7-10 / INV-27 — bounded IAOS Test operator proof for approved ARV.
 *
 * This runner composes the landed B7-04..B7-09 seams and performs only the
 * two B7-08 writes the issue authorizes: one approval and one override on the
 * canonical Test fixture. It cannot target Production: parseCommonArgs and
 * assertTestOnly reject it before the credential is loaded or a request runs.
 * Evidence is written outside the repository by default and never contains
 * the credential.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getConfig } from "../app/shared/ghl-config.ts";
import { runArvWorkspace } from "../app/src/lib/arv-workspace-model.ts";
import {
  arvPersistGate,
  persistApprovedArv,
  type ArvApprovalProvenance,
  type ArvPersistClient,
} from "../app/src/lib/arv-persist.ts";
import {
  appendValuation,
  createLedger,
  recordDecision,
  snapshotAt,
  stableStringify,
  verifyLedger,
} from "../app/src/lib/arv-evidence-snapshot.ts";
import {
  capture,
  evidencePath,
  ghlGet,
  ghlPost,
  ghlPut,
  loadToken,
  parseCommonArgs,
  readOpportunity,
  readSingularFieldValue,
  runBattery,
  stamp,
  writeEvidence,
} from "./lib/ghl-test-proof.ts";

const CONTACT_ID = "NAGtUZ9aOE5C1GatJzpT";
const OPPORTUNITY_ID = "MAl1FWHEsK0QqsXt4v6f";
const OPERATOR = "Brad Thompson";

function fieldValue(record: any, id: string): unknown {
  const entry = (record?.customFields ?? []).find((item: any) => item.id === id);
  return entry === undefined ? null : (entry.fieldValue ?? entry.value ?? null);
}

function assessments(ids: string[]) {
  return ids.map((evidenceId) => ({
    evidenceId,
    marketRelationship: "LOCAL_COMPETITIVE_MARKET" as const,
    marketReason: "Investor confirmed same buyer pool.",
    transactionReliability: "CREDIBLE" as const,
    transactionReason: "Investor confirmed arm-length sale.",
  }));
}

function notes(body: any): any[] {
  return Array.isArray(body?.notes) ? body.notes : [];
}

async function main() {
  const args = parseCommonArgs(process.argv.slice(2));
  const token = loadToken(args.credentialFile);
  const config = getConfig("test");
  const fixture = JSON.parse(readFileSync(resolve("scripts/harness-fixtures.json"), "utf8")).test;
  if (fixture.fixtureRecords.contacts.iaosTestProbe !== CONTACT_ID ||
      fixture.fixtureRecords.opportunities.iaosUnderwritingTest !== OPPORTUNITY_ID) {
    throw new Error("canonical Test fixture ids drifted; no request was issued");
  }

  const csv1 = readFileSync(resolve("app/scripts/fixtures/propstream-comparable-export.csv"), "utf8");
  const csv2 = readFileSync(resolve("app/scripts/fixtures/propstream-comparable-export-refresh.csv"), "utf8");
  const subject1 = {
    asOfDate: "2026-09-02", propertyType: "Single Family Residential", squareFeet: 2300,
    subdivision: "SUNSET RIDGE PHASE I (CMC)", beds: 4, baths: 2, yearBuilt: 1990,
  };
  const subject2 = { ...subject1, asOfDate: "2026-10-15", squareFeet: 2350 };
  const ids = ["row-2", "row-3", "row-4", "row-5", "row-6", "row-7", "row-8"];
  const run1 = runArvWorkspace({
    csv: csv1,
    metadata: { fileName: "Comparable Export.csv", importedAt: "2026-09-04T12:00:00.000Z" },
    subject: subject1, assessments: assessments(ids), level: "STANDARD",
  });
  const run2 = runArvWorkspace({
    csv: csv2,
    metadata: { fileName: "Comparable Export (refresh).csv", importedAt: "2026-10-15T09:30:00.000Z" },
    subject: subject2, assessments: assessments(ids), level: "EXPANDED",
  });
  if (run1.reconciliation.recommendedArv == null || run2.reconciliation.recommendedArv == null) {
    throw new Error("deterministic proof fixtures no longer produce recommendations; no live write was attempted");
  }

  const initialOpportunity = await readOpportunity(token, OPPORTUNITY_ID);
  const initialContactResponse = await ghlGet<any>(token, `/contacts/${CONTACT_ID}`);
  const initialNotesResponse = await ghlGet<any>(token, `/contacts/${CONTACT_ID}/notes`);
  if (initialContactResponse.status !== 200 || initialNotesResponse.status !== 200) {
    throw new Error(`Test fixture read failed: contact=${initialContactResponse.status} notes=${initialNotesResponse.status}`);
  }
  const initialContact = initialContactResponse.body.contact ?? initialContactResponse.body;
  const initialCapture = capture(initialOpportunity);
  const initialContactArv = fieldValue(initialContact, config.fields.arv);
  const initialNoteIds = new Set(notes(initialNotesResponse.body).map((note) => note.id));

  // Merely producing a recommendation performs no persistence.
  const afterRecommendation = await readOpportunity(token, OPPORTUNITY_ID);
  if (stableStringify(capture(afterRecommendation)) !== stableStringify(initialCapture)) {
    throw new Error("recommendation-only precondition failed: Opportunity changed before explicit approval");
  }

  const client: ArvPersistClient = {
    opportunities: {
      setApprovedArv: async (opportunityId, value) => {
        const put = await ghlPut(token, `/opportunities/${opportunityId}`, {
          customFields: [{ id: config.opportunityFacts.arv, field_value: value }],
        });
        if (put.status < 200 || put.status >= 300) {
          throw new Error(`PUT /opportunities/${opportunityId} returned ${put.status}`);
        }
        const observedRecord = await readOpportunity(token, opportunityId);
        const entry = (observedRecord.customFields ?? []).find((item: any) => item.id === config.opportunityFacts.arv);
        const observed = readSingularFieldValue(entry);
        return { ok: Number(observed) === value, sent: value, observed };
      },
    },
    notes: {
      create: async (contactId, body) => {
        const response = await ghlPost(token, `/contacts/${contactId}/notes`, { body });
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`POST /contacts/${contactId}/notes returned ${response.status}`);
        }
        return response.body;
      },
    },
  };

  let ledger = appendValuation(createLedger(`contact:${CONTACT_ID}`), {
    run: run1, subject: subject1, assessments: assessments(ids), capturedAt: "2026-09-04T12:05:00.000Z",
  });
  const v1BeforeRefresh = stableStringify(snapshotAt(ledger, 1));
  const approvedAt = stamp();
  const provenance1: ArvApprovalProvenance = {
    approvedAt, operator: OPERATOR, opportunityId: OPPORTUNITY_ID,
    evidenceState: run1.reconciliation.evidenceState,
    reconciliationOutcome: run1.reconciliation.outcome,
    acceptedCompCount: run1.search.acceptedCount,
    searchLevel: run1.search.level,
    source: { kind: run1.imported.source.kind, version: run1.imported.source.version,
      fileName: run1.imported.source.fileName, importedAt: run1.imported.source.importedAt },
  };
  const approval = { kind: "approved" as const, amount: run1.reconciliation.recommendedArv,
    recommendedArv: run1.reconciliation.recommendedArv, revision: 1 };
  const approvalResult = await persistApprovedArv(client, CONTACT_ID, arvPersistGate(approval, 1), provenance1);
  if (approvalResult.ok !== true) throw new Error(`approval persistence failed at ${approvalResult.stage}: ${approvalResult.error}`);
  ledger = recordDecision(ledger, { version: 1, kind: "APPROVED", amount: approval.amount,
    decidedBy: OPERATOR, decidedAt: approvedAt });

  ledger = appendValuation(ledger, {
    run: run2, subject: subject2, assessments: assessments(ids), capturedAt: "2026-10-15T09:35:00.000Z",
  });
  const overrideAmount = Math.max(1, run2.reconciliation.recommendedArv - 5000);
  const overriddenAt = stamp();
  const provenance2: ArvApprovalProvenance = {
    approvedAt: overriddenAt, operator: OPERATOR, opportunityId: OPPORTUNITY_ID,
    evidenceState: run2.reconciliation.evidenceState,
    reconciliationOutcome: run2.reconciliation.outcome,
    acceptedCompCount: run2.search.acceptedCount,
    searchLevel: run2.search.level,
    source: { kind: run2.imported.source.kind, version: run2.imported.source.version,
      fileName: run2.imported.source.fileName, importedAt: run2.imported.source.importedAt },
  };
  const override = { kind: "overridden" as const, amount: overrideAmount,
    recommendedArv: run2.reconciliation.recommendedArv, revision: 2 };
  const overrideResult = await persistApprovedArv(client, CONTACT_ID, arvPersistGate(override, 2), provenance2);
  if (overrideResult.ok !== true) throw new Error(`override persistence failed at ${overrideResult.stage}: ${overrideResult.error}`);
  ledger = recordDecision(ledger, { version: 2, kind: "OVERRIDDEN", amount: overrideAmount,
    overrideReason: "B7-10 operator-proof override",
    decidedBy: OPERATOR, decidedAt: overriddenAt });

  const finalOpportunity = await readOpportunity(token, OPPORTUNITY_ID);
  const finalContactResponse = await ghlGet<any>(token, `/contacts/${CONTACT_ID}`);
  const finalNotesResponse = await ghlGet<any>(token, `/contacts/${CONTACT_ID}/notes`);
  if (finalContactResponse.status !== 200 || finalNotesResponse.status !== 200) {
    throw new Error(`final Test fixture read failed: contact=${finalContactResponse.status} notes=${finalNotesResponse.status}`);
  }
  const finalContact = finalContactResponse.body.contact ?? finalContactResponse.body;
  const finalNotes = notes(finalNotesResponse.body);
  const newNotes = finalNotes.filter((note) => !initialNoteIds.has(note.id));
  const battery = runBattery(initialCapture, capture(finalOpportunity), config.opportunityFacts.arv,
    Object.values(fixture.untouchedPins.opportunityOfferFields));
  const targetEntry = (finalOpportunity.customFields ?? []).find((item: any) => item.id === config.opportunityFacts.arv);
  const finalArv = readSingularFieldValue(targetEntry);
  const contactArvUnchanged = stableStringify(fieldValue(finalContact, config.fields.arv)) === stableStringify(initialContactArv);
  const v1Survived = stableStringify(snapshotAt(ledger, 1)) === v1BeforeRefresh;
  const noteBodies = newNotes.map((note) => String(note.body ?? ""));
  const approvalNoteFound = noteBodies.some((body) => body.includes(`Approval timestamp: ${approvedAt}`) && body.includes("Decision: APPROVED"));
  const overrideNoteFound = noteBodies.some((body) => body.includes(`Approval timestamp: ${overriddenAt}`) && body.includes("Decision: OVERRIDE"));

  const passed = Number(finalArv) === overrideAmount && battery.passed && contactArvUnchanged &&
    newNotes.length === 2 && approvalNoteFound && overrideNoteFound && v1Survived && verifyLedger(ledger).length === 0;
  const artifact = {
    schema: "iaos-b7-10-operator-proof-v1", environment: "test", locationId: args.location,
    fixture: { contactId: CONTACT_ID, opportunityId: OPPORTUNITY_ID },
    deterministic: {
      run1: { importedRows: run1.imported.evidence.length, acceptedCount: run1.search.acceptedCount,
        searchLevel: run1.search.level, searchOutcome: run1.search.outcome,
        medianSale: run1.reconciliation.primaryMedianSoldPrice,
        ppsfCrossCheck: run1.reconciliation.pricePerSquareFootCrossCheck,
        recommendation: run1.reconciliation.recommendedArv },
      run2: { importedRows: run2.imported.evidence.length, acceptedCount: run2.search.acceptedCount,
        searchLevel: run2.search.level, searchOutcome: run2.search.outcome,
        recommendation: run2.reconciliation.recommendedArv },
      versions: ledger.snapshots.map((snapshot) => ({ version: snapshot.version, fingerprint: snapshot.fingerprint })),
      decisions: ledger.decisions,
      version1SurvivedRefreshByteExact: v1Survived,
      fingerprintsValid: verifyLedger(ledger).length === 0,
    },
    live: {
      recommendationAlonePersistedNothing: true,
      approvalConfirmed: approvalResult.ok,
      overrideConfirmed: overrideResult.ok,
      finalOpportunityArv: finalArv,
      expectedFinalOpportunityArv: overrideAmount,
      appendedProvenanceNotes: newNotes.length,
      approvalNoteFound,
      overrideNoteFound,
      contactArvSeedUnchanged: contactArvUnchanged,
      nonTargetBattery: battery,
    },
    passed,
  };
  writeEvidence(evidencePath(args, "iaos-b7-10-operator-proof"), artifact);
  console.log(JSON.stringify(artifact, null, 2));
  if (!passed) process.exit(1);
}

main().catch((error) => {
  console.error(`ABORT: ${(error as Error).message}`);
  process.exit(1);
});
