/**
 * B15-09 / Pass 1 F23 — every configured Seller Leads stage has a display name.
 *
 * Offline, source-text check. `ghl-opportunities.ts` carries the display list
 * (name + position) the Pipeline and Dashboard use to name a stage id; a
 * configured stage missing from it renders as "Unknown" and drops out of the
 * Dashboard's per-stage counts. Under Contract was missing until this check.
 */
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(APP, p), 'utf8');

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`}`);
}

// The configured stage keys, from the GhlConfig `stages` type.
const config = read('shared/ghl-config.ts');
const typeBlock = config.match(/\n  stages: \{([\s\S]*?)\n  \};/);
check('ghl-config.ts declares a stages type block', !!typeBlock, true);
const configuredKeys = [...(typeBlock ? typeBlock[1] : '').matchAll(/^\s+(\w+): string;/gm)].map((m) => m[1]);
check('stages type declares 11 stage keys', configuredKeys.length, 11);

// The display list.
const fn = read('netlify/functions/ghl-opportunities.ts');
const listBlock = fn.match(/const STAGES = \[([\s\S]*?)\n\];/);
check('ghl-opportunities.ts has a STAGES display list', !!listBlock, true);
const rows = [...(listBlock ? listBlock[1] : '').matchAll(/id: CONFIG\.stages\.(\w+),\s*name: "([^"]+)",\s*position: (\d+)/g)]
  .map((m) => ({ key: m[1], name: m[2], position: Number(m[3]) }));

check('every configured stage key is in the display list',
  configuredKeys.filter((k) => !rows.some((r) => r.key === k)), []);
check('no display row names an unconfigured stage key',
  rows.filter((r) => !configuredKeys.includes(r.key)).map((r) => r.key), []);
check('positions are 0..n-1 in list order', rows.map((r) => r.position), rows.map((_, i) => i));
check('display names are unique', new Set(rows.map((r) => r.name)).size, rows.length);
check('Under Contract sits after Seller Offer Sent and before Seller Closed-Won',
  rows.map((r) => r.key).slice(6, 9), ['sellerOfferSent', 'underContract', 'sellerClosedWon']);

// Both stage-colour maps know every display name (cosmetic, but a missing
// name silently falls back to grey).
for (const page of ['src/pages/Pipeline.tsx', 'src/pages/Dashboard.tsx']) {
  const src = read(page);
  check(`${page} STAGE_COLOR covers every display name`,
    rows.filter((r) => !src.includes(`"${r.name}":`)).map((r) => r.name), []);
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
