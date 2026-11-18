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
 *   F2. pre-execution rescission (Bones REVISE R2): no Under Contract record,
 *      never sent or sent -> "Rescission recorded", no send prompt; another
 *      deal's or revision's rescission does not apply
 *   S. a send recorded, no execution (Bones REVISE R1): an accepted, bound
 *      send for this deal/revision -> "Contract sent", no send prompt, no
 *      signature claim; in progress / awaiting readback / ambiguous -> "Send
 *      outcome not confirmed", no send prompt; failed, another deal's or
 *      another revision's send -> the readiness guidance stands
 *   H. send HISTORY (Bones B2): every attempt is resolved within itself from
 *      canonical notes (resolvedSendAttemptsForOpportunity); a later failed
 *      attempt never erases an earlier accepted or unresolved one; a pending
 *      note superseded by its own terminal note is not unresolved; another
 *      deal's or revision's attempts are isolated; the page's existingSend
 *      (latest attempt, used by the gates) is unchanged
 *   L. the WHOLE PAGE's send instructions (Bones B1): the top next action, the
 *      lower "Manual GHL upload and send" instruction and the Record GHL Send
 *      explanation rendered together; a send-again instruction appears only
 *      when no send, execution or rescission is recorded
 *   R. RENDERED: the page's exact headline and next-action JSX (extracted from
 *      ContractWorkspace.tsx, compiled by TypeScript, server-rendered by React)
 *      for every state, including sent/pending and pre-execution rescission
 *      and their wrong-deal / wrong-revision controls
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
const L = require(path.join(LIB, 'contract-lifecycle-model.ts'));
const SC = require(path.join(LIB, 'contract-send-carriers.ts'));

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
const SENT_AT = '2026-09-21T23:00:00.000Z';
const V2 = { agreementAt: AGREEMENT_AT, versionSeq: 2, supersedesVersionSeq: 1, replacesAgreementAt: null };
/** A contract-send record in the real v3 note format, read back with the real parser (what the page's existingSend holds). */
function sendRecord(status, over) {
  const parsed = SC.parseContractSendNote(sendNote(status, over));
  if (!parsed) throw new Error(`fixture: ${status} send did not round-trip through its carrier`);
  return parsed;
}
/** The canonical v3 send NOTE body (what GHL holds) for one attempt at one status. */
function sendNote(status, over) {
  const accepted = status === 'accepted';
  const args = Object.assign({
    opportunityId: OPP, at: SENT_AT, operator: 'brad', attemptId: SENT_AT, status, version: V1,
    templateName: 'TREC 20-19', templateSource: 'manual', requestedTemplateId: 'tmpl-fixture', authorizedAt: '2026-09-21T22:00:00.000Z',
    authorizedArtifactSha256: 'c'.repeat(64), signers: [{ role: 'Seller', displayName: 'Jane Seller' }],
    confirmedRecipientId: accepted ? 'recipient-1' : null, expirationAt: null, requestAt: SENT_AT,
    iaosObservedAcceptanceAt: accepted ? SENT_AT : null,
    providerResponse: accepted ? { documentId: '6aaffa4a0f9b5add21ee171f', documentReference: '6241B756', documentRevision: 1, recipientId: 'recipient-1', createdBy: 'brad', readbackStatus: 'sent', readbackLocationId: 'fixture-location', fillableFieldCount: 3 } : null,
    failureReason: status === 'failed' ? 'fixture failure' : null,
  }, over || {});
  return SC.formatContractSendNote(args);
}
/** A pre-execution rescission built by the REAL builder (acceptedSend null = never sent, or the bound accepted send). */
function preExecRescission(version, acceptedSend, opportunityId = OPP) {
  const built = L.buildRescissionRecord({ opportunityId, version, reason: 'Fixture: agreement withdrawn before execution', authorizedBy: 'brad', authorizedAt: '2026-09-25T15:00:00.000Z',
    acceptedSend, iaosObservedAt: '2026-09-25T15:00:00.000Z', evidenceSummary: 'fixture pre-execution rescission', relatedPriorRecordId: null });
  if (!built.ok) throw new Error('fixture: buildRescissionRecord refused ' + JSON.stringify(built.reasons));
  const parsed = LC.parseContractLifecycleNote(LC.formatContractLifecycleNote(built.value));
  if (!parsed) throw new Error('fixture: pre-execution rescission did not round-trip through its carrier');
  return parsed;
}
const derive = (over) => S.deriveContractCurrentStatus(Object.assign({
  opportunityId: OPP, agreementAt: AGREEMENT_AT, version: V1, readinessReady: true,
  underContract: null, dispositionHandoff: null, lifecycleHistory: [], sendAttempts: [], formatTime: fmt,
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

/* F2. pre-execution rescission (Bones R2) */
const OTHER_OPP = '8N0SqUzkCf7GCJNTAY4g';
{
  const never = derive({ lifecycleHistory: [preExecRescission(V1, null)] });
  check('F2: never sent, rescinded, no Under Contract -> "Rescission recorded", no send prompt', never.kind === 'rescinded' && !sendsSomething(never), never);
  check('F2: the detail names no Under Contract time when none exists',
    never.detail === 'A Rescission was recorded for this contract version (2026-09-25T15:00:00.000Z). No Under Contract record exists for this version.', never.detail);
  const sent = sendRecord('accepted');
  const sentThen = derive({ sendAttempts: [sent], lifecycleHistory: [preExecRescission(V1, sent)] });
  check('F2: sent, then rescinded before execution -> "Rescission recorded" (wins over the send), no send prompt', sentThen.kind === 'rescinded' && !sendsSomething(sentThen), sentThen);
  check('F2: holds when readiness is not met', derive({ readinessReady: false, lifecycleHistory: [preExecRescission(V1, null)] }).kind === 'rescinded');
  check("F2 control: another deal's rescission does not apply", derive({ lifecycleHistory: [preExecRescission(V1, null, OTHER_OPP)] }).kind === 'ready_unsent');
  check("F2 control: another revision's rescission does not apply", derive({ lifecycleHistory: [preExecRescission(V2, null)] }).kind === 'ready_unsent');
}

/* S. send recorded, no execution (Bones R1) */
{
  const sent = sendRecord('accepted');
  check('S: the fixture send passes the real verifyAcceptedSendBinding for this deal and revision', L.verifyAcceptedSendBinding({ acceptedSend: sent, opportunityId: OPP, version: V1 }).ok === true);
  const st = derive({ sendAttempts: [sent] });
  check('S: an accepted send for this deal/revision -> "Contract sent — execution not yet recorded"', st.kind === 'sent_not_executed' && st.headline === 'Contract sent — execution not yet recorded', st);
  check('S: the next instruction never prompts a second send', !sendsSomething(st) && /^Do not upload or send it again\./.test(st.next), st.next);
  check('S: the detail records the send and claims no signature or provider state',
    st.detail === `A send of this contract version was recorded ${SENT_AT} (GHL document 6aaffa4a0f9b5add21ee171f). IAOS has no verified execution for it yet; this is not a signature status.`
      && !/\bsigned\b|pending|completed|viewed/i.test(st.detail), st.detail);
  check('S: holds when readiness is not currently met', derive({ sendAttempts: [sent], readinessReady: false }).kind === 'sent_not_executed');
  check('S: Under Contract supersedes the send record', derive({ sendAttempts: [sent], underContract: uc }).kind === 'under_contract');
  for (const status of ['in_progress', 'provider_accepted_pending_readback', 'ambiguous']) {
    const u = derive({ sendAttempts: [sendRecord(status)] });
    check(`S: a ${status} send -> "Send outcome not confirmed", no send prompt`, u.kind === 'send_unconfirmed' && !sendsSomething(u) && /^Do not upload or send it again/.test(u.next), u);
  }
  check('S: a failed send leaves the readiness (send) guidance', derive({ sendAttempts: [sendRecord('failed')] }).kind === 'ready_unsent');
  check("S control: another deal's accepted send establishes nothing", derive({ sendAttempts: [sendRecord('accepted', { opportunityId: OTHER_OPP })] }).kind === 'ready_unsent');
  check("S control: another revision's accepted send establishes nothing", derive({ sendAttempts: [sendRecord('accepted', { version: V2 })] }).kind === 'ready_unsent');
  check("S control: another revision's ambiguous send establishes nothing", derive({ sendAttempts: [sendRecord('ambiguous', { version: V2 })] }).kind === 'ready_unsent');
  check('S: an "accepted" record with no provider document is not a bound send, and is treated conservatively (no send prompt)', derive({ sendAttempts: [Object.assign({}, sent, { providerResponse: null })] }).kind === 'send_unconfirmed');
}

/* R. rendered: the page's exact headline + next-action JSX for every state */
{
  const ts = require(path.join(APP, 'node_modules', 'typescript'));
  const React = require(path.join(APP, 'node_modules', 'react'));
  const SSR = require(path.join(APP, 'node_modules', 'react-dom', 'server'));
  const start = page.indexOf('{contractCurrentStatus && contractCurrentStatus.headline ? (');
  const end = start < 0 ? -1 : page.indexOf('\n\n          <div', start);
  const nStart = page.indexOf('<div data-testid="contract-next-action"');
  const nEnd = nStart < 0 ? -1 : page.indexOf('</div>', nStart) + 6;
  let Status = null;
  if (start >= 0 && end > start && nStart >= 0) {
    const tsx = 'module.exports = function Status({ contractCurrentStatus }: any) { return <>' + page.slice(start, end) + page.slice(nStart, nEnd) + '</>; };';
    const js = ts.transpileModule(tsx, { fileName: 'status.tsx', compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const icon = (name) => () => React.createElement('i', { 'data-icon': name });
    const cm = { exports: {} };
    new Function('module', 'exports', 'React', 'ShieldAlert', 'ShieldCheck', js)(cm, cm.exports, React, icon('alert'), icon('check'));
    Status = cm.exports;
  }
  check('R: the headline and next-action JSX are extracted from the page and compile', typeof Status === 'function');
  const sent = sendRecord('accepted');
  const cases = {
    ready_unsent: [derive({}), 'ready_unsent'],
    not_ready: [derive({ readinessReady: false }), 'not_ready'],
    sent_signatures_pending: [derive({ sendAttempts: [sent] }), 'sent_not_executed'],
    send_outcome_ambiguous: [derive({ sendAttempts: [sendRecord('ambiguous')] }), 'send_unconfirmed'],
    sent_other_deal: [derive({ sendAttempts: [sendRecord('accepted', { opportunityId: OTHER_OPP })] }), 'ready_unsent'],
    sent_other_revision: [derive({ sendAttempts: [sendRecord('accepted', { version: V2 })] }), 'ready_unsent'],
    under_contract: [derive({ underContract: uc, sendAttempts: [sent] }), 'under_contract'],
    disposition_started: [derive({ underContract: uc, dispositionHandoff: handoff, sendAttempts: [sent] }), 'disposition_started'],
    rescinded_after_execution: [derive({ underContract: uc, sendAttempts: [sent], lifecycleHistory: [rescissionRecord(V1)] }), 'rescinded'],
    rescinded_before_execution_never_sent: [derive({ lifecycleHistory: [preExecRescission(V1, null)] }), 'rescinded'],
    rescinded_before_execution_after_send: [derive({ sendAttempts: [sent], lifecycleHistory: [preExecRescission(V1, sent)] }), 'rescinded'],
    rescinded_other_deal: [derive({ lifecycleHistory: [preExecRescission(V1, null, OTHER_OPP)] }), 'ready_unsent'],
    rescinded_other_revision: [derive({ lifecycleHistory: [preExecRescission(V2, null)] }), 'ready_unsent'],
  };
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;');
  const rendered = {};
  for (const [name, [st, want]] of Object.entries(cases)) {
    const html = Status ? SSR.renderToStaticMarkup(React.createElement(Status, { contractCurrentStatus: st })) : '';
    rendered[name] = { status: st, markup: html };
    const sendPrompt = html.includes('upload and send it manually in GHL');
    const headlineShown = html.includes('data-testid="contract-current-status"');
    const nextKind = (/data-testid="contract-next-action" data-kind="([a-z_]*)"/.exec(html) || [])[1];
    const wantsPrompt = want === 'ready_unsent';
    check(`R ${name}: renders ${want}${st.headline ? ` with headline "${st.headline}"` : ', no headline'}; send prompt ${wantsPrompt ? 'shown' : 'absent'}`,
      nextKind === want && sendPrompt === wantsPrompt && headlineShown === !!st.headline && (!st.headline || html.includes(esc(st.headline))) && html.includes(esc(st.next)),
      { nextKind, sendPrompt, headlineShown, html: html.slice(0, 300) });
  }
  const outDir = process.env.B1521_RENDER_OUT;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'rendered-cases.json'), JSON.stringify(rendered, null, 2));
    fs.writeFileSync(path.join(outDir, 'rendered-cases.html'), '<!doctype html><meta charset="utf-8"><title>B15-21 rendered cases</title><body style="background:#0B1220;color:#E2E8F0;font-family:sans-serif;padding:16px">'
      + Object.entries(rendered).map(([n, r]) => `<h2 style="color:#64748B;font-size:12px">${n}</h2>${r.markup}`).join('<hr>') + '</body>');
  }
}

/* H. send history (Bones B2): canonical notes, every attempt resolved within itself */
const T0 = '2026-09-21T23:00:00.000Z', T1 = '2026-09-21T23:05:00.000Z', T2 = '2026-09-22T10:00:00.000Z', T3 = '2026-09-22T10:02:00.000Z';
const attempt = (id, status, at, over) => ({ body: sendNote(status, Object.assign({ attemptId: id, at, requestAt: id, ...(status === 'accepted' ? { iaosObservedAcceptanceAt: at } : {}) }, over || {})) });
const fromNotes = (notes, over) => derive(Object.assign({ sendAttempts: S.resolvedSendAttemptsForOpportunity(notes, OPP) }, over || {}));
{
  const A = T0, B = T2; // attempt ids are ISO request instants, as the carrier requires
  const acceptedA_failedB = [attempt(A, 'in_progress', T0), attempt(A, 'accepted', T1), attempt(B, 'in_progress', T2), attempt(B, 'failed', T3)];
  const latest = SC.latestContractSendForOpportunity(acceptedA_failedB, OPP);
  check('H: (the defect) the page\'s existingSend -- the latest attempt, unchanged -- is the failed attempt B', !!latest && latest.attemptId === B && latest.status === 'failed', latest && [latest.attemptId, latest.status]);
  const atts = S.resolvedSendAttemptsForOpportunity(acceptedA_failedB, OPP);
  check('H: both attempts are resolved within themselves (A accepted, B failed)', JSON.stringify(atts.map((a) => [a.attemptId, a.status]).sort()) === JSON.stringify([[A, 'accepted'], [B, 'failed']]), atts.map((a) => [a.attemptId, a.status]));
  const st = fromNotes(acceptedA_failedB);
  check('H: accepted A + later failed B (same deal/revision) -> still "Contract sent", no send prompt', st.kind === 'sent_not_executed' && !sendsSomething(st), st);
  check('H: the detail names A\'s recorded send', (st.detail || '').includes(`recorded ${T1}`), st.detail);
  const unresolvedA_failedB = [attempt(A, 'in_progress', T0), attempt(A, 'ambiguous', T1), attempt(B, 'in_progress', T2), attempt(B, 'failed', T3)];
  const u = fromNotes(unresolvedA_failedB);
  check('H: ambiguous A + later failed B -> "Send outcome not confirmed", no send prompt', u.kind === 'send_unconfirmed' && !sendsSomething(u), u);
  const stuckA = [attempt(A, 'in_progress', T0), attempt(A, 'in_progress', T1)];
  check('H: an attempt still only in progress -> "Send outcome not confirmed"', fromNotes(stuckA).kind === 'send_unconfirmed');
  const pendingThenFailed = [attempt(A, 'in_progress', T0), attempt(A, 'provider_accepted_pending_readback', T1), attempt(A, 'failed', T2)];
  check('H: a pending note superseded by its own failure is NOT unresolved forever -> readiness guidance', fromNotes(pendingThenFailed).kind === 'ready_unsent');
  const failedOutOfOrder = [attempt(A, 'failed', T1), attempt(A, 'in_progress', T2)];
  check('H: within one attempt the terminal note wins by carrier precedence even when a pending note is later', fromNotes(failedOutOfOrder).kind === 'ready_unsent');
  const pendingThenAccepted = [attempt(A, 'in_progress', T0), attempt(A, 'accepted', T1)];
  check('H: in progress then accepted within one attempt -> "Contract sent"', fromNotes(pendingThenAccepted).kind === 'sent_not_executed');
  const twoFailed = [attempt(A, 'failed', T1), attempt(B, 'failed', T3)];
  check('H: only failed attempts -> readiness (send) guidance', fromNotes(twoFailed).kind === 'ready_unsent');
  const otherDealAccepted = [attempt(A, 'accepted', T1, { opportunityId: OTHER_OPP }), attempt(B, 'failed', T3)];
  check('H control: another deal\'s accepted attempt + our failed attempt -> readiness guidance', fromNotes(otherDealAccepted).kind === 'ready_unsent');
  check('H control: another deal\'s attempts never enter this deal\'s list', S.resolvedSendAttemptsForOpportunity(otherDealAccepted, OPP).every((a) => a.opportunityId === OPP));
  const otherRevAccepted = [attempt(A, 'accepted', T1, { version: V2 }), attempt(B, 'failed', T3)];
  check('H control: another revision\'s accepted attempt + our failed attempt -> readiness guidance', fromNotes(otherRevAccepted).kind === 'ready_unsent');
  const otherRevAmbiguous = [attempt(A, 'ambiguous', T1, { version: V2 }), attempt(B, 'failed', T3)];
  check('H control: another revision\'s ambiguous attempt -> readiness guidance', fromNotes(otherRevAmbiguous).kind === 'ready_unsent');
  const oursObscured = [attempt(A, 'accepted', T1), attempt(B, 'failed', T3, { version: V2 })];
  check('H: our accepted attempt stays "Contract sent" when another revision\'s attempt is newer', fromNotes(oursObscured).kind === 'sent_not_executed');
  check('H: Under Contract still supersedes the send history', fromNotes(acceptedA_failedB, { underContract: uc }).kind === 'under_contract');
  check('H: a Rescission still supersedes the send history', fromNotes(acceptedA_failedB, { lifecycleHistory: [preExecRescission(V1, null)] }).kind === 'rescinded');
}

/* L. the whole page's send instructions rendered together (Bones B1) */
{
  const ts = require(path.join(APP, 'node_modules', 'typescript'));
  const React = require(path.join(APP, 'node_modules', 'react'));
  const SSR = require(path.join(APP, 'node_modules', 'react-dom', 'server'));
  const slice = (from, endMarker, extra = 0) => { const a = page.indexOf(from); if (a < 0) return null; const b = page.indexOf(endMarker, a); return b < 0 ? null : page.slice(a, b + extra); };
  const top = slice('{contractCurrentStatus && contractCurrentStatus.headline ? (', '\n\n          <div');
  const next = slice('<div data-testid="contract-next-action"', '</div>', 6);
  const lower = slice('{allowsNewSend(contractCurrentStatus) ? (\n                <p data-testid="contract-manual-send-instruction"', '\n              )}', '\n              )}'.length);
  const record = slice('<div data-testid="contract-manual-send-explanation"', '</div>', 6);
  let Whole = null;
  if (top && next && lower && record) {
    const tsx = 'module.exports = function Whole({ contractCurrentStatus }: any) { return <><section data-part="top">' + top + next
      + '</section><section data-part="lower-notice">' + lower + '</section><section data-part="record-send">' + record + '</section></>; };';
    const js = ts.transpileModule(tsx, { fileName: 'whole.tsx', compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const cm = { exports: {} };
    new Function('module', 'exports', 'React', 'ShieldAlert', 'ShieldCheck', 'allowsNewSend', 'LOWER_NO_RESEND', 'RECORD_SEND_NO_RESEND', js)(
      cm, cm.exports, React, () => null, () => null, S.allowsNewSend, S.LOWER_NO_RESEND, S.RECORD_SEND_NO_RESEND);
    Whole = cm.exports;
  }
  check('L: the top, lower-notice and Record GHL Send instruction JSX are all extracted from the page and compile', typeof Whole === 'function', { top: !!top, next: !!next, lower: !!lower, record: !!record });
  // Every imperative to upload/send on the page, as rendered.
  const SEND_AGAIN = [/upload and send it manually in GHL/, /upload it to GHL\s+Documents &amp; Contracts and send it manually/, /After you manually upload the authorized PDF to GHL Documents &amp; Contracts and send it/];
  const sent = sendRecord('accepted');
  const A = T0, B = T2;
  const states = {
    unsent_ready: [derive({}), true],
    unsent_not_ready: [derive({ readinessReady: false }), true],
    sent_accepted: [derive({ sendAttempts: [sent] }), false],
    sent_accepted_then_failed: [fromNotes([attempt(A, 'accepted', T1), attempt(B, 'failed', T3)]), false],
    send_unresolved: [fromNotes([attempt(A, 'ambiguous', T1)]), false],
    send_unresolved_then_failed: [fromNotes([attempt(A, 'in_progress', T0), attempt(B, 'failed', T3)]), false],
    rescinded_before_execution: [derive({ lifecycleHistory: [preExecRescission(V1, null)] }), false],
    executed_under_contract: [derive({ underContract: uc, sendAttempts: [sent] }), false],
    executed_disposition_started: [derive({ underContract: uc, dispositionHandoff: handoff, sendAttempts: [sent] }), false],
    failed_only: [fromNotes([attempt(A, 'failed', T1)]), true],
    other_deal_sent: [fromNotes([attempt(A, 'accepted', T1, { opportunityId: OTHER_OPP })]), true],
    other_revision_sent: [fromNotes([attempt(A, 'accepted', T1, { version: V2 })]), true],
  };
  const wholeRendered = {};
  for (const [name, [st, sendAllowed]] of Object.entries(states)) {
    const html = Whole ? SSR.renderToStaticMarkup(React.createElement(Whole, { contractCurrentStatus: st })) : '';
    wholeRendered[name] = { kind: st.kind, markup: html };
    const prompts = SEND_AGAIN.filter((re) => re.test(html)).length;
    const lowerAllows = (/data-testid="contract-manual-send-instruction" data-allows-send="(true|false)"/.exec(html) || [])[1];
    const recordAllows = (/data-testid="contract-manual-send-explanation" data-allows-send="(true|false)"/.exec(html) || [])[1];
    if (sendAllowed) {
      check(`L ${name} (${st.kind}): the lower notice and Record GHL Send keep their send instructions`, lowerAllows === 'true' && recordAllows === 'true' && prompts >= 2, { prompts, lowerAllows, recordAllows });
    } else {
      check(`L ${name} (${st.kind}): NO instruction to upload or send anywhere -- top, lower notice and Record GHL Send agree`,
        prompts === 0 && lowerAllows === 'false' && recordAllows === 'false' && html.includes('Do not upload or send'), { prompts, lowerAllows, recordAllows, html: html.slice(0, 400) });
    }
  }
  const outDir = process.env.B1521_RENDER_OUT;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'whole-page-instructions.json'), JSON.stringify(wholeRendered, null, 2));
    fs.writeFileSync(path.join(outDir, 'whole-page-instructions.html'), '<!doctype html><meta charset="utf-8"><title>B15-21 page send instructions</title><body style="background:#0B1220;color:#E2E8F0;font-family:sans-serif;padding:16px">'
      + Object.entries(wholeRendered).map(([n, r]) => `<h2 style="color:#64748B;font-size:12px">${n} (${r.kind})</h2>${r.markup}`).join('<hr>') + '</body>');
  }
}

/* G. page wiring (source; --before must fail here) */
{
  check('G: the page imports the helper', /import \{[^}]*\bderiveContractCurrentStatus\b[^}]*\} from "\.\.\/lib\/contract-current-status";/.test(page));
  const call = /deriveContractCurrentStatus\(\{([\s\S]*?)\}\);/.exec(page);
  check('G: the page passes only the governed records (Under Contract, verified handoff, lifecycle history, latest send record, readiness)',
    !!call && /underContract: currentUnderContractRecord/.test(call[1]) && /dispositionHandoff: currentDispositionHandoff/.test(call[1]) && /lifecycleHistory: dispositionLifecycleHistory/.test(call[1])
      && /readinessReady: screen\.readiness\.ready/.test(call[1]) && /version: documentVersion/.test(call[1]) && /sendAttempts: sendAttemptsForDisplay/.test(call[1])
      && !/email|conversation|propertyAddress/i.test(call[1]), call && call[1]);
  check("G: the page's existingSend (used by the send/execution gates) is unchanged: still the latest attempt (latestContractSendForOpportunity)",
    page.includes('return latestContractSendForOpportunity(notes, screen.opportunity.id);'));
  check('G: the display-only send history comes from the same notes, resolved per attempt',
    page.includes('return resolvedSendAttemptsForOpportunity(notes, screen.opportunity.id);'));
  check('G: the Record GHL Send and Verify Execution controls are still chosen by existingSend, unchanged',
    page.includes('{showVerifyExecutionControl(existingSend) ? (') && page.includes(') : showRecordGhlSendControl(screen, bradAuthorizationRecord, existingSend) ? ('));
  check('G: the lower notice and Record GHL Send explanation follow the same no-resend state as the top',
    (page.match(/allowsNewSend\(contractCurrentStatus\)/g) || []).length === 3);
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
