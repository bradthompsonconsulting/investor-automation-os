/**
 * B15-04 -- creates the synthetic fixtures for the controlled Test evaluation
 * of property answers (Brad's Test authorization, 2026-10-17: "run the
 * controlled Test evaluation with fake contacts and deals"). GHL TEST ONLY.
 *
 *   Y1 "IAOS PROBE Answers Y1"  + Deal E (Seller Leads, New Lead - Seller, open)       -> one eligible deal
 *   Y2 "IAOS PROBE Answers Y2"  + Deal F (New Lead - Seller, open)
 *                               + Deal G (Seller Follow-Up, open)                       -> two eligible deals
 *
 * No email, no phone, no tags, no workflow enrolment requested. --apply runs
 * at most 10 requests, each once, no retry, in this order:
 *   POST /contacts/ (Y1), POST /contacts/ (Y2),
 *   POST /opportunities/ (E, F, G),
 *   GET /contacts/{id} x2, GET /opportunities/{id} x3   (readback)
 * STOP on any non-2xx (including a duplicate-opportunity refusal for G) or any
 * readback mismatch. The journal holds statuses, ids and names only.
 */
const fs = require('fs');
const path = require('path');
const BASE = 'https://services.leadconnectorhq.com';
const VERSION = '2021-07-28';
const TEST_LOCATION = 'SoTgVoaFGHtBdRFvXWQV';
const PIPELINE = 'wdvKMdPMxs38qoA6lkUa';                   // Test Seller Leads (ghl-config.ts TEST)
const STAGE_NEW_LEAD = '1228a837-09b1-4ce5-8821-cfd98a6d9367'; // Test newLeadSeller
const MAX_REQUESTS = 10;
const die = (m, c = 2) => { console.error('STOP: ' + m); process.exit(c); };
const arg = (f) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : null; };

async function main() {
  const location = arg('--location'), cred = arg('--credential-file'), journalDir = arg('--journal'), followUp = arg('--follow-up-stage');
  if (location !== TEST_LOCATION) die('Test location only');
  if (!cred || !journalDir || !followUp) die('--credential-file, --journal and --follow-up-stage are required');
  if (!process.argv.includes('--apply')) { console.log('DRY RUN: nothing sent. Re-run with --apply.'); return; }
  const m = fs.readFileSync(cred, 'utf8').match(/^GHL_PRIVATE_API_KEY=(.*)$/m);
  if (!m || !m[1].trim()) die('GHL_PRIVATE_API_KEY not found');
  const token = m[1].trim().replace(/^["']|["']$/g, '');
  fs.mkdirSync(journalDir, { recursive: true });
  const fd = fs.openSync(path.join(journalDir, 'b15-04-fixtures-apply.jsonl'), 'wx');
  const line = (o) => { fs.writeSync(fd, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n'); fs.fsyncSync(fd); };
  let sent = 0;
  async function req(method, p, body) {
    if (++sent > MAX_REQUESTS) die('request budget exceeded');
    line({ event: 'ATTEMPT', n: sent, method, path: p });
    const res = await fetch(BASE + p, { method, redirect: 'error', headers: { Authorization: `Bearer ${token}`, Version: VERSION, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await res.text();
    line({ event: 'RESPONSE', n: sent, status: res.status, ...(res.ok ? {} : { message: (() => { try { return String(JSON.parse(text).message).slice(0, 200); } catch { return null; } })() }) });
    if (!res.ok) die(`HTTP ${res.status} on ${method} ${p}`, 3);
    return JSON.parse(text);
  }
  line({ event: 'START', location, pipeline: PIPELINE });
  const contacts = {};
  for (const [k, lastName] of [['Y1', 'Answers Y1'], ['Y2', 'Answers Y2']]) {
    const r = await req('POST', '/contacts/', { locationId: location, firstName: 'IAOS PROBE', lastName, source: 'IAOS PROBE B15-04' });
    const c = r.contact ?? r; if (typeof c.id !== 'string') die('no contact id');
    contacts[k] = c.id; line({ event: 'CONTACT', key: k, id: c.id });
  }
  const opps = {};
  for (const [k, contact, stage] of [['E', 'Y1', STAGE_NEW_LEAD], ['F', 'Y2', STAGE_NEW_LEAD], ['G', 'Y2', followUp]]) {
    const r = await req('POST', '/opportunities/', { locationId: location, pipelineId: PIPELINE, pipelineStageId: stage, name: `IAOS PROBE Answers Deal ${k}`, status: 'open', contactId: contacts[contact] });
    const o = r.opportunity ?? r; if (typeof o.id !== 'string') die('no opportunity id');
    opps[k] = o.id; line({ event: 'OPPORTUNITY', key: k, id: o.id, contactKey: contact });
  }
  for (const k of ['Y1', 'Y2']) {
    const c = (await req('GET', `/contacts/${contacts[k]}`)).contact;
    const checks = { id: c?.id === contacts[k], location: c?.locationId === location, noEmail: !c?.email, noPhone: !c?.phone, noTags: !(c?.tags ?? []).length };
    line({ event: 'READBACK_CONTACT', key: k, checks }); if (!Object.values(checks).every(Boolean)) die('contact readback mismatch ' + k, 4);
  }
  for (const [k, contact, stage] of [['E', 'Y1', STAGE_NEW_LEAD], ['F', 'Y2', STAGE_NEW_LEAD], ['G', 'Y2', followUp]]) {
    const r = await req('GET', `/opportunities/${opps[k]}`); const o = r.opportunity ?? r;
    const checks = { id: o.id === opps[k], location: o.locationId === location, contact: o.contactId === contacts[contact], pipeline: o.pipelineId === PIPELINE, stage: o.pipelineStageId === stage, open: o.status === 'open' };
    line({ event: 'READBACK_OPPORTUNITY', key: k, checks }); if (!Object.values(checks).every(Boolean)) die('opportunity readback mismatch ' + k, 4);
  }
  line({ event: 'END', verdict: 'FIXTURES_CREATED', requests: sent, contacts, opps });
  fs.closeSync(fd);
  console.log(JSON.stringify({ verdict: 'FIXTURES_CREATED', requests: sent, contacts, opps }, null, 2));
}
main().catch((e) => { console.error('FATAL: ' + e.message); process.exit(1); });
