/**
 * Canonical GHL config loader for CommonJS consumers.
 *
 * app/shared/ghl-config.ts is TypeScript and is the single source of truth for
 * environment-bound identifiers. CommonJS harnesses cannot require it directly.
 * This module compiles it to a temp directory, requires the emitted JavaScript,
 * and re-exports that module unchanged.
 *
 * Modelled on app/scripts/test-underwriting-core.cjs, the proven in-repo idiom.
 *
 * BOTH the repo root and app/package.json set "type": "module", so the temp
 * directory is given its own package.json declaring commonjs. Without it, Node
 * reads the emitted .js as ESM and require() fails before anything loads.
 *
 * COMPILES AT MODULE SCOPE, so a broken source fails closed at require() time
 * rather than at the first call -- the same doctrine as iaos-runtime-config.ts.
 *
 * REFUSES BY THROWING, not by process.exit. That is a deliberate deviation from
 * the precedent: a test runner has a run to abort, a loader does not, and a
 * library that exits the host process removes the caller's ability to respond.
 *
 * THE WORKSPACE IS PID-SCOPED. Thirteen harnesses are intended to share this
 * loader, so a fixed temp path would let two concurrent processes delete each
 * other's compilation workspace. Each process gets its own directory and
 * removes only that one.
 *
 * CLEANS UP IMMEDIATELY after the require succeeds, and on every failure path.
 * Also a deliberate deviation: the precedent cleans up at end-of-run, and a
 * loader has no run to end. Once required, the module is in memory and nothing
 * on disk is needed again.
 *
 * THIS FILE CARRIES NO IDENTIFIER, NO ENVIRONMENT NAME, NO DEFAULT AND NO
 * FALLBACK. It resolves nothing itself. Selector validation, refusal on an
 * absent or unknown selector, and every identifier value belong to getConfig,
 * and its errors must reach the caller untouched.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-ghl-config-loader-' + process.pid);
const SRC = path.join(APP, 'shared', 'ghl-config.ts');
const EMITTED = path.join(TMP, 'ghl-config.js');

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}

cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

try {
  execSync(
    'npx tsc "' + SRC + '" --outDir "' + TMP + '" --module commonjs --target es2020 --strict',
    { cwd: APP, stdio: 'inherit' }
  );
} catch (e) {
  cleanup();
  throw new Error(
    '[ghl-config-loader] TypeScript compilation of ' + SRC + ' failed. Nothing was loaded.'
  );
}

if (!fs.existsSync(EMITTED)) {
  cleanup();
  throw new Error(
    '[ghl-config-loader] compilation reported success but no emitted module exists at ' +
    EMITTED + '. Nothing was loaded.'
  );
}

let loaded;
try {
  loaded = require(EMITTED);
} catch (e) {
  cleanup();
  throw e;
}

cleanup();

module.exports = loaded;
