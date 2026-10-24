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
