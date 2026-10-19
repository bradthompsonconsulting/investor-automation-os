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
 * the page source; wiring and "no gate changed" by source text and by the
 * exact diff against origin/main.
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
const page = REV
  ? execFileSync('git', ['show', `${REV}:app/src/pages/ContractWorkspace.tsx`], { cwd: APP, encoding: 'utf8' })
  : fs.readFileSync(path.join(APP, 'src/pages/ContractWorkspace.tsx'), 'utf8');
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

// ── 4. Gates unchanged: the exact diff against origin/main is display-only ───
if (!REV) {
  const diff = execFileSync('git', ['diff', '-U0', 'origin/main', '--', 'src/pages/ContractWorkspace.tsx'], { cwd: APP, encoding: 'utf8' });
  const removed = diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
  const added = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
  check('exactly five lines replaced (heading, two unresolved texts, title placeholder, artifact-none text)', removed.length === 5, removed.length);
  check('removed lines are the heading, the two unresolved texts, the title input and the artifact-none sentence',
    removed.every((l) => /Contract Ready<\/h1>|text: "Unresolved", color|\{l\.text \?\? "Unresolved"\}\s*$|testId="contract-fact-input-title-company"|Not yet generated for this revision -- generate before authorizing\./.test(l)), removed);
  check('no added line touches a gate, write, handler or validation',
    !added.some((l) => /disabled=|eligib|persist|ghl\.|await |onClick=|setGroupError|handle[A-Z]|evaluate[A-Z]|authorized\s*[=:]/.test(l)), added.filter((l) => /disabled=|eligib|persist|ghl\.|await |onClick=|setGroupError|handle[A-Z]|evaluate[A-Z]/.test(l)));
  const libDiff = execFileSync('git', ['diff', '--stat', 'origin/main', '--', 'src/lib', 'netlify', 'shared'], { cwd: APP, encoding: 'utf8' });
  check('no model, carrier, generation, server or config file changed', libDiff.trim() === '', libDiff);
}

console.log(`\nB15-21 contract display: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
