/**
 * B15-03 / INV-103 -- negative controls for test-seller-conversation-rendered.cjs.
 * Each mutation rewrites SellerConversation.tsx in the dev server only (no file
 * is touched) and MUST make the rendered suite fail on its own named check:
 *   requireanswer -- an answer is required before Next  -> a "B: Next is enabled" check fails
 *   writeonnext   -- moving sends a GHL write           -> "H: zero GHL writes" fails
 *   dropdrafts    -- moving discards typed drafts       -> "D: four typed draft answers survive" fails
 *   sharedkey     -- drafts in one shared store/key      -> "I: B's price draft field is empty" fails (Bones P2-3)
 *   stalesource   -- the page applies a late old read    -> "I: after A's late reads land" fails (Bones P2-3)
 *   sametab       -- the repair estimate replaces the page -> "P2-1: it opens in a new tab" fails
 *   (recapsaved retired with the superseded P2-2 recap; Captain C8 2026-11-03)
 *   summarymissing    -- Summary drops General notes        -> "SUM: Summary shows the call note" fails
 *   summaryunanswered -- Summary prints Unanswered for blanks -> "SUM: a blank answer stays blank" fails
 *   summarystale      -- Summary reads another copy          -> "SUM: every Summary answer equals the editable Call notes value" fails
 *   notesdiverge  -- Call notes edit a separate copy      -> "SA notes: typing in the notes shows in the card" fails (slice A)
 *   unsavedlabel  -- GHL controls stop saying NOT SAVED   -> "SA GHL: the Occupancy control ... NOT SAVED" fails (slice A)
 *   headingnav    -- a note heading stops navigating      -> "SA notes: selecting a note heading opens that question" fails (slice A)
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
  sharedkey: /^FAIL {2}I: B's price draft field is empty/m,
  stalesource: /^FAIL {2}I: after A's late reads land/m,
  sametab: /^FAIL {2}P2-1: it opens in a new tab/m,
  summarymissing: /^FAIL {2}SUM: Summary shows the call note/m,
  summaryunanswered: /^FAIL {2}SUM: a blank answer stays blank/m,
  summarystale: /^FAIL {2}SUM: every Summary answer equals the editable Call notes value/m,
  notesdiverge: /^FAIL {2}SA notes: typing in the notes shows in the card/m,
  unsavedlabel: /^FAIL {2}SA GHL: the Occupancy control names its GHL field and says NOT SAVED/m,
  headingnav: /^FAIL {2}SA notes: selecting a note heading opens that question/m,
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
