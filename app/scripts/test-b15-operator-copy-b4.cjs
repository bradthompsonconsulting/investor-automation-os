/**
 * Board 15 batch B4 -- operator copy and labels (Pass 1 F4, F5, F7, F9, F15,
 * F22, F25, F27, F41/F42/F46, F45, F51, F52, F55).
 *
 * Offline. Compiles the pure display helpers (src/lib/operator-display.ts)
 * and checks the surfaces that use them by source text, following this
 * repository's existing convention for UI wiring (see
 * test-call-outcome-copy.cjs / test-seller-call-workspace-wiring.cjs).
 * Every fix here is display/copy only; the checks also assert that the
 * logic each fix sits beside is unchanged.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const ROOT = path.resolve(APP, '..');
const TMP = path.join(APP, '.tmp-b15-operator-copy-b4-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"commonjs"}');
try {
  execFileSync(process.execPath, [
    path.join(APP, 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(APP, 'src/lib/operator-display.ts'),
    '--outDir', TMP, '--rootDir', APP, '--module', 'commonjs',
    '--target', 'es2020', '--strict', '--skipLibCheck',
  ], { cwd: APP, stdio: 'inherit' });
} catch (error) {
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(10);
}

const od = require(path.join(TMP, 'src/lib/operator-display.js'));
let checks = 0;
let failures = 0;
function check(name, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`}`);
  if (!ok) failures += 1;
}
const read = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8').replace(/\r\n/g, '\n');
const readRoot = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const dashboard = read('src/pages/Dashboard.tsx');
const pipeline = read('src/pages/Pipeline.tsx');
const segmentation = read('src/pages/Segmentation.tsx');
const conversations = read('src/pages/Conversations.tsx');
const contract = read('src/pages/ContractWorkspace.tsx');
const calc = read('src/pages/DealCalculator.tsx');
const underwriting = read('src/pages/UnderwritingWorkspace.tsx');
const contacts = read('src/pages/Contacts.tsx');
const convFn = read('netlify/functions/ghl-conversations.ts');
const spec = readRoot('docs/CONTACTS_OPPORTUNITIES_SPEC.md');

// ── Pure helpers ─────────────────────────────────────────────────────────
check('F9 looksLikePhone: E.164, formatted, dotted', ['+18177575598', '(817) 757-5598', '817.757.5598'].map(od.looksLikePhone), [true, true, true]);
check('F9 looksLikePhone: names and short numbers are not phones', ['Jane Doe', '123', '', 'Unit 4B'].map(od.looksLikePhone), [false, false, false, false]);
check('F9 displayContactName: empty / "(no name)" / phone -> Unnamed contact',
  ['', '   ', null, undefined, '(no name)', '+18177575598', '817-757-5598'].map(od.displayContactName),
  Array(7).fill('Unnamed contact'));
check('F9 displayContactName: a real name is shown as read (trimmed)', [od.displayContactName(' john sanchez '), od.displayContactName('Apt 3 Owner')], ['john sanchez', 'Apt 3 Owner']);
check('F51 neutral empty-preview label', od.NO_MESSAGE_TEXT, 'No message text (call or activity)');
check('F52 automated document email: exact phrase at start, case-insensitive, HTML-tolerant',
  ['DOCUMENT SIGNED SUCCESSFULLY\nYour document...', 'Document signed successfully', '  <p><b>DOCUMENT  SIGNED</b> SUCCESSFULLY</p>'].map(od.isAutomatedDocumentEmail),
  [true, true, true]);
check('F52 automated document email: conservative -- phrase elsewhere, other text, empty do NOT match',
  ['Hi Brad, DOCUMENT SIGNED SUCCESSFULLY?', 'Can you resend the document?', 'DOCUMENT SIGNED', '', null].map(od.isAutomatedDocumentEmail),
  [false, false, false, false, false]);
check('F52 phrase list is exactly the one recorded phrase', od.AUTOMATED_DOCUMENT_EMAIL_PHRASES, ['DOCUMENT SIGNED SUCCESSFULLY']);
check('F15 phoneQueryDigits: displayed formats -> digits',
  ['757-5598', '(817) 757-5598', '817.757.5598', '+1 817 757 5598', '+18177575598'].map(od.phoneQueryDigits),
  ['7575598', '8177575598', '8177575598', '18177575598', '18177575598']);
check('F15 phoneQueryDigits: digits-only at any length unchanged', ['6', '61', '2149146151'].map(od.phoneQueryDigits), ['6', '61', '2149146151']);
check('F15 phoneQueryDigits: names, emails, short punctuated, mixed -> null (name/email branch)',
  ['john', 'bradt75@gmail.com', '1-2', '817-ABC', 'Unit 4', '-', ''].map(od.phoneQueryDigits),
  [null, null, null, null, null, null, null]);

// ── F4 / F5 Dashboard intro and Lead Queue explanation ─────────────────
check('F4 Dashboard intro is the operator one-liner', /<p[^>]*>\n\s+What needs your attention today\.\n\s+<\/p>/.test(dashboard), true);
check('F4 internal write-count copy removed from the Dashboard', /Only three writes happen/.test(dashboard), false);
check('F5 Lead Queue has one short operator sentence', /Sellers to cold-call next, top of the list first\./.test(dashboard), true);
check('F5 full ordering rules kept, collapsed under "How this list is ordered"',
  /<details[^>]*>\n\s+<summary[^>]*>How this list is ordered<\/summary>\n\s+<p[^>]*>\n\s+Attempted-but-no-response \(oldest attempt first\)/.test(dashboard), true);

// ── F7 tier pills vs Lead Queue ─────────────────────────────────────────
check('F7 tier pills labelled as contact counts', />Contacts by temperature</.test(dashboard), true);
check('F7 bucketCounts still counts every contact (logic unchanged)',
  /const bucketCounts = useMemo\(\(\) => \{\n\s+const counts: Record<BucketTag, number> = \{ hot: 0, warm: 0, low: 0 \};\n\s+\(contacts \?\? \[\]\)\.forEach\(\(c\) => counts\[getBucketTag\(c\)\]\+\+\);/.test(dashboard), true);
check('F7 Lead Queue hint names who is elsewhere or left out',
  /Not every contact is here\.[\s\S]{0,400}callback[\s\S]{0,200}recent call result[\s\S]{0,200}no\s+phone, a wrong number, Do Not Call/.test(dashboard), true);
check('F7 Lead Queue filter unchanged (phone required, exclusion set)',
  /\.filter\(\(c\) => c\.phone\?\.trim\(\) && !coldOutreachExcludedIds\.has\(c\.id\)\)/.test(dashboard), true);

// ── F9 / F51 Dashboard Unanswered Inbound ───────────────────────────────
check('F9 Unanswered Inbound name goes through displayContactName', /\{displayContactName\(r\.contactName\)\}/.test(dashboard), true);
check('F9 formatted phone line kept', /\{formatPhone\(r\.phone\) \|\| r\.email \|\| "—"\}/.test(dashboard), true);
check('F51 Dashboard and Conversations no longer show "(no preview)"', /\(no preview\)/.test(dashboard + conversations), false);
check('F51 Dashboard empty preview uses the neutral label', /\{r\.preview \|\| <em[^>]*>\{NO_MESSAGE_TEXT\}<\/em>\}/.test(dashboard), true);
check('F51 Conversations empty preview uses the neutral label', /\{t\.preview \|\| NO_MESSAGE_TEXT\}/.test(conversations), true);
check('F51/F9 ghl-conversations unchanged: no type field read, name fallback as before',
  !/lastMessageType/.test(convFn) && (convFn.match(/c\.contactName \|\| c\.fullName \|\| "\(no name\)"/g) || []).length === 2, true);

// ── F52 automated document emails ───────────────────────────────────────
check('F52 Email section splits real vs automated with the shared rule',
  /const realEmails\s+= useMemo\(\(\) => emails\.filter\(\(m\) => !isAutomatedDocumentEmail\(m\.body\)\)/.test(conversations)
  && /const automatedEmails = useMemo\(\(\) => emails\.filter\(\(m\) => isAutomatedDocumentEmail\(m\.body\)\)/.test(conversations), true);
check('F52 automated emails render behind a collapsed group, not dropped',
  /\{realEmails\.map\(/.test(conversations) && /<AutomatedEmailGroup key=\{selected\.conversationId\} emails=\{automatedEmails\} \/>/.test(conversations)
  && /<details onToggle=[\s\S]{0,300}automated document email/.test(conversations), true);
check('F52 Email count still counts every email', /count=\{messages \? emails\.length : null\}/.test(conversations), true);

// ── F22 / F27 Segmentation ──────────────────────────────────────────────
check('F22 Segmentation phone formatted', /\{formatPhone\(contact\.phone\) \|\| contact\.email \|\| "—"\}/.test(segmentation), true);
check('F22 no raw phone render left', /\{contact\.phone \|\|/.test(segmentation), false);
check('F27 Segmentation intro is operator copy', /Leads grouped by temperature \(Hot \/ Warm \/ Low\)\. Read-only\./.test(segmentation), true);
check('F27 internal scoring-function copy removed', /Tiers are assigned by the scoring function/.test(segmentation), false);

// ── F25 Pipeline ────────────────────────────────────────────────────────
check('F25 per-row "Read-only" cell and Access header removed', /<span>Read-only<\/span>|>\s*Access\s*</.test(pipeline), false);
check('F25 one read-only note near the heading', /Read-only view of the Seller Leads Pipeline\./.test(pipeline), true);
check('F25 table is three columns (empty-state colSpan, skeleton cells)', /colSpan=\{3\}/.test(pipeline) && /\{\[160, 160, 120\]\.map/.test(pipeline), true);

// ── F55 Contract workspace ──────────────────────────────────────────────
const contractRendered = contract.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
check('F55 no "Board #" or "INV-65" in rendered Contract text (outside evidenceSummary)',
  contractRendered.split('\n').filter((l) => /Board #|INV-65/.test(l) && !/evidenceSummary:/.test(l)), []);
check('F55 plain-term replacements present',
  /The contract begins once the seller has accepted a price/.test(contract) && /Start Disposition -- hand off to buyer disposition/.test(contract)
  && /Buyer disposition can now use handoff id/.test(contract) && /Every contract-execution requirement passes/.test(contract), true);
check('F55 persisted disposition evidenceSummary deliberately unchanged',
  /evidenceSummary: "No-reentry disposition-start handoff to Board #10, assembled from already-canonical Board #9 upstream sources\.",/.test(contract), true);

// ── F45 raw keys -> labels ──────────────────────────────────────────────
check('F45 Contract provenance uses a label', /Provenance: \{AUTHORITY_LABEL\[screen\.economics\.authority\] \?\? screen\.economics\.authority\}/.test(contract), true);
check('F45 Contract authorization diff uses group/field labels', /\{GROUP_LABEL_BY_KEY\[d\.group\] \?\? d\.group\} — \{FIELD_LABELS\[`\$\{d\.group\}\.\$\{d\.field\}`\] \?\? d\.field\}/.test(contract), true);
check('F45 Contract BLOCKED stage uses a label', /\{VERIFICATION_STAGE_LABEL\[fullVerificationResult\.failure\.stage\] \?\? fullVerificationResult\.failure\.stage\}/.test(contract), true);
// F45 Underwriting partial-save carrier labels: owned by PR #123 (test-b15-operator-copy.cjs), not duplicated here.

// ── F41 / F42 / F46 Deal Calculator ─────────────────────────────────────
check('F41 Deal Calculator title area says nothing is saved', /Scratchpad -- nothing here is saved\./.test(calc), true);
check('F42/F46 practice-figures note under the figure bar',
  /data-testid="deal-calc-practice-figures-note"[\s\S]{0,200}Practice figures: the repairs, offer and spread here do not change the deal\./.test(calc), true);
check('F42/F46 Underwriting legend line near the decision figures',
  /data-testid="underwriting-figures-legend"[\s\S]{0,300}the Deal Calculator is practice only and never changes them\./.test(underwriting), true);
const estimatorStart = underwriting.indexOf('function RepairEstimator(');
const legendAt = underwriting.indexOf('underwriting-figures-legend');
const estimatorEnd = underwriting.indexOf('\n}\n', estimatorStart);
check('F42/F46 legend sits outside the repair-estimator region', estimatorStart > 0 && legendAt > estimatorEnd, true);

// ── F15 Contacts search ─────────────────────────────────────────────────
check('F15 Contacts search uses phoneQueryDigits for the phone branch',
  /const phoneDigits = phoneQueryDigits\(q\);\n\s+if \(phoneDigits !== null\) \{\n\s+return ordered\.filter\(\(r\) => r\.phone\.replace\(\/\\D\/g, ""\)\.includes\(phoneDigits\)\);/.test(contacts), true);
check('F15 name/email substring branch unchanged',
  /r\.name\.toLowerCase\(\)\.includes\(lc\) \|\|\n\s+r\.phone\.toLowerCase\(\)\.includes\(lc\) \|\|\n\s+r\.email\.toLowerCase\(\)\.includes\(lc\)/.test(contacts), true);
check('F15 spec amendment dated and original text preserved',
  /\*\*Consequence \(ACCEPTED for V1\):\*\*/.test(spec) && /Amendment \(2026-10-04, Jess\): formatted-phone search brought into scope for Board 15 Pass 1 F15\./.test(spec), true);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nBoard 15 B4 operator copy and labels: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
