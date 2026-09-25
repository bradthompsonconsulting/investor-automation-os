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
// A controllable clock: every mode() call advances it past the hold by
// default, so ordinary sequences satisfy the S1/S2 holds; hold tests pass
// an explicit, shorter advance.
const clock = { t: Date.parse('2026-09-25T12:00:00.000Z') };
async function mode(ghl, evidence, m, extra = [], opts = {}) {
  const out = [], err = [];
  clock.t += opts.advanceMs === undefined ? proof.HOLD_MS + 1000 : opts.advanceMs;
  const code = await proof.run(['--mode', m, '--credential-file', CRED, '--evidence', evidence, ...extra], { fetch: ghl.fetch, stdout: (s) => out.push(s), stderr: (s) => err.push(s), sleep: async () => {}, pollDelayMs: 0, now: () => new Date(clock.t).toISOString() });
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
    assert.equal(r.out.includes(proof.HANDOFF.S0), true);
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
    assert.match(r.err, /MESSAGE VERIFICATION WILL BE INCOMPLETE/);
    assert.equal(lines(ev)[1].messageVerification, 'incomplete');
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
  await check('full procedure (absent start): write, verify x2 across the S1 hold, restore, final x2 across the S2 hold -> qualified DATA CHECKS PASSED', async () => {
    const ghl = makeGhl(); const ev = newEvidence();
    let sawBeforeRecordAtPut = [];
    ghl.hooks.onPut = (body, { applyPut, state, reply }) => { sawBeforeRecordAtPut.push(phases(ev).at(-1)); applyPut(body); state.opportunity.updatedAt = new Date(clock.t).toISOString(); return reply(200, { opportunity: state.opportunity }); };
    assert.equal((await mode(ghl, ev, 'precheck', ['--expect-field', 'absent'])).code, 0);
    assert.equal((await mode(ghl, ev, 'write')).code, 0);
    const v1 = await mode(ghl, ev, 'verify'); assert.equal(v1.code, 0, v1.err); assert.equal(v1.out.includes(proof.HANDOFF.S1), true);
    const v2 = await mode(ghl, ev, 'verify'); assert.equal(v2.code, 0, v2.err); assert.match(v2.out, /Next: --mode restore/);
    assert.equal((await mode(ghl, ev, 'restore')).code, 0);
    const f1 = await mode(ghl, ev, 'final'); assert.equal(f1.code, 0, f1.err); assert.equal(f1.out.includes(proof.HANDOFF.S2), true);
    const f2 = await mode(ghl, ev, 'final'); assert.equal(f2.code, 0, f2.err);
    assert.match(f2.out, /DATA CHECKS PASSED \(script evidence only\)/);
    assert.equal(f2.out.includes(proof.HANDOFF.PASS), true, 'never an unqualified pass');
    const puts = ghl.puts();
    assert.equal(puts.length, 2);
    assert.deepEqual(JSON.parse(puts[0].body), { customFields: [{ id: C.CURRENT_OFFER_FIELD_ID, field_value: 999999 }] });
    assert.deepEqual(JSON.parse(puts[1].body), { customFields: [{ id: C.CURRENT_OFFER_FIELD_ID, field_value: '' }] });
    assert.deepEqual(sawBeforeRecordAtPut, ['write:put_before', 'restore:put_before'], 'durable record exists BEFORE each PUT');
    assert.deepEqual(phases(ev), ['precheck:before', 'precheck:after', 'write:before', 'write:put_before', 'write:after', 'verify:before', 'verify:after', 'verify:before', 'verify:after', 'restore:before', 'restore:put_before', 'restore:after', 'final:before', 'final:after', 'final:before', 'final:after']);
    const last = lines(ev).at(-1);
    assert.equal(last.result, 'restored_clean'); assert.equal(last.pass, 2);
    assert.deepEqual(last.verdict, { verdict: 'DATA_CHECKS_PASSED', reasons: [] });
    assert.notEqual(last.observed.chronology.opportunityUpdatedAt, lines(ev)[1].start.chronology.opportunityUpdatedAt, 'updatedAt changed and was NOT treated as a failure');
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
    // The separately invoked restore landed, but the run's DATA verdict still
    // fails: a final pass was start_not_restored and only one verify ran.
    const f2 = await mode(ghl, ev, 'final');
    assert.equal(f2.code, proof.EXIT.CHECK_FAILED); assert.match(f2.err, /DATA CHECKS FAILED/);
    const last = lines(ev).filter((x) => x.mode === 'final' && x.phase === 'after').at(-1);
    assert.equal(last.result, 'restored_clean'); assert.equal(last.verdict.verdict, 'FAILED');
    assert.deepEqual(ghl.state.opportunity.customFields, [{ id: 'otherOppField00000001', fieldValue: 'keep' }]);
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

  // ===== (1) Baseline drift since precheck refuses the write.
  const drifts = [
    ['a contact tag', (s) => { s.contact.tags.push('added-later'); }, 'contact tags changed'],
    ['per-channel DND', (s) => { s.contact.dndSettings = { SMS: { status: 'active' } }; }, 'contact dndSettings changed'],
    ['contact followers', (s) => { s.contact.followers = ['user-2']; }, 'contact followers changed'],
    ['another opportunity field', (s) => { s.opportunity.customFields[0].fieldValue = 'changed'; }, 'another opportunity custom field changed'],
    ['lastStageChangeAt', (s) => { s.opportunity.lastStageChangeAt = '2026-09-25T13:00:00.000Z'; }, 'opportunity lastStageChangeAt changed'],
    ['opportunity source', (s) => { s.opportunity.source = 'changed'; }, 'opportunity source changed'],
    ['a new message', (s) => { s.conversations[0].messages.push({ id: 'm-late', messageType: 'TYPE_SMS', direction: 'outbound', status: 'failed' }); }, 'conversations/messages changed (possible message attempt)'],
  ];
  for (const [label, mutate, expected] of drifts) {
    await check('write refused (nothing sent) on baseline drift since precheck: ' + label, async () => {
      const ghl = makeGhl(); const ev = newEvidence();
      await mode(ghl, ev, 'precheck', ['--expect-field', 'absent']);
      mutate(ghl.state);
      const w = await mode(ghl, ev, 'write');
      assert.equal(w.code, proof.EXIT.REFUSED);
      assert.ok(lines(ev).find((r) => r.mode === 'write' && r.phase === 'refused').problems.includes('baseline drift since precheck: ' + expected));
      assert.equal(ghl.puts().length, 0);
    });
  }

  // ===== (2) Timestamps, chronology, source/followers/DND, UNKNOWN.
  await check('keys the API does not return are recorded as UNKNOWN; returned ones are captured', async () => {
    const ghl = makeGhl(); const ev = newEvidence();
    Object.assign(ghl.state.opportunity, { lastStageChangeAt: '2026-09-24T12:18:00.000Z', lastStatusChangeAt: '2026-09-20T00:00:00.000Z', source: 'IAOS proof', updatedAt: '2026-09-24T12:18:00.000Z' });
    Object.assign(ghl.state.contact, { source: 'manual', followers: ['user-b', 'user-a'], dateUpdated: '2026-09-24T12:00:00.000Z' });
    await mode(ghl, ev, 'precheck', ['--expect-field', 'absent']);
    const s = lines(ev)[1].start;
    assert.equal(s.opportunity.lastStageChangeAt, '2026-09-24T12:18:00.000Z');
    assert.equal(s.opportunity.lastStatusChangeAt, '2026-09-20T00:00:00.000Z');
    assert.equal(s.opportunity.source, 'IAOS proof');
    assert.equal(s.opportunity.followers, 'UNKNOWN');
    assert.equal(s.contact.source, 'manual');
    assert.deepEqual(s.contact.followers, ['user-a', 'user-b']);
    assert.equal(s.contact.dndSettings, 'UNKNOWN');
    assert.equal(s.contact.dnd, false);
    assert.deepEqual(s.chronology, { opportunityUpdatedAt: '2026-09-24T12:18:00.000Z', contactDateUpdated: '2026-09-24T12:00:00.000Z' });
  });
  await check('a status-change timestamp moving during the write is a side effect', async () => {
    const ghl = makeGhl(); const ev = newEvidence();
    ghl.state.opportunity.lastStatusChangeAt = '2026-09-20T00:00:00.000Z';
    await mode(ghl, ev, 'precheck', ['--expect-field', 'absent']);
    ghl.hooks.onPut = (body, { applyPut, state, reply }) => { applyPut(body); state.opportunity.lastStatusChangeAt = '2026-09-25T12:30:00.000Z'; return reply(200, {}); };
    await mode(ghl, ev, 'write');
    assert.equal((await mode(ghl, ev, 'verify')).code, proof.EXIT.CHECK_FAILED);
    assert.ok(lines(ev).find((r) => r.mode === 'verify' && r.phase === 'after').diffs.includes('opportunity lastStatusChangeAt changed'));
  });
  await check('updatedAt/dateUpdated changing is chronology only, never a failure', async () => {
    const ghl = makeGhl(); const ev = newEvidence();
    Object.assign(ghl.state.opportunity, { updatedAt: '2026-09-24T00:00:00.000Z' }); Object.assign(ghl.state.contact, { dateUpdated: '2026-09-24T00:00:00.000Z' });
    await mode(ghl, ev, 'precheck', ['--expect-field', 'absent']);
    ghl.hooks.onPut = (body, { applyPut, state, reply }) => { applyPut(body); state.opportunity.updatedAt = '2026-09-25T12:31:00.000Z'; state.contact.dateUpdated = '2026-09-25T12:31:00.000Z'; return reply(200, {}); };
    await mode(ghl, ev, 'write');
    assert.equal((await mode(ghl, ev, 'verify')).code, 0);
    assert.deepEqual(lines(ev).find((r) => r.mode === 'verify' && r.phase === 'after').diffs, []);
  });

  // ===== (3) Second verify / second final only after the holds.
  await check('verify pass 2 before the S1 hold is refused and reads nothing', async () => {
    const ghl = makeGhl(); const ev = newEvidence();
    await mode(ghl, ev, 'precheck', ['--expect-field', 'absent']); await mode(ghl, ev, 'write'); await mode(ghl, ev, 'verify');
    const gets = ghl.calls.length;
    const v2 = await mode(ghl, ev, 'verify', [], { advanceMs: 60 * 1000 });
    assert.equal(v2.code, proof.EXIT.REFUSED); assert.match(v2.err, /verify pass 2 refused/);
    assert.equal(ghl.calls.length, gets, 'no GHL read during a refused pass 2');
    assert.equal((await mode(ghl, ev, 'verify', [], { advanceMs: proof.HOLD_MS })).code, 0, 'allowed once the hold has elapsed');
  });
  await check('final pass 2 before the S2 hold is refused and reads nothing', async () => {
    const ghl = makeGhl(); const ev = newEvidence();
    await mode(ghl, ev, 'precheck', ['--expect-field', 'absent']); await mode(ghl, ev, 'write'); await mode(ghl, ev, 'verify'); await mode(ghl, ev, 'verify');
    await mode(ghl, ev, 'restore'); await mode(ghl, ev, 'final');
    const gets = ghl.calls.length;
    const f2 = await mode(ghl, ev, 'final', [], { advanceMs: 4 * 60 * 1000 });
    assert.equal(f2.code, proof.EXIT.REFUSED); assert.equal(ghl.calls.length, gets);
    const ok = await mode(ghl, ev, 'final', [], { advanceMs: proof.HOLD_MS });
    assert.equal(ok.code, 0); assert.match(ok.out, /DATA CHECKS PASSED/);
  });
  await check('a data verdict with only ONE verify pass is FAILED, never a pass', async () => {
    const ghl = makeGhl(); const ev = newEvidence();
    await mode(ghl, ev, 'precheck', ['--expect-field', 'absent']); await mode(ghl, ev, 'write'); await mode(ghl, ev, 'verify');
    await mode(ghl, ev, 'restore'); await mode(ghl, ev, 'final');
    const f2 = await mode(ghl, ev, 'final');
    assert.equal(f2.code, proof.EXIT.CHECK_FAILED); assert.match(f2.err, /fewer than two verify passes/);
    assert.ok(!/DATA CHECKS PASSED/.test(f2.out));
  });
  await check('verify is refused once a restore was attempted', async () => {
    const ghl = makeGhl(); const ev = newEvidence();
    await mode(ghl, ev, 'precheck', ['--expect-field', 'absent']); await mode(ghl, ev, 'write'); await mode(ghl, ev, 'verify'); await mode(ghl, ev, 'restore');
    assert.equal((await mode(ghl, ev, 'verify')).code, proof.EXIT.REFUSED);
  });
  await check('handoff names the fixture\'s own workflow history, message-attempt view and the six opportunity-trigger workflows', () => {
    assert.match(proof.HANDOFF.S0, /OWN workflow history/); assert.match(proof.HANDOFF.S0, /OWN message-attempt view/);
    assert.match(proof.HANDOFF.S0, /six opportunity-trigger workflows/);
    for (const w of ['Seller - Under Contract Exit', 'Seller - Follow Up', 'Seller - Not Interested', 'Seller - Route to Long-Term Nurture', 'Seller 6', 'Seller 7', 'Seller 8', 'Phone Type Validation']) assert.ok(proof.HANDOFF.S0.includes(w), w);
    assert.match(proof.HANDOFF.PASS, /ONLY if/);
  });

  // ===== (4) Conversation reads failing -> INCOMPLETE, never a clean pass.
  await check('conversations unreadable throughout: every verify/final and the verdict are INCOMPLETE (exit 7), never "DATA CHECKS PASSED"', async () => {
    const ghl = makeGhl(); ghl.state.conversationsStatus = 403; const ev = newEvidence();
    await mode(ghl, ev, 'precheck', ['--expect-field', 'absent']); await mode(ghl, ev, 'write');
    const runs = [await mode(ghl, ev, 'verify'), await mode(ghl, ev, 'verify')];
    assert.equal((await mode(ghl, ev, 'restore')).code, 0);
    runs.push(await mode(ghl, ev, 'final'), await mode(ghl, ev, 'final'));
    for (const r of runs) { assert.equal(r.code, proof.EXIT.INCOMPLETE); assert.ok(!/DATA CHECKS PASSED/.test(r.out + r.err)); }
    assert.match(runs[3].err, /DATA CHECKS INCOMPLETE/); assert.match(runs[3].err, /NOT a clean pass/);
    const afters = lines(ev).filter((r) => (r.mode === 'verify' || r.mode === 'final') && r.phase === 'after');
    assert.ok(afters.every((r) => r.messageVerification === 'incomplete'));
    assert.equal(afters.at(-1).verdict.verdict, 'INCOMPLETE');
  });
  await check('conversations readable at precheck but failing at verify: a side effect (readability changed), not silently skipped', async () => {
    const ghl = makeGhl(); const ev = newEvidence();
    await mode(ghl, ev, 'precheck', ['--expect-field', 'absent']); await mode(ghl, ev, 'write');
    ghl.state.conversationsStatus = 500;
    assert.equal((await mode(ghl, ev, 'verify')).code, proof.EXIT.CHECK_FAILED);
    const rec = lines(ev).find((r) => r.mode === 'verify' && r.phase === 'after');
    assert.equal(rec.messageVerification, 'incomplete'); assert.ok(rec.diffs.includes('conversation readability changed between observations'));
  });

  // ===== (5) Present but non-numeric Current Offer is refused, never coerced.
  for (const [label, raw, expect] of [['empty string, expect 0', '', '0'], ['empty string, expect absent', '', 'absent'], ['text', 'abc', '0'], ['null', null, '0'], ['negative text', '-5', '0']]) {
    await check('precheck refuses a present non-numeric Current Offer: ' + label, async () => {
      const ghl = makeGhl({ start: raw }); const ev = newEvidence();
      const r = await mode(ghl, ev, 'precheck', ['--expect-field', expect]);
      assert.equal(r.code, proof.EXIT.REFUSED); assert.match(r.err, /present but not numeric/);
      assert.equal(ghl.puts().length, 0);
    });
  }
  await check('a numeric string start is accepted and compared strictly', async () => {
    const ghl = makeGhl({ start: '250000' }); const ev = newEvidence();
    assert.equal((await mode(ghl, ev, 'precheck', ['--expect-field', '250000'])).code, 0);
    assert.equal((await mode(makeGhl({ start: '250000' }), newEvidence(), 'precheck', ['--expect-field', '0'])).code, proof.EXIT.REFUSED);
  });

  // ===== (6) Exclusive lock.
  await check('an existing lock refuses the run: no read, no write, no evidence append, lock left for a human', async () => {
    const ghl = makeGhl(); const ev = newEvidence();
    await mode(ghl, ev, 'precheck', ['--expect-field', 'absent']);
    fs.writeFileSync(ev + '.lock', 'held by another run\n');
    const before = fs.readFileSync(ev, 'utf8'); const calls = ghl.calls.length;
    const r = await mode(ghl, ev, 'write');
    assert.equal(r.code, proof.EXIT.LOCKED); assert.match(r.err, /delete the lock file by hand/);
    assert.equal(ghl.calls.length, calls); assert.equal(fs.readFileSync(ev, 'utf8'), before);
    assert.equal(fs.readFileSync(ev + '.lock', 'utf8'), 'held by another run\n');
    fs.unlinkSync(ev + '.lock');
    assert.equal((await mode(ghl, ev, 'write')).code, 0);
  });
  await check('two concurrent runs on one evidence file: the second is refused while the first holds the lock', async () => {
    const ghl = makeGhl(); const ev = newEvidence();
    let releaseGate; const gate = new Promise((r) => { releaseGate = r; });
    const slow = { ...ghl, fetch: async (url, init) => { await gate; return ghl.fetch(url, init); } };
    const first = mode(slow, ev, 'precheck', ['--expect-field', 'absent']);
    await new Promise((r) => setImmediate(r));
    assert.ok(fs.existsSync(ev + '.lock'), 'first run holds the lock');
    const second = await mode(ghl, ev, 'precheck', ['--expect-field', 'absent']);
    assert.equal(second.code, proof.EXIT.LOCKED);
    releaseGate();
    assert.equal((await first).code, 0);
    assert.ok(!fs.existsSync(ev + '.lock'), 'lock released after the run');
    assert.deepEqual(phases(ev), ['precheck:before', 'precheck:after']);
  });
  await check('the lock is released after a refused run and after a failed run', async () => {
    const ghl = makeGhl(); const ev = newEvidence();
    assert.equal((await mode(ghl, ev, 'write')).code, proof.EXIT.REFUSED);
    assert.ok(!fs.existsSync(ev + '.lock'));
    const ev2 = newEvidence();
    await mode(ghl, ev2, 'precheck', ['--expect-field', 'absent']);
    ghl.hooks.onPut = () => { throw new Error('ECONNRESET'); };
    assert.equal((await mode(ghl, ev2, 'write')).code, proof.EXIT.WRITE_NOT_CONFIRMED);
    assert.ok(!fs.existsSync(ev2 + '.lock'));
  });

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`inv98-current-offer-inert-proof checks=${checks} failures=${failures}`);
  process.exitCode = failures ? 1 : 0;
})();
