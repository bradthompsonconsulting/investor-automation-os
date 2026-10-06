/**
 * Board 15 cleanup (Brad's Test checks, 2026-10-06) -- offline checks, in CI.
 *
 *   1. No internal Board / issue / commit / repository / PB-D references in
 *      operator-visible text: the Contract Workspace (template name, the
 *      Agreement Reached meaning, the send-evidence message), the no-deal
 *      reasons (PB-D55) and the Seller Call question text (PB-D56). Stored
 *      values (the template source in authorization records, the disposition
 *      evidence summary) are unchanged -- only their display.
 *   2. "Unnamed contact" wherever a contact's name is shown; the Seller Call
 *      header phone is formatted.
 *   3. An expired read session shows a sign-in recovery screen (never the
 *      page's raw failed reads); the page stays mounted behind it, is never
 *      remounted (drafts and pending saves survive) and re-reads its data
 *      when sign-in returns (Bones, PR #131).
 */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const APP = path.resolve(__dirname, '..');
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);

let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}
const read = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8');
/** Source with comments removed, so only code and rendered strings remain. */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'`])\/\/.*$/gm, '$1');
const INTERNAL = /\bBoard ?#?\d|\bINV-\d|\bPB-D\d|\bcommitted\b|\brepositor|\bgithub\b|docs\//;

const display = require(path.join(APP, 'src/lib/operator-display.ts'));
const docModel = require(path.join(APP, 'src/lib/contract-document-model.ts'));

// 1 -- internal references
check('the contract template is displayed by its document name only', display.contractTemplateDisplayName(docModel.CONTRACT_DOCUMENT_TEMPLATE_SOURCE) === 'TREC Resale Home Contract', display.contractTemplateDisplayName(docModel.CONTRACT_DOCUMENT_TEMPLATE_SOURCE));
check('the stored template source is unchanged (it is part of persisted authorization records)', /committed d7a2b18/.test(docModel.CONTRACT_DOCUMENT_TEMPLATE_SOURCE));
const contract = code('src/pages/ContractWorkspace.tsx');
check('Contract Workspace renders the template through contractTemplateDisplayName', /\{contractTemplateDisplayName\(contractDocumentPreview\.templateSource\)\}/.test(contract) && !/\{contractDocumentPreview\.templateSource\}/.test(contract));
check('Contract Workspace renders the operator Agreement Reached meaning (no board name)', /\{AGREEMENT_REACHED_OPERATOR_MEANING\}/.test(contract) && !INTERNAL.test(display.AGREEMENT_REACHED_OPERATOR_MEANING));
check('the contract send-evidence message names no issue key', !/INV-\d/.test(code('src/lib/contract-lifecycle-model.ts').match(/message: "The supplied send evidence[^"]*"/)?.[0] ?? 'missing'));
check('no-deal reasons on Seller Call and Underwriting carry no PB-D55', !/reason="[^"]*PB-D55/.test(code('src/pages/SellerCallWorkspace.tsx')) && !/reason="[^"]*PB-D55/.test(code('src/pages/UnderwritingWorkspace.tsx')));
check('the Seller Call question text carries no PB-D56', !/"PB-D56/.test(code('src/lib/underwriting/next-best-question.ts')));
{
  // Every rendered string literal in the operator pages and the components they use.
  const files = ['src/pages/ContractWorkspace.tsx', 'src/pages/SellerCallWorkspace.tsx', 'src/pages/UnderwritingWorkspace.tsx', 'src/pages/ContactWorkspace.tsx', 'src/pages/Dashboard.tsx', 'src/components/NoDealYet.tsx', 'src/lib/board9-contract-model.ts', 'src/lib/contract-lifecycle-model.ts', 'src/lib/underwriting/next-best-question.ts'];
  const offenders = [];
  for (const f of files) {
    const lines = code(f).split('\n');
    lines.forEach((l, i) => {
      for (const m of l.matchAll(/"[^"\n]{3,}"|`[^`\n]{3,}`/g)) {
        const s = m[0];
        if (INTERNAL.test(s) && !/^["`](\.\/|\.\.\/)/.test(s) && !/evidenceSummary/.test(l) && !/CONTRACT_STATE_MEANING|agreement_reached:/.test(l) && !/CONTRACT_DOCUMENT_TEMPLATE_SOURCE/.test(l)) offenders.push(`${f}:${i + 1} ${s.slice(0, 80)}`);
      }
    });
  }
  // board9-contract-model's CONTRACT_STATE_MEANING restates the governing doc verbatim; it is displayed through the operator wording above.
  check('no other internal references in rendered strings of these screens', offenders.filter((o) => !/board9-contract-model/.test(o)).length === 0, offenders);
}

// 2 -- "Unnamed contact"
for (const f of ['src/pages/ContactWorkspace.tsx', 'src/pages/ContractWorkspace.tsx', 'src/pages/Dashboard.tsx', 'src/pages/SellerCallWorkspace.tsx', 'src/pages/UnderwritingWorkspace.tsx', 'src/pages/Segmentation.tsx', 'src/pages/Mailers.tsx', 'src/pages/Pipeline.tsx']) {
  const c = code(f);
  check(`${path.basename(f)}: a nameless contact is "Unnamed contact", never "Unknown"`, !/\|\|\s*"Unknown"|>Unknown</.test(c.replace(/stageName\.get\([^)]*\) \?\? "Unknown"/g, '')) && /UNNAMED_CONTACT/.test(c));
}
check('Seller Call header formats the phone', /\{contact\?\.phone \? ` · \$\{formatPhone\(contact\.phone\)\}` : ""\}/.test(code('src/pages/SellerCallWorkspace.tsx')));

// 3 -- expired session
const ra = code('src/components/ReadAccess.tsx');
check('a lapsed session shows the sign-in recovery screen with a Sign in again action', /data-testid="read-access-recovery"/.test(ra) && /Your sign-in has ended/.test(ra) && /Sign in again/.test(ra));
check('the page stays mounted behind it (one wrapper with a FIXED key, hidden while signed out)', /const page = <div key="page" hidden=\{status\.kind !== "signed_in"\}/.test(ra) && /return <>\{null\}\{page\}<\/>;/.test(ra) && /\{page\}\s*<\/>;/.test(ra));
check('Bones PR #131: the page is never remounted on recovery (no key derived from the recovery count)', !/key=\{[^}]*epoch/.test(ra));
check('recovery is signalled to the page, not forced by a remount', /if \(lapsed\.current\) \{ lapsed\.current = false; setEpoch\(\(e\) => e \+ 1\); \}/.test(ra) && /<ReadRecovered\.Provider value=\{epoch\}>\{children\}<\/ReadRecovered\.Provider>/.test(ra));
{
  // Every page that reads re-runs its READS on recovery (and only its reads).
  const pages = { Dashboard: /\}, \[readRecovered\]\);/, Calendars: /\}, \[readRecovered\]\);/, Contacts: /\}, \[readRecovered\]\);/, Conversations: /\}, \[selected, readRecovered\]\);/,
    Pipeline: /\}, \[readRecovered\]\);/, Segmentation: /\}, \[readRecovered\]\);/, Mailers: /load\(!firstLoad\.current\); firstLoad\.current = false; \}, \[readRecovered\]\);/,
    DealCalculator: /\}, \[readRecovered\]\);/, SellerCallWorkspace: /\}, \[contactId, readRecovered\]\);/, ContractWorkspace: /\}, \[contactId, readRecovered\]\);/,
    UnderwritingWorkspace: /\}, \[contactId, reloadTick, readRecovered\]\);/, ContactWorkspace: /if \(readRecovered === seenRecovery\.current\) return;/ };
  const missing = Object.entries(pages).filter(([f, re]) => { const c = code(`src/pages/${f}.tsx`); return !/const readRecovered = useReadRecovered\(\);/.test(c) || !re.test(c); }).map(([f]) => f);
  check('every reading page re-reads on recovery', missing.length === 0, missing);
}
{
  const cw = code('src/pages/ContactWorkspace.tsx');
  check('Contact page recovery: screen-keeping refresh once loaded, guarded first-load readers only for what never loaded (no navigation reset); waits while an editor is open',
    /function recoverReads\(\) \{\s*if \(!defs\) loadDefs\(\);[\s\S]*?if \(contact && detail && opps\) \{ void refreshAll\(\); return; \}\s*if \(!contact\) loadContact\(\);\s*if \(!detail\) loadDetail\(\);\s*if \(!opps\) loadOpportunities\(\);\s*loadNotes\(\);\s*loadConversations\(\);\s*\}/.test(cw)
    && /if \(anyEditorOpenRef\.current\) \{ recoveryPending\.current = true; setRefreshDeferred\(true\); return; \}/.test(cw)
    && /if \(recoveryPending\.current\) \{ recoveryPending\.current = false; recoverReads\(\); return; \}/.test(cw));
  check('ARV comps: a re-read of the same contact never re-seeds (overwrites) the subject draft',
    /if \(seededFor\.current === contact\.id\) return;/.test(code('src/components/ArvCompsWorkspace.tsx')));
  check('Mailers: a recovery re-read keeps ticked tasks that still exist', /setChecked\(\(prev\) => new Set\(\[\.\.\.prev\]\.filter\(\(t\) => present\.has\(t\)\)\)\);/.test(code('src/pages/Mailers.tsx')));
  check('Dashboard: "new since last visit" is recorded on the first load only', /if \(visitRecorded\.current\) return;\s*visitRecorded\.current = true;/.test(code('src/pages/Dashboard.tsx')));
}
check('before any sign-in, the single sign-in landing is unchanged (no page rendered)', /if \(!wasSignedIn\) \{[\s\S]{0,600}>Sign in to IAOS<\/h1>[\s\S]{0,400}<\/div>;\s*\}/.test(ra));

// 4 -- Bones, PR #131 re-review at b34c6d5 (behaviour proven in test-read-session-recovery.cjs P1CL / P1BLUR / P2UW).
{
  const cl = code('src/components/CallLogControl.tsx');
  check('P1 call log: ownership starts the moment the result write is confirmed',
    /await ghl\.contacts\.setCallLogResult\(contactId, chosen\);\s*unresolved\.current = \{ result: chosen, body \};/.test(cl));
  check('P1 call log: the save handler refuses while an unresolved attempt exists',
    /if \(!result \|\| inFlight\.current\) return;[^\n]*\n\s*if \(unresolved\.current\) return;/.test(cl));
  check('P1 call log: choosing a result refuses (and is disabled) while unresolved; Save is disabled',
    /onClick=\{\(\) => \{ if \(unresolved\.current\) return; setResult\(r\);/.test(cl) && /disabled=\{busy \|\| owned\} style=\{btn\(result === r\)\}/.test(cl)
    && /data-testid="call-log-save" onClick=\{\(\) => void save\(\)\} disabled=\{busy \|\| owned \|\| !result\}/.test(cl));
  check('P1 call log: only a readback that answers releases it (verified save path or Check again)',
    (cl.match(/unresolved\.current = null;/g) || []).length === 2 && /async function checkAgain\(\)/.test(cl) && /data-testid="call-log-check-again"/.test(cl));
  check('P1 call log: Check again finishes a confirmed attempt through the same note-then-touch path, once', /await writeNoteAndTouch\(pending\.result, pending\.body\);/.test(cl));

  const blurSites = { 'src/pages/SellerCallWorkspace.tsx': 1, 'src/pages/ContactWorkspace.tsx': 3, 'src/pages/Dashboard.tsx': 1 };
  for (const [f, n] of Object.entries(blurSites)) {
    const c = code(f);
    check(`P1 lifecycle blur: ${path.basename(f)} -- every blur-to-save handler ignores the blur from hiding the page (${n})`,
      (c.match(/onBlur=\{\(e\) => \{ if \(isLifecycleBlur\(e\.currentTarget\)\) return;/g) || []).length === n && (c.match(/onBlur=/g) || []).length === n);
  }
  check('P1 lifecycle blur: the rule is "inside the hidden page wrapper"', /target\.closest\("\[hidden\]"\) !== null/.test(code('src/lib/lifecycle-blur.ts')));

  for (const f of ['UnderwritingWorkspace', 'SellerCallWorkspace', 'ContractWorkspace']) {
    const c = code(`src/pages/${f}.tsx`);
    check(`P2 ${f}: a failed RE-read is reported on its own line and never replaces the loaded workspace`,
      /if \(loadedFor\.current === contactId\) setRefreshReadError\(e\.message\);\s*else setFetchError\(e\.message\);/.test(c)
      && /loadedFor\.current = contactId;\s*setRefreshReadError\(null\);/.test(c) && /<RefreshReadError message=\{refreshReadError\} \/>/.test(c));
  }
  check('P2 Contact page: once loaded, recovery uses the screen-keeping refresh (failure = refresh error, never the full-page error)',
    /if \(contact && detail && opps\) \{ void refreshAll\(\); return; \}/.test(code('src/pages/ContactWorkspace.tsx')));
}

console.log(`\nBoard 15 cleanup: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
