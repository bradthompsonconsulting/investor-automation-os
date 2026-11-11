/**
 * H5a (B15-29, Jeff 2026-11-11) -- test-only: suites that drive the REAL handlers with LEGACY Test sessions and tokens
 * run with one IAOS sign-in OFF in both environments, whatever the committed config says.
 *
 * Why: committing TEST `oneLogin: ONE_LOGIN_ENABLED` (H5) makes every real handler require a One Login session, so a
 * suite built on the legacy write token / read cookie is refused 401 -- correct ON behaviour, but not what those suites
 * test. The suites that test one IAOS sign-in itself (test-b15-29-*) do NOT use this helper; they keep driving the
 * switch themselves (test-b15-29-one-login-server.cjs captures the committed values, then pins OFF).
 *
 * What it does (no assertion is weakened; nothing outside the test process changes):
 *   1. In this process: shared/ghl-config.ts's (or a suite's own compiled copy's, e.g. tsc --outDir) TEST and PRODUCTION objects get `oneLogin = ONE_LOGIN_DISABLED` --
 *      immediately if the module is already loaded, otherwise the moment it loads (a Module._load hook; it works with
 *      every suite's own .ts loader because it looks at the resolved file, not at how it was compiled).
 *   2. Child Node processes (a suite that re-runs itself per test, an aggregate that spawns suites, a function host):
 *      this file is added to NODE_OPTIONS (`-r <this file>`), so the pin is applied in the process that loads the config.
 *   3. esbuild bundles (test-inv67-pdf-packaging.cjs): a bundle inlines its own copy of the config, which no in-process
 *      pin reaches. pinBundle(file) rewrites exactly the committed `oneLogin: ONE_LOGIN_ENABLED,` lines in the built
 *      bundle to DISABLED -- the count must equal the number of ENABLED values committed in shared/ghl-config.ts (so at
 *      the committed OFF it finds none and changes nothing). Every other byte of the packaged artifact is untouched.
 * Inert at the committed OFF: each step sets DISABLED where DISABLED already is.
 *
 * Usage: require('./lib/one-login-legacy-pin.cjs') before anything else in the suite (it also works later).
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const CONFIG_FILE = path.resolve(__dirname, '..', '..', 'shared', 'ghl-config.ts');
const norm = (f) => path.resolve(f).toLowerCase();
const CONFIG_KEY = norm(CONFIG_FILE);
const ENABLED_LINE = /^(\s*oneLogin: )ONE_LOGIN_ENABLED,$/mg;

/* Scope (Jeff, 2026-11-11): NODE_OPTIONS reaches every descendant, so a process that is itself a one IAOS sign-in suite
   -- a test-b15-29-* entry script, or any entry script that refers to the switch -- is NEVER pinned: the helper does
   nothing there and removes itself from NODE_OPTIONS, so nothing that suite spawns is pinned either. Such suites read
   the committed values as loaded and drive the switch themselves. */
const SELF_FLAG = `-r ${JSON.stringify(__filename)}`;
/* Any form of the preload flag for this file: -r / --require, quoted or not, either slash direction. */
const ANY_SELF_FLAG = /(?:^|\s)(?:-r|--require)(?:\s+|=)(?:"[^"]*one-login-legacy-pin\.cjs"|'[^']*one-login-legacy-pin\.cjs'|\S*one-login-legacy-pin\.cjs)(?=\s|$)/g;
const hasSelf = (opts) => { ANY_SELF_FLAG.lastIndex = 0; return ANY_SELF_FLAG.test(opts); };
function stripSelf() {
  const cur = process.env.NODE_OPTIONS || '';
  const next = cur.replace(ANY_SELF_FLAG, ' ').replace(/\s+/g, ' ').trim();
  if (next) process.env.NODE_OPTIONS = next; else delete process.env.NODE_OPTIONS;
}
function isOneLoginSuite(entry) {
  if (!entry) return false;
  if (/^test-b15-29-/.test(path.basename(entry))) return true;
  try { return /ONE_LOGIN_ENABLED|ONE_LOGIN_DISABLED|\.oneLogin\b/.test(fs.readFileSync(entry, 'utf8')); } catch { return false; }
}
const ENTRY = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (isOneLoginSuite(ENTRY)) {
  stripSelf();
  module.exports = { active: false, reason: 'one IAOS sign-in suite: never pinned', entry: ENTRY,
    pin() {}, pinBundle() { throw new Error('one-login-legacy-pin: not active in a one IAOS sign-in suite'); }, committedEnabledCount: () => NaN, CONFIG_FILE };
  return;
}

const pinned = new WeakSet();
/** A ghl-config module: the source, or a copy a suite compiled itself (tsc --outDir into a temp folder). */
const isConfigFile = (file) => norm(file) === CONFIG_KEY || /[\\/]shared[\\/]ghl-config\.(ts|js|cjs)$/i.test(file);
function pin(mod) {
  if (!mod || typeof mod.getConfig !== 'function' || typeof mod.ONE_LOGIN_DISABLED !== 'string' || pinned.has(mod)) return;
  for (const env of ['test', 'production']) mod.getConfig(env).oneLogin = mod.ONE_LOGIN_DISABLED;
  pinned.add(mod);
}

// 1a. already loaded (any casing of the path)
for (const [file, m] of Object.entries(require.cache)) if (m && m.loaded && isConfigFile(file)) pin(m.exports);
// 1b. loaded later
if (!Module.__iaosOneLoginLegacyPin) {
  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    const exports = original.apply(this, arguments);
    if (typeof request === 'string' && /ghl-config(\.ts)?$/.test(request)) {
      try { if (isConfigFile(Module._resolveFilename(request, parent, isMain))) pin(exports); } catch { /* not ours */ }
    }
    return exports;
  };
  Module.__iaosOneLoginLegacyPin = true;
}
// 2. child Node processes (each one re-applies the scope rule above for its own entry script)
{
  const cur = process.env.NODE_OPTIONS || '';
  if (!hasSelf(cur)) process.env.NODE_OPTIONS = `${cur} ${SELF_FLAG}`.trim();
}

/** The number of ENABLED values committed in shared/ghl-config.ts (0 at the committed OFF, 1 under H5). */
function committedEnabledCount() { return (fs.readFileSync(CONFIG_FILE, 'utf8').replace(/\r\n/g, '\n').match(ENABLED_LINE) || []).length; }

/** 3. Rewrites a built esbuild bundle's committed ENABLED value(s) to DISABLED; returns how many were rewritten. */
function pinBundle(bundleFile) {
  const want = committedEnabledCount();
  const text = fs.readFileSync(bundleFile, 'utf8');
  const found = (text.match(ENABLED_LINE) || []).length;
  if (found !== want) throw new Error(`one-login-legacy-pin: ${path.basename(bundleFile)} carries ${found} ENABLED oneLogin value(s), the committed config ${want}`);
  if (found) fs.writeFileSync(bundleFile, text.replace(ENABLED_LINE, '$1ONE_LOGIN_DISABLED,'));
  return found;
}

module.exports = { active: true, entry: ENTRY, pin, pinBundle, committedEnabledCount, CONFIG_FILE };
