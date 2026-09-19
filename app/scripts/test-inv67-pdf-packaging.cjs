'use strict';

/**
 * Board #9 Phase B packaging correction -- proves the REAL, esbuild-bundled
 * Netlify Function artifact (not the TypeScript require shim every other
 * test in this repo uses) behaves correctly, closing the exact regression
 * observed against a live deploy-preview: `ghl-write.ts` (and
 * `generate-contract-pdf.ts`) 502'd on EVERY request, including a plain
 * unauthenticated one, because a module-scope `require()` of the INV-67
 * PDF runtime resolved and validated the canonical source PDF's on-disk
 * path eagerly at import time -- before requireAppWriter or
 * requireAppWriteOrigin ever ran.
 *
 * BUNDLED WITH esbuild, exactly mirroring test-generate-contract-pdf-
 * adapter.cjs's own established technique (see that file's header) and
 * how Netlify's own esbuild-based function bundler packages these same
 * files for real deployment.
 *
 * FIXTURES ONLY -- no GHL call, no network call, no Production data. Every
 * GHL read is a mocked, in-memory fixture (global.fetch).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const ts = require('typescript');
const Module = require('node:module');
const { execFileSync } = require('child_process');

const APP = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(APP, '..');
const ESBUILD_BIN = path.join(APP, 'node_modules', '.pnpm', 'esbuild@0.25.12', 'node_modules', 'esbuild', 'bin', 'esbuild');
// ONE canonical PDF, packaged directly -- never a second committed copy.
const SOURCE_PDF_FILENAME = 'TREC Resale Home Contract.pdf';
const CANONICAL_PDF_SOURCE = path.join(REPO_ROOT, 'docs', SOURCE_PDF_FILENAME);
const PINNED_SOURCE_SHA256 = '3f458518e9e01fc9c84cab420dcd0ce9793113c4b356ed5caf7a2fb1bdef2ca5';

// Deliberately OUTSIDE this repo's own directory tree (os.tmpdir(), not a
// subdirectory of APP) -- a real deployed Lambda's filesystem contains
// ONLY the bundle plus whatever `included_files` actually placed, with no
// access back to this repo's checkout at all. Bundling under APP would let
// inv67-pdf-render-core.cjs's own candidate #1 (this file's real on-disk
// location, a LOCAL-DEV-ONLY fallback) accidentally keep finding the real
// repo-root docs/ folder via a coincidentally-matching `../../../` climb,
// silently defeating the entire "missing PDF" proof below.
//
// TWO SEPARATE roots, not one shared tree: `ghl-write` and
// `generate-contract-pdf` share BUNDLE_ROOT (their bundles sit in their
// own subdirectories, with a single `docs/` placed at BUNDLE_ROOT itself
// -- one level above each, matching netlify.toml's `../docs/` ->
// candidate #3 layout). The PDF-less `generate-contract-pdf` variant gets
// its OWN, entirely separate root (NO_PDF_ROOT) so it can never
// accidentally inherit BUNDLE_ROOT's shared docs/ folder via the same
// `__dirname/../docs/` climb.
const BUNDLE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'inv67-pdf-packaging-test-'));
const NO_PDF_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'inv67-pdf-packaging-test-no-pdf-'));

function cleanup() {
  try { fs.rmSync(BUNDLE_ROOT, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(NO_PDF_ROOT, { recursive: true, force: true }); } catch (_) {}
}

let checks = 0, failures = 0;
function check(name, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log('PASS  ' + name);
  else { failures++; console.error('FAIL  ' + name); console.error('      expected: ' + JSON.stringify(expected)); console.error('      actual:   ' + JSON.stringify(actual)); }
}
function checkTrue(name, actual) { check(name, actual, true); }

process.env.IAOS_ENV = 'test';
process.env.IAOS_APP_WRITE_GOOGLE_CLIENT_ID = 'offline-client';
process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN = 'https://proof.example.invalid';
process.env.IAOS_APP_WRITE_BRAD_EMAILS = 'brad@example.invalid';
process.env.IAOS_APP_WRITE_SESSION_SECRET = 'offline-fixture-only-not-a-real-secret';
process.env.GHL_PRIVATE_API_KEY = 'offline-fixture';
process.env.GHL_API_TOKEN = 'offline-fixture';

// TS-transpile shim, ONLY for loading app-write-auth.ts to mint a valid
// session token -- that file has no runtime require() dependency outside
// the compiled set, so it is not itself part of the packaging proof.
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  if (name.startsWith('.') && parent) {
    const candidate = path.resolve(path.dirname(parent.filename), name + '.ts');
    if (fs.existsSync(candidate)) return candidate;
  }
  return originalResolve.call(this, name, parent, ...rest);
};
Module._extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText,
    filename,
  );
const authLib = require('../netlify/functions/lib/app-write-auth.ts');
const config = require('../shared/ghl-config.ts').getConfig('test');
const load = (name) => require('../src/lib/' + name + '.ts');

const APPROVED_ORIGIN = process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN;
function validToken() { return authLib.issueAppSession('brad@example.invalid').token; }

(async () => {
  // BUNDLE_ROOT already exists (mkdtempSync, above) -- no recreation needed.

  // ============================================================
  // 0. ONE canonical PDF, tracked exactly once -- not a packaged
  //    duplicate. `git ls-files` (read-only) is the authoritative,
  //    tracked-file source of truth; a plain filesystem search could be
  //    fooled by a build artifact or an ignored stray copy.
  // ============================================================
  const trackedMatches = execFileSync('git', ['ls-files', '--', `*${SOURCE_PDF_FILENAME}`], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n').map((l) => l.trim()).filter(Boolean);
  check('exactly one tracked canonical TREC source PDF exists in the repository', trackedMatches.length, 1);
  check('the single tracked copy is the repo-root canonical location, never a packaged duplicate under app/', trackedMatches[0], 'docs/' + SOURCE_PDF_FILENAME);
  checkTrue('no duplicate PDF exists under app/netlify/functions/docs/ (removed, never re-created)', !fs.existsSync(path.join(APP, 'netlify', 'functions', 'docs')));
  const crypto = require('crypto');
  const canonicalHash = crypto.createHash('sha256').update(fs.readFileSync(CANONICAL_PDF_SOURCE)).digest('hex');
  check('the single canonical source PDF\'s SHA-256 matches the pinned hash', canonicalHash, PINNED_SOURCE_SHA256);

  // ============================================================
  // Bundle both real Netlify Function entry points with esbuild --
  // exactly mirroring Netlify's own bundler, and test-generate-contract-
  // pdf-adapter.cjs's established technique.
  // ============================================================
  const GHL_WRITE_SOURCE = path.join(APP, 'netlify', 'functions', 'ghl-write.ts');
  const GENERATE_PDF_SOURCE = path.join(APP, 'netlify', 'functions', 'generate-contract-pdf.ts');
  // Both bundles are siblings directly under BUNDLE_ROOT -- netlify.toml's
  // `../docs/` (relative to base dir app/) lands the included file at
  // BUNDLE_ROOT/docs/, one level ABOVE each function's own subdirectory,
  // exactly matching candidate #3 (`__dirname/../docs/...`) for BOTH.
  const ghlWriteDir = path.join(BUNDLE_ROOT, 'ghl-write');
  const generatePdfDir = path.join(BUNDLE_ROOT, 'generate-contract-pdf');
  const generatePdfNoPdfDir = path.join(NO_PDF_ROOT, 'generate-contract-pdf');
  fs.mkdirSync(ghlWriteDir, { recursive: true });
  fs.mkdirSync(generatePdfDir, { recursive: true });
  fs.mkdirSync(generatePdfNoPdfDir, { recursive: true });
  // .cjs, not .js -- app/package.json declares "type": "module", so a
  // bundled .js output is (wrongly) loaded as ESM by Node, breaking the
  // bundle's own CJS module.exports (esbuild's --format=cjs notwithstanding).
  // test-generate-contract-pdf-adapter.cjs's own bundle output already
  // established this exact convention.
  const ghlWriteBundlePath = path.join(ghlWriteDir, 'ghl-write.cjs');
  // esbuild-bundled twice into separate directories -- one WITH the
  // simulated included_files asset placement, one WITHOUT -- so the
  // "missing PDF fails closed" proof (item 5) starts from a bundle that
  // genuinely has no PDF on disk, not merely a deleted file.
  const generatePdfBundlePath = path.join(generatePdfDir, 'generate-contract-pdf.cjs');
  const generatePdfNoPdfBundlePath = path.join(generatePdfNoPdfDir, 'generate-contract-pdf.cjs');

  console.log('Bundling ghl-write.ts with esbuild (mirrors Netlify\'s own bundler)...');
  execFileSync(process.execPath, [ESBUILD_BIN, GHL_WRITE_SOURCE, '--bundle', '--platform=node', '--format=cjs', '--target=node18', `--outfile=${ghlWriteBundlePath}`], { cwd: APP, stdio: 'inherit' });
  checkTrue('esbuild bundled ghl-write.ts with zero errors', fs.existsSync(ghlWriteBundlePath));

  console.log('Bundling generate-contract-pdf.ts with esbuild (WITH simulated included_files)...');
  execFileSync(process.execPath, [ESBUILD_BIN, GENERATE_PDF_SOURCE, '--bundle', '--platform=node', '--format=cjs', '--target=node18', `--outfile=${generatePdfBundlePath}`], { cwd: APP, stdio: 'inherit' });
  checkTrue('esbuild bundled generate-contract-pdf.ts with zero errors', fs.existsSync(generatePdfBundlePath));

  console.log('Bundling generate-contract-pdf.ts with esbuild (WITHOUT the PDF asset, for the fail-closed proof)...');
  execFileSync(process.execPath, [ESBUILD_BIN, GENERATE_PDF_SOURCE, '--bundle', '--platform=node', '--format=cjs', '--target=node18', `--outfile=${generatePdfNoPdfBundlePath}`], { cwd: APP, stdio: 'inherit' });
  checkTrue('esbuild bundled the no-PDF variant with zero errors', fs.existsSync(generatePdfNoPdfBundlePath));

  // Simulates the REAL deployment asset layout netlify.toml's
  // `included_files = ["../docs/TREC Resale Home Contract.pdf"]` now
  // declares: ONE shared `docs/` directory at BUNDLE_ROOT, one level
  // ABOVE both function bundles -- candidate #3 of inv67-pdf-render-
  // core.cjs's own resolveCanonicalSourcePdfPath(), packaging the SAME
  // repo-root canonical file directly (never a copy). Deliberately not
  // simulated anywhere under NO_PDF_ROOT.
  const sharedDocsDir = path.join(BUNDLE_ROOT, 'docs');
  fs.mkdirSync(sharedDocsDir, { recursive: true });
  fs.copyFileSync(CANONICAL_PDF_SOURCE, path.join(sharedDocsDir, SOURCE_PDF_FILENAME));

  // ============================================================
  // 1. Packaged ghl-write loads and returns 401 unauthenticated, never
  //    502 -- proves the module-scope PDF-runtime crash is gone. No GHL
  //    or Blob mock needed: requireAppWriter throws before either is ever
  //    touched.
  // ============================================================
  const ghlWrite = require(ghlWriteBundlePath);
  checkTrue('the packaged ghl-write bundle exports a handler', typeof ghlWrite.handler === 'function');
  {
    const res = await ghlWrite.handler({ httpMethod: 'POST', headers: {}, body: '{}' });
    check('packaged ghl-write: unauthenticated request returns 401, never 502', res.statusCode, 401);
  }

  // ============================================================
  // 2. Packaged ghl-write can execute a harmless non-generation rejection
  //    path (past auth+Origin, rejected at body validation) WITHOUT ever
  //    resolving the PDF -- this bundle directory's docs/ folder is
  //    present, but an operation that never reaches write-derived-note's
  //    authorization branch must not depend on it either way. Proven by
  //    the response being a clean, expected 400 rather than a crash.
  // ============================================================
  {
    const res = await ghlWrite.handler({
      httpMethod: 'POST',
      headers: { origin: APPROVED_ORIGIN, authorization: `Bearer ${validToken()}` },
      body: JSON.stringify({ operation: 'workflow.execute', targetId: 'x', requestId: 'packaging-proof-1', args: {} }),
    });
    check('packaged ghl-write: an authenticated, correctly-Origin\'d, but rejected operation returns a clean 400, never 502', res.statusCode, 400);
  }

  // ============================================================
  // 3. Packaged generate-contract-pdf reaches its 401/403 boundaries
  //    WITHOUT loading or generating the PDF -- proven against the
  //    no-PDF-asset bundle specifically: if these gates somehow required
  //    the PDF, this variant would 502, not 401/403.
  // ============================================================
  const generatePdfNoPdf = require(generatePdfNoPdfBundlePath);
  {
    const res = await generatePdfNoPdf.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ opportunityId: 'x' }) });
    check('packaged generate-contract-pdf (no PDF asset present): unauthenticated returns 401, never 502', res.statusCode, 401);
  }
  {
    const res = await generatePdfNoPdf.handler({ httpMethod: 'POST', headers: { origin: 'https://wrong.example.invalid', authorization: `Bearer ${validToken()}` }, body: JSON.stringify({ opportunityId: 'x' }) });
    check('packaged generate-contract-pdf (no PDF asset present): wrong Origin returns 403, never 502', res.statusCode, 403);
  }

  // ============================================================
  // 4/6. A fully valid mocked Test request can locate the packaged
  //      canonical PDF and generate real evidence -- against the bundle
  //      WITH the simulated included_files placement. Canonical source
  //      SHA verification remains enforced (unweakened) throughout.
  // ============================================================
  const contact = { id: config.documentsContracts.approvedTestContactId, locationId: config.locationId, customFields: [], firstName: 'Jane', lastName: 'Seller', email: 'seller@example.com', address1: '123 Main St', city: 'Austin', state: 'TX', postalCode: '78701' };
  const opportunity = { id: 'fixture-opportunity-packaging-proof', contactId: contact.id, locationId: config.locationId, customFields: [{ id: config.opportunityFacts.currentOffer, fieldValue: 190000 }] };
  const fixture = require('./write-contract-fixture.cjs').contractFixture(load, opportunity.id);
  const notes = [...fixture.notes];
  const reply = (data) => ({ ok: true, status: 200, json: async () => structuredClone(data), text: async () => JSON.stringify(data) });
  global.fetch = async (url) => {
    const u = new URL(url);
    if (u.origin !== 'https://services.leadconnectorhq.com') throw new Error('no external network');
    if (u.pathname === '/opportunities/' + opportunity.id) return reply({ opportunity });
    if (u.pathname === '/contacts/' + contact.id) return reply({ contact });
    if (u.pathname === '/contacts/' + contact.id + '/notes') return reply({ notes });
    throw new Error('Unexpected mocked request ' + u.pathname);
  };

  const generatePdf = require(generatePdfBundlePath);
  const validRes = await generatePdf.handler({
    httpMethod: 'POST',
    headers: { origin: APPROVED_ORIGIN, authorization: `Bearer ${validToken()}` },
    body: JSON.stringify({ opportunityId: opportunity.id }),
  });
  check('packaged generate-contract-pdf: a fully valid request succeeds (200), locating the packaged canonical PDF', validRes.statusCode, 200);
  const validBody = JSON.parse(validRes.body || '{}');
  checkTrue('the packaged bundle returned real generator evidence (outputSha256)', /^[0-9a-f]{64}$/.test(validBody.evidence && validBody.evidence.outputSha256));
  check('canonical source SHA verification remains enforced through the packaged bundle (unweakened, matches the pinned hash)', validBody.evidence && validBody.evidence.sourceSha256, PINNED_SOURCE_SHA256);
  checkTrue('the packaged bundle returned non-empty PDF bytes', typeof validBody.pdfBase64 === 'string' && validBody.pdfBase64.length > 100000);

  // ============================================================
  // 5. Missing packaged PDF fails closed -- the SAME valid request against
  //    the deliberately PDF-less bundle variant must fail closed (a clean
  //    409 from generate-contract-pdf.ts's own catch-all), never a 502 or
  //    an uncaught crash, and never a fabricated/partial success.
  // ============================================================
  const missingRes = await generatePdfNoPdf.handler({
    httpMethod: 'POST',
    headers: { origin: APPROVED_ORIGIN, authorization: `Bearer ${validToken()}` },
    body: JSON.stringify({ opportunityId: opportunity.id }),
  });
  check('packaged generate-contract-pdf (no PDF asset present): a fully valid request still fails closed (409), never 502 or a fabricated success', missingRes.statusCode, 409);
  const missingBody = JSON.parse(missingRes.body || '{}');
  checkTrue('the fail-closed response names the missing canonical PDF explicitly', /Cannot locate the canonical source PDF/.test(missingBody.error || ''));

  cleanup();

  console.log('');
  console.log(checks + ' checks, ' + failures + ' failures.');
  console.log('No live write, GHL mutation, deployment, or Production access occurred in this run -- every fixture above is an in-memory object and global.fetch is fully mocked.');
  if (failures > 0) process.exitCode = 1;
})().catch((e) => { console.error(e); cleanup(); process.exitCode = 1; });
