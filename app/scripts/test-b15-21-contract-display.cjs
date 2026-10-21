/**
 * B15-21 (INV-130) -- Contract Workspace display-only cleanup (Walkthrough 2,
 * Brad/Jess 2026-10-07).
 *
 * Offline. Settled points only:
 *   1. The page heading no longer claims "Contract Ready" in every state; it
 *      is the screen's established name, "Contract Workspace".
 *   2. "Authorization saved" is explained against the PDF it covers: the
 *      authorization record's artifact hash, and whether a PDF generated in
 *      this session re-checked those bytes. Nothing claims verification.
 *   3. An unresolved title company reads "Not selected yet" (display only);
 *      it stays unresolved and blocking. Saving without a title company is
 *      NOT changed (it needs a recorded decision; see handoff).
 * Behaviour of the page's own helper is checked by transpiling it out of
 * the page source; wiring and "no gate changed" by exact source invariants
 * that need no git and hold on any tree containing B15-21 (F3b).
 *
 * SLICE PROVENANCE runs in every mode from checked-in material
 * (scripts/fixtures/b15-21-slice-provenance.json, pinned by sha256): the slice
 * b9a84f2 -> 529b145 replaced exactly five display lines, added no gate
 * token, changed only the page and this test, and every line it added is
 * present in this tree. Missing or altered material fails loudly; no git or
 * network is needed, so it runs in shallow CI. --provenance-git additionally
 * re-derives the record from the pinned commits (fails loudly if absent).
 *
 * NEGATIVE CONTROL: --before=<rev> reads that revision's page and must FAIL.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..');
const ts = require(path.join(APP, 'node_modules', 'typescript'));
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const REV = beforeArg ? beforeArg.slice('--before='.length) : null;
const page = (REV
  ? execFileSync('git', ['show', `${REV}:app/src/pages/ContractWorkspace.tsx`], { cwd: APP, encoding: 'utf8' })
  : fs.readFileSync(path.join(APP, 'src/pages/ContractWorkspace.tsx'), 'utf8')).replace(/\r\n/g, '\n'); // line endings vary by checkout (CRLF on Windows)
if (REV) console.log(`NEGATIVE CONTROL: reading ContractWorkspace.tsx at ${REV}; this run must fail.`);

let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks++;
  if (!ok) failures++;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

// ── 1. Heading ───────────────────────────────────────────────────────────────
check('heading is "Contract Workspace"', />Contract Workspace<\/h1>/.test(page));
check('no h1 claims "Contract Ready"', !/<h1[^>]*>Contract Ready<\/h1>/.test(page));
check('the readiness status itself still says Contract Ready / Not Contract Ready', /\? "Contract Ready"\n\s+: `Not Contract Ready — /.test(page));

// ── 2. Title company "Not selected yet" (behaviour, from the page source) ────
let unresolvedText = null;
const m = /const TITLE_COMPANY_NOT_SELECTED = "Not selected yet";\nfunction unresolvedText\(group: string, field: string\): string \{[\s\S]*?\n\}/.exec(page);
if (m) {
  const js = ts.transpileModule(m[0] + '\nmodule.exports = unresolvedText;', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', js)(mod, mod.exports);
  unresolvedText = mod.exports;
}
check('helper exists', typeof unresolvedText === 'function');
check('unresolved title company reads "Not selected yet"', unresolvedText && unresolvedText('titleSurvey', 'titleCompanyName') === 'Not selected yet');
check('every other unresolved field still reads "Unresolved"', unresolvedText && ['titlePolicyExpenseParty', 'surveyElection'].every((f) => unresolvedText('titleSurvey', f) === 'Unresolved') && unresolvedText('earnestMoneyOption', 'escrowAgentName') === 'Unresolved');
check('field summary uses the helper for unresolved values, still amber', page.includes('if (d.kind === "unresolved") return { text: unresolvedText(group, field), color: "#F59E0B" };'));
check('material-terms preview uses the helper for unresolved lines', page.includes('{l.text ?? unresolvedText(l.group, l.field)}'));
check('title company input shows "Not selected yet" as its empty placeholder', page.includes('placeholder={TITLE_COMPANY_NOT_SELECTED} onChange={(v) => updateDraft("titleSurvey", { titleCompanyName: v })}'));
check('saving still requires a title company (no recorded decision to change it)', page.includes('if (drafts.titleSurvey.titleCompanyName.trim() === "") { setGroupError("titleSurvey", "Title company name is required."); return; }'));
check('"Not selected yet" is never written: not in any note/record builder', !/formatTitleSurvey[\s\S]{0,400}Not selected yet/.test(page) && !/TITLE_COMPANY_NOT_SELECTED[^;\n]*(ghl\.|notes\.create|format[A-Z])/.test(page));

// ── 3. Authorization saved vs this session's PDF ─────────────────────────────
check('the pinned sentence is kept verbatim', page.includes('"Authorization saved for this version."'));
check('saved: names the covered PDF hash, only when saved and a record exists',
  page.includes('{authorizationDisplayState === "saved" && bradAuthorizationRecord ? (') && page.includes('data-testid="contract-authorization-saved-artifact"'));
check('saved + no PDF this session: says the bytes were not re-checked (no verification claim)',
  page.includes('No PDF has been generated in this session, so those bytes have not been re-checked here.'));
check('saved + PDF this session: says it matches (currency already compares the fresh PDF)',
  page.includes('which the PDF generated in this session matches.'));
check('artifact panel: when authorized, explains instead of "generate before authorizing"',
  page.includes('No PDF generated in this session. The saved authorization covers SHA-256') && page.includes('"Not yet generated for this revision -- generate before authorizing."'));
check('no "verified" claim added', !/re-checked and verified|verification (is )?complete/i.test(page));

// ── 4. Gates unchanged — combined invariants, no git (F3b) ───────────────────
// These hold on ANY tree that contains B15-21: the slice branch, a shallow CI
// checkout, the integrated main. They replace the old moving `origin/main`
// diff, which needs history CI lacks and becomes empty after merge.
check('generation is still gated on authorization eligibility',
  page.includes('<Btn testId="contract-generate-button" onClick={handleGenerateArtifact} busy={generateBusy} disabled={!authorizationEligibility.eligible}>'));
check('Save authorization is still gated on eligibility AND a PDF generated in this session',
  /testId="contract-authorization-authorize-button"\s+onClick=\{handleAuthorize\}\s+busy=\{authorizeBusy\}\s+disabled=\{!authorizationEligibility\.eligible \|\| !generatedArtifact\}/.test(page));
check('authorization currency is still evaluated against the current preview and artifact facts',
  page.includes('return evaluateBradAuthorizationCurrency(bradAuthorizationRecord, contractDocumentPreview, currentArtifactFactsForDisplay);'));
check('authorization eligibility is still evaluated from the preview and document version',
  page.includes('return evaluateAuthorizationEligibility(contractDocumentPreview, documentVersion);'));
check('"saved" still derives only from currency (display state unchanged)',
  /const authorizationDisplayState: "saved" \| "unsaved_changes" \| "not_saved" =\r?\n\s+bradAuthorizationStatus\?\.authorized\r?\n\s+\? "saved"\r?\n\s+: bradAuthorizationStatus && bradAuthorizationStatus\.record\r?\n\s+\? "unsaved_changes"\r?\n\s+: "not_saved";/.test(page));

// ── 5. No new GHL call or write on the page (pinned, no git) ─────────────────
// Static count of GHL-client call sites (`ghl.<area>.<op>(`) and appWriteFetch(
// in ContractWorkspace.tsx: 24 at b9a84f2 (blob fd5c3e01051418cf3caf60c1278e181cd10e1fad)
// and at 529b145. A new read or write call fails this; a deliberate change
// must update the pin in the same commit. Scope: these call patterns only.
const CLIENT_CALLS = /appWriteFetch\(|\bghl\.[A-Za-z]+\.[A-Za-z]+\(/g;
check('no new GHL client or write call on the page (pinned 24)', (page.match(CLIENT_CALLS) || []).length === 24, (page.match(CLIENT_CALLS) || []).length);

// ── 6. Slice provenance from CHECKED-IN material (runs in every mode) ────────
// scripts/fixtures/b15-21-slice-provenance.json records the pinned slice
// b9a84f2 -> 529b145 (blobs, changed files, the exact removed/added lines).
// It is verified by a pinned sha256 (LF-normalised), so missing or altered
// material FAILS LOUDLY; nothing is skipped and no git or network is needed.
// This proves what the B15-21 slice itself changed and that its display
// additions are present in this tree; it is NOT a claim that the final
// combined gates are unchanged -- sections 4-5 check those directly.
const FIXTURE = path.join(APP, 'scripts', 'fixtures', 'b15-21-slice-provenance.json');
const FIXTURE_SHA256 = '027bd01195597a1d3f24e40e7817e650eee68dea1d1569e7e7c6528697215139';
let fx = null;
if (!fs.existsSync(FIXTURE)) {
  check('provenance material present (scripts/fixtures/b15-21-slice-provenance.json)', false, 'missing -- provenance cannot be proven');
} else {
  const raw = fs.readFileSync(FIXTURE, 'utf8').replace(/\r\n/g, '\n');
  const sha = require('crypto').createHash('sha256').update(raw).digest('hex');
  check('provenance material is the pinned, unaltered record', sha === FIXTURE_SHA256, sha);
  if (sha === FIXTURE_SHA256) fx = JSON.parse(raw);
}
if (fx) {
  check('provenance: slice is b9a84f2 -> 529b145 on the page', fx.base === 'b9a84f2ad1a3a350ebe1ba233220222ebeca0796' && fx.slice === '529b145cbedabd45847b49110e16ececdc1180a2' && fx.file === 'app/src/pages/ContractWorkspace.tsx');
  check('provenance: the slice replaced exactly five display lines', fx.removed.length === 5, fx.removed.length);
  check('provenance: the replaced lines are the heading, two unresolved texts, the title input and the artifact-none sentence',
    fx.removed.length > 0 && fx.removed.every((l) => /Contract Ready<\/h1>|text: "Unresolved", color|\{l\.text \?\? "Unresolved"\}\s*$|testId="contract-fact-input-title-company"|Not yet generated for this revision -- generate before authorizing\./.test(l)), fx.removed);
  check('provenance: no added line touches a gate, write, handler or validation',
    fx.added.length > 0 && !fx.added.some((l) => /disabled=|eligib|persist|ghl\.|await |onClick=|setGroupError|handle[A-Z]|evaluate[A-Z]|authorized\s*[=:]/.test(l)));
  check('provenance: the slice changed only the page and this test',
    JSON.stringify(fx.changedFiles) === JSON.stringify(['app/scripts/test-b15-21-contract-display.cjs', 'app/src/pages/ContractWorkspace.tsx']), fx.changedFiles);
  const missingAdds = fx.added.filter((l) => l.trim() !== '' && !page.includes(l.trim()));
  check('provenance: every line the slice added is present in this tree', missingAdds.length === 0, missingAdds);
}

// ── 7. Optional reviewer cross-check against git (explicit, never silent) ────
// `--provenance-git` re-derives the record from the pinned commits and requires
// an exact match. Missing commits FAIL LOUDLY. Not needed in CI: section 6
// already runs on the checked-in material.
if (process.argv.includes('--provenance-git')) {
  const have = (rev) => { try { execFileSync('git', ['cat-file', '-e', `${rev}^{commit}`], { cwd: APP, stdio: 'ignore' }); return true; } catch { return false; } };
  const B = 'b9a84f2ad1a3a350ebe1ba233220222ebeca0796', S = '529b145cbedabd45847b49110e16ececdc1180a2', F = 'app/src/pages/ContractWorkspace.tsx';
  const missing = [B, S].filter((r) => !have(r));
  check('provenance-git: pinned commits present', missing.length === 0, missing.length ? `missing ${missing.join(', ')} -- fetch them` : undefined);
  if (missing.length === 0 && fx) {
    const g = (a) => execFileSync('git', a, { cwd: APP, encoding: 'utf8' });
    const d = g(['diff', '-U0', B, S, '--', `:/${F}`]).replace(/\r\n/g, '\n').split('\n');
    const actual = {
      baseBlob: g(['rev-parse', `${B}:${F}`]).trim(), sliceBlob: g(['rev-parse', `${S}:${F}`]).trim(),
      changedFiles: g(['diff', '--name-only', B, S]).trim().split('\n').sort(),
      removed: d.filter((l) => l.startsWith('-') && !l.startsWith('---')).map((l) => l.slice(1)),
      added: d.filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1)),
    };
    for (const k of Object.keys(actual)) check(`provenance-git: ${k} matches the checked-in record`, JSON.stringify(actual[k]) === JSON.stringify(fx[k]));
  }
}

console.log(`\nB15-21 contract display: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
