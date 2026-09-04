/** INV-25 Tranche 2 deterministic persistence boundary; mocks only. */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-arv-persist-test');
const SRC = path.join(APP, 'src', 'lib', 'arv-persist.ts');
const GHL = path.join(APP, 'src', 'lib', 'ghl.ts');
const UI = path.join(APP, 'src', 'components', 'ArvCompsWorkspace.tsx');
const PAGE = path.join(APP, 'src', 'pages', 'UnderwritingWorkspace.tsx');
function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }
cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }));
try {
  execSync(`npx tsc "${SRC}" --outDir "${TMP}" --module commonjs --target es2020 --strict`,
    { cwd: APP, stdio: 'inherit' });
} catch (_) {
  console.error('ABORT: TypeScript compilation failed.');
  cleanup();
  process.exit(10);
}
const { arvPersistGate, persistApprovedArv, formatArvApprovalNote } =
  require(path.join(TMP, 'arv-persist.js'));

const FLOOR = 53;
let checks = 0;
let failures = 0;
function check(name, actual, expected) {
  checks++;
  if (JSON.stringify(actual) === JSON.stringify(expected)) console.log('PASS  ' + name);
  else {
    failures++;
    console.error('FAIL  ' + name);
    console.error('      expected: ' + JSON.stringify(expected));
    console.error('      actual:   ' + JSON.stringify(actual));
  }
}

const provenance = {
  approvedAt: '2026-09-04T20:00:00.000Z', operator: 'Brad Thompson',
  opportunityId: 'opp-test', evidenceState: 'HIGH', reconciliationOutcome: 'RECOMMENDED',
  acceptedCompCount: 4, searchLevel: 'STANDARD',
  source: { kind: 'PROPSTREAM_COMPARABLE_CSV', version: 'propstream-comparable-csv-v1', fileName: 'test-comps.csv', importedAt: '2026-09-04T19:00:00.000Z' },
};
const approved = { kind: 'approved', amount: 250000, recommendedArv: 250000, revision: 3 };
const overridden = { kind: 'overridden', amount: 245000, recommendedArv: 250000, revision: 3 };

function mock(options) {
  const opts = options || {};
  const calls = [];
  const notes = [];
  const opportunities = new Proxy({
    setApprovedArv: async (id, value) => {
      calls.push({ method: 'setApprovedArv', id, value });
      if (opts.arvThrows) throw new Error('ARV transport failed');
      return { ok: opts.arvOk !== false, sent: value, observed: opts.arvOk === false ? 1 : value };
    },
  }, { get(target, key) { calls.push({ touched: String(key) }); return target[key]; } });
  return {
    client: { opportunities, notes: { create: async (id, body) => {
      calls.push({ method: 'notes.create', id });
      if (opts.noteThrows) throw new Error('Note transport failed');
      notes.push(body);
    } } }, calls, notes,
  };
}

(async function () {
  check('unapproved blocked', arvPersistGate({ kind: 'none' }, 3).kind, 'blocked');
  check('stale blocked', arvPersistGate(approved, 4).kind, 'blocked');
  check('invalid amount blocked', arvPersistGate({ ...approved, amount: Number.NaN }, 3).kind, 'blocked');
  check('changed recommendation blocked', arvPersistGate({ ...approved, amount: 240000 }, 3).kind, 'blocked');
  check('current approval allowed', arvPersistGate(approved, 3).kind, 'allowed');
  check('current override allowed', arvPersistGate(overridden, 3).kind, 'allowed');

  const blocked = mock();
  const br = await persistApprovedArv(blocked.client, 'contact-test', arvPersistGate({ kind: 'none' }, 3), provenance);
  check('blocked result explicit', br.stage, 'blocked');
  check('blocked writes nothing', blocked.calls.length, 0);

  const fail = mock({ arvThrows: true });
  const fr = await persistApprovedArv(fail.client, 'contact-test', arvPersistGate(approved, 3), provenance);
  check('ARV failure explicit', fr.stage, 'arv_write');
  check('ARV failure writes no note', fail.notes.length, 0);
  check('ARV failure touches only named writer', fail.calls.some((x) => x.method === 'notes.create'), false);

  const unconfirmed = mock({ arvOk: false });
  const ur = await persistApprovedArv(unconfirmed.client, 'contact-test', arvPersistGate(approved, 3), provenance);
  check('unconfirmed ARV explicit', ur.stage, 'arv_unconfirmed');
  check('unconfirmed ARV writes no note', unconfirmed.notes.length, 0);

  const ok = mock();
  const result = await persistApprovedArv(ok.client, 'contact-test', arvPersistGate(approved, 3), provenance);
  check('approved persistence succeeds', result.ok, true);
  check('named writer called once', ok.calls.filter((x) => x.method === 'setApprovedArv').length, 1);
  check('writer receives selected opportunity', ok.calls.find((x) => x.method === 'setApprovedArv').id, 'opp-test');
  check('writer receives approved value', ok.calls.find((x) => x.method === 'setApprovedArv').value, 250000);
  check('note appended once', ok.notes.length, 1);
  check('ARV precedes note', ok.calls.findIndex((x) => x.method === 'setApprovedArv') < ok.calls.findIndex((x) => x.method === 'notes.create'), true);

  const note = ok.notes[0];
  for (const required of ['Approval timestamp: 2026-09-04T20:00:00.000Z', 'Operator: Brad Thompson', 'Opportunity: opp-test', 'Decision: APPROVED', 'Approved ARV: 250000', 'Recommended ARV: 250000', 'Evidence state: HIGH', 'Reconciliation outcome: RECOMMENDED', 'Accepted comp count: 4', 'Search level: STANDARD', 'Source version: propstream-comparable-csv-v1', 'PropStream CSV: test-comps.csv', 'Imported at: 2026-09-04T19:00:00.000Z']) {
    check('note contains ' + required, note.includes(required), true);
  }
  check('note excludes per-comp detail', /row-\d|evidenceId|salePrice/.test(note), false);

  const ov = mock();
  await persistApprovedArv(ov.client, 'contact-test', arvPersistGate(overridden, 3), provenance);
  check('override represented', ov.notes[0].includes('Decision: OVERRIDE'), true);
  check('override preserves recommendation', ov.notes[0].includes('Recommended ARV: 250000'), true);
  check('override preserves approved amount', ov.notes[0].includes('Approved ARV: 245000'), true);

  const second = await persistApprovedArv(ok.client, 'contact-test', arvPersistGate(overridden, 3), provenance);
  check('reapproval succeeds', second.ok, true);
  check('reapproval appends second note', ok.notes.length, 2);
  check('prior note remains unchanged', ok.notes[0], note);

  const partial = mock({ noteThrows: true });
  const pr = await persistApprovedArv(partial.client, 'contact-test', arvPersistGate(approved, 3), provenance);
  check('note failure is not success', pr.ok, false);
  check('note failure stage explicit', pr.stage, 'note');
  check('note failure admits ARV confirmed', pr.arvConfirmed, true);
  check('note failure attempts no rollback', partial.calls.filter((x) => x.method === 'setApprovedArv').length, 1);

  const persistCode = fs.readFileSync(SRC, 'utf8');
  const ghlCode = fs.readFileSync(GHL, 'utf8');
  const uiCode = fs.readFileSync(UI, 'utf8');
  const pageCode = fs.readFileSync(PAGE, 'utf8');
  check('boundary names authoritative writer', persistCode.includes('setApprovedArv'), true);
  check('boundary does not name Contact ARV setter', persistCode.includes('setARV'), false);
  check('boundary does not name underwriting writer', persistCode.includes('saveUnderwritingFields'), false);
  check('boundary touches no offer carrier', persistCode.includes('offer_'), false);
  check('boundary touches no repair carrier', /repair/i.test(persistCode), false);
  check('writer resolves configured opportunity ARV', ghlCode.includes('const fieldId = CONFIG.opportunityFacts.arv;'), true);
  check('writer accepts no field id', ghlCode.includes('setApprovedArv: async (\n      opportunityId: string,\n      value: number,'), true);
  check('PB-D59 plan remains three fields', (ghlCode.match(/key: "endBuyerMaxPrice"|key: "sellerMAO"|key: "assignmentMode"/g) || []).length, 3);
  check('UI calls dedicated boundary', uiCode.includes('persistApprovedArv('), true);
  check('selected opportunity passed to workspace', pageCode.includes('opportunityId={screen.opportunity.id}'), true);

  cleanup();
  console.log('');
  console.log(`checksRun=${checks} failures=${failures} floor=${FLOOR}`);
  if (checks !== FLOOR) process.exit(2);
  if (failures) process.exit(1);
  console.log('OK');
})().catch((error) => { console.error(error); cleanup(); process.exit(3); });
