/**
 * Bones step 070 -- NEGATIVE CONTROL for the receipt-recorder-shim adoption in the B15-04 property-answer harnesses.
 *
 * Runs a temporary copy of test-property-answer-recovery.cjs with ONLY the adapter removed (the @netlify/blobs stub
 * returned unwrapped, exactly as before step 070). Main's recorded receipt helpers then never see their recorder used,
 * so the contact lock reads as unresolved and the suite must FAIL with the original refusal ("code":"locked"). The
 * unmodified suite (with the adapter) is run by CI separately and must pass. Offline; no network.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
let checks = 0, failures = 0;
const check = (name, ok, detail) => { checks++; if (!ok) failures++; console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  ' + String(detail).slice(0, 300)}`); };

const SUITE = path.join(__dirname, 'test-property-answer-recovery.cjs');
const WRAPPED = "if (name === '@netlify/blobs') return receiptShim.wrap({ connectLambda: (event) => realBlobs.connectLambda(event), getStore: () => memStore });";
const ORIGINAL = "if (name === '@netlify/blobs') return { connectLambda: (event) => realBlobs.connectLambda(event), getStore: () => memStore };";
const src = fs.readFileSync(SUITE, 'utf8');
check('the suite under control uses the adapter exactly once', src.split(WRAPPED).length === 2);
const tmp = path.join(__dirname, `.tmp-shim-removed-recovery-${process.pid}.cjs`);
fs.writeFileSync(tmp, src.replace(WRAPPED, () => ORIGINAL));
let r;
try { r = spawnSync(process.execPath, [tmp], { encoding: 'utf8', timeout: 300_000 }); } finally { fs.rmSync(tmp, { force: true }); }
const out = `${r.stdout || ''}${r.stderr || ''}`;
const failed = (out.match(/^FAIL /gm) || []).length;
check('adapter REMOVED: the recovery suite fails (non-zero exit)', r.status !== 0, `exit ${r.status}`);
check('adapter REMOVED: failures carry the original lock refusal ("code":"locked")', /"code":"locked"/.test(out), out.slice(0, 300));
check('adapter REMOVED: more than one scenario fails (the original 8 of 21)', failed >= 2, `failed=${failed}`);
check('the temporary copy was removed', !fs.existsSync(tmp));
console.log(`\nB15-04 step-070 receipt-shim negative control: ${checks - failures}/${checks} checks passed${failures ? ` (failures=${failures})` : ''} [adapter-removed run: exit ${r.status}, ${failed} failing scenarios]`);
process.exit(failures ? 1 : 0);
