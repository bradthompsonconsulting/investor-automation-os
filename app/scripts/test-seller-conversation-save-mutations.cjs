/**
 * B15-03 / INV-103 slice C -- negative controls for test-seller-conversation-save-rendered.cjs.
 * Each mutation rewrites source in the dev server only (no file is touched) and MUST make the rendered suite
 * fail on its own named check:
 *   saveoff              -- Save writes with the flag off           -> "OFF: ZERO write requests after Save"
 *   resenduncertain      -- Save re-sends an uncertain item         -> "MIX: Save again re-sends ONLY the refused item"
 *   autoretry            -- an uncertain item is retried by itself  -> "MIX: nothing is retried automatically"
 *   cleardrafts          -- drafts cleared after a failure          -> "MIX: drafts are kept after the failure" (an effect clears them)
 *   duplicate            -- a confirmed identical item is re-sent   -> "ON: a second Save sends nothing (no duplicate)"
 *   addresswritten       -- the property address is written         -> "MIX: address and reason were never sent"
 *   nogeneral            -- the note drops General notes            -> "ON: the conversation note ... carries every answer and the General notes"
 *   autosaveon           -- flag on, sections still autosave        -> "ON: the sections do not write on blur"
 *   autosaveoff          -- flag off, sections stop autosaving      -> "OFF-A: leaving the Transaction assumptions field still saves it"
 *   noleaveguard         -- no leave warning                        -> "LEAVE: an in-app link asks first"
 *   uncertainasconfirmed -- an unreadable answer counts as saved    -> "MIX: each item reports its own result"
 *   noinflight           -- a second Save starts while one runs     -> "ONE: while the first write is held, exactly one request is in flight"
 *
 * Not a CI step (like the slice A mutation runner): each mutation re-runs the whole rendered suite.
 *
 *   node scripts/test-seller-conversation-save-mutations.cjs
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const EXPECT = {
  saveoff: /^FAIL {2}OFF: ZERO write requests after Save/m,
  resenduncertain: /^FAIL {2}MIX: Save again re-sends ONLY the refused item/m,
  autoretry: /^FAIL {2}MIX: nothing is retried automatically/m,
  cleardrafts: /^FAIL {2}MIX: drafts are kept after the failure/m,
  duplicate: /^FAIL {2}ON: a second Save sends nothing \(no duplicate\)/m,
  addresswritten: /^FAIL {2}MIX: address and reason were never sent/m,
  nogeneral: /^FAIL {2}ON: the conversation note is for this deal and carries every answer and the General notes/m,
  autosaveon: /^FAIL {2}ON: the sections do not write on blur/m,
  autosaveoff: /^FAIL {2}OFF-A: leaving the Transaction assumptions field still saves it/m,
  noleaveguard: /^FAIL {2}LEAVE: an in-app link asks first/m,
  uncertainasconfirmed: /^FAIL {2}MIX: each item reports its own result/m,
  noinflight: /^FAIL {2}ONE: while the first write is held, exactly one request is in flight/m,
};
const only = process.argv.slice(2);
let failures = 0;
let ran = 0;
for (const [name, mustFail] of Object.entries(EXPECT)) {
  if (only.length && !only.includes(name)) continue;
  ran += 1;
  const r = spawnSync(process.execPath, [path.join(__dirname, 'test-seller-conversation-save-rendered.cjs')], {
    env: { ...process.env, SC_SAVE_MUTATION: name }, encoding: 'utf8', timeout: 12 * 60_000, maxBuffer: 32 * 1024 * 1024,
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const applied = out.includes(`NOTE  mutation ${name} applied`);
  const caught = r.status === 1 && mustFail.test(out);
  console.log(`${caught && applied ? 'PASS' : 'FAIL'}  mutation ${name}: exit ${r.status}, applied=${applied}, named check failed=${mustFail.test(out)}`);
  if (!(caught && applied)) { failures += 1; console.log(out.split('\n').filter((l) => l.startsWith('FAIL')).slice(0, 6).join('\n')); }
}
console.log(`\nmutations=${ran} caught=${ran - failures} ${failures === 0 ? 'OK' : 'FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
