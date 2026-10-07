#!/usr/bin/env node
/**
 * Storage correction (plan v6 §12) -- the probes are NOT deployed to
 * Production. Netlify bundles functions after the build command, so on every
 * build that is not the Test site (`SITE_NAME === "iaos-app-test"`, which
 * Netlify sets at build time) the probe functions are removed from the build
 * workspace and their absence is verified; any failure FAILS the build.
 * Default-deny: an unknown site is treated as Production.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const PROBES = ['storage-probe.ts', 'probe-limit.ts'];
function guard(env = process.env, dir = path.join(__dirname, '..', 'netlify', 'functions')) {
  if (env.SITE_NAME === 'iaos-app-test') return { kept: true };
  for (const f of PROBES) { const p = path.join(dir, f); if (fs.existsSync(p)) fs.rmSync(p); }
  const left = PROBES.filter((f) => fs.existsSync(path.join(dir, f)));
  if (left.length) throw new Error('Probe functions present in a non-Test build: ' + left.join(', '));
  return { kept: false };
}
if (require.main === module) {
  try { const r = guard(); console.log(r.kept ? 'production-build-guard: Test site, probes kept' : 'production-build-guard: probes removed and verified absent'); }
  catch (e) { console.error('production-build-guard FAILED:', e.message); process.exit(1); }
}
module.exports = { guard, PROBES };
