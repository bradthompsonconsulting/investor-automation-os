/**
 * B14-12 / INV-94 — Do Not Call. Offline.
 *
 * 1. The pure rules (src/lib/dnc.ts): plan, readback verification, the note,
 *    the calling-list predicate.
 * 2. The real GhlBoundary.dnc (the server side of contact.dnc) against a fake
 *    GHL: it must send the WHOLE dndSettings object, never weaken an existing
 *    entry, skip the PUT when already complete, and fail closed (WriteUncertain)
 *    when GHL rejects the write or reads back anything but suppression — both
 *    for a merge-style and a replace-style GHL.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const APP = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  if (name.startsWith('.') && parent) {
    const candidate = path.resolve(path.dirname(parent.filename), name + '.ts');
    if (fs.existsSync(candidate)) return candidate;
  }
  return originalResolve.call(this, name, parent, ...rest);
};
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);

const dnc = require(path.join(APP, 'src/lib/dnc.ts'));
const { GhlBoundary, WriteUncertain } = require(path.join(APP, 'netlify/functions/lib/ghl-write-boundary.ts'));

let checks = 0, failures = 0;
async function check(name, fn) {
  checks += 1;
  try { await fn(); console.log('PASS  ' + name); }
  catch (e) { failures += 1; console.error('FAIL  ' + name + '\n      ' + (e && e.message)); }
}

const STOP = { status: 'permanent', message: 'STOP_KEYWORD' };
const UNSUB = { status: 'active', message: 'User clicked on the unsubscribe link' };
const TWILIO = { status: 'active', message: 'TWILIO_ERROR_CODE: 30006' };
const IAOS = { status: 'active', message: 'IAOS Do Not Call' };

(async () => {
  // ── 1. Pure rules ───────────────────────────────────────────────────────
  await check('plan, no DND: Call, SMS and Email become active with the IAOS message', () => {
    const p = dnc.planDnc({});
    assert.deepEqual(p.changed, ['Call', 'SMS', 'Email']);
    assert.deepEqual(p.next, { Call: IAOS, SMS: IAOS, Email: IAOS });
  });
  await check('plan, a missing or malformed dndSettings is treated as none', () => {
    for (const v of [undefined, null, [], 'x']) assert.deepEqual(dnc.planDnc(v).changed, ['Call', 'SMS', 'Email']);
  });
  await check('plan never weakens: STOP (SMS, RCS), unsubscribe (Email) and Twilio entries are kept exactly', () => {
    const before = { SMS: STOP, RCS: STOP, Email: UNSUB };
    const p = dnc.planDnc(before);
    assert.deepEqual(p.changed, ['Call']);
    assert.deepEqual(p.next, { SMS: STOP, RCS: STOP, Email: UNSUB, Call: IAOS });
    const p2 = dnc.planDnc({ SMS: TWILIO });
    assert.deepEqual(p2.next.SMS, TWILIO);
    assert.deepEqual(p2.changed, ['Call', 'Email']);
  });
  await check('plan: an inactive target channel is replaced; other channels (e.g. WhatsApp) carried through', () => {
    const p = dnc.planDnc({ Call: { status: 'inactive', message: '' }, WhatsApp: { status: 'inactive' } });
    assert.deepEqual(p.next.Call, IAOS);
    assert.deepEqual(p.next.WhatsApp, { status: 'inactive' });
  });
  await check('plan: already complete -> nothing changes', () => {
    assert.deepEqual(dnc.planDnc({ Call: IAOS, SMS: STOP, Email: UNSUB }).changed, []);
  });
  await check('the calling-list predicate reads the Call channel only (any cause); STOP on SMS alone does not exclude', () => {
    assert.equal(dnc.isCallSuppressed({ Call: IAOS }), true);
    assert.equal(dnc.isCallSuppressed({ Call: { status: 'permanent', message: 'x' } }), true);
    assert.equal(dnc.isCallSuppressed({ SMS: STOP, RCS: STOP }), false);
    assert.equal(dnc.isCallSuppressed({ Call: { status: 'inactive' } }), false);
    assert.equal(dnc.isCallSuppressed(undefined), false);
    assert.equal(dnc.isDncComplete({ Call: IAOS, SMS: STOP, Email: UNSUB }), true);
    assert.equal(dnc.isDncComplete({ Call: IAOS, SMS: STOP }), false);
  });
  await check('verify: suppression of all three, everything else unchanged -> ok', () => {
    const before = { SMS: STOP, RCS: STOP };
    assert.deepEqual(dnc.verifyDnc(before, ['Call', 'Email'], { SMS: STOP, RCS: STOP, Call: IAOS, Email: IAOS }), { ok: true });
  });
  await check('verify fails closed: a target not suppressed, an untouched channel dropped or altered, a changed channel not active', () => {
    const before = { SMS: STOP, RCS: STOP };
    assert.equal(dnc.verifyDnc(before, ['Call', 'Email'], { SMS: STOP, RCS: STOP, Call: IAOS }).ok, false);              // Email missing
    assert.equal(dnc.verifyDnc(before, ['Call', 'Email'], { SMS: STOP, Call: IAOS, Email: IAOS }).ok, false);            // RCS dropped
    assert.equal(dnc.verifyDnc(before, ['Call', 'Email'], { SMS: IAOS, RCS: STOP, Call: IAOS, Email: IAOS }).ok, false); // STOP rewritten
    assert.equal(dnc.verifyDnc({}, ['Call'], { Call: { status: 'permanent' }, SMS: STOP, Email: UNSUB }).ok, false);     // changed but not active
  });
  await check('note: exact two lines, written only for a 1–500 character single-line reason', () => {
    const n = dnc.dncNote('  Seller asked us not to contact them again.  ');
    assert.equal(n, 'Do Not Call (recorded by Brad in IAOS): Seller asked us not to contact them again.\nSuppressed in GHL: calls, SMS and email.');
    assert.equal(dnc.isDncNoteBody(n), true);
    assert.equal(dnc.isDncNoteBody(dnc.dncNote('x'.repeat(500))), true);
    for (const bad of [dnc.dncNote('x'.repeat(501)), 'Do Not Call (recorded by Brad in IAOS): \nSuppressed in GHL: calls, SMS and email.',
      'Do Not Call (recorded by Brad in IAOS):  padded\nSuppressed in GHL: calls, SMS and email.', 'Do Not Call (recorded by Brad in IAOS): a\nb\nSuppressed in GHL: calls, SMS and email.',
      'Do Not Call (recorded by Brad in IAOS): a\nSuppressed in GHL: calls.', 'IAOS Do Not Call: a\nSuppressed in GHL: calls, SMS and email.', 'plain note', null]) {
      assert.equal(dnc.isDncNoteBody(bad), false, JSON.stringify(bad));
    }
  });
  await check('note: never starts with "IAOS " (the server note guard refuses undeclared IAOS-prefixed ledgers)', () => {
    assert.equal(dnc.dncNote('x').startsWith('IAOS '), false);
  });
  await check('copy: consequence names all three channels, existing opt-outs kept, and removal in GHL', () => {
    assert.ok(/calls, text messages and email/.test(dnc.DNC_CONSEQUENCE) && /Existing opt-outs such as STOP stay in place/.test(dnc.DNC_CONSEQUENCE) && /Removing Do Not Call later is done in GHL/.test(dnc.DNC_CONSEQUENCE));
  });

  // ── 2. GhlBoundary.dnc against a fake GHL ───────────────────────────────
  const LOC = 'fixture-location';
  function fakeGhl({ initial, mode = 'merge', putStatus = 200, dropOnWrite = null }) {
    const contact = { id: 'c1', locationId: LOC, customFields: [], dndSettings: JSON.parse(JSON.stringify(initial)) };
    const calls = [];
    const fetcher = async (url, init = {}) => {
      const method = init.method || 'GET';
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: new URL(url).pathname, body });
      if (method === 'PUT') {
        if (putStatus !== 200) return { ok: false, status: putStatus, json: async () => ({}) };
        const sent = body.dndSettings;
        contact.dndSettings = mode === 'replace' ? JSON.parse(JSON.stringify(sent)) : { ...contact.dndSettings, ...JSON.parse(JSON.stringify(sent)) };
        if (dropOnWrite) delete contact.dndSettings[dropOnWrite];
        return { ok: true, status: 200, json: async () => ({ contact }) };
      }
      return { ok: true, status: 200, json: async () => ({ contact: JSON.parse(JSON.stringify(contact)) }) };
    };
    return { contact, calls, boundary: new GhlBoundary('token', LOC, fetcher) };
  }
  for (const mode of ['merge', 'replace']) {
    await check(`boundary (${mode}-style GHL): sends the WHOLE object, keeps STOP and unsubscribe, confirms suppression`, async () => {
      const g = fakeGhl({ initial: { SMS: STOP, RCS: STOP, Email: UNSUB }, mode });
      const before = await g.boundary.contact('c1');
      const r = await g.boundary.dnc('c1', before);
      const put = g.calls.find((c) => c.method === 'PUT');
      assert.deepEqual(put.body, { dndSettings: { SMS: STOP, RCS: STOP, Email: UNSUB, Call: IAOS } });
      assert.deepEqual(Object.keys(put.body), ['dndSettings'], 'no top-level dnd, no other field');
      assert.deepEqual(g.contact.dndSettings, { SMS: STOP, RCS: STOP, Email: UNSUB, Call: IAOS });
      assert.deepEqual(r.changed, ['Call']);
      assert.equal(r.alreadySuppressed, false);
      assert.deepEqual(r.readback.channels.Call, { status: 'active', message: 'IAOS Do Not Call' });
    });
  }
  await check('boundary: already complete -> no PUT, readback still confirms', async () => {
    const g = fakeGhl({ initial: { Call: IAOS, SMS: STOP, Email: UNSUB } });
    const r = await g.boundary.dnc('c1', await g.boundary.contact('c1'));
    assert.equal(g.calls.filter((c) => c.method === 'PUT').length, 0);
    assert.equal(r.alreadySuppressed, true);
  });
  await check('boundary: GHL rejects the write -> WriteUncertain, never confirmed', async () => {
    const g = fakeGhl({ initial: {}, putStatus: 422 });
    await assert.rejects(g.boundary.dnc('c1', await g.boundary.contact('c1')), (e) => e instanceof WriteUncertain && /not accepted/.test(e.message));
  });
  await check('boundary: GHL drops an existing restriction on write -> WriteUncertain names it', async () => {
    const g = fakeGhl({ initial: { SMS: STOP, RCS: STOP }, dropOnWrite: 'RCS' });
    await assert.rejects(g.boundary.dnc('c1', await g.boundary.contact('c1')), (e) => e instanceof WriteUncertain && /RCS changed/.test(e.message));
  });
  await check('boundary: GHL accepts but a target does not read back suppressed -> WriteUncertain', async () => {
    const g = fakeGhl({ initial: {}, dropOnWrite: 'Email' });
    await assert.rejects(g.boundary.dnc('c1', await g.boundary.contact('c1')), (e) => e instanceof WriteUncertain && /Email is not suppressed/.test(e.message));
  });

  // ── 3. The operation contract ───────────────────────────────────────────
  const contracts = require(path.join(APP, 'netlify/functions/lib/write-contracts.ts'));
  const { getConfig } = require(path.join(APP, 'shared/ghl-config.ts'));
  await check('contact.dnc: only {confirm: "DO_NOT_CALL"}; plans the dnd kind with no custom field', () => {
    assert.deepEqual(contracts.planWrite('contact.dnc', { confirm: 'DO_NOT_CALL' }, getConfig('test')), { kind: 'contact_dnd', fields: [] });
    for (const args of [{}, { confirm: 'yes' }, { confirm: 'DO_NOT_CALL', channels: ['Call'] }, { confirm: 'DO_NOT_CALL', status: 'inactive' }]) {
      assert.throws(() => contracts.planWrite('contact.dnc', args, getConfig('test')), undefined, JSON.stringify(args));
    }
  });
  await check('the dialer webhook list is unchanged: Do Not Call is still not one of its six', () => {
    assert.equal(contracts.dispositions.includes('Do Not Call'), false);
    assert.equal(contracts.dispositions.length, 6);
  });

  console.log(`\nB14-12 Do Not Call: ${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
})();
