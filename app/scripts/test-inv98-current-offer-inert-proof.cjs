/**
 * INV-98 -- offline tests for inv98-current-offer-inert-proof.cjs.
 *
 * A stubbed, in-memory GHL stands in for every request; nothing leaves the
 * process. Covers fixture locking, precheck refusals, mode ordering,
 * durable evidence (including a record written BEFORE a PUT that then
 * fails), the exact single-field PUT body, failed / ambiguous writes
 * (never retried), side-effect detection, and failed restoration.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const APP = path.resolve(__dirname, '..');

const proof = require('./inv98-current-offer-inert-proof.cjs');
const C = proof.CONSTANTS;
const TOKEN = 'offline-inert-proof-token-NEVER-PRINT';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'inv98-inert-'));
const CRED = path.join(TMP, 'cred.env');
fs.writeFileSync(CRED, `OTHER=1\nGHL_PRIVATE_API_KEY=${TOKEN}\n`);

// ---- Stubbed GHL ---------------------------------------------------------------
function makeGhl(options = {}) {
  const state = {
    opportunity: {
      id: C.OPPORTUNITY_ID, locationId: C.LOCATION_ID, contactId: C.CONTACT_ID, pipelineId: C.PIPELINE_ID,
      pipelineStageId: C.UNDER_CONTRACT_STAGE_ID, status: 'open', monetaryValue: 0, assignedTo: null, name: 'IAOS PROOF synthetic',
      customFields: [{ id: 'otherOppField00000001', fieldValue: 'keep' }],
    },
    contact: { id: C.CONTACT_ID, locationId: C.LOCATION_ID, tags: ['iaos-proof'], customFields: [{ id: 'contactField000000001', value: 'x' }], dnd: false },
    conversations: [{ id: 'conv-1', messages: [{ id: 'm-1', messageType: 'TYPE_SMS', direction: 'outbound', status: 'delivered', dateAdded: '2026-09-01T00:00:00.000Z', body: 'PRIVATE BODY' }] }],
    conversationsStatus: 200,
  };
  if (options.start !== undefined) state.opportunity.customFields.push({ id: C.CURRENT_OFFER_FIELD_ID, fieldValue: options.start });
  const calls = [];
  const hooks = { onPut: null };
  const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) });
  const applyPut = (body) => {
    for (const f of body.customFields) {
      state.opportunity.customFields = state.opportunity.customFields.filter((x) => x.id !== f.id);
      if (f.field_value !== '' && f.field_value !== null) state.opportunity.customFields.push({ id: f.id, fieldValue: f.field_value });
    }
  };
  async function fetchStub(url, init = {}) {
    const u = new URL(url);
    const method = init.method || 'GET';
    calls.push({ method, path: u.pathname, search: u.search, body: init.body, auth: init.headers && init.headers.Authorization });
    assert.equal(u.origin, 'https://services.leadconnectorhq.com');
    if (method === 'PUT') {
      assert.equal(u.pathname, `/opportunities/${C.OPPORTUNITY_ID}`, 'PUT only ever targets the fixture opportunity');
      const body = JSON.parse(init.body);
      if (hooks.onPut) return hooks.onPut(body, { applyPut, state, reply });
      applyPut(body);
      return reply(200, { opportunity: state.opportunity });
    }
    if (method !== 'GET') throw new Error('unexpected method ' + method);
    if (u.pathname === `/opportunities/${C.OPPORTUNITY_ID}`) return reply(200, { opportunity: JSON.parse(JSON.stringify(state.opportunity)) });
    if (u.pathname === `/contacts/${C.CONTACT_ID}`) return reply(200, { contact: JSON.parse(JSON.stringify(state.contact)) });
    if (u.pathname === '/conversations/search') {
      if (state.conversationsStatus !== 200) return reply(state.conversationsStatus, { message: 'not authorized for this scope' });
      assert.equal(u.searchParams.get('contactId'), C.CONTACT_ID);
      return reply(200, { conversations: state.conversations.map((c) => ({ id: c.id })) });
    }
    const m = u.pathname.match(/^\/conversations\/([^/]+)\/messages$/);
    if (m) return reply(200, { messages: { messages: state.conversations.find((c) => c.id === m[1]).messages, nextPage: false } });
    throw new Error('unexpected GET ' + u.pathname);
  }
  return { state, calls, hooks, fetch: fetchStub, puts: () => calls.filter((c) => c.method === 'PUT') };
}

let seq = 0;
function newEvidence() { return path.join(TMP, `evidence-${++seq}.jsonl`); }
async function mode(ghl, evidence, m, extra = []) {
  const out = [], err = [];
  const code = await proof.run(['--mode', m, '--credential-file', CRED, '--evidence', evidence, ...extra], { fetch: ghl.fetch, stdout: (s) => out.push(s), stderr: (s) => err.push(s), sleep: async () => {}, pollDelayMs: 0 });
  const text = out.join('\n') + '\n' + err.join('\n');
  assert.ok(!text.includes(TOKEN), 'credential never printed');
  if (fs.existsSync(evidence)) assert.ok(!fs.readFileSync(evidence, 'utf8').includes(TOKEN), 'credential never in evidence');
  return { code, out: out.join('\n'), err: err.join('\n') };
}
const lines = (evidence) => fs.readFileSync(evidence, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const phases = (evidence) => lines(evidence).map((r) => r.mode + ':' + r.phase);

let checks = 0, failures = 0;
async function check(name, fn) {
  try { await fn(); checks++; console.log('PASS ' + name); }
  catch (e) { checks++; failures++; console.log('FAIL ' + name + ' -- ' + (e && e.stack || e)); }
}

(async () => {
  // ===== Fixture locking.
  await check('hardcoded ids equal the reviewed fixture and the committed Production config', () => {
    const originalResolve = Module._resolveFilename;
    Module._resolveFilename = function (name, parent, ...rest) {
      if (name.startsWith('.') && parent) { const c = path.resolve(path.dirname(parent.filename), name + '.ts'); if (fs.existsSync(c)) return c; }
      return originalResolve.call(this, name, parent, ...rest);
    };
    Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
    const { getConfig } = require(path.join(APP, 'shared', 'ghl-config.ts'));
    const prod = getConfig('production');
    assert.equal(C.LOCATION_ID, 'jmHG4B8RdzwpfqruNf68'); assert.equal(C.LOCATION_ID, prod.locationId);
    assert.equal(C.PIPELINE_ID, 'GpUWK4YlhNqBzm5Hrm58'); assert.equal(C.PIPELINE_ID, prod.pipelines.sellerLeads);
    assert.equal(C.CURRENT_OFFER_FIELD_ID, 'yZgEdTOvppmmCvv8kx9n'); assert.equal(C.CURRENT_OFFER_FIELD_ID, prod.opportunityFacts.currentOffer);
    assert.equal(C.CONTACT_ID, 'PyytyrvpIv8ndpJWK4kk');
    assert.equal(C.OPPORTUNITY_ID, 'EYPJ0L2ADOQVgPBdIods');
    assert.equal(C.UNDER_CONTRACT_STAGE_ID, 'bf17076b-3830-4479-94bb-b8af70fe9163');
  });
  await check('source: no flag can widen the target; the only PUT path is the fixture opportunity; exactly one PUT call site', () => {
    const src = fs.readFileSync(path.join(__dirname, 'inv98-current-offer-inert-proof.cjs'), 'utf8');
    assert.ok(!/--(opportunity|contact|location|field|stage)-id/.test(src));
    assert.equal((src.match(/'PUT'/g) || []).length, 1);
    assert.ok(/request\('PUT', `\/opportunities\/\$\{OPPORTUNITY_ID\}`, body\)/.test(src));
    assert.ok(!/setTimeout\([^)]*put|retry/i.test(src.replace(/never retried|Nothing retries|Not retried|RETRIED|retry on/gi, '')), 'no retry logic');
  });

  // ===== Argument handling.
  for (const [label, argv] of [
    ['missing mode', ['--credential-file', CRED, '--evidence', 'x']],
    ['unknown mode', ['--mode', 'delete', '--credential-file', CRED, '--evidence', 'x']],
    ['missing credential', ['--mode', 'verify', '--evidence', 'x']],
    ['missing evidence', ['--mode', 'verify', '--credential-file', CRED]],
    ['precheck without --expect-field', ['--mode', 'precheck', '--credential-file', CRED, '--evidence', 'x']],
    ['bad --expect-field', ['--mode', 'precheck', '--credential-file', CRED, '--evidence', 'x', '--expect-field', 'empty']],
    ['--expect-field on a later mode', ['--mode', 'write', '--credential-file', CRED, '--evidence', 'x', '--expect-field', 'absent']],
  ]) {
    await check('usage refused: ' + label, async () => {
      const ghl = makeGhl();
      const code = await proof.run(argv, { fetch: ghl.fetch, stdout: () => {}, stderr: () => {} });
      assert.equal(code, proof.EXIT.USAGE); assert.equal(ghl.calls.length, 0);
    });
  }
  await check('credential file without GHL_PRIVATE_API_KEY refused, no request', async () => {
    const ghl = makeGhl(); const bad = path.join(TMP, 'bad.env'); fs.writeFileSync(bad, 'X=1\n');
    const code = await proof.run(['--mode', 'precheck', '--credential-file', bad, '--evidence', newEvidence(), '--expect-field', 'absent'], { fetch: ghl.fetch, stdout: () => {}, stderr: () => {} });
    assert.equal(code, proof.EXIT.USAGE); assert.equal(ghl.calls.length, 0);
  });

  // ===== Precheck.
  await check('precheck (absent start): records before+after, exact start, temp 999999, reads only', async () => {
    const ghl = makeGhl(); const ev = newEvidence();
    const r = await mode(ghl, ev, 'precheck', ['--expect-field', 'absent']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(phases(ev), ['precheck:before', 'precheck:after']);
    const after = lines(ev)[1];
    assert.equal(after.result, 'ok'); assert.equal(after.tempValue, 999999);
    assert.deepEqual(after.start.target, { present: false });
    assert.deepEqual(after.start.contact.tags, ['iaos-proof']);
    assert.equal(after.start.conversations.readable, true);
    assert.ok(!fs.readFileSync(ev, 'utf8').includes('PRIVATE BODY'), 'message bodies are never recorded');
    assert.equal(ghl.puts().length, 0);
    assert.ok(ghl.calls.every((c) => c.auth === 'Bearer ' + TOKEN));
    assert.match(r.out, /HANDOFF: Spock UI snapshot S0/);
  });
  await check('precheck (present start 250000): temp 999999; (present start 999999): temp 999998', async () => {
    let ghl = makeGhl({ start: 250000 }); let ev = newEvidence();
    assert.equal((await mode(ghl, ev, 'precheck', ['--expect-field', '250000'])).code, 0);
    assert.equal(lines(ev)[1].tempValue, 999999);
    ghl = makeGhl({ start: 999999 }); ev = newEvidence();
    assert.equal((await mode(ghl, ev, 'precheck', ['--expect-field', '999999'])).code, 0);
    assert.equal(lines(ev)[1].tempValue, 999998);
  });
  const refusals = [
    ['wrong contact on the opportunity', (s) => { s.opportunity.contactId = 'someOtherContact00001'; }],
    ['wrong location', (s) => { s.opportunity.locationId = 'SoTgVoaFGHtBdRFvXWQV'; }],
    ['wrong pipeline', (s) => { s.opportunity.pipelineId = 'otherPipeline00000001'; }],
    ['not in Under Contract', (s) => { s.opportunity.pipelineStageId = 'a0f01076-5019-4abc-b809-7f4b0218dd35'; }],
    ['status not open', (s) => { s.opportunity.status = 'lost'; }],
    ['contact location wrong', (s) => { s.contact.locationId = 'SoTgVoaFGHtBdRFvXWQV'; }],
    ['field present but expected absent', (s) => { s.opportunity.customFields.push({ id: C.CURRENT_OFFER_FIELD_ID, fieldValue: 190000 }); }],
  ];
  for (const [label, mutate] of refusals) {
    await check('precheck refused: ' + label + ' (recorded, no PUT)', async () => {
      const ghl = makeGhl(); mutate(ghl.state); const ev = newEvidence();
      const r = await mode(ghl, ev, 'precheck', ['--expect-field', 'absent']);
      assert.equal(r.code, proof.EXIT.REFUSED);
      assert.deepEqual(phases(ev).slice(0, 2), ['precheck:before', 'precheck:after']);
      assert.equal(lines(ev)[1].result, 'refused');
      assert.equal(ghl.puts().length, 0);
    });
  }
  await check('precheck refused: value differs from --expect-field', async () => {
    const ghl = makeGhl({ start: 250000 }); const ev = newEvidence();
    assert.equal((await mode(ghl, ev, 'precheck', ['--expect-field', '250001'])).code, proof.EXIT.REFUSED);
  });
  await check('precheck refuses an evidence file that already holds records', async () => {
    const ghl = makeGhl(); const ev = newEvidence();
    await mode(ghl, ev, 'precheck', ['--expect-field', 'absent']);
    const before = fs.readFileSync(ev, 'utf8');
    assert.equal((await mode(ghl, ev, 'precheck', ['--expect-field', 'absent'])).code, proof.EXIT.REFUSED);
    assert.equal(ghl.calls.filter((c) => c.method === 'GET').length > 0, true);
    assert.ok(fs.readFileSync(ev, 'utf8').startsWith(before));
  });
  await check('precheck with unreadable conversations: ok but warns that UI snapshots are the only message evidence', async () => {
    const ghl = makeGhl(); ghl.state.conversationsStatus = 401; const ev = newEvidence();
    const r = await mode(ghl, ev, 'precheck', ['--expect-field', 'absent']);
    assert.equal(r.code, 0); assert.equal(lines(ev)[1].start.conversations.readable, false);
    assert.match(r.err, /message-attempt evidence must come from Spock/);
  });

  // ===== Mode ordering (each refusal still leaves a record, and sends nothing).
  await check('write without a precheck refused, recorded, no PUT', async () => {
    const ghl = makeGhl(); const ev = newEvidence();
    assert.equal((await mode(ghl, ev, 'write')).code, proof.EXIT.REFUSED);
    assert.deepEqual(phases(ev), ['write:before', 'write:error']);
    assert.equal(ghl.puts().length, 0);
  });
  await check('verify/restore without a write, and final without a restore, refused with no PUT', async () => {
    const ghl = makeGhl(); const ev = newEvidence();
    await mode(ghl, ev, 'precheck', ['--expect-field', 'absent']);
    for (const m of ['verify', 'restore', 'final']) assert.equal((await mode(ghl, ev, m)).code, proof.EXIT.REFUSED, m);
    assert.equal(ghl.puts().length, 0);
  });

  // ===== Happy path, absent start.
  await check('full sequence (absent start): one write PUT, one restore PUT, exact bodies, clean final', async () => {
    const ghl = makeGhl(); const ev = newEvidence();
    let sawBeforeRecordAtPut = [];
    ghl.hooks.onPut = (body, { applyPut, state, reply }) => { sawBeforeRecordAtPut.push(phases(ev).at(-1)); applyPut(body); return reply(200, { opportunity: state.opportunity }); };
    assert.equal((await mode(ghl, ev, 'precheck', ['--expect-field', 'absent'])).code, 0);
    assert.equal((await mode(ghl, ev, 'write')).code, 0);
    const v = await mode(ghl, ev, 'verify'); assert.equal(v.code, 0, v.err); assert.match(v.out, /S1/);
    assert.equal((await mode(ghl, ev, 'restore')).code, 0);
    const f = await mode(ghl, ev, 'final'); assert.equal(f.code, 0, f.err); assert.match(f.out, /S2/);
    const puts = ghl.puts();
    assert.equal(puts.length, 2);
    assert.deepEqual(JSON.parse(puts[0].body), { customFields: [{ id: C.CURRENT_OFFER_FIELD_ID, field_value: 999999 }] });
    assert.deepEqual(JSON.parse(puts[1].body), { customFields: [{ id: C.CURRENT_OFFER_FIELD_ID, field_value: '' }] });
    assert.deepEqual(sawBeforeRecordAtPut, ['write:put_before', 'restore:put_before'], 'durable record exists BEFORE each PUT');
    assert.deepEqual(phases(ev), ['precheck:before', 'precheck:after', 'write:before', 'write:put_before', 'write:after', 'verify:before', 'verify:after', 'restore:before', 'restore:put_before', 'restore:after', 'final:before', 'final:after']);
    assert.equal(lines(ev).at(-1).result, 'restored_clean');
    assert.deepEqual(ghl.state.opportunity.customFields, [{ id: 'otherOppField00000001', fieldValue: 'keep' }]);
    assert.ok(ghl.calls.every((c) => c.method === 'GET' || c.method === 'PUT'));
  });
  await check('full sequence (present start 250000): restore PUTs the exact recorded start value', async () => {
    const ghl = makeGhl({ start: 250000 }); const ev = newEvidence();
    await mode(ghl, ev, 'precheck', ['--expect-field', '250000']);
    await mode(ghl, ev, 'write'); await mode(ghl, ev, 'verify');
    assert.equal((await mode(ghl, ev, 'restore')).code, 0);
    assert.deepEqual(JSON.parse(ghl.puts()[1].body), { customFields: [{ id: C.CURRENT_OFFER_FIELD_ID, field_value: 250000 }] });
    assert.equal((await mode(ghl, ev, 'final')).code, 0);
  });
  await check('write is never re-run for the same evidence file', async () => {
    const ghl = makeGhl(); const ev = newEvidence();
    await mode(ghl, ev, 'precheck', ['--expect-field', 'absent']); await mode(ghl, ev, 'write');
    assert.equal((await mode(ghl, ev, 'write')).code, proof.EXIT.REFUSED);
    assert.equal(ghl.puts().length, 1);
  });
  await check('write refused (nothing sent) if the field drifted after precheck', async () => {
    const ghl = makeGhl(); const ev = newEvidence();
    await mode(ghl, ev, 'precheck', ['--expect-field', 'absent']);
    ghl.state.opportunity.customFields.push({ id: C.CURRENT_OFFER_FIELD_ID, fieldValue: 1 });
    assert.equal((await mode(ghl, ev, 'write')).code, proof.EXIT.REFUSED);
    assert.ok(phases(ev).includes('write:refused')); assert.equal(ghl.puts().length, 0);
  });
  await check('write refused (nothing sent) if the stage moved after precheck', async () => {
    const ghl = makeGhl(); const ev = newEvidence();
    await mode(ghl, ev, 'precheck', ['--expect-field', 'absent']);
    ghl.state.opportunity.pipelineStageId = '0c45ee3d-7be7-4651-97a4-6df53f53481b';
    assert.equal((await mode(ghl, ev, 'write')).code, proof.EXIT.REFUSED); assert.equal(ghl.puts().length, 0);
  });

  // ===== Failed and ambiguous writes -- never retried.
  await check('failed write (HTTP 500, not applied): one PUT, recorded rejected, verify reports temp_not_observed, restore sends nothing', async () => {
    const ghl = makeGhl(); const ev = newEvidence();
    await mode(ghl, ev, 'precheck', ['--expect-field', 'absent']);
    ghl.hooks.onPut = (body, { reply }) => reply(500, { message: 'internal ' + TOKEN });
    const w = await mode(ghl, ev, 'write');
    assert.equal(w.code, proof.EXIT.WRITE_NOT_CONFIRMED); assert.match(w.err, /Not retried/);
    assert.equal(ghl.puts().length, 1);
    const rec = lines(ev).find((r) => r.mode === 'write' && r.phase === 'after');
    assert.equal(rec.outcome, 'rejected'); assert.equal(rec.httpStatus, 500);
    assert.equal((await mode(ghl, ev, 'verify')).code, proof.EXIT.CHECK_FAILED);
    assert.equal(lines(ev).find((r) => r.mode === 'verify' && r.phase === 'after').result, 'temp_not_observed');
    ghl.hooks.onPut = null;
    const r = await mode(ghl, ev, 'restore'); assert.equal(r.code, 0); assert.match(r.out, /not needed/);
    assert.equal(ghl.puts().length, 1, 'restore sent nothing: the field was already at its start');
    assert.equal((await mode(ghl, ev, 'final')).code, 0);
  });
  await check('ambiguous write (network error AFTER the change landed): one PUT, recorded ambiguous, verify observes the temp value', async () => {
    const ghl = makeGhl(); const ev = newEvidence();
    await mode(ghl, ev, 'precheck', ['--expect-field', 'absent']);
    ghl.hooks.onPut = (body, { applyPut }) => { applyPut(body); throw new Error('socket hang up'); };
    const w = await mode(ghl, ev, 'write');
    assert.equal(w.code, proof.EXIT.WRITE_NOT_CONFIRMED); assert.match(w.err, /AMBIGUOUS/);
    assert.equal(ghl.puts().length, 1);
    assert.equal(lines(ev).find((r) => r.mode === 'write' && r.phase === 'after').outcome, 'ambiguous');
    ghl.hooks.onPut = null;
    assert.equal((await mode(ghl, ev, 'verify')).code, 0);
    assert.equal((await mode(ghl, ev, 'restore')).code, 0);
    assert.equal((await mode(ghl, ev, 'final')).code, 0);
    assert.equal(ghl.puts().length, 2);
  });

  // ===== Side effects.
  await check('verify detects a side effect (tag added by a workflow on write)', async () => {
    const ghl = makeGhl(); const ev = newEvidence();
    await mode(ghl, ev, 'precheck', ['--expect-field', 'absent']);
    ghl.hooks.onPut = (body, { applyPut, state, reply }) => { applyPut(body); state.contact.tags.push('workflow-added'); return reply(200, {}); };
    await mode(ghl, ev, 'write');
    assert.equal((await mode(ghl, ev, 'verify')).code, proof.EXIT.CHECK_FAILED);
    const rec = lines(ev).find((r) => r.mode === 'verify' && r.phase === 'after');
    assert.equal(rec.result, 'side_effect_detected'); assert.ok(rec.diffs.includes('contact tags changed'));
  });
  await check('verify detects a new message attempt and a stage move', async () => {
    const ghl = makeGhl(); const ev = newEvidence();
    await mode(ghl, ev, 'precheck', ['--expect-field', 'absent']);
    ghl.hooks.onPut = (body, { applyPut, state, reply }) => { applyPut(body); state.conversations[0].messages.push({ id: 'm-2', messageType: 'TYPE_EMAIL', direction: 'outbound', status: 'failed' }); state.opportunity.pipelineStageId = 'a7436df7-e05a-4bf0-bd29-70f7066ec0bd'; return reply(200, {}); };
    await mode(ghl, ev, 'write');
    assert.equal((await mode(ghl, ev, 'verify')).code, proof.EXIT.CHECK_FAILED);
    const rec = lines(ev).find((r) => r.mode === 'verify' && r.phase === 'after');
    assert.ok(rec.diffs.some((d) => /conversations\/messages changed/.test(d)));
    assert.ok(rec.problems.some((p) => /stage/.test(p)));
  });
  await check('restore refused (nothing sent) if the fixture left Under Contract', async () => {
    const ghl = makeGhl(); const ev = newEvidence();
    await mode(ghl, ev, 'precheck', ['--expect-field', 'absent']); await mode(ghl, ev, 'write');
    ghl.state.opportunity.pipelineStageId = 'a7436df7-e05a-4bf0-bd29-70f7066ec0bd';
    assert.equal((await mode(ghl, ev, 'restore')).code, proof.EXIT.REFUSED);
    assert.equal(ghl.puts().length, 1); assert.ok(phases(ev).includes('restore:refused'));
  });

  // ===== Failed restoration -- never retried.
  await check('failed restore (HTTP 500): one restore PUT, recorded rejected, loud message, final fails; a separately invoked restore then recovers', async () => {
    const ghl = makeGhl(); const ev = newEvidence();
    await mode(ghl, ev, 'precheck', ['--expect-field', 'absent']); await mode(ghl, ev, 'write'); await mode(ghl, ev, 'verify');
    ghl.hooks.onPut = (body, { reply }) => reply(500, { message: 'boom' });
    const r = await mode(ghl, ev, 'restore');
    assert.equal(r.code, proof.EXIT.WRITE_NOT_CONFIRMED);
    assert.match(r.err, /THE FIELD MAY STILL HOLD 999999/); assert.match(r.err, /Not retried/);
    assert.equal(ghl.puts().length, 2, 'write + exactly one restore attempt');
    assert.equal(lines(ev).filter((x) => x.mode === 'restore' && x.phase === 'after').at(-1).outcome, 'rejected');
    const f = await mode(ghl, ev, 'final');
    assert.equal(f.code, proof.EXIT.CHECK_FAILED); assert.match(f.err, /MAY STILL HOLD 999999/);
    assert.equal(lines(ev).filter((x) => x.mode === 'final' && x.phase === 'after').at(-1).result, 'start_not_restored');
    ghl.hooks.onPut = null;
    assert.equal((await mode(ghl, ev, 'restore')).code, 0);
    assert.equal((await mode(ghl, ev, 'final')).code, 0);
    assert.equal(ghl.puts().length, 3);
  });
  await check('ambiguous restore (network error, not applied): recorded ambiguous, final fails', async () => {
    const ghl = makeGhl(); const ev = newEvidence();
    await mode(ghl, ev, 'precheck', ['--expect-field', 'absent']); await mode(ghl, ev, 'write'); await mode(ghl, ev, 'verify');
    ghl.hooks.onPut = () => { throw new Error('ETIMEDOUT'); };
    assert.equal((await mode(ghl, ev, 'restore')).code, proof.EXIT.WRITE_NOT_CONFIRMED);
    assert.equal(lines(ev).filter((x) => x.mode === 'restore' && x.phase === 'after').at(-1).outcome, 'ambiguous');
    ghl.hooks.onPut = null;
    assert.equal((await mode(ghl, ev, 'final')).code, proof.EXIT.CHECK_FAILED);
    assert.equal(ghl.puts().length, 2);
  });
  await check('a GET failure mid-mode leaves an error record', async () => {
    const ghl = makeGhl(); const ev = newEvidence();
    await mode(ghl, ev, 'precheck', ['--expect-field', 'absent']);
    const realFetch = ghl.fetch;
    const failing = { ...ghl, fetch: async (url, init) => { if (new URL(url).pathname.startsWith('/contacts/')) return { status: 503, ok: false, text: async () => 'down' }; return realFetch(url, init); } };
    assert.equal((await mode(failing, ev, 'write')).code, proof.EXIT.READ_FAILED);
    assert.deepEqual(phases(ev).slice(-2), ['write:before', 'write:error']);
    assert.equal(ghl.puts().length, 0);
  });

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`inv98-current-offer-inert-proof checks=${checks} failures=${failures}`);
  process.exitCode = failures ? 1 : 0;
})();
