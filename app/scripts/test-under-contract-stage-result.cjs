/** INV-98 -- the browser may never show an uncertain Under Contract stage
 * transition as success, nor allow a blind retry. Offline: global.fetch is a
 * fixture for the whole run, and the real ghl.ts / write-command.ts code runs. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const APP = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(name, parent, ...rest) {
  if (name.startsWith('.') && parent) {
    for (const ext of ['.ts', '.tsx']) {
      const candidate = path.resolve(path.dirname(parent.filename), name + ext);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return originalResolve.call(this, name, parent, ...rest);
};
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);

let calls = [];
let route = null;
global.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
  if (!route) throw new Error('unexpected outbound request: ' + url);
  return route(String(url), init);
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const { getConfig, projectRuntimeConfig, setRuntimeConfig } = require('../shared/ghl-config.ts');
const TEST = getConfig('test');
setRuntimeConfig(projectRuntimeConfig(TEST));
const writeSession = require('../src/lib/app-write-session.ts');
const model = require('../src/lib/contract-stage-transition-model.ts');
const { ghl } = require('../src/lib/ghl.ts');

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (err) { failed++; console.log('FAIL ' + name + ' -- ' + (err && err.message)); }
}

const PIPE = TEST.pipelines.sellerLeads, STAGE = TEST.stages.underContract, CLOSED_WON = TEST.stages.sellerClosedWon;
const OPP = 'fixture-opportunity';
const AGREEMENT = '2026-09-20T15:00:00.000Z';
let versionSeq = 0;
const nextVersion = () => ({ agreementAt: AGREEMENT, versionSeq: ++versionSeq, supersedesVersionSeq: null, replacesAgreementAt: null });
const readback = (over = {}) => ({ id: OPP, pipelineId: PIPE, pipelineStageId: STAGE, locationId: TEST.locationId, contactId: 'c', customFields: [], ...over });
const signIn = () => writeSession.setAppWriteSession({ token: 'write-fixture', expiresAt: new Date(Date.now() + 600000).toISOString() });
const writes = () => calls.filter(c => c.url === '/.netlify/functions/ghl-write');
const reads = () => calls.filter(c => c.url.startsWith('/.netlify/functions/ghl-proxy'));

/** Run one transition against a fixed ghl-write response; return the result and the calls made. */
async function transitionWith(writeResponse, version = nextVersion()) {
  calls = []; signIn();
  route = (url) => {
    if (url === '/.netlify/functions/ghl-write') return typeof writeResponse === 'function' ? writeResponse() : writeResponse;
    throw new Error('unexpected ' + url);
  };
  const result = await ghl.opportunities.transitionToUnderContractStage(OPP, AGREEMENT, version);
  route = null;
  return result;
}

(async () => {
  // ---- 1. the classifier, directly ------------------------------------------------
  const expected = { opportunityId: OPP, expectedPipelineId: PIPE, targetStageId: STAGE };
  await check('model: 200 + confirmed + exact readback is the ONLY confirmed shape', () => {
    assert.deepEqual(model.classifyStageTransitionResponse({ status: 200, body: { confirmed: true, alreadyInStage: false, readback: readback() }, ...expected }), { kind: 'confirmed', alreadyInStage: false });
    for (const [label, status, body] of [
      ['202 indeterminate', 202, { outcome: 'indeterminate', error: 'x' }],
      ['200 missing confirmed', 200, { readback: readback() }],
      ['200 confirmed:false', 200, { confirmed: false, readback: readback() }],
      ['200 confirmed:"true" (string)', 200, { confirmed: 'true', readback: readback() }],
      ['200 confirmed, no readback', 200, { confirmed: true }],
      ['200 confirmed, readback wrong stage', 200, { confirmed: true, readback: readback({ pipelineStageId: CLOSED_WON }) }],
      ['200 confirmed, readback wrong pipeline', 200, { confirmed: true, readback: readback({ pipelineId: 'other' }) }],
      ['200 confirmed, readback other opportunity', 200, { confirmed: true, readback: readback({ id: 'other' }) }],
      ['201 confirmed + readback', 201, { confirmed: true, readback: readback() }],
      ['409', 409, { error: 'Write refused or unconfirmed' }],
      ['500', 500, { error: 'boom' }],
      ['200 unparseable body', 200, null],
    ]) assert.equal(model.classifyStageTransitionResponse({ status, body, ...expected }).kind, 'uncertain', label);
  });
  await check('model: 400/401/403/405 are refused before dispatch', () => {
    for (const status of [400, 401, 403, 405]) assert.equal(model.classifyStageTransitionResponse({ status, body: { error: 'e' }, ...expected }).kind, 'refused', String(status));
  });
  await check('model: the uncertain message forbids a retry and demands a fresh independent GHL read', () => {
    assert.match(model.STAGE_TRANSITION_UNCERTAIN_MESSAGE, /NOT confirmed/);
    assert.match(model.STAGE_TRANSITION_UNCERTAIN_MESSAGE, /Do not retry/);
    assert.match(model.STAGE_TRANSITION_UNCERTAIN_MESSAGE, /fresh, independent read of this opportunity from GHL/);
  });
  await check('model: fresh-read resolution', () => {
    const r = (fresh) => model.resolveUncertainStageTransition({ fresh, ...expected });
    assert.equal(r({ opportunity: readback() }), 'in_target_stage');
    assert.equal(r(readback()), 'in_target_stage');
    assert.equal(r({ opportunity: readback({ pipelineStageId: 'seller-offer-sent' }) }), 'not_in_target');
    assert.equal(r({ opportunity: readback({ pipelineId: 'other' }) }), 'not_in_target');
    for (const bad of [null, undefined, {}, { opportunity: null }, { opportunity: readback({ id: 'other' }) }, { opportunity: { id: OPP } }]) assert.equal(r(bad), 'still_uncertain');
  });

  // ---- 2. the real browser writer ----------------------------------------------------
  await check('200 confirmed with exact readback -> confirmed (success), one write', async () => {
    const result = await transitionWith(json({ confirmed: true, alreadyInStage: false, readback: readback() }));
    assert.deepEqual(result, { kind: 'confirmed', alreadyInStage: false });
    assert.equal(writes().length, 1);
    assert.equal(writes()[0].body.operation, 'opportunity.underContractStage');
    assert.deepEqual(Object.keys(writes()[0].body.args).sort(), ['agreementAt', 'version']);
  });
  await check('server idempotence preserved: 200 confirmed alreadyInStage -> confirmed, alreadyInStage true', async () => {
    assert.deepEqual(await transitionWith(json({ confirmed: true, alreadyInStage: true, readback: readback() })), { kind: 'confirmed', alreadyInStage: true });
  });
  await check('409 indeterminate (surfaced by writeCommand as 202) -> uncertain, NOT success', async () => {
    const result = await transitionWith(json({ outcome: 'indeterminate', error: 'Stage transition submitted; readback unavailable. Do not retry blindly' }, 409));
    assert.equal(result.kind, 'uncertain');
    assert.equal(result.message, model.STAGE_TRANSITION_UNCERTAIN_MESSAGE);
  });
  await check('200 with no confirmed flag -> uncertain', async () => {
    assert.equal((await transitionWith(json({ readback: readback() }))).kind, 'uncertain');
  });
  await check('200 confirmed:false -> uncertain', async () => {
    assert.equal((await transitionWith(json({ confirmed: false, readback: readback() }))).kind, 'uncertain');
  });
  await check('readback mismatch (Seller Closed-Won) despite confirmed:true -> uncertain', async () => {
    assert.equal((await transitionWith(json({ confirmed: true, readback: readback({ pipelineStageId: CLOSED_WON }) }))).kind, 'uncertain');
  });
  await check('readback in the wrong pipeline despite confirmed:true -> uncertain', async () => {
    assert.equal((await transitionWith(json({ confirmed: true, readback: readback({ pipelineId: 'other-pipeline' }) }))).kind, 'uncertain');
  });
  await check('generic 409 "refused or unconfirmed" -> uncertain', async () => {
    assert.equal((await transitionWith(json({ error: 'Write refused or unconfirmed; refresh and inspect before retrying' }, 409))).kind, 'uncertain');
  });
  await check('500 and a network failure after sending -> uncertain', async () => {
    assert.equal((await transitionWith(json({ error: 'x' }, 500))).kind, 'uncertain');
    assert.equal((await transitionWith(() => { throw new TypeError('network down'); })).kind, 'uncertain');
  });
  await check('401/403/400 -> refused (nothing reached GHL)', async () => {
    for (const status of [401, 403, 400]) assert.equal((await transitionWith(json({ error: 'e' }, status))).kind, 'refused', String(status));
  });
  await check('no write session -> refused, and no request is sent', async () => {
    calls = []; writeSession.setAppWriteSession(null); route = () => json({});
    const result = await ghl.opportunities.transitionToUnderContractStage(OPP, AGREEMENT, nextVersion());
    route = null;
    assert.equal(result.kind, 'refused');
    assert.deepEqual(calls, []);
  });

  // ---- 3. no blind retry, and recovery after a fresh read -----------------------------
  const indeterminate = () => json({ outcome: 'indeterminate', error: 'unresolved' }, 409);
  await check('no blind retry: a re-send after "uncertain" reuses the SAME requestId (the server refuses it as a duplicate)', async () => {
    const v = nextVersion();
    await transitionWith(indeterminate, v);
    const first = writes()[0].body.requestId;
    await transitionWith(indeterminate, v);
    assert.equal(writes()[0].body.requestId, first);
  });
  await check('recovery: fresh read shows the stage landed -> in_target_stage; only a GET, no write', async () => {
    const v = nextVersion();
    await transitionWith(indeterminate, v);
    calls = []; route = () => json({ opportunity: readback() });
    assert.equal(await ghl.opportunities.recheckUnderContractStage(OPP, AGREEMENT, v), 'in_target_stage');
    route = null;
    assert.equal(writes().length, 0);
    assert.equal(reads().length, 1);
    assert.equal(reads()[0].method, 'GET');
  });
  await check('recovery: fresh read shows NOT in stage -> not_in_target, and the next deliberate attempt is a NEW request', async () => {
    const v = nextVersion();
    await transitionWith(indeterminate, v);
    const held = writes()[0].body.requestId;
    calls = []; route = () => json({ opportunity: readback({ pipelineStageId: 'seller-offer-sent' }) });
    assert.equal(await ghl.opportunities.recheckUnderContractStage(OPP, AGREEMENT, v), 'not_in_target');
    route = null;
    const result = await transitionWith(json({ confirmed: true, alreadyInStage: false, readback: readback() }), v);
    assert.notEqual(writes()[0].body.requestId, held);
    assert.equal(result.kind, 'confirmed');
  });
  await check('recovery: a failed fresh read settles nothing -> still_uncertain, and the requestId stays held', async () => {
    const v = nextVersion();
    await transitionWith(indeterminate, v);
    const held = writes()[0].body.requestId;
    for (const failure of [() => json({ message: 'boom' }, 500), () => json({ error: 'Sign in to read IAOS data', by: 'iaos-app-read-auth' }, 401), () => json({ opportunity: readback({ id: 'someone-else' }) })]) {
      calls = []; route = failure;
      assert.equal(await ghl.opportunities.recheckUnderContractStage(OPP, AGREEMENT, v), 'still_uncertain');
      route = null;
    }
    await transitionWith(indeterminate, v);
    assert.equal(writes()[0].body.requestId, held);
  });

  // ---- 4. Contract Workspace wiring (no DOM harness in this repo; source checks) --------
  const cw = fs.readFileSync(path.join(APP, 'src', 'pages', 'ContractWorkspace.tsx'), 'utf8').replace(/\r\n/g, '\n');
  const handler = (cw.match(/async function handleTransitionUnderContractStage\(\)[\s\S]*?\n  \}\n/) || [''])[0];
  const recheck = (cw.match(/async function handleRecheckUnderContractStage\(\)[\s\S]*?\n  \}\n/) || [''])[0];
  await check('UI: success is set ONLY from a confirmed result', () => {
    assert.match(handler, /if \(result\.kind === "confirmed"\) setStageTransitionState\(\{ kind: "success", alreadyInStage: result\.alreadyInStage \}\);\s*else setStageTransitionState\(result\);/);
    assert.equal((handler.match(/kind: "success"/g) || []).length, 1);
  });
  await check('UI: an unexpected client failure is uncertain, never "failed" and never success', () => {
    assert.match(handler, /catch \{[\s\S]*?setStageTransitionState\(\{ kind: "uncertain", message: STAGE_TRANSITION_UNCERTAIN_MESSAGE \}\);/);
    assert.doesNotMatch(cw, /stageTransitionState\.kind === "failed"|setStageTransitionState\(\{ kind: "failed"/);
  });
  await check('UI: the Transition button is disabled while uncertain or rechecking, and the handler refuses too', () => {
    assert.match(cw, /testId="contract-execution-transition-under-contract-button"[\s\S]{0,200}disabled=\{stageTransitionState\.kind === "success" \|\| stageTransitionState\.kind === "uncertain" \|\| stageTransitionState\.kind === "rechecking"\}/);
    assert.match(handler, /if \(stageTransitionState\.kind === "uncertain" \|\| stageTransitionState\.kind === "rechecking"\) return;\s*setStageTransitionState\(\{ kind: "busy" \}\);/);
  });
  await check('UI: "Read GHL again" performs only the fresh read and settles the state from it', () => {
    assert.match(cw, /testId="contract-execution-stage-transition-recheck-button"\s*onClick=\{handleRecheckUnderContractStage\}/);
    assert.match(recheck, /ghl\.opportunities\.recheckUnderContractStage\(screen\.opportunity\.id, screen\.economics\.agreementAt, documentVersion\)/);
    assert.doesNotMatch(recheck, /transitionToUnderContractStage|writeCommand|confirmedCommand|notes\.create/);
    assert.match(recheck, /resolution === "in_target_stage"\) setStageTransitionState\(\{ kind: "success", alreadyInStage: true \}\)/);
    assert.match(recheck, /resolution === "not_in_target"\) setStageTransitionState\(\{ kind: "retry_allowed"/);
    assert.match(recheck, /else setStageTransitionState\(\{ kind: "uncertain"/);
  });
  await check('UI: uncertain is rendered in amber with its own test id; refused keeps a red notice', () => {
    assert.match(cw, /data-testid="contract-execution-stage-transition-uncertain" style=\{\{ fontSize: "12px", color: "#F59E0B"/);
    assert.match(cw, /data-testid="contract-execution-stage-transition-refused"/);
  });
  await check('scope: confirmedCommand is unchanged and releasePendingWrite is used only by the stage recheck', () => {
    const wc = fs.readFileSync(path.join(APP, 'src', 'lib', 'write-command.ts'), 'utf8');
    assert.match(wc, /if \(!response\.ok \|\| result\.confirmed === false\) throw new Error/);
    const users = ['src/lib/ghl.ts', 'src/pages/ContractWorkspace.tsx', 'src/lib/write-command.ts']
      .filter(rel => /releasePendingWrite\(/.test(fs.readFileSync(path.join(APP, rel), 'utf8').replace(/export function releasePendingWrite/, '')));
    assert.deepEqual(users, ['src/lib/ghl.ts']);
    const ghlSrc = fs.readFileSync(path.join(APP, 'src', 'lib', 'ghl.ts'), 'utf8');
    assert.equal((ghlSrc.match(/releasePendingWrite\(/g) || []).length, 1);
    assert.doesNotMatch(ghlSrc, /confirmedCommand\("opportunity\.underContractStage"/);
  });

  console.log('Under Contract stage result: passed=' + passed + ' failed=' + failed);
  process.exitCode = failed ? 1 : 0;
})();
