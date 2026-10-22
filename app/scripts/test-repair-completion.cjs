/**
 * Repair-save completion (B15-26 B1 completion contract r1 + r2 + r3 + r4) --
 * offline tests.
 *
 * Compiles netlify/functions/lib/blob-authority.ts (+ repair-evidence.ts) and
 * drives the completion operations against two loopback FAKES: a Blob service
 * (signing API + signed URLs, conditional PUTs) and a GHL service (contact
 * notes, opportunity read/update). Every request is to 127.0.0.1; every site
 * id, token, field id and GHL id is synthetic. The production transport is
 * exercised only against a replaced global fetch that never reaches a network.
 *
 * Shows OUR module's behaviour only. It cannot prove GHL multi-field
 * atomicity, notes-list completeness/pagination, read-after-write visibility,
 * Netlify ETag distinctness (A1) or deployed-runtime behaviour.
 */
'use strict';
process.env.NODE_ENV = 'test';
const { execSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-repair-completion-test');
/** Literal count of check() executions below (loops expanded by hand); never back-filled from a run. */
const FLOOR = 91; // 90 at run 2; +1 B19b (coverage gap found by control K9)
let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

// ---------------------------------------------------------------- compile ---
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"commonjs"}');
try {
  execSync(`node "${path.join(APP, 'node_modules', 'typescript', 'bin', 'tsc')}" "${path.join(APP, 'netlify', 'functions', 'lib', 'blob-authority.ts')}" --outDir "${TMP}" --module commonjs --target es2022 --moduleResolution node --strict --skipLibCheck --esModuleInterop`, { cwd: APP, stdio: 'inherit' });
} catch (e) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  process.exit(10);
}
const MOD_PATH = path.join(TMP, 'blob-authority.js');
const EV_PATH = path.join(TMP, 'repair-evidence.js');
const loadModule = () => { delete require.cache[require.resolve(MOD_PATH)]; delete require.cache[require.resolve(EV_PATH)]; return require(MOD_PATH); };
const EV = require(EV_PATH);

// -------------------------------------------------------- fake Blob service ---
function startBlobs() {
  const store = new Map(); // fullKey -> { text, etag }
  const signed = new Map();
  const log = [];
  const transitions = [];
  let rules = [];
  let etagN = 0;
  const held = [];
  const fullKey = (site, s, k) => `${site}|${s}|${k}`;
  const stateOf = (text) => { try { return JSON.parse(text); } catch { return null; } };
  function applyPut(k, body, headers) {
    const cur = store.get(k);
    const inm = headers['if-none-match'];
    const im = headers['if-match'];
    if (!inm && !im) return { status: 400 };
    if (inm === '*' && cur) return { status: 412 };
    if (im && (!cur || cur.etag !== im)) return { status: 412 };
    const etag = `"blob-e${++etagN}"`;
    const prev = cur ? stateOf(cur.text) : null;
    transitions.push({ from: prev ? prev.state : 'absent', to: (stateOf(body) || {}).state, prevOpId: prev && prev.op ? prev.op.opId : null, next: stateOf(body) });
    store.set(k, { text: body, etag });
    return { status: 200, etag };
  }
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const url = new URL(req.url, 'http://x');
      const isSign = req.headers.accept === 'application/json;type=signed-url' && url.pathname.startsWith('/api/v1/blobs/');
      const stage = isSign ? 'sign' : 'blob';
      const method = req.method;
      const rule = rules.find((r) => r.stage === stage && (!r.method || r.method === method));
      if (rule) rules = rules.filter((r) => r !== rule);
      log.push({ stage, method });
      if (isSign) {
        const rest = decodeURIComponent(url.pathname.slice('/api/v1/blobs/'.length)).split('/');
        const [site, s, ...kp] = rest;
        const id = crypto.randomUUID();
        signed.set(id, { k: fullKey(site, s, kp.join('/')), method });
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ url: `${origin}/signed/${id}` }));
      }
      const sg = url.pathname.startsWith('/signed/') && signed.get(url.pathname.slice(8));
      if (!sg || sg.method !== method) { res.writeHead(403); return res.end(); }
      if (method === 'GET') {
        if (rule && rule.hold) await new Promise((r) => held.push(r));
        if (rule && rule.onRead) rule.onRead();
        const cur = store.get(sg.k);
        if (!cur) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { etag: cur.etag });
        return res.end(cur.text);
      }
      if (method === 'DELETE') { transitions.push({ from: 'delete' }); res.writeHead(204); return res.end(); }
      if (rule && rule.reset) { if (rule.apply) applyPut(sg.k, body, req.headers); return req.socket.destroy(); }
      const out = applyPut(sg.k, body, req.headers);
      res.writeHead(out.status, out.etag ? { etag: out.etag } : {});
      return res.end();
    });
  });
  let origin = '';
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    origin = `http://127.0.0.1:${server.address().port}`;
    resolve({
      origin, store, log, transitions,
      script: (r) => { rules.push(...r); },
      release: () => { const r = held.shift(); if (r) r(); return !!r; },
      heldCount: () => held.length,
      puts: () => log.filter((e) => e.stage === 'blob' && e.method === 'PUT').length,
      gets: () => log.filter((e) => e.stage === 'blob' && e.method === 'GET').length,
      bump: (k) => { const cur = store.get(k); if (cur) store.set(k, { text: cur.text, etag: `"blob-x${++etagN}"` }); },
      close: () => new Promise((r) => server.close(r)),
    });
  }));
}

// --------------------------------------------------------- fake GHL service ---
function startGhl() {
  const opps = new Map();   // id -> { id, contactId, customFields: [] }
  const notes = new Map();  // contactId -> [{ id, body }]
  const log = [];
  let rules = [];
  let noteN = 0;
  const held = [];
  const counts = { notePost: 0, oppPut: 0, oppGet: 0, notesGet: 0 };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const url = new URL(req.url, 'http://x');
      const m = req.method;
      const p = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      const kind = m === 'POST' && p[0] === 'contacts' && p[2] === 'notes' ? 'notePost'
        : m === 'GET' && p[0] === 'contacts' && p[2] === 'notes' ? 'notesGet'
        : m === 'PUT' && p[0] === 'opportunities' ? 'oppPut'
        : m === 'GET' && p[0] === 'opportunities' ? 'oppGet' : 'other';
      const n = kind in counts ? ++counts[kind] : 0;
      log.push({ kind, method: m, path: url.pathname, body: raw, auth: req.headers.authorization || null, version: req.headers.version || null });
      const rule = rules.find((r) => r.kind === kind && (r.n === undefined || r.n === n));
      if (rule && rule.once !== false) rules = rules.filter((r) => r !== rule);
      if (rule && rule.hold) await new Promise((r) => held.push(r));
      if (rule && rule.delayMs) await new Promise((r) => setTimeout(r, rule.delayMs));
      if (rule && rule.hook) rule.hook();
      if (rule && rule.redirectTo) { res.writeHead(302, { location: rule.redirectTo }); return res.end(); }
      const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : (typeof obj === 'string' ? obj : JSON.stringify(obj))); };
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
      if (kind === 'notePost') {
        const note = { id: `note-${++noteN}`, body: body && body.body };
        const applyIt = !(rule && rule.status && !rule.apply) && !(rule && rule.reset && !rule.apply);
        if (applyIt && !(rule && rule.dropStore)) {
          const target = rule && rule.storeOn ? rule.storeOn : p[1];
          if (!notes.has(target)) notes.set(target, []);
          notes.get(target).push(note);
          if (rule && rule.storeTwice) notes.get(target).push({ id: `note-${++noteN}`, body: note.body });
        }
        if (rule && rule.reset) return req.socket.destroy();
        return send(rule && rule.status ? rule.status : 201, { note });
      }
      if (kind === 'oppPut') {
        const o = opps.get(p[1]);
        const applyIt = o && !(rule && rule.status && !rule.apply) && !(rule && rule.reset && !rule.apply);
        if (applyIt && body && Array.isArray(body.customFields)) {
          for (const f of body.customFields) {
            if (rule && rule.onlyField && f.id !== rule.onlyField) continue;
            o.customFields = o.customFields.filter((e) => e.id !== f.id).concat([{ id: f.id, fieldValue: f.field_value }]);
          }
        }
        if (rule && rule.reset) return req.socket.destroy();
        return send(rule && rule.status ? rule.status : 200, { opportunity: o || null });
      }
      if (kind === 'oppGet') {
        if (rule && rule.reset) return req.socket.destroy();
        if (rule && rule.status) return send(rule.status, {});
        if (rule && rule.malformed) return send(200, '{not json');
        const o = opps.get(p[1]);
        return o ? send(200, { opportunity: JSON.parse(JSON.stringify(o)) }) : send(404, {});
      }
      if (kind === 'notesGet') {
        if (rule && rule.reset) return req.socket.destroy();
        if (rule && rule.status) return send(rule.status, {});
        const list = (notes.get(p[1]) || []).map((x) => ({ ...x }));
        if (rule && rule.hide) return send(200, { notes: [] });
        if (rule && rule.meta) return send(200, { notes: list, meta: rule.meta });
        return send(200, { notes: list });
      }
      return send(404, {});
    });
  });
  let origin = '';
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    origin = `http://127.0.0.1:${server.address().port}`;
    resolve({
      origin, opps, notes, log, counts,
      script: (r) => { rules.push(...r); },
      clearRules: () => { rules = []; },
      release: () => { const r = held.shift(); if (r) r(); return !!r; },
      close: () => new Promise((r) => server.close(r)),
    });
  }));
}

function startDecoy() {
  const hits = [];
  const server = http.createServer((req, res) => { hits.push(req.url); res.writeHead(200); res.end('decoy'); });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ origin: `http://127.0.0.1:${server.address().port}`, hits, close: () => new Promise((r) => server.close(r)) })));
}

const HEX = (c) => c.repeat(64);
const SITE = 'site-synthetic-completion';
const TOKEN = 'tok-synthetic-not-a-credential';
const FIELDS = { repairEstimate: 'fld-repair-estimate', repairApprovalId: 'fld-repair-approval-id' };
const tick = () => new Promise((r) => setImmediate(r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // Network guard, installed before any client or transport exists (each captures fetch at creation):
  // anything not addressed to 127.0.0.1 is rejected without leaving the machine.
  const realFetch = globalThis.fetch;
  const blocked = [];
  globalThis.fetch = (url, init) => { const u = new URL(String(url)); if (u.hostname !== '127.0.0.1') { blocked.push(u.origin); return Promise.reject(new Error('network guard: blocked ' + u.origin)); } return realFetch(url, init); };
  let M = loadModule();
  const blobs = await startBlobs();
  const ghl = await startGhl();
  const decoy = await startDecoy();
  let clock = 1_000_000;
  const now = () => clock;
  const client = M.createAuthorityClient({ siteID: SITE, token: TOKEN, apiURL: blobs.origin, timeoutMs: 500, now });
  const transport = M.createFakeTargetTransport({ fetch: globalThis.fetch, origin: ghl.origin, fieldIds: FIELDS, timeoutMs: 400 });
  const STORE = 'site:' + M.AUTHORITY_STORE;
  const keyOf = (scope) => `${SITE}|${STORE}|${M.authorityKey(scope)}`;
  const stored = (scope) => { const s = blobs.store.get(keyOf(scope)); return s ? JSON.parse(s.text) : null; };
  let n = 0;

  /** A fresh opportunity/contact pair in the fake GHL, and its payload. */
  function fixture(total = 18500, extra = {}) {
    n += 1;
    const opportunityId = `opp-c${n}`;
    const contactId = `contact-c${n}`;
    ghl.opps.set(opportunityId, { id: opportunityId, contactId, customFields: extra.customFields || [] });
    const payload = { opportunityId, contactId, operator: 'operator@example.test', total, complete: true, lineCount: 4, basisDigest: HEX('b') };
    return { scope: `repair-approval:test:loc:${opportunityId}`, payload, opportunityId, contactId };
  }
  async function admit(fx, cl = client) {
    const r = await M.openAdmission(cl, fx.scope, { operator: fx.payload.operator, opportunityId: fx.opportunityId, contactId: fx.contactId, preconditionDigest: HEX('a'), expectedResultHash: EV.payloadDigest(fx.payload) });
    if (r.kind !== 'committed') throw new Error('admission failed: ' + JSON.stringify(r));
    return r;
  }
  async function toFieldsDefinite(fx, cl = client, tr = transport) {
    const a = await admit(fx, cl);
    const d1 = await M.dispatchNote(a.admission, tr, fx.payload);
    const d2 = await M.dispatchFields(a.admission, fx.payload);
    if (d1.kind !== 'definite' || d2.kind !== 'definite') throw new Error('dispatch not definite: ' + JSON.stringify([d1, d2]));
    return a;
  }
  async function completed(fx) {
    const a = await toFieldsDefinite(fx);
    const v = await M.verifyRepairTarget(a.admission, fx.payload);
    const c = v.kind === 'verified' ? await M.closeVerified(v.token) : null;
    if (!c || c.kind !== 'committed') throw new Error('not completed: ' + JSON.stringify([v, c]));
    return a;
  }
  const ghlCount = (kinds) => ghl.log.filter((e) => kinds.includes(e.kind)).length;

  try {
    // ======================================================== A1 happy path ===
    { const fx = fixture(); const before = ghl.log.length;
      const a = await admit(fx);
      check('A1 openAdmission committed returns an opaque, frozen admission handle', a.admission && Object.isFrozen(a.admission) && Object.keys(a.admission).length === 0 && Object.getPrototypeOf(a.admission) === null);
      const d1 = await M.dispatchNote(a.admission, transport, fx.payload);
      const d2 = await M.dispatchFields(a.admission, fx.payload);
      const v = await M.verifyRepairTarget(a.admission, fx.payload);
      const admittedOp = JSON.stringify(stored(fx.scope).op);
      const c = await M.closeVerified(v.token);
      const s = stored(fx.scope);
      check('A1 note then fields definite; VERIFIED; closeVerified committed', d1.kind === 'definite' && d2.kind === 'definite' && v.kind === 'verified' && c.kind === 'committed', { d1, d2, v: v.kind, c });
      check('A1 A = COMPLETED with op byte-identical to the admitted op and completion = observed values', s.state === 'COMPLETED' && JSON.stringify(s.op) === admittedOp && s.completion.observedId === a.opId && s.completion.observedTotal === 18500 && /^note-/.test(s.completion.noteId));
      const reqs = ghl.log.slice(before);
      check('A1 GHL saw exactly: note POST, opportunity PUT, opportunity GET, notes GET, in that order', reqs.map((e) => e.kind).join(',') === 'notePost,oppPut,oppGet,notesGet', reqs.map((e) => e.kind));
      const r = await M.readRepairApproval(client, transport, fx.scope, fx.opportunityId);
      check('A1 reader: "Recorded repair approval — checked as of <time>"', r.kind === 'checked' && r.text.startsWith('Recorded repair approval — checked as of ') && r.total === 18500, r);
    }
    // ======================================== A2 payload that is not admitted ===
    { check('A2 an incomplete payload (complete:false) is not a valid payload', EV.validatePayload({ ...fixture().payload, complete: false }) === null);
      const fx = fixture(); const a = await admit(fx); const before = ghl.log.length;
      const r = await M.dispatchNote(a.admission, transport, { ...fx.payload, total: 18501 });
      check('A2 a payload whose total differs from the admitted digest -> refused, nothing sent, nothing reserved', r.kind === 'refused' && r.reason === 'payload_mismatch' && ghl.log.length === before && (await M.dispatchNote(a.admission, transport, fx.payload)).kind === 'definite', r);
    }
    // =================================================== uncertain TARGET ===
    { const fx = fixture(); const a = await admit(fx);
      ghl.script([{ kind: 'notePost', status: 500, apply: true }]);
      const d1 = await M.dispatchNote(a.admission, transport, fx.payload);
      const puts = ghlCount(['oppPut']);
      const d2 = await M.dispatchFields(a.admission, fx.payload);
      const v = await M.verifyRepairTarget(a.admission, fx.payload);
      check('A3′ note 500 -> uncertain; fields refused (nothing sent); verify refused target_uncertain', d1.kind === 'uncertain' && d2.kind === 'refused' && ghlCount(['oppPut']) === puts && v.kind === 'refused' && v.reason === 'target_uncertain', { d1, d2, v });
      const r = await M.readRepairApproval(client, transport, fx.scope, fx.opportunityId);
      check('A3′ A stays ADMITTED; reader: "Repair save needs review. Do not retry this approval."', stored(fx.scope).state === 'ADMITTED' && r.kind === 'needs_review' && r.text === 'Repair save needs review. Do not retry this approval.', r);
      check('A3′ abandonUndispatched refused after an uncertain note (a TARGET was sent)', (await M.abandonUndispatched(a.admission)).kind === 'refused' && stored(fx.scope).state === 'ADMITTED');
    }
    { const fx = fixture(); const a = await admit(fx);
      ghl.script([{ kind: 'notePost', delayMs: 900 }]);
      const d1 = await M.dispatchNote(a.admission, transport, fx.payload);
      check('A3b note timeout (transport 400 ms) -> uncertain', d1.kind === 'uncertain', d1);
      await sleep(700);
    }
    { const fx = fixture(); const a = await admit(fx);
      await M.dispatchNote(a.admission, transport, fx.payload);
      ghl.script([{ kind: 'oppPut', status: 500, apply: true }]);
      const d2 = await M.dispatchFields(a.admission, fx.payload);
      const v = await M.verifyRepairTarget(a.admission, fx.payload);
      const o = ghl.opps.get(fx.opportunityId);
      check('A4′ fields 500 with values landed -> uncertain; verify refused even though GHL matches', d2.kind === 'uncertain' && v.kind === 'refused' && v.reason === 'target_uncertain' && o.customFields.some((f) => f.id === FIELDS.repairApprovalId && f.fieldValue === a.opId), { d2, v });
    }
    { const fx = fixture(); const a = await admit(fx);
      await M.dispatchNote(a.admission, transport, fx.payload);
      ghl.script([{ kind: 'oppPut', status: 422 }]);
      const d2 = await M.dispatchFields(a.admission, fx.payload);
      check('A5′ fields 4xx -> uncertain (P-A: only 2xx is definite); blocking', d2.kind === 'uncertain' && (await M.verifyRepairTarget(a.admission, fx.payload)).kind === 'refused' && stored(fx.scope).state === 'ADMITTED');
    }
    { const fx = fixture(); const a = await admit(fx);
      ghl.script([{ kind: 'notePost', redirectTo: decoy.origin + '/landing' }]);
      const d1 = await M.dispatchNote(a.admission, transport, fx.payload);
      check('A5r note answered with a 302 -> uncertain; the redirect target received no request', d1.kind === 'uncertain' && decoy.hits.length === 0, { d1, hits: decoy.hits });
    }
    // ===================================== missing / duplicate / mismatch ===
    { const fx = fixture(); const a = await admit(fx);
      await M.dispatchNote(a.admission, transport, fx.payload);
      ghl.script([{ kind: 'oppPut', onlyField: FIELDS.repairEstimate }]);
      await M.dispatchFields(a.admission, fx.payload);
      const v1 = await M.verifyRepairTarget(a.admission, fx.payload);
      check('A6 a binding field missing after definite writes -> pending (missing_field), not HOLD', v1.kind === 'pending' && v1.reason === 'missing_field', v1);
    }
    { const fx = fixture(); const a = await admit(fx);
      ghl.script([{ kind: 'notePost', dropStore: true }]);
      await M.dispatchNote(a.admission, transport, fx.payload);
      await M.dispatchFields(a.admission, fx.payload);
      const v1 = await M.verifyRepairTarget(a.admission, fx.payload);
      check('A7 zero E for opId -> pending (missing_evidence)', v1.kind === 'pending' && v1.reason === 'missing_evidence', v1);
    }
    { const fx = fixture(); const a = await admit(fx);
      ghl.script([{ kind: 'notePost', storeTwice: true }]);
      await M.dispatchNote(a.admission, transport, fx.payload);
      await M.dispatchFields(a.admission, fx.payload);
      const v = await M.verifyRepairTarget(a.admission, fx.payload);
      check('A8 two identical E for opId -> terminal HOLD duplicate_evidence', v.kind === 'hold' && v.reason === 'duplicate_evidence', v);
    }
    { const fx = fixture(); const a = await toFieldsDefinite(fx);
      const list = ghl.notes.get(fx.contactId); list[0].body = list[0].body.replace('Line count: 4', 'Line count: 5');
      const v = await M.verifyRepairTarget(a.admission, fx.payload);
      check('A9 E body differs (one value) -> terminal HOLD mismatch', v.kind === 'hold' && v.reason === 'mismatch', v);
    }
    { const fx = fixture(); const a = await admit(fx);
      ghl.script([{ kind: 'notePost', storeOn: 'contact-elsewhere' }]);
      await M.dispatchNote(a.admission, transport, fx.payload);
      await M.dispatchFields(a.admission, fx.payload);
      const v = await M.verifyRepairTarget(a.admission, fx.payload);
      check('A9b E landed on another contact -> not read; pending missing_evidence', v.kind === 'pending' && v.reason === 'missing_evidence', v);
    }
    for (const [label, mutate] of [
      ['approval id = another opId', (o) => { o.customFields.find((f) => f.id === FIELDS.repairApprovalId).fieldValue = 'op-other'; }],
      ['total off by $1', (o) => { o.customFields.find((f) => f.id === FIELDS.repairEstimate).fieldValue = 18501; }],
      ['contactId changed', (o) => { o.contactId = 'contact-moved'; }],
    ]) {
      const fx = fixture(); const a = await toFieldsDefinite(fx);
      mutate(ghl.opps.get(fx.opportunityId));
      const v = await M.verifyRepairTarget(a.admission, fx.payload);
      check(`A10 ${label} -> terminal HOLD mismatch`, v.kind === 'hold' && v.reason === 'mismatch', v);
    }
    for (const [label, rule] of [
      ['opportunity GET 500', { kind: 'oppGet', status: 500 }],
      ['notes GET reset', { kind: 'notesGet', reset: true }],
      ['opportunity GET malformed JSON', { kind: 'oppGet', malformed: true }],
      ['notes list with nextPage (not provably complete)', { kind: 'notesGet', meta: { nextPage: 2 } }],
    ]) {
      const fx = fixture(); const a = await toFieldsDefinite(fx);
      ghl.script([rule]);
      const v = await M.verifyRepairTarget(a.admission, fx.payload);
      check(`A11 ${label} -> terminal HOLD unreadable`, v.kind === 'hold' && v.reason === 'unreadable', v);
    }
    { const fx = fixture(); const a = await toFieldsDefinite(fx);
      ghl.script([{ kind: 'notesGet', hook: () => blobs.bump(keyOf(fx.scope)) }]);
      const v = await M.verifyRepairTarget(a.admission, fx.payload);
      check('A12 A changed between the first and final strong read -> terminal HOLD authority_changed', v.kind === 'hold' && v.reason === 'authority_changed', v);
    }
    // ========================================================= CLOSE rules ===
    { const fx = fixture(); const a = await toFieldsDefinite(fx);
      const v = await M.verifyRepairTarget(a.admission, fx.payload);
      const puts = blobs.puts();
      const forged = await M.closeVerified({});
      const cloned = await M.closeVerified(structuredClone(v.token));
      const asJson = await M.closeVerified(JSON.parse(JSON.stringify(v.token)));
      check('A13 forged / structuredClone / JSON-copied tokens refused before any request', forged.kind === 'refused' && cloned.kind === 'refused' && asJson.kind === 'refused' && blobs.puts() === puts);
      const c1 = await M.closeVerified(v.token);
      const c2 = await M.closeVerified(v.token);
      check('A13 the token is single-use: second close refused (token_used); one CAS', c1.kind === 'committed' && c2.kind === 'refused' && c2.reason === 'token_used' && blobs.puts() === puts + 1, { c1, c2 });
    }
    { const fx = fixture(); const a = await toFieldsDefinite(fx);
      const v = await M.verifyRepairTarget(a.admission, fx.payload);
      blobs.bump(keyOf(fx.scope));
      const puts = blobs.puts();
      const c = await M.closeVerified(v.token);
      check('A14 A moved after verification -> close refused by its own strong read; no write; A unchanged', c.kind === 'refused' && blobs.puts() === puts && stored(fx.scope).state === 'ADMITTED', c);
    }
    { const fx = fixture(); const a = await toFieldsDefinite(fx);
      const v = await M.verifyRepairTarget(a.admission, fx.payload);
      blobs.script([{ stage: 'blob', method: 'PUT', reset: true }]);
      const puts = blobs.puts();
      const c = await M.closeVerified(v.token);
      check('A15 close CAS ambiguous -> ambiguous; exactly one PUT, no retry; A still ADMITTED', c.kind === 'ambiguous' && blobs.puts() === puts + 1 && stored(fx.scope).state === 'ADMITTED', c);
    }
    { const fx = fixture(); const a = await toFieldsDefinite(fx);
      const v = await M.verifyRepairTarget(a.admission, fx.payload);
      const M2 = loadModule();
      const client2 = M2.createAuthorityClient({ siteID: SITE, token: TOKEN, apiURL: blobs.origin, timeoutMs: 500, now });
      const transport2 = M2.createFakeTargetTransport({ fetch: globalThis.fetch, origin: ghl.origin, fieldIds: FIELDS });
      const r1 = await M2.verifyRepairTarget(a.admission, fx.payload);
      const r2 = await M2.closeVerified(v.token);
      const r3 = await M2.abandonUndispatched(a.admission);
      const rd = await M2.readRepairApproval(client2, transport2, fx.scope, fx.opportunityId);
      check('A16′ restart (fresh module instance): old handle and token unusable; A stays ADMITTED; reader needs_review', r1.kind === 'refused' && r2.kind === 'refused' && r3.kind === 'refused' && stored(fx.scope).state === 'ADMITTED' && rd.kind === 'needs_review', { r1, r2, r3, rd });
    }
    { const fx = fixture(); const a = await admit(fx);
      blobs.bump(keyOf(fx.scope)); const before = ghl.log.length;
      const d = await M.dispatchNote(a.admission, transport, fx.payload);
      check('A18′ D1 strong read shows A ≠ ADMITTED(op, eAdm) -> not_sent; transport never called', d.kind === 'not_sent' && ghl.log.length === before, d);
      check('A18′ after D1 refusal nothing further dispatches', (await M.dispatchNote(a.admission, transport, fx.payload)).kind === 'refused' && (await M.dispatchFields(a.admission, fx.payload)).kind === 'refused' && ghl.log.length === before);
    }
    { const fx = fixture(); const a = await admit(fx);
      await M.dispatchNote(a.admission, transport, fx.payload);
      const again = await M.dispatchNote(a.admission, transport, fx.payload);
      check('A19′ a second note dispatch (sequential) refused; one note POST', again.kind === 'refused' && ghl.notes.get(fx.contactId).length === 1, again);
    }
    { const fx = fixture(); const a = await admit(fx);
      const r = await M.abandonUndispatched(a.admission);
      const s = stored(fx.scope);
      check('A20′ abandon from NONE -> released; A = IDLE{abandoned_undispatched}', r.kind === 'released' && s.state === 'IDLE' && s.last.opId === a.opId && s.last.outcome === 'abandoned_undispatched', { r, s });
      const again = await M.openAdmission(client, fx.scope, { operator: fx.payload.operator, opportunityId: fx.opportunityId, contactId: fx.contactId, preconditionDigest: HEX('a'), expectedResultHash: EV.payloadDigest(fx.payload) });
      check('A20′ after release a new admission commits', again.kind === 'committed', again);
    }
    { const fx = fixture(); const a = await toFieldsDefinite(fx);
      const v = await M.verifyRepairTarget(a.admission, { ...fx.payload, lineCount: 5 });
      const v2 = await M.verifyRepairTarget(a.admission, fx.payload);
      check('A21 verify with a payload whose digest ≠ A.op.expectedResultHash -> HOLD mismatch; later passes refused', v.kind === 'hold' && v.reason === 'mismatch' && v2.kind === 'refused', { v, v2 });
    }
    { const fx = fixture(); const a = await admit(fx);
      const r = [await M.dispatchNote(a.admission, transport, fx.payload, { cleared: true }), await M.dispatchFields(a.admission, fx.payload, Date.now()), await M.verifyRepairTarget(a.admission, fx.payload, 'operator says saved'), await M.closeVerified({}, { elapsed: 60000 }), await M.abandonUndispatched(a.admission, true), await M.readRepairApproval(client, transport, fx.scope, fx.opportunityId, { force: true })];
      check('A22 no completion export accepts an extra (time / assertion / cleared) argument', r.every((x) => x.kind === 'refused' && x.reason === 'unexpected_argument'), r);
    }
    // ===================================================== B: ownership ===
    { const fx = fixture(); const a = await admit(fx); const before = ghl.log.length;
      const r1 = await M.dispatchNote(a.admission, async () => new Response('{}'), fx.payload);
      const r2 = await M.dispatchNote(a.admission, { __targetTransport: true }, fx.payload);
      check('B1 a send callback or lookalike object in place of a transport -> refused unknown_transport; nothing sent', r1.kind === 'refused' && r1.reason === 'unknown_transport' && r2.kind === 'refused' && ghl.log.length === before);
      check('B1 the transport exposes no request method (frozen, only its brand)', Object.isFrozen(transport) && Object.keys(transport).join() === '__targetTransport');
    }
    { const saved = globalThis.fetch; const savedKey = process.env.GHL_PRIVATE_API_KEY;
      const seen = [];
      process.env.GHL_PRIVATE_API_KEY = 'synthetic-server-ghl-credential';
      let prod;
      try {
        let thrown = null; try { M.createProductionTargetTransport({ fieldIds: { repairEstimate: FIELDS.repairEstimate } }); } catch (e) { thrown = e.message; }
        check('B2 production transport refuses without the repair_approval_id field id (P5 not configured)', /binding field ids/.test(thrown || ''), thrown);
        delete process.env.GHL_PRIVATE_API_KEY; thrown = null;
        try { M.createProductionTargetTransport({ fieldIds: FIELDS }); } catch (e) { thrown = e.message; }
        check('B2 production transport refuses without the server credential', /credential unavailable/.test(thrown || ''), thrown);
        process.env.GHL_PRIVATE_API_KEY = 'synthetic-server-ghl-credential';
        const fx = fixture(); const a = await admit(fx);
        globalThis.fetch = async (url, init) => { seen.push({ url: String(url), init }); return new Response(JSON.stringify(String(url).endsWith('/notes') ? { note: { id: 'note-prod-1' } } : { opportunity: {} }), { status: 200 }); };
        prod = M.createProductionTargetTransport({ fieldIds: FIELDS }); // created AFTER the stub: it captures the stub
        const d1 = await M.dispatchNote(a.admission, prod, fx.payload);
        const d2 = await M.dispatchFields(a.admission, fx.payload);
        globalThis.fetch = saved;
        const expectedNote = JSON.stringify({ body: EV.renderEvidence({ opId: a.opId, admittedAt: stored(fx.scope).op.admittedAt }, fx.payload) });
        const expectedPut = JSON.stringify({ customFields: [{ id: FIELDS.repairEstimate, field_value: 18500 }, { id: FIELDS.repairApprovalId, field_value: a.opId }] });
        check('B2 production note request: pinned https GHL origin, POST, exact module-built body, server credential, Version header',
          d1.kind === 'definite' && seen[0].url === `https://services.leadconnectorhq.com/contacts/${fx.contactId}/notes` && seen[0].init.method === 'POST' && seen[0].init.body === expectedNote
          && seen[0].init.headers.Authorization === 'Bearer synthetic-server-ghl-credential' && seen[0].init.headers.Version === '2021-07-28' && seen[0].init.redirect === 'manual', seen[0] && { url: seen[0].url, body: seen[0].init.body });
        check('B2 production fields request: PUT /opportunities/{id}, exactly the two binding fields', d2.kind === 'definite' && seen[1].url === `https://services.leadconnectorhq.com/opportunities/${fx.opportunityId}` && seen[1].init.method === 'PUT' && seen[1].init.body === expectedPut, seen[1] && seen[1].init.body);
      } finally { globalThis.fetch = saved; if (savedKey === undefined) delete process.env.GHL_PRIVATE_API_KEY; else process.env.GHL_PRIVATE_API_KEY = savedKey; }
      // B4 (reverse): a production-transport token cannot close a loopback (test) authority record.
      const fx = fixture(); const a = await admit(fx);
      process.env.GHL_PRIVATE_API_KEY = 'synthetic-server-ghl-credential';
      globalThis.fetch = (url, init) => saved(String(url).replace('https://services.leadconnectorhq.com', ghl.origin), init);
      const prod2 = M.createProductionTargetTransport({ fieldIds: FIELDS }); // created AFTER the routing stub
      let c;
      try {
        await M.dispatchNote(a.admission, prod2, fx.payload); await M.dispatchFields(a.admission, fx.payload);
        const v = await M.verifyRepairTarget(a.admission, fx.payload);
        c = v.kind === 'verified' ? await M.closeVerified(v.token) : v;
      } finally { globalThis.fetch = saved; if (savedKey === undefined) delete process.env.GHL_PRIVATE_API_KEY; else process.env.GHL_PRIVATE_API_KEY = savedKey; }
      check('B4 a production-transport ("ghl") token presented for a loopback authority client -> refused transport_mode_mismatch; A unchanged', c.kind === 'refused' && c.reason === 'transport_mode_mismatch' && stored(fx.scope).state === 'ADMITTED', c);
    }
    { let t1 = null; try { M.createFakeTargetTransport({ fetch: globalThis.fetch, origin: 'https://services.leadconnectorhq.com', fieldIds: FIELDS }); } catch (e) { t1 = e.message; }
      let t2 = null; try { M.createFakeTargetTransport({ fetch: globalThis.fetch, origin: 'http://10.0.0.5:80', fieldIds: FIELDS }); } catch (e) { t2 = e.message; }
      check('B3 fake transport with a non-loopback origin refused at the factory', /loopback/.test(t1 || '') && /loopback/.test(t2 || ''), [t1, t2]);
    }
    { // B4: a fake-transport token presented to a real-mode (non-loopback apiURL) authority client.
      const routing = (url, init) => globalThis.fetch(String(url).replace('https://api.netlify.com', blobs.origin), init);
      const realMode = M.createAuthorityClient({ siteID: SITE, token: TOKEN, apiURL: 'https://api.netlify.com', fetch: routing, timeoutMs: 500, now });
      const fx = fixture(); const a = await toFieldsDefinite(fx, realMode, transport);
      const v = await M.verifyRepairTarget(a.admission, fx.payload);
      const puts = blobs.puts();
      const c = await M.closeVerified(v.token);
      check('B4 a fake-transport token for a real-mode authority client -> refused transport_mode_mismatch; no write', v.kind === 'verified' && c.kind === 'refused' && c.reason === 'transport_mode_mismatch' && blobs.puts() === puts && stored(fx.scope).state === 'ADMITTED', { v: v.kind, c });
      const rd = await M.readRepairApproval(realMode, transport, fx.scope, fx.opportunityId);
      check('B4 the reader also refuses a mode mismatch', rd.kind === 'refused' && rd.reason === 'transport_mode_mismatch', rd);
    }
    // ===================================================== B: ordering ===
    { const fx = fixture(); const a = await admit(fx); const before = ghl.log.length;
      const r0 = await M.dispatchFields(a.admission, fx.payload);
      blobs.script([{ stage: 'blob', method: 'GET', hold: true }]);
      const pNote = M.dispatchNote(a.admission, transport, fx.payload);
      const r1 = await M.dispatchFields(a.admission, fx.payload); // NOTE_RESERVED
      while (blobs.heldCount() === 0) await tick(); blobs.release();
      ghl.script([{ kind: 'notePost', hold: true }]);
      // note is now SENDING (held at GHL)
      await sleep(50);
      const r2 = await M.dispatchFields(a.admission, fx.payload); // NOTE_SENDING
      while (!ghl.release()) await tick();
      const dn = await pNote;
      check('B5 fields before NOTE_DEFINITE (NONE / NOTE_RESERVED / NOTE_SENDING) -> refused; no PUT sent', r0.kind === 'refused' && r1.kind === 'refused' && r2.kind === 'refused' && dn.kind === 'definite' && ghl.log.slice(before).every((e) => e.kind !== 'oppPut'), { r0, r1, r2, dn });
    }
    { const fx = fixture(); const a = await admit(fx); const gets = blobs.gets(); const before = ghl.log.length;
      const pa = M.dispatchNote(a.admission, transport, fx.payload);
      const pb = M.dispatchNote(a.admission, transport, fx.payload);
      const [ra, rb] = await Promise.all([pa, pb]);
      check('B6 two concurrent note dispatches in one tick: one definite, one refused at entry; one D1 read; one POST', ra.kind === 'definite' && rb.kind === 'refused' && blobs.gets() === gets + 1 && ghl.log.slice(before).filter((e) => e.kind === 'notePost').length === 1, { ra, rb, gets: blobs.gets() - gets });
    }
    { const fx = fixture(); const a = await admit(fx); const before = ghl.log.length;
      blobs.script([{ stage: 'blob', method: 'GET', hold: true }]);
      const pNote = M.dispatchNote(a.admission, transport, fx.payload); // reserved, D1 held
      while (blobs.heldCount() === 0) await tick(); // D1's blob GET is now held at the fake
      const pAb = M.abandonUndispatched(a.admission); // retires synchronously
      while (!blobs.release()) await tick();
      const [dn, ab] = await Promise.all([pNote, pAb]);
      const s = stored(fx.scope);
      check('B7 delayed D1 vs abandon: the send gate sees RETIRED -> no transport call; abandon released; A = IDLE{abandoned_undispatched}', dn.kind === 'not_sent' && dn.reason === 'retired' && ab.kind === 'released' && ghl.log.length === before && s.state === 'IDLE' && s.last.outcome === 'abandoned_undispatched', { dn, ab, ghl: ghl.log.length - before });
    }
    { const fx = fixture(); const a = await admit(fx); const before = ghl.log.length;
      blobs.script([{ stage: 'blob', method: 'PUT', reset: true, apply: true }]);
      const puts = blobs.puts();
      const ab = await M.abandonUndispatched(a.admission);
      const casPuts = blobs.puts() - puts; // measured before the follow-up admission adds its own PUT
      const s = stored(fx.scope);
      const reopen = await M.openAdmission(client, fx.scope, { operator: fx.payload.operator, opportunityId: fx.opportunityId, contactId: fx.contactId, preconditionDigest: HEX('a'), expectedResultHash: EV.payloadDigest(fx.payload) });
      check('B8a abandon CAS applied, response lost -> release_unknown; one CAS; A = IDLE; no TARGET; a new admission commits', ab.kind === 'release_unknown' && casPuts === 1 && s.state === 'IDLE' && ghl.log.length === before && reopen.kind === 'committed', { ab, s: s.state, reopen: reopen.kind });
      const after = [await M.dispatchNote(a.admission, transport, fx.payload), await M.verifyRepairTarget(a.admission, fx.payload), await M.abandonUndispatched(a.admission)];
      check('B8c (after B8a) the old handle cannot dispatch, verify or abandon; nothing sent', after.every((x) => x.kind === 'refused') && ghl.log.length === before, after);
    }
    { const fx = fixture(); const a = await admit(fx); const before = ghl.log.length;
      blobs.script([{ stage: 'blob', method: 'PUT', reset: true }]);
      const ab = await M.abandonUndispatched(a.admission);
      const reopen = await M.openAdmission(client, fx.scope, { operator: fx.payload.operator, opportunityId: fx.opportunityId, contactId: fx.contactId, preconditionDigest: HEX('a'), expectedResultHash: EV.payloadDigest(fx.payload) });
      const rd = await M.readRepairApproval(client, transport, fx.scope, fx.opportunityId);
      check('B8b abandon CAS not applied -> release_unknown; A stays ADMITTED; a new admission refused; reader needs_review; no TARGET', ab.kind === 'release_unknown' && stored(fx.scope).state === 'ADMITTED' && reopen.kind === 'refused' && reopen.reason === 'scope_blocked' && rd.kind === 'needs_review' && ghl.log.slice(before).every((e) => e.kind === 'oppGet'), { ab, reopen, rd });
      const after = [await M.dispatchNote(a.admission, transport, fx.payload), await M.dispatchFields(a.admission, fx.payload), await M.abandonUndispatched(a.admission)];
      check('B8c (after B8b) the retired handle stays inert', after.every((x) => x.kind === 'refused'), after);
    }
    { const fx = fixture(); const a = await admit(fx);
      ghl.script([{ kind: 'notePost', hold: true }]);
      const pNote = M.dispatchNote(a.admission, transport, fx.payload);
      await sleep(50); // NOTE_SENDING (POST held at the fake)
      const ab = await M.abandonUndispatched(a.admission);
      while (!ghl.release()) await tick();
      const dn = await pNote;
      check('B9 abandon after the note reached SENDING -> refused; the note outcome is classified normally; A unchanged', ab.kind === 'refused' && dn.kind === 'definite' && stored(fx.scope).state === 'ADMITTED', { ab, dn });
    }
    { const fx = fixture(); const a = await admit(fx); await M.abandonUndispatched(a.admission); const before = ghl.log.length;
      const after = [await M.dispatchNote(a.admission, transport, fx.payload), await M.dispatchFields(a.admission, fx.payload), await M.verifyRepairTarget(a.admission, fx.payload)];
      check('B10 dispatch / verify after RETIRED -> refused; nothing sent', after.every((x) => x.kind === 'refused') && ghl.log.length === before, after);
    }
    // ====================================== B: pending vs terminal HOLD ===
    { const fx = fixture(); const a = await toFieldsDefinite(fx);
      ghl.script([{ kind: 'notesGet', hide: true }]);
      const v1 = await M.verifyRepairTarget(a.admission, fx.payload);
      clock += 2000;
      const v2 = await M.verifyRepairTarget(a.admission, fx.payload);
      check('B11 visibility lag: pass 1 pending (missing_evidence), pass 2 VERIFIED', v1.kind === 'pending' && v2.kind === 'verified', { v1, v2: v2.kind });
    }
    { const fx = fixture(); const a = await toFieldsDefinite(fx);
      ghl.script([{ kind: 'notesGet', hide: true }, { kind: 'notesGet', hide: true }, { kind: 'notesGet', hide: true }]);
      const vs = [];
      for (let i = 0; i < 3; i++) { vs.push(await M.verifyRepairTarget(a.admission, fx.payload)); clock += 1000; }
      const v4 = await M.verifyRepairTarget(a.admission, fx.payload);
      ghl.clearRules();
      check('B12 E missing on passes 1-3 -> pending, pending, HOLD(missing_after_window); 4th call refused', vs[0].kind === 'pending' && vs[1].kind === 'pending' && vs[2].kind === 'hold' && vs[2].reason === 'missing_after_window' && v4.kind === 'refused', vs.concat([v4]));
    }
    { const fx = fixture(); const a = await toFieldsDefinite(fx);
      ghl.script([{ kind: 'notesGet', hide: true }]);
      const v1 = await M.verifyRepairTarget(a.admission, fx.payload);
      const list = ghl.notes.get(fx.contactId); list.push({ id: 'note-dup', body: list[0].body });
      clock += 1000;
      const v2 = await M.verifyRepairTarget(a.admission, fx.payload);
      const v3 = await M.verifyRepairTarget(a.admission, fx.payload);
      check('B13 missing, then a duplicate on pass 2 -> HOLD at pass 2; pass 3 refused; no token', v1.kind === 'pending' && v2.kind === 'hold' && v2.reason === 'duplicate_evidence' && v3.kind === 'refused', [v1, v2, v3]);
    }
    { const fx = fixture(); const a = await toFieldsDefinite(fx);
      ghl.opps.get(fx.opportunityId).customFields.find((f) => f.id === FIELDS.repairEstimate).fieldValue = 1;
      const v1 = await M.verifyRepairTarget(a.admission, fx.payload);
      ghl.opps.get(fx.opportunityId).customFields.find((f) => f.id === FIELDS.repairEstimate).fieldValue = 18500;
      const v2 = await M.verifyRepairTarget(a.admission, fx.payload);
      check('B14 pass 1 mismatch -> HOLD immediately; a later (now matching) pass is refused, no token', v1.kind === 'hold' && v1.reason === 'mismatch' && v2.kind === 'refused', [v1, v2]);
    }
    { const fx = fixture(); const a = await toFieldsDefinite(fx);
      ghl.script([{ kind: 'notesGet', hide: true }]);
      const v1 = await M.verifyRepairTarget(a.admission, fx.payload);
      clock += 10_000;
      const v2 = await M.verifyRepairTarget(a.admission, fx.payload);
      check('B15 a pass that would start at first-pass + 10 s -> HOLD missing_after_window (no read made)', v1.kind === 'pending' && v2.kind === 'hold' && v2.reason === 'missing_after_window', [v1, v2]);
    }
    { const fx = fixture(); const a = await toFieldsDefinite(fx);
      const pa = M.verifyRepairTarget(a.admission, fx.payload);
      const pb = M.verifyRepairTarget(a.admission, fx.payload);
      const [va, vb] = await Promise.all([pa, pb]);
      check('B16 two concurrent verify calls -> one runs (VERIFIED), the other refused pass_in_flight', va.kind === 'verified' && vb.kind === 'refused' && vb.reason === 'pass_in_flight', [va.kind, vb]);
    }
    // ============================================ B: cross-session reader ===
    const READER_KINDS = new Set(['checked', 'needs_review', 'not_verified', 'none', 'refused']);
    { const fx = fixture(); await completed(fx);
      const ok = await M.readRepairApproval(client, transport, fx.scope, fx.opportunityId);
      ghl.script([{ kind: 'notesGet', hook: () => blobs.bump(keyOf(fx.scope)) }]);
      const changed = await M.readRepairApproval(client, transport, fx.scope, fx.opportunityId);
      check('B17′ reader: checked text; A ETag changed between the strong reads -> "could not be verified" (record_changed)', ok.kind === 'checked' && changed.kind === 'not_verified' && changed.reason === 'record_changed' && changed.text === 'Repair approval could not be verified', [ok, changed]);
      check('B17′ no reader result kind is or implies OFFER READY', [ok, changed].every((r) => READER_KINDS.has(r.kind)) && !JSON.stringify([ok, changed]).toLowerCase().includes('offer'));
    }
    const mutateE = async (label, fn, reason = 'evidence_mismatch') => {
      const fx = fixture(); await completed(fx);
      const list = ghl.notes.get(fx.contactId);
      fn(list, fx);
      const r = await M.readRepairApproval(client, transport, fx.scope, fx.opportunityId);
      check(label, r.kind === 'not_verified' && r.reason === reason && r.text === 'Repair approval could not be verified', r);
    };
    await mutateE('B18 E Line count altered -> could not be verified (evidence_mismatch)', (l) => { l[0].body = l[0].body.replace('Line count: 4', 'Line count: 7'); });
    await mutateE('B19 E Total changed and its own Payload digest recomputed -> P′ ≠ A hash -> evidence_mismatch', (l, fx) => {
      const p2 = { ...fx.payload, total: 99999 };
      const lines = l[0].body.split('\n');
      lines[5] = 'Total: 99999'; lines[9] = `Payload digest: ${EV.payloadDigest(p2)}`;
      l[0].body = lines.join('\n');
    });
    await mutateE('B19b E Line count changed AND its own Payload digest recomputed (total unchanged) -> only P′ ≠ A.op.expectedResultHash catches it -> evidence_mismatch', (l, fx) => {
      const p2 = { ...fx.payload, lineCount: 9 };
      const lines = l[0].body.split('\n');
      lines[7] = 'Line count: 9'; lines[9] = `Payload digest: ${EV.payloadDigest(p2)}`;
      l[0].body = lines.join('\n');
    });
    await mutateE('B20 E with an extra trailing line -> evidence_mismatch', (l) => { l[0].body = l[0].body + '\nNote: edited'; });
    await mutateE('B20 E with non-canonical currency (18500.0) -> evidence_mismatch', (l) => { l[0].body = l[0].body.replace('Total: 18500', 'Total: 18500.0'); });
    await mutateE('B20 E with two labels swapped -> evidence_mismatch', (l) => { const x = l[0].body.split('\n'); [x[1], x[2]] = [x[2], x[1]]; l[0].body = x.join('\n'); });
    await mutateE('B21 E re-created with identical text (new note id) -> evidence_mismatch', (l) => { l[0].id = 'note-recreated'; });
    { const fx = fixture(18500, { customFields: [{ id: FIELDS.repairEstimate, fieldValue: 12000 }] }); const puts = blobs.puts();
      const r = await M.readRepairApproval(client, transport, fx.scope, fx.opportunityId);
      check('B22 A absent but GHL holds a total -> could not be verified (no_recorded_approval); nothing written', r.kind === 'not_verified' && r.reason === 'no_recorded_approval' && r.total === 12000 && blobs.puts() === puts, r);
    }
    { const fx = fixture(); const a = await toFieldsDefinite(fx);
      const l = ghl.notes.get(fx.contactId); l[0].body = l[0].body.replace('Total: 18500', 'Total: 18500.00');
      const v = await M.verifyRepairTarget(a.admission, fx.payload);
      check('B23 verifier applies the same strict parse: readback E differs only in canonical form -> HOLD mismatch, no token', v.kind === 'hold' && v.reason === 'mismatch', v);
    }
    // ================================== B: exactly one entry per field (r4 D2) ===
    const dupCase = async (label, makeFields, readerReason, holdReason) => {
      const fxR = fixture(); await completed(fxR);
      const oR = ghl.opps.get(fxR.opportunityId); oR.customFields = makeFields(oR.customFields, fxR);
      const r = await M.readRepairApproval(client, transport, fxR.scope, fxR.opportunityId);
      const fxV = fixture(); const a = await toFieldsDefinite(fxV);
      const oV = ghl.opps.get(fxV.opportunityId); oV.customFields = makeFields(oV.customFields, fxV, a.opId);
      const v = await M.verifyRepairTarget(a.admission, fxV.payload);
      check(label, r.kind === 'not_verified' && r.reason === readerReason && v.kind === 'hold' && v.reason === holdReason, { reader: r, verifier: v });
    };
    const fieldOf = (cf, id) => cf.find((f) => f.id === id);
    await dupCase('B24 two identical repair_estimate entries -> reader evidence_ambiguous; verifier HOLD duplicate_evidence',
      (cf) => cf.concat([{ ...fieldOf(cf, FIELDS.repairEstimate) }]), 'evidence_ambiguous', 'duplicate_evidence');
    await dupCase('B25 two identical repair_approval_id entries -> reader evidence_ambiguous; verifier HOLD duplicate_evidence',
      (cf) => cf.concat([{ ...fieldOf(cf, FIELDS.repairApprovalId) }]), 'evidence_ambiguous', 'duplicate_evidence');
    for (const [fieldName, fid, bad] of [['repair_estimate', FIELDS.repairEstimate, 1], ['repair_approval_id', FIELDS.repairApprovalId, 'op-conflicting']]) {
      await dupCase(`B26 ${fieldName}: matching entry FIRST + conflicting duplicate -> ambiguous / HOLD (never first-entry selection)`,
        (cf) => cf.concat([{ id: fid, fieldValue: bad }]), 'evidence_ambiguous', 'duplicate_evidence');
      await dupCase(`B26 ${fieldName}: conflicting duplicate FIRST + matching entry -> ambiguous / HOLD (never last-entry selection)`,
        (cf) => [{ id: fid, fieldValue: bad }].concat(cf), 'evidence_ambiguous', 'duplicate_evidence');
    }
    for (const [label, value] of [['an array', [18500]], ['an object', { amount: 18500 }], ['"12,500"', '12,500'], ['empty', '']]) {
      await dupCase(`B27 single repair_estimate entry whose value is ${label} -> reader evidence_ambiguous; verifier HOLD mismatch`,
        (cf) => cf.map((f) => (f.id === FIELDS.repairEstimate ? { id: f.id, fieldValue: value } : f)), 'evidence_ambiguous', 'mismatch');
    }
    { const fxR = fixture(); await completed(fxR);
      const oR = ghl.opps.get(fxR.opportunityId); oR.customFields = oR.customFields.filter((f) => f.id !== FIELDS.repairApprovalId);
      const r = await M.readRepairApproval(client, transport, fxR.scope, fxR.opportunityId);
      const fxV = fixture(); const a = await admit(fxV);
      await M.dispatchNote(a.admission, transport, fxV.payload);
      ghl.script([{ kind: 'oppPut', onlyField: FIELDS.repairEstimate }]);
      await M.dispatchFields(a.admission, fxV.payload);
      const v1 = await M.verifyRepairTarget(a.admission, fxV.payload);
      clock += 11_000;
      const v2 = await M.verifyRepairTarget(a.admission, fxV.payload);
      check('B28 zero repair_approval_id entries with E present -> reader evidence_mismatch; verifier pending missing_field, then HOLD', r.kind === 'not_verified' && r.reason === 'evidence_mismatch' && v1.kind === 'pending' && v1.reason === 'missing_field' && v2.kind === 'hold', { r, v1, v2 });
    }
    // ======================================================= A17 / hygiene ===
    { const ill = blobs.transitions.filter((t) => !(
        ((t.from === 'absent' || t.from === 'IDLE' || t.from === 'COMPLETED') && t.to === 'ADMITTED')
        || (t.from === 'ADMITTED' && t.to === 'HELD_RECOVERY')
        || (t.from === 'ADMITTED' && t.to === 'COMPLETED' && t.next && t.next.op && t.next.op.opId === t.prevOpId)
        || (t.from === 'ADMITTED' && t.to === 'IDLE' && t.next && t.next.last && t.next.last.outcome === 'abandoned_undispatched' && t.next.last.opId === t.prevOpId)));
      check('A17 every Blob transition in this run is allowed: COMPLETED only from ADMITTED(same op); IDLE only as abandoned_undispatched; no delete', ill.length === 0 && blobs.transitions.some((t) => t.to === 'COMPLETED'), ill.slice(0, 3));
      const fns = Object.keys(M).filter((k) => typeof M[k] === 'function').sort().join(',');
      check('A17 exported functions = accepted nine + completion operations', fns === ['abandonUndispatched', 'authorityKey', 'canonicalJson', 'classifyUncertainOpen', 'closeVerified', 'createAuthorityClient', 'createFakeTargetTransport', 'createProductionTargetTransport', 'dispatchFields', 'dispatchNote', 'fenceUncertainOpen', 'labelHeldRecovery', 'openAdmission', 'parseAuthorityText', 'readAuthority', 'readRepairApproval', 'verifyRepairTarget'].join(','), fns);
      check('hygiene: every fake-GHL request carried the synthetic bearer token and the Version header; no other origin reached', ghl.log.every((e) => (e.auth === 'Bearer synthetic-fake-transport' || e.auth === 'Bearer synthetic-server-ghl-credential') && e.version === '2021-07-28') && decoy.hits.length === 0);
      check('hygiene: every GHL write was a note POST or the two-field opportunity PUT (no other method or path)', ghl.log.every((e) => e.kind !== 'other'));
      check('hygiene: the network guard blocked nothing (no request left loopback)', blocked.length === 0, blocked);
    }
  } finally {
    await blobs.close(); await ghl.close(); await decoy.close();
  }
}

main().then(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\nB1 repair completion: ${checks - failures}/${checks} checks passed${failures ? ` (failures=${failures})` : ''}`);
  if (checks < FLOOR) { console.error(`FLOOR only ${checks} checks ran (floor ${FLOOR})`); process.exit(1); }
  process.exit(failures ? 1 : 0);
}, (e) => { console.error('ABORT', e); fs.rmSync(TMP, { recursive: true, force: true }); process.exit(1); });
