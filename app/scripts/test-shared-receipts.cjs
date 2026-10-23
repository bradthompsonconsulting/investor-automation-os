/**
 * Shared receipt helpers (claimWrite, lockContact + release, claimStageTransition, clearStageTransition):
 * recorded-result classification and no SDK retries -- offline.
 *
 * REAL: the pinned @netlify/blobs 11.1.0 (hash asserted) in edge mode via the real connectLambda, the real
 * write-receipts.ts, ghl-disposition.ts and ghl-write.ts. NODE_ENV is NOT "test", so the SDK's retry delay is
 * its production 5 s and an unsuppressed retry shows as a >= 1 s SDK timer (and, in R5, as a second DELETE).
 * FAKE: global.fetch answers the Blobs edge and GHL from in-memory state; any other origin fails the run.
 * Scope: the inspected callers only. Nothing here is a general ownership guarantee against arbitrary repeated
 * releases or external cleanup, and nothing proves Netlify or GHL behaviour.
 */
'use strict';
delete process.env.NODE_ENV;
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const APP = path.resolve(__dirname, '..');
/** Literal count of check() executions below (loops expanded by hand); never back-filled from a run. */
const FLOOR = 34;
let checks = 0; let failures = 0;
function check(name, ok, detail) {
  checks += 1; if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

// --- timer spy: classified by the frame that called setTimeout ---
const realSetTimeout = global.setTimeout;
const timers = []; let timerSeq = 0;
global.setTimeout = function (fn, ms, ...a) { const top = (new Error().stack || '').split(String.fromCharCode(10))[2] || ''; timers.push({ id: ++timerSeq, ms: Number(ms) || 0, sdk: /@netlify[\\/+]blobs/.test(top) }); return realSetTimeout(fn, ms, ...a); };
const tmark = () => timerSeq;
const sdkSleeps = (m) => timers.filter((t) => t.id > m && t.sdk && t.ms >= 1000).length;
const wait = (ms) => new Promise((r) => realSetTimeout(r, ms));

// --- loader: .ts through the TypeScript transpiler; the real SDK ---
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  if (name.startsWith('.') && parent) { const c = path.resolve(path.dirname(parent.filename), name + '.ts'); if (fs.existsSync(c)) return c; }
  return originalResolve.call(this, name, parent, ...rest);
};
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const appRequire = Module.createRequire(path.join(APP, 'package.json'));
const SDK_SHA = crypto.createHash('sha256').update(fs.readFileSync(appRequire.resolve('@netlify/blobs').replace(/main\.js$/, 'main.cjs'))).digest('hex');

Object.assign(process.env, {
  IAOS_ENV: 'test', IAOS_WEBHOOK_SECRET: 'offline-disposition-secret', GHL_PRIVATE_API_KEY: 'offline-ghl-token', GHL_API_TOKEN: 'offline-ghl-token',
  IAOS_APP_WRITE_GOOGLE_CLIENT_ID: 'offline-client', IAOS_APP_WRITE_BRAD_EMAILS: 'brad@example.invalid',
  IAOS_APP_WRITE_SESSION_SECRET: 'offline-fixture-only-not-a-real-secret', IAOS_APP_WRITE_ALLOWED_ORIGIN: 'https://proof.example.invalid',
});
delete process.env.NETLIFY_BLOBS_CONTEXT; delete globalThis.netlifyBlobsContext;
const { getConfig } = require('../shared/ghl-config.ts');
const { connectLambda } = require('@netlify/blobs');
const R = require('../netlify/functions/lib/write-receipts.ts');
const { WriteUncertain } = require('../netlify/functions/lib/ghl-write-boundary.ts');
const disposition = require('../netlify/functions/ghl-disposition.ts').handler;
const ghlWrite = require('../netlify/functions/ghl-write.ts').handler;
const auth = require('../netlify/functions/lib/app-write-auth.ts');
const LOC = getConfig('test').locationId;

// --- fake transport ---
const EDGE = 'https://blobs.example.invalid'; const SITE = 'offline-site';
const blobs = new Map(); const log = []; let rules = []; const blocked = [];
const contact = { id: 'fixture-contact', locationId: LOC, customFields: [] }; const notes = [];
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status });
/** A rule applies to the next matching edge request: { method, status?, apply?:bool, fail?:'throw'|'abort' }. */
const rule = (...r) => { rules.push(...r); };
global.fetch = async (url, init = {}) => {
  const u = new URL(url); const method = (init.method || 'GET').toUpperCase();
  if (u.origin === EDGE) {
    log.push({ method, path: u.pathname });
    const i = rules.findIndex((r) => r.method === method); const r = i >= 0 ? rules.splice(i, 1)[0] : null;
    const headers = new Headers(init.headers);
    const apply = () => { if (method === 'PUT') { if (headers.get('if-none-match') === '*' && blobs.has(u.pathname)) return 412; blobs.set(u.pathname, String(init.body)); return 200; } if (method === 'DELETE') { blobs.delete(u.pathname); return 204; } return blobs.has(u.pathname) ? 200 : 404; };
    if (r && r.fail && !r.apply) { const e = new Error(r.fail === 'abort' ? 'aborted' : 'fetch failed'); e.name = r.fail === 'abort' ? 'AbortError' : 'TypeError'; throw e; }
    if (r && r.apply) { apply(); const e = new TypeError('fetch failed: the response was lost'); throw e; } // sent and applied, response lost
    if (r && r.status) return new Response(null, { status: r.status });
    const s = apply();
    return new Response(method === 'GET' && s === 200 ? blobs.get(u.pathname) : null, { status: s, headers: s === 200 && method === 'PUT' ? { etag: '"e"' } : {} });
  }
  if (u.origin !== 'https://services.leadconnectorhq.com') { blocked.push(u.origin); throw new Error('offline guard: blocked ' + u.origin); }
  if (u.pathname === `/contacts/${contact.id}/notes`) {
    if (method === 'POST') { notes.push({ id: `note-${notes.length}`, body: JSON.parse(init.body).body, dateAdded: new Date().toISOString() }); return reply({ note: notes.at(-1) }); }
    return reply({ notes });
  }
  if (u.pathname === `/contacts/${contact.id}`) {
    if (method === 'PUT') contact.customFields = JSON.parse(init.body).customFields.map((f) => ({ id: f.id, value: f.field_value }));
    return reply({ contact });
  }
  return reply({}, 404);
};
const lambda = { blobs: Buffer.from(JSON.stringify({ url: EDGE, token: 'offline-blob-token' })).toString('base64'), headers: { 'x-nf-site-id': SITE, 'x-nf-deploy-id': 'offline-deploy' } };
connectLambda(lambda);
const reset = () => { rules = []; log.length = 0; };
const puts = (m) => log.slice(m).filter((x) => x.method === 'PUT').length;
const dels = (m) => log.slice(m).filter((x) => x.method === 'DELETE').length;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const pathOf = (key) => `/${SITE}/site:iaos-write-receipts/${key}`;

(async () => {
  check('S0 the pinned SDK is @netlify/blobs 11.1.0 main.cjs 24ddd49a…', SDK_SHA === '24ddd49a4768546302122ba2360c8dba3137fae2158d8c93c2102c8bfcd465e5', SDK_SHA);

  // ------------------------------------------------- RS1: creates, every outcome class, all three helpers ---
  let n = 0;
  const helpers = {
    claimWrite: { run: () => R.claimWrite('op:x:t', `req-${++n}`, { a: n }), cls: WriteUncertain, msg: 'Duplicate or unresolved request; read back before retrying' },
    lockContact: { run: () => R.lockContact(`contact-${++n}`), cls: WriteUncertain, msg: 'Another write is in progress or unresolved; inspect before retrying' },
    claimStageTransition: { run: () => R.claimStageTransition(`opp-${++n}`, 'req', 'op'), cls: R.StageTransitionUnresolved, msg: 'An earlier Under Contract stage transition for this opportunity is unresolved; inspect before retrying' },
  };
  const attempt = async (h) => { try { const v = await h.run(); return { ok: true, v }; } catch (e) { return { ok: false, e }; } };
  const refusedLike = (h, o) => !o.ok && o.e instanceof h.cls && o.e.message === h.msg;
  for (const [name, h] of Object.entries(helpers)) {
    { reset(); const m = log.length; const o = await attempt(h);
      check(`RS1 ${name}: one 2xx -> accepted (lock: a release is returned); 1 PUT, 0 DELETE`, o.ok && (name !== 'lockContact' || typeof o.v === 'function') && puts(m) === 1 && dels(m) === 0, [o.ok, puts(m)]); }
    { reset(); const m = log.length; rule({ method: 'PUT', status: 412 }); const o = await attempt(h);
      check(`RS1 ${name}: 412 -> refused with the unchanged class and message; 1 PUT, 0 DELETE`, refusedLike(h, o) && puts(m) === 1 && dels(m) === 0, o.e && o.e.message); }
    { const res = [];
      for (const s of [400, 401, 403, 404]) { reset(); const m = log.length; rule({ method: 'PUT', status: s }); const o = await attempt(h); res.push(refusedLike(h, o) && puts(m) === 1 && dels(m) === 0); }
      check(`RS1 ${name}: 400/401/403/404 -> refused (not "modified"), 1 PUT each, 0 DELETE`, res.every(Boolean), res); }
    { const res = [];
      for (const s of [429, 500, 503]) { reset(); const m = log.length; const t = tmark(); rule({ method: 'PUT', status: s }); const o = await attempt(h); res.push(refusedLike(h, o) && puts(m) === 1 && sdkSleeps(t) === 0 && dels(m) === 0); }
      check(`RS1 ${name}: 429/500/503 -> refused, exactly 1 PUT each, 0 SDK retry sleeps, 0 DELETE`, res.every(Boolean), res); }
    { reset(); const m = log.length; const t = tmark(); rule({ method: 'PUT', fail: 'throw' }); const o = await attempt(h);
      check(`RS1 ${name}: a thrown request -> refused; 1 PUT; no retry, no SDK sleep`, refusedLike(h, o) && puts(m) === 1 && sdkSleeps(t) === 0, [o.e && o.e.message, puts(m)]); }
    { reset(); const m = log.length; rule({ method: 'PUT', fail: 'abort' }); const o = await attempt(h);
      check(`RS1 ${name}: an aborted request -> refused; 1 PUT; no retry`, refusedLike(h, o) && puts(m) === 1, [o.e && o.e.message, puts(m)]); }
    { reset(); const before = new Set(blobs.keys()); const m = log.length; rule({ method: 'PUT', apply: true }); const o = await attempt(h); const added = [...blobs.keys()].filter((k) => !before.has(k));
      check(`RS1 ${name}: sent and STORED but the response lost -> refused (uncertain); the stored record is kept, never deleted or retried`, refusedLike(h, o) && puts(m) === 1 && dels(m) === 0 && added.length === 1, [added.length, dels(m)]); }
  }

  // ------------------------------------------------------------------------- RS2/RS3: releases ---
  { const res = [];
    for (const s of [200, 204, 404]) { reset(); const rel = await R.lockContact(`rel-${s}`); const m = log.length; rule({ method: 'DELETE', status: s }); let threw = false; try { await rel(); } catch { threw = true; } res.push(!threw && dels(m) === 1); }
    check('RS2 lock release: 200/204/404 -> resolves, exactly 1 DELETE each', res.every(Boolean), res); }
  { const res = []; const warn = console.warn; let warned = 0; console.warn = () => { warned += 1; };
    for (const r of [{ status: 400 }, { status: 500 }, { fail: 'throw' }]) { reset(); const key = `relf-${JSON.stringify(r)}`; const rel = await R.lockContact(key); const m = log.length; const t = tmark(); rule({ method: 'DELETE', ...r }); let threw = false; try { await rel(); } catch { threw = true; }
      res.push(!threw && dels(m) === 1 && sdkSleeps(t) === 0 && blobs.has(pathOf(`lock/${sha(LOC + key)}`))); }
    console.warn = warn;
    check('RS2 lock release unconfirmed (400 / 500 / thrown): never throws, 1 DELETE, no retry, the lock stays (fail closed), logged', res.every(Boolean) && warned === 3, [res, warned]); }
  { reset(); const rel = await R.lockContact('single-use'); await rel(); const b = await R.lockContact('single-use'); const m = log.length; await rel();
    check('RS2 a release is single-use: calling it again after another caller re-acquired sends nothing; the new lock stays', dels(m) === 0 && blobs.has(pathOf(`lock/${sha(LOC + 'single-use')}`)) && typeof b === 'function'); await b(); }
  { const res = [];
    reset(); await R.claimStageTransition('opp-clear-ok', 'r', 'o'); let m = log.length; let threw = false; try { await R.clearStageTransition('opp-clear-ok'); } catch { threw = true; } res.push(!threw && dels(m) === 1);
    for (const r of [{ status: 500 }, { fail: 'throw' }]) { reset(); await R.claimStageTransition(`opp-clear-${r.status || 'x'}`, 'r', 'o'); m = log.length; const t = tmark(); rule({ method: 'DELETE', ...r }); threw = false; try { await R.clearStageTransition(`opp-clear-${r.status || 'x'}`); } catch { threw = true; }
      res.push(threw && dels(m) === 1 && sdkSleeps(t) === 0 && blobs.has(pathOf(R.stageTransitionMarkerKey(`opp-clear-${r.status || 'x'}`)))); }
    check('RS3 clearStageTransition: 204 -> resolves; unconfirmed -> still THROWS (INV-98: never success), 1 DELETE, no retry, the marker stays', res.every(Boolean), res); }

  // ----------------------------------------- RS4: a delete lands, its response is lost, another caller re-acquires ---
  { reset(); const relA = await R.lockContact('aba-contact'); const lockPath = pathOf(`lock/${sha(LOC + 'aba-contact')}`);
    await R.claimStageTransition('aba-opp', 'reqA', 'opA'); const markerPath = pathOf(R.stageTransitionMarkerKey('aba-opp'));
    const m = log.length; const t = tmark();
    rule({ method: 'DELETE', apply: true }); await relA();                                  // A's lock DELETE lands; A never hears back
    const relB = await R.lockContact('aba-contact');                                         // B re-acquires the same contact
    rule({ method: 'DELETE', apply: true }); let clearThrew = false; try { await R.clearStageTransition('aba-opp'); } catch { clearThrew = true; }
    await R.claimStageTransition('aba-opp', 'reqB', 'opB');                                  // B claims the marker again
    const bMarker = blobs.get(markerPath);
    await wait(5_600);                                                                        // past the SDK's 5 s retry delay
    check('RS4a lock: A\'s DELETE lands with its response lost; B re-acquires; 5.6 s later A sent no 2nd DELETE and B\'s lock still exists', typeof relB === 'function' && blobs.has(lockPath) && log.slice(m).filter((x) => x.method === 'DELETE' && x.path === lockPath).length === 1 && sdkSleeps(t) === 0, log.slice(m).map((x) => x.method));
    check('RS4b marker: A\'s clear lands with its response lost (it throws); B claims again; 5.6 s later no 2nd DELETE and B\'s marker is the stored one', clearThrew && blobs.get(markerPath) === bMarker && JSON.parse(bMarker).requestIdDigest === sha('reqB') && log.slice(m).filter((x) => x.method === 'DELETE' && x.path === markerPath).length === 1);
    await relB(); }

  // --------------------------------------------- RS5: same keys and records as before (independent derivation) ---
  { const RealDate = Date; const FIXED = RealDate.UTC(2026, 9, 23, 12, 0, 0); const iso = new RealDate(FIXED).toISOString(); const rows = [];
    try {
      global.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [FIXED])); } static now() { return FIXED; } };
      reset(); blobs.clear();
      await R.claimWrite('op:repair:x', 'req-k', { a: 1 });
      rows.push(blobs.get(pathOf(sha('test:op:repair:x:req-k'))) === JSON.stringify({ fingerprint: sha(JSON.stringify({ a: 1 })), claimedAt: iso }));
      const rel = await R.lockContact('contact-k');
      rows.push(blobs.get(pathOf(`lock/${sha(LOC + 'contact-k')}`)) === JSON.stringify({ claimedAt: iso }));
      await R.claimStageTransition('opp-k', 'req-k', 'op-k');
      rows.push(blobs.get(pathOf(R.stageTransitionMarkerKey('opp-k'))) === JSON.stringify({ kind: 'under-contract-stage-transition', requestIdDigest: sha('req-k'), operatorDigest: sha('op-k'), claimedAt: iso }));
      await rel();
    } finally { global.Date = RealDate; }
    check('RS5 frozen clock: claim / lock / marker keys and stored JSON equal the independent derivation (unchanged formats); clock restored', rows.length === 3 && rows.every(Boolean) && global.Date === RealDate, rows); }

  // ------------------------------------------------------ RS6: release failure after a successful protected write ---
  const dispEvent = () => ({ httpMethod: 'POST', headers: { 'x-iaos-secret': process.env.IAOS_WEBHOOK_SECRET, ...lambda.headers }, blobs: lambda.blobs,
    body: JSON.stringify({ customData: { contact_id: contact.id, disposition: 'No Answer', duration: '5' } }) });
  const lockKeyPath = pathOf(`lock/${sha(LOC + contact.id)}`);
  { reset(); blobs.delete(lockKeyPath); const notesBefore = notes.length; const warn = console.warn; console.warn = () => {};
    rule({ method: 'DELETE', status: 500 }); let res; let threw = null; try { res = await disposition(dispEvent()); } catch (e) { threw = e; } console.warn = warn;
    check('RS6a ghl-disposition: the note and attempt land, then the lock release fails in `finally` -> still 200 ok (not a refusal or thrown error); the lock stays', !threw && res && res.statusCode === 200 && JSON.parse(res.body).ok === true && notes.length === notesBefore + 1 && blobs.has(lockKeyPath), [threw && threw.message, res && res.statusCode]); }
  { // control: with the lock still held (from RS6a), the existing refusal is unchanged and nothing is written
    const notesBefore = notes.length; const res = await disposition(dispEvent());
    check('RS6b control: the lock left by RS6a is held -> the existing 409 "Disposition deduplication unavailable; no blind retry write", no note', res.statusCode === 409 && /deduplication unavailable/.test(res.body) && notes.length === notesBefore, res.body);
    blobs.delete(lockKeyPath); }
  { reset(); const notesBefore = notes.length; const warn = console.warn; console.warn = () => {};
    const e = { blobs: lambda.blobs, httpMethod: 'POST', headers: { ...lambda.headers, origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN, authorization: `Bearer ${auth.issueAppSession('brad@example.invalid').token}` }, body: JSON.stringify({ operation: 'note.create', targetId: contact.id, requestId: 'rs6c-request', args: { body: 'Release-failure fixture' } }) };
    rule({ method: 'DELETE', status: 500 }); let res; let threw = null; try { res = await ghlWrite(e); } catch (err) { threw = err; } console.warn = warn;
    const b = res ? JSON.parse(res.body) : null;
    check('RS6c ghl-write note.create: the note is confirmed, then the lock release fails in `finally` -> still 200 confirmed (never not_sent / thrown); the lock stays', !threw && res && res.statusCode === 200 && b && b.outcome !== 'not_sent' && notes.length === notesBefore + 1 && blobs.has(lockKeyPath), [threw && threw.message, res && res.statusCode, b]);
    blobs.delete(lockKeyPath); }
  { // RS6d: the guarantee is limited to the inspected callers -- each releases only from `finally`
    const sites = { 'ghl-write.ts': /finally \{ if \(release\) await release\(\); \}/, 'ghl-disposition.ts': /finally \{ if \(release\) await release\(\); \}/, 'call-log-barrier.ts': /finally \{ if \(release\) await release\(\); \}/, 'current-offer-barrier.ts': /finally \{ if \(release\) await release\(\); \}/, 'ghl-executed-artifact-upload.ts': /finally \{ await release\(\); \}/ };
    const ok = Object.entries(sites).map(([f, re]) => { const src = fs.readFileSync(path.join(APP, 'netlify', 'functions', f), 'utf8'); return re.test(src) && (src.match(/lockContact\(/g) || []).length === 1; });
    check('RS6d the five inspected lockContact callers each take one lock and release it only in `finally` (scope of RS6)', ok.every(Boolean), ok); }

  check('hygiene: no request left the fakes', blocked.length === 0, blocked);
  console.log(`\nShared receipts: ${checks - failures}/${checks} checks passed`);
  if (checks !== FLOOR) { console.error(`FAIL  check count ${checks} != FLOOR ${FLOOR}`); process.exitCode = 1; }
  if (failures) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exit(1); });
