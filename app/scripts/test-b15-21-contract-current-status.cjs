/**
 * B15-21 (INV-130) -- the Contract Workspace's top status and next instruction
 * follow the latest SUBSTANTIATED contract state (Spock 2026-11-18, IAOS Test
 * Probe: the top still said "upload and send it manually in GHL" while the
 * same workspace recorded Under Contract 9/21 and a Start Disposition handoff
 * 9/22). Display only.
 *
 * Offline. Records are built in the real canonical note format and read back
 * with the real carrier parsers (the same parsers the page uses), then given
 * to the page's own helper (src/lib/contract-current-status.ts):
 *   A. ready, unsent           -> the send guidance, unchanged
 *   B. not ready               -> the checklist guidance, unchanged
 *   C. Under Contract recorded -> "Under Contract", nothing to upload or send
 *   D. disposition started     -> "Disposition started" (latest wins over C)
 *   E. missing / mismatched    -> no execution claimed; readiness guidance stands
 *      (no record; another opportunity, agreement or version; a handoff for a
 *      different Under Contract verification; no version)
 *   F. rescission recorded     -> Under Contract no longer claimed
 *   G. page wiring: the page passes only the governed, already-scoped records
 *      (no email, conversation or address input); no new GHL call or write;
 *      the readiness status line and its gates are unchanged.
 *
 * NEGATIVE CONTROL: --before=<rev> reads that revision's page for section G
 * and must FAIL (e.g. --before=c7b09bc).
 *
 *   node scripts/test-b15-21-contract-current-status.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
require('./harness/ts-loader.cjs');
const APP = path.resolve(__dirname, '..');
const LIB = path.join(APP, 'src', 'lib');
const S = require(path.join(LIB, 'contract-current-status.ts'));
const B = require(path.join(LIB, 'board9-contract-model.ts'));
const EC = require(path.join(LIB, 'contract-execution-carriers.ts'));
const H = require(path.join(LIB, 'contract-disposition-handoff-model.ts'));
const HC = require(path.join(LIB, 'contract-disposition-handoff-carriers.ts'));
const LC = require(path.join(LIB, 'contract-lifecycle-carriers.ts'));

const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const REV = beforeArg ? beforeArg.slice('--before='.length) : null;
const pageRaw = REV
  ? execFileSync('git', ['show', `${REV}:app/src/pages/ContractWorkspace.tsx`], { cwd: APP, encoding: 'utf8' })
  : fs.readFileSync(path.join(APP, 'src/pages/ContractWorkspace.tsx'), 'utf8');
const page = pageRaw.replace(/\r\n/g, '\n');
if (REV) console.log(`NEGATIVE CONTROL: reading ContractWorkspace.tsx at ${REV}; this run must fail.`);

let checks = 0, failures = 0;
function check(name, ok, detail) {
  checks++; if (!ok) failures++;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail).slice(0, 400)}`}`);
}

/* ── Fixtures, shaped like IAOS Test Probe (deal MAl1…, agreement 9/8, version 1) ── */
const OPP = 'MAl1FWHEsK0QqsXt4v6f';
const CONTACT = 'NAGtUZ9aOE5C1GatJzpT';
const AGREEMENT_AT = '2026-09-08T16:33:18.000Z';
const V1 = B.initialVersionIdentity(AGREEMENT_AT);
const UC_AT = '2026-09-22T01:59:38.000Z';
const HANDOFF_AT = '2026-09-22T14:54:15.000Z';
const fmt = (iso) => iso; // deterministic; the page uses toLocaleString
const populated = (value) => ({ kind: 'populated', value, authority: 'operator_attested', recordedAt: null });
const notApplicable = () => ({ kind: 'not_applicable', confirmedBy: 'brad', at: AGREEMENT_AT, note: null });

function ucRecord(over) {
  const rec = Object.assign({
    kind: 'under_contract', opportunityId: OPP, agreementAt: AGREEMENT_AT, version: V1,
    acceptedSendAttemptId: '2026-09-21T23:00:00.000Z', providerDocumentId: '6aaffa4a0f9b5add21ee171f',
    providerDocumentReference: '6241B756', providerDocumentRevision: 1, providerReportedCompletionAt: '2026-09-21T23:10:00.000Z',
    signers: [{ role: 'Seller', displayName: 'Jane Seller', providerRecipientId: 'r1', providerCompletedAt: '2026-09-21T23:05:00.000Z' }],
    artifactSha256: 'b'.repeat(64), executedTermsConflictCount: 0, pageCount: 13, iaosVerifiedAt: UC_AT,
    authority: 'system_derived', evidenceSummary: 'fixture under contract record', relatedPriorRecordId: null,
  }, over || {});
  // Round-trip through the canonical carrier: exactly what the page would parse from a GHL note.
  const parsed = EC.parseUnderContractNote(EC.formatUnderContractNote(rec));
  if (!parsed) throw new Error('fixture: Under Contract record did not round-trip through its carrier');
  return parsed;
}
function handoffRecord(underContract, over) {
  const built = H.buildDispositionHandoffRecordArgs(Object.assign({
    handoffId: '4f7b4e33-3a21-4429-b09e-2dbf2d4e829e', createdAt: HANDOFF_AT, opportunityId: OPP, contactId: CONTACT,
    agreementAt: AGREEMENT_AT, version: V1, eligibility: { eligible: true }, underContract,
    propertyAddress: populated('742 Evergreen Terrace, Austin, TX 78701'),
    propertyLegalDescription: {
      lot: populated({ kind: 'value', value: '12' }), block: populated({ kind: 'value', value: 'A' }), addition: populated({ kind: 'value', value: 'Fixture Addition' }),
      county: populated({ kind: 'value', value: 'Travis' }), exclusions: notApplicable(), reservations: notApplicable(), legalMunicipality: populated({ kind: 'municipality', name: 'Austin' }),
    },
    sellerContractPrice: 415000, approvedArv: { amount: 639863, approvalEvidenceState: 'HIGH', approvalDecision: 'APPROVED', approvedAt: '2026-09-05T12:00:00.000Z' },
    approvedRepairs: 20000, closingDate: populated('2026-10-15T00:00:00.000Z'), possessionDetails: populated({ kind: 'value', value: 'Upon closing and funding' }),
    accessShowingInformation: { kind: 'unresolved' },
    sellerContact: { noticeAddress: populated('742 Evergreen Terrace, Austin, TX'), noticePhone: populated('555-555-1234'), noticeEmail: populated('seller@example.com') },
    requiredSigners: [{ role: 'Seller', displayName: 'Jane Seller' }], documentReferences: [], documentReferencesNote: 'No photo/document carrier exists in IAOS today.',
    evidenceSummary: 'fixture disposition handoff',
  }, over || {}));
  if (!built.ok) throw new Error('fixture: handoff build failed ' + JSON.stringify(built.reasons));
  const parsed = HC.parseDispositionHandoffNote(HC.formatDispositionHandoffNote(built.value));
  if (!parsed) throw new Error('fixture: handoff did not round-trip through its carrier');
  return parsed;
}
function rescissionRecord(version) {
  const rec = { kind: 'rescission', opportunityId: OPP, version, reason: 'Fixture rescission', authorizedBy: 'brad', authorizedAt: '2026-09-25T15:00:00.000Z', providerDocumentIdAtRescission: '6aaffa4a0f9b5add21ee171f', iaosObservedAt: '2026-09-25T15:00:00.000Z', authority: 'brad_authorized', evidenceSummary: 'fixture rescission', relatedPriorRecordId: null };
  const parsed = LC.parseContractLifecycleNote(LC.formatContractLifecycleNote(rec));
  if (!parsed) throw new Error('fixture: rescission did not round-trip through its carrier');
  return parsed;
}
const derive = (over) => S.deriveContractCurrentStatus(Object.assign({
  opportunityId: OPP, agreementAt: AGREEMENT_AT, version: V1, readinessReady: true,
  underContract: null, dispositionHandoff: null, lifecycleHistory: [], formatTime: fmt,
}, over));
const SEND = 'Contract Ready. Review the populated PDF, then upload and send it manually in GHL.';
const sendsSomething = (st) => /upload and send it manually/.test(st.next);

const uc = ucRecord();
const handoff = handoffRecord(uc);

/* A. ready, unsent */
{
  const st = derive({});
  check('A: ready and unsent keeps the send guidance verbatim, with no extra headline', st.kind === 'ready_unsent' && st.next === SEND && st.headline === null, st);
}
/* B. not ready */
{
  const st = derive({ readinessReady: false });
  check('B: not ready keeps the checklist guidance verbatim', st.kind === 'not_ready' && st.next === 'Complete the checklist above to reach Contract Ready.' && st.headline === null, st);
}
/* C. Under Contract recorded */
{
  const st = derive({ underContract: uc });
  check('C: Under Contract recorded -> headline "Under Contract"', st.kind === 'under_contract' && st.headline === 'Under Contract', st);
  check('C: names when Under Contract was recorded', st.detail === `Under Contract recorded ${UC_AT} for this exact verified execution.`, st.detail);
  check('C: the next instruction no longer says to upload and send', !sendsSomething(st) && /^Nothing to upload or send/.test(st.next), st.next);
  check('C: holds even if the readiness checklist is not currently met', derive({ underContract: uc, readinessReady: false }).kind === 'under_contract');
}
/* D. disposition started */
{
  const st = derive({ underContract: uc, dispositionHandoff: handoff });
  check('D: a verified Start Disposition handoff -> headline "Disposition started"', st.kind === 'disposition_started' && st.headline === 'Disposition started', st);
  check('D: names both the Under Contract and handoff times', st.detail === `Under Contract recorded ${UC_AT}. Start Disposition handoff created ${HANDOFF_AT}.`, st.detail);
  check('D: the next instruction says nothing is to be sent and points at the records', !sendsSomething(st) && st.next.includes('handed off to buyer disposition'), st.next);
  check('D: a handoff without an Under Contract record establishes nothing', derive({ dispositionHandoff: handoff }).kind === 'ready_unsent');
}
/* E. missing or mismatched evidence */
{
  const otherOpp = ucRecord({ opportunityId: '8N0SqUzkCf7GCJNTAY4g' });
  const otherAgreement = ucRecord({ agreementAt: '2026-09-01T10:00:00.000Z', version: B.initialVersionIdentity('2026-09-01T10:00:00.000Z') });
  const otherVersion = ucRecord({ version: { agreementAt: AGREEMENT_AT, versionSeq: 2, supersedesVersionSeq: 1, replacesAgreementAt: null } });
  check('E: no Under Contract record -> readiness guidance stands', derive({ underContract: null }).kind === 'ready_unsent');
  check('E: an Under Contract record for another opportunity (e.g. the F38 probe deal) establishes nothing', derive({ underContract: otherOpp }).kind === 'ready_unsent');
  check('E: an Under Contract record for an earlier agreement establishes nothing', derive({ underContract: otherAgreement }).kind === 'ready_unsent');
  check('E: an Under Contract record for an unrelated revision establishes nothing', derive({ underContract: otherVersion }).kind === 'ready_unsent');
  check('E: no applicable contract version -> no execution claimed', derive({ underContract: uc, version: null }).kind === 'ready_unsent');
  const staleHandoff = handoffRecord(ucRecord({ iaosVerifiedAt: '2026-09-20T10:00:00.000Z' }));
  const st = derive({ underContract: uc, dispositionHandoff: staleHandoff });
  check('E: a handoff for a different Under Contract verification is not "Disposition started"', st.kind === 'under_contract', st);
  const otherOppHandoff = handoffRecord(ucRecord(), { opportunityId: '8N0SqUzkCf7GCJNTAY4g' });
  check('E: a handoff for another opportunity is not "Disposition started"', derive({ underContract: uc, dispositionHandoff: otherOppHandoff }).kind === 'under_contract');
  check('E: the helper takes no email, conversation, document or address input',
    !/email|conversation|propertyAddress|providerDocument|signed/i.test(/export function deriveContractCurrentStatus\(args: \{([\s\S]*?)\}\): ContractCurrentStatus/.exec(fs.readFileSync(path.join(LIB, 'contract-current-status.ts'), 'utf8'))?.[1] ?? 'email'));
}
/* F. rescission */
{
  const st = derive({ underContract: uc, dispositionHandoff: handoff, lifecycleHistory: [rescissionRecord(V1)] });
  check('F: a Rescission for this version -> Under Contract / disposition no longer claimed', st.kind === 'rescinded' && st.headline === 'Rescission recorded' && !sendsSomething(st), st);
  const other = derive({ underContract: uc, lifecycleHistory: [rescissionRecord({ agreementAt: AGREEMENT_AT, versionSeq: 2, supersedesVersionSeq: 1, replacesAgreementAt: null })] });
  check('F: a Rescission for another version does not apply', other.kind === 'under_contract', other);
}

/* G. page wiring (source; --before must fail here) */
{
  check('G: the page imports the helper', page.includes('import { deriveContractCurrentStatus } from "../lib/contract-current-status";'));
  const call = /deriveContractCurrentStatus\(\{([\s\S]*?)\}\);/.exec(page);
  check('G: the page passes only the governed, already-scoped records (Under Contract, verified handoff, lifecycle history, readiness)',
    !!call && /underContract: currentUnderContractRecord/.test(call[1]) && /dispositionHandoff: currentDispositionHandoff/.test(call[1]) && /lifecycleHistory: dispositionLifecycleHistory/.test(call[1])
      && /readinessReady: screen\.readiness\.ready/.test(call[1]) && /version: documentVersion/.test(call[1]) && !/email|conversation|propertyAddress/i.test(call[1]), call && call[1]);
  check('G: the next instruction renders the helper\'s text (no hard-coded ready-only send line)',
    /data-testid="contract-next-action"[^>]*>\n\s+\{contractCurrentStatus\?\.next\}/.test(page) && !page.includes('"Contract Ready. Review the populated PDF, then upload and send it manually in GHL."'));
  check('G: the latest-state headline renders only when there is one', /\{contractCurrentStatus && contractCurrentStatus\.headline \? \(\n\s+<div data-testid="contract-current-status"/.test(page));
  check('G: the readiness status line is unchanged', /\? "Contract Ready"\n\s+: `Not Contract Ready — /.test(page));
  const CLIENT_CALLS = /appWriteFetch\(|\bghl\.[A-Za-z]+\.[A-Za-z]+\(/g;
  check('G: no new GHL client or write call on the page (pinned 24)', (page.match(CLIENT_CALLS) || []).length === 24, (page.match(CLIENT_CALLS) || []).length);
  check('G: Start Disposition and Under Contract gates unchanged',
    page.includes('{showStartDispositionControl(currentUnderContractRecord, preservedArtifactRecord, underContractStageConfirmed) ? (')
      && page.includes('return existingDispositionHandoffs.find((h) => verifyHandoffMatchesUnderContract({'));
}

console.log(`\nB15-21 contract current status: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
