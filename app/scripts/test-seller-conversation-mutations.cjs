/**
 * B15-03 / INV-103 -- negative controls for test-seller-conversation-rendered.cjs.
 * Each mutation rewrites SellerConversation.tsx in the dev server only (no file
 * is touched) and MUST make the rendered suite fail on its own named check:
 *   requireanswer -- an answer is required before Next  -> a "B: Next is enabled" check fails
 *   writeonnext   -- moving sends a GHL write           -> "H: zero GHL writes" fails
 *   dropdrafts    -- moving discards typed drafts       -> "D: four typed draft answers survive" fails
 *
 * Not a CI step (same as the B15-06 focus mutation runner): each mutation
 * re-runs the whole rendered suite. Run it for review evidence.
 *
 *   node scripts/test-seller-conversation-mutations.cjs
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const EXPECT = {
  requireanswer: /^FAIL {2}B: Next is enabled on /m,
  writeonnext: /^FAIL {2}H: zero GHL writes/m,
  dropdrafts: /^FAIL {2}D: four typed draft answers survive/m,
};
let failures = 0;
for (const [name, mustFail] of Object.entries(EXPECT)) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'test-seller-conversation-rendered.cjs')], {
    env: { ...process.env, SC_CONV_MUTATION: name }, encoding: 'utf8', timeout: 12 * 60_000, maxBuffer: 32 * 1024 * 1024,
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const applied = out.includes(`NOTE  mutation ${name} applied`);
  const caught = r.status === 1 && mustFail.test(out);
  console.log(`${caught && applied ? 'PASS' : 'FAIL'}  mutation ${name}: exit ${r.status}, applied=${applied}, named check failed=${mustFail.test(out)}`);
  if (!(caught && applied)) failures += 1;
}
console.log(`\nmutations=${Object.keys(EXPECT).length} caught=${Object.keys(EXPECT).length - failures} ${failures === 0 ? 'OK' : 'FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
