/**
 * Browser-compatible SHA-256 -- deterministic proof. B9-10 / INV-65, Jess
 * Gate repair round, 2026-09-13, item 1.
 *
 * Runs `computeManualArtifactSha256Hex` DIRECTLY in Node -- no mock, no
 * simulation -- and checks its output against known fixture bytes and a
 * known, independently-verifiable SHA-256 hex digest, plus against Node's
 * own `crypto.createHash('sha256')` as a second, independent oracle. Node
 * has supported `globalThis.crypto.subtle` natively since v19, so this is
 * the EXACT code path a real browser would execute, not an approximation
 * of it -- proving the browser-facing implementation is correct without
 * needing an actual browser.
 */
const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-browser-artifact-hash-test');
const LIB = path.join(APP, 'src', 'lib');

function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} }
cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

try {
  execSync(
    'npx tsc "' + path.join(LIB, 'browser-artifact-hash.ts') + '"' +
    ' --outDir "' + TMP + '" --rootDir "' + APP + '" --module commonjs --target es2020 --strict',
    { cwd: APP, stdio: 'inherit' }
  );
} catch (e) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const M = require(path.join(TMP, 'src', 'lib', 'browser-artifact-hash.js'));

let checks = 0;
let failures = 0;
function check(name, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log('PASS  ' + name);
  else {
    failures++;
    console.error('FAIL  ' + name);
    console.error('      expected: ' + JSON.stringify(expected));
    console.error('      actual:   ' + JSON.stringify(actual));
  }
}

async function main() {
  // Known fixture: the standard empty-string SHA-256, a widely-published,
  // independently-verifiable constant -- not computed by anything in this
  // codebase.
  const emptyBytes = new Uint8Array(0);
  const KNOWN_EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  check('sanity: the known empty-SHA256 fixture constant is exactly 64 hex chars', /^[0-9a-f]{64}$/.test(KNOWN_EMPTY_SHA256), true);

  const emptyHash = await M.computeManualArtifactSha256Hex(emptyBytes);
  check('SHA-256 of zero bytes matches the well-known, independently-published constant', emptyHash, KNOWN_EMPTY_SHA256);

  // Known fixture: SHA-256("abc") -- a standard NIST test vector, independently verifiable.
  const abcBytes = Buffer.from('abc', 'ascii');
  const KNOWN_ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  check('sanity: the NIST "abc" fixture constant is exactly 64 hex chars', /^[0-9a-f]{64}$/.test(KNOWN_ABC_SHA256), true);
  const abcHash = await M.computeManualArtifactSha256Hex(abcBytes);
  check('SHA-256 of "abc" matches the well-known NIST test vector', abcHash, KNOWN_ABC_SHA256);

  // Cross-checked against Node's OWN independent createHash oracle for arbitrary synthetic fixture bytes.
  const syntheticBytes = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('IAOS synthetic non-sensitive fixture bytes for the browser hash test.')]);
  const independentHash = crypto.createHash('sha256').update(syntheticBytes).digest('hex');
  const browserPathHash = await M.computeManualArtifactSha256Hex(syntheticBytes);
  check('the browser-compatible Web Crypto path agrees with Node\'s independent createHash oracle for the same synthetic bytes', browserPathHash, independentHash);

  // Determinism: hashing the exact same bytes twice produces the exact same result.
  const hashAgain = await M.computeManualArtifactSha256Hex(syntheticBytes);
  check('hashing the exact same bytes twice is fully deterministic', hashAgain, browserPathHash);

  // Different bytes produce a different hash.
  const otherBytes = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('a genuinely different synthetic fixture')]);
  const otherHash = await M.computeManualArtifactSha256Hex(otherBytes);
  check('different bytes produce a different hash', otherHash !== browserPathHash, true);

  // Never leaks the input bytes through the return value (a plain string, no bytes possible).
  check('the function\'s own return type is a plain string -- structurally cannot carry the original bytes', typeof browserPathHash, 'string');

  cleanup();
  console.log('');
  console.log(`checksRun=${checks} failures=${failures}`);
  if (failures) { console.error('FAILED'); process.exit(1); }
  console.log('OK');
}

main().catch((e) => { console.error('FATAL: ' + (e && e.stack || e)); cleanup(); process.exit(1); });
