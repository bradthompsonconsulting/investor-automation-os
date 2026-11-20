/**
 * B15-17 (INV-126) remaining operator copy, r3 -- Jess GO 2026-11-11.
 *
 * F4, F5, F45, F55 (and F11, F50 in Batch 7) were already resolved; this suite covers the two engineer-language
 * strings a full sweep still found, display text only:
 *   S  Seller Call: the Current Offer integrity warning (was "carrier mismatch ... immutable ... reconciliation flag on
 *      the queryable field"). The check, its two cases and its gate are unchanged.
 *   C  Contract: the disposition preview's "Photos/documents" line (was the persisted note "No photo/document carrier
 *      exists in IAOS today -- this list is honestly empty, not omitted."). The persisted documentReferencesNote written
 *      into the GHL handoff record is byte-identical and still passed into the record.
 *   R  rendered-text sweep (TypeScript AST: JSX text + displayed string/template literals) of both pages: no engineer
 *      vocabulary is shown, except the persisted record strings and the TREC term "Fixture leases".
 *
 * NEGATIVE CONTROL: `--base=<rev>` runs the same checks on <rev>'s files (git show) and must FAIL (e.g. 754a595).
 * Offline, source-only. No GHL, no network.
 */
const fs = require('fs'); const path = require('path'); const cp = require('child_process');
const APP = path.resolve(__dirname, '..');
const ts = require(path.join(APP, 'node_modules', 'typescript'));
const baseArg = process.argv.find((a) => a.startsWith('--base='));
const BASE = baseArg ? baseArg.slice('--base='.length) : null;
const read = (rel) => (BASE ? cp.execFileSync('git', ['show', `${BASE}:app/${rel}`], { cwd: APP, encoding: 'utf8', maxBuffer: 64 << 20 }) : fs.readFileSync(path.join(APP, rel), 'utf8')).replace(/\r\n/g, '\n');

const FLOOR = 14;
let checks = 0, failures = 0;
const check = (name, ok, detail) => { checks++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  ' + JSON.stringify(detail).slice(0, 300)}`); };
const count = (s, sub) => s.split(sub).length - 1;

const sc = read('src/pages/SellerCallWorkspace.tsx');
const cw = read('src/pages/ContractWorkspace.tsx');

// ── S: Seller Call integrity warning ───────────────────────────────────────
check('S1 the warning opens in operator words: "Current Offer doesn\'t match the agreed price"', sc.includes('⚠ Current Offer doesn\'t match the agreed price —{" "}'));
check('S2 both cases name the GHL field and the agreed price plainly',
  sc.includes('? `the deal\'s Current Offer field in GHL is empty, but the agreed price on record is ${moneyOrUnknown(currentOfferIntegrity.acceptedValue)}.`')
  && sc.includes(': `the deal\'s Current Offer field in GHL shows ${moneyOrUnknown(currentOfferIntegrity.opportunityValue)}, but the agreed price on record is ${moneyOrUnknown(currentOfferIntegrity.acceptedValue)}.`}'));
check('S3 the meaning is kept: the agreed price governs; no re-confirmation is requested',
  sc.includes('The agreed price above comes from the Agreement Reached record and is the one that counts. This only flags that the GHL field is out of date; you don\'t need to re-confirm the agreement.'));
check('S4 the engineer phrases are gone ("carrier mismatch", "immutable", "queryable field", "reconciliation flag")',
  !/carrier mismatch|immutable Agreement Reached record|queryable field|reconciliation flag/.test(sc));
check('S5 behaviour unchanged: the same gate, testid and opportunity_field_empty branch',
  /\{!currentOfferIntegrity\.ok \? \(\s*<div\s*data-testid="current-offer-integrity-warning"/.test(sc) && count(sc, 'currentOfferIntegrity.reason === "opportunity_field_empty"') === 1
  && count(sc, 'checkCurrentOfferIntegrity(') === 1);

// ── C: Contract disposition preview ────────────────────────────────────────
const NOTE = 'documentReferencesNote: "No photo/document carrier exists in IAOS today -- this list is honestly empty, not omitted.",';
check('C1 the persisted documentReferencesNote (written to the GHL handoff record) is byte-identical, once', count(cw, NOTE) === 1);
check('C2 the preview line shows operator text when there are no documents, the note otherwise',
  cw.includes('<li data-testid="disposition-handoff-preview-documents">Photos/documents: {pkg.documentReferences.length === 0 ? DISPOSITION_NO_DOCUMENTS_TEXT : pkg.documentReferencesNote}</li>'));
check('C3 the operator text is "not stored in IAOS yet."', cw.includes('const DISPOSITION_NO_DOCUMENTS_TEXT = "not stored in IAOS yet.";'));
check('C4 the preview no longer renders the persisted note directly', !cw.includes('<li>Photos/documents: {pkg.documentReferencesNote}</li>'));
check('C5 the record still receives the same empty documentReferences and the persisted note',
  /documentReferences: \[\] as readonly DocumentReference\[\],\n\s*documentReferencesNote: "No photo\/document carrier exists in IAOS today/.test(cw));

// ── R: rendered-text sweep ─────────────────────────────────────────────────
const ENGINEER = /\b(carrier|webhook|endpoint|payload|harness|fixture|immutable|queryable|handler|netlify)\b/i;
const ALLOWED = new Set(['Fixture leases', 'No photo/document carrier exists in IAOS today -- this list is honestly empty, not omitted.']);
function shown(src, file) {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); const out = [];
  const visit = (n) => {
    if (ts.isImportDeclaration(n)) return;
    let text = null;
    if (ts.isJsxText(n)) text = n.getText();
    else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      const p = n.parent;
      const attr = ts.isJsxAttribute(p) && /^(data-|key|style|className|href|to|id|type|role)/.test(p.name.getText());
      const key = ts.isPropertyAssignment(p) && p.name === n; const cmp = ts.isBinaryExpression(p) && /[=!]==?/.test(p.operatorToken.getText());
      if (!attr && !key && !cmp) text = n.text;
    }
    if (text && text.trim() && ENGINEER.test(text) && !ALLOWED.has(text.trim()) && !/^\/\.netlify\/functions\//.test(text.trim()) && !/^[a-z0-9]+(-[a-z0-9]+)+$/.test(text.trim())) out.push(text.trim().slice(0, 90));
    ts.forEachChild(n, visit);
  };
  visit(sf); return out;
}
const scHits = shown(sc, 'SellerCallWorkspace.tsx'); const cwHits = shown(cw, 'ContractWorkspace.tsx');
check('R1 Seller Call shows no engineer vocabulary', scHits.length === 0, scHits);
check('R2 Contract shows no engineer vocabulary (persisted record strings and the TREC term excepted)', cwHits.length === 0, cwHits);

// ── U: unchanged neighbours ────────────────────────────────────────────────
check('U1 the other persisted GHL strings are unchanged (three evidenceSummary)',
  count(cw, 'evidenceSummary: "No-reentry disposition-start handoff to Board #10, assembled from already-canonical Board #9 upstream sources."') === 1
  && count(cw, 'evidenceSummary: "Brad\'s own factual, visually-verified mapping of each required signer to its GHL provider recipient id."') === 1);
check('U2 the Optional details card is still gated on missing optional items', cw.includes('{missingOptional.length > 0 ? (') && cw.includes('Optional details IAOS does not have (listed here, never made up)'));

console.log(`\nB15-17 operator copy r3: ${checks - failures}/${checks} checks passed${BASE ? ` (negative control vs ${BASE})` : ''}`);
if (checks !== FLOOR) { console.error(`FAILED: expected ${FLOOR} checks, ran ${checks}`); process.exit(2); }
process.exitCode = failures ? 1 : 0;
