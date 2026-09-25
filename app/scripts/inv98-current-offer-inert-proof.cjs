/**
 * INV-98 Board #9 -- fixture-locked Current Offer side-effect (inert) proof.
 *
 * Reuses the INV-70 mechanism proven on Production (a single-custom-field
 * `PUT /opportunities/{id}` + singular-GET readback + `field_value: ""`
 * clear -- `inv70-current-offer-inert-proof.cjs`), and adds what INV-70
 * never recorded: the fixture's identity, stage, status, other fields,
 * contact tags and conversation state before and after, so the proof can
 * show the write changed the target field and nothing else.
 *
 * FIXTURE-LOCKED BY CONSTRUCTION. Every id below is hardcoded; there is no
 * flag that points this script at any other location, contact,
 * opportunity or field, and every mode re-verifies the fixture's identity
 * from a fresh GET before acting.
 *
 * FIVE SEPARATELY RUNNABLE MODES -- each is its own, separately approved
 * increment (PHASE_B_INERT_PROOFS.md practice). Only `write` and `restore`
 * ever PUT, and each PUTs AT MOST ONCE per invocation. Nothing retries.
 *
 *   --mode precheck  READ-ONLY. Verifies ids, pipeline, Under Contract
 *                    stage, status "open", and that the Current Offer
 *                    field matches the operator-declared starting state
 *                    (`--expect-field absent` or `--expect-field <number>`);
 *                    refuses otherwise. Captures the exact starting state
 *                    and chooses the temporary value. Requires a NEW
 *                    evidence file.
 *   --mode write     One PUT of the temporary value, only if a successful
 *                    precheck is recorded, no write was ever attempted, and
 *                    a fresh GET still shows the recorded starting state.
 *   --mode verify    READ-ONLY. Polls fresh GETs for the temporary value and
 *                    compares everything else to the starting state.
 *   --mode restore   One PUT of the RECORDED starting state (`""` if the
 *                    field was absent, else the exact starting value) --
 *                    skipped entirely if a fresh GET already shows the
 *                    starting state. Never writes the temporary value.
 *   --mode final     READ-ONLY. Polls fresh GETs for the starting state and
 *                    compares everything to the starting state.
 *
 * AMBIGUOUS WRITES ARE NEVER RETRIED. A PUT that throws (no HTTP response)
 * is recorded "ambiguous"; a non-2xx is recorded "rejected". Either way the
 * mode exits non-zero and names the next READ-ONLY step (verify / final).
 * A second restore attempt is a new, separately approved invocation.
 *
 * DURABLE EVIDENCE. Every mode appends a JSON line (fsync'd) to
 * `--evidence <file>` BEFORE and AFTER its action, so a failure mid-mode
 * still leaves a record. The file holds ids, field values, tags and
 * message ids/types/directions/timestamps -- never message bodies, never
 * the credential.
 *
 * WHAT THIS SCRIPT CANNOT SEE -- SPOCK'S UI HANDOFF. Workflow enrollment is
 * not API-readable (spec §4.6). Spock captures GHL UI snapshots at:
 *   S0  after `precheck`, BEFORE `write`
 *   S1  after `verify` + a ~5 minute hold, BEFORE `restore`
 *   S2  after `final` + a ~5 minute hold (the restore is itself a change)
 * Each snapshot: the contact's tags; the contact's Workflows panel (active
 * and past); enrollment totals + this contact's execution logs for
 * Seller - Under Contract Exit, Seller - Follow Up, Seller - Not
 * Interested, Seller - Route to Long-Term Nurture, Seller 6, Seller 7,
 * Seller 8, Phone Type Validation, and any workflow the builder audit found
 * with an opportunity-changed / custom-field trigger; and the contact's
 * conversation view (every channel, including failed or skipped sends).
 * PASS requires zero new enrollments and zero new message attempts across
 * S0 -> S1 -> S2, in addition to this script's own data checks.
 *
 * Usage (from app/):
 *   node scripts/inv98-current-offer-inert-proof.cjs --mode precheck \
 *     --credential-file <path> --evidence <new-file> --expect-field absent|<number>
 *   node scripts/inv98-current-offer-inert-proof.cjs --mode write|verify|restore|final \
 *     --credential-file <path> --evidence <same-file>
 */
'use strict';
const fs = require('fs');

const BASE = 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';
const LOCATION_ID = 'jmHG4B8RdzwpfqruNf68';
const CONTACT_ID = 'PyytyrvpIv8ndpJWK4kk';
const OPPORTUNITY_ID = 'EYPJ0L2ADOQVgPBdIods';
const PIPELINE_ID = 'GpUWK4YlhNqBzm5Hrm58';
const UNDER_CONTRACT_STAGE_ID = 'bf17076b-3830-4479-94bb-b8af70fe9163';
const CURRENT_OFFER_FIELD_ID = 'yZgEdTOvppmmCvv8kx9n';
const EXPECTED_STATUS = 'open';
const PRIMARY_TEMP_VALUE = 999999;
const ALTERNATE_TEMP_VALUE = 999998;
const MODES = ['precheck', 'write', 'verify', 'restore', 'final'];
const POLLS = 15;
const MESSAGE_PAGE_CAP = 20;

const EXIT = { OK: 0, USAGE: 2, REFUSED: 3, WRITE_NOT_CONFIRMED: 4, CHECK_FAILED: 5, READ_FAILED: 6 };

class Stop extends Error {
  constructor(code, message) { super(message); this.exitCode = code; }
}

function parseArgs(argv) {
  const get = (flag) => { const i = argv.indexOf(flag); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null; };
  const mode = get('--mode');
  const credentialFile = get('--credential-file');
  const evidencePath = get('--evidence');
  const expectRaw = get('--expect-field');
  if (!MODES.includes(mode)) throw new Stop(EXIT.USAGE, `--mode must be one of ${MODES.join(', ')}. There is no default.`);
  if (!credentialFile) throw new Stop(EXIT.USAGE, '--credential-file is required. There is no default.');
  if (!evidencePath) throw new Stop(EXIT.USAGE, '--evidence is required. There is no default.');
  let expectField = null;
  if (mode === 'precheck') {
    if (expectRaw === null) throw new Stop(EXIT.USAGE, '--expect-field absent|<number> is required for precheck: declare the starting state you expect.');
    if (expectRaw === 'absent') expectField = { present: false };
    else if (/^\d+(\.\d+)?$/.test(expectRaw)) expectField = { present: true, value: Number(expectRaw) };
    else throw new Stop(EXIT.USAGE, '--expect-field must be "absent" or a non-negative number.');
  } else if (expectRaw !== null) {
    throw new Stop(EXIT.USAGE, '--expect-field applies to precheck only; later modes use the recorded starting state.');
  }
  return { mode, credentialFile, evidencePath, expectField };
}

function readCredential(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { throw new Stop(EXIT.USAGE, 'credential file could not be read.'); }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^GHL_PRIVATE_API_KEY=(.*)$/);
    if (m && m[1].trim()) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  throw new Stop(EXIT.USAGE, 'GHL_PRIVATE_API_KEY is not present in the credential file.');
}

// ---- Durable evidence --------------------------------------------------------
function appendEvidence(path, record) {
  const fd = fs.openSync(path, 'a');
  try { fs.writeSync(fd, JSON.stringify(record) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function readEvidence(path) {
  if (!fs.existsSync(path)) return [];
  return fs.readFileSync(path, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
}

// ---- GHL reads (never throws a credential into a message) ---------------------
function client(fetchImpl, token) {
  const scrub = (s) => String(s).split(token).join('[redacted]').slice(0, 300);
  async function request(method, path, body) {
    const init = { method, headers: { Authorization: `Bearer ${token}`, Version: API_VERSION } };
    if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    const res = await fetchImpl(`${BASE}${path}`, init);
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: res.status, ok: res.ok, json, text: scrub(text) };
  }
  async function getOk(path) {
    let res;
    try { res = await request('GET', path); } catch (e) { throw new Stop(EXIT.READ_FAILED, `GET ${path.split('?')[0]} failed: ${scrub(e && e.message)}`); }
    if (!res.ok) throw new Stop(EXIT.READ_FAILED, `GET ${path.split('?')[0]} failed: HTTP ${res.status}: ${res.text}`);
    return res.json;
  }
  return { request, getOk, scrub };
}

function fieldState(opportunity) {
  const entry = (opportunity.customFields || []).find((f) => f && f.id === CURRENT_OFFER_FIELD_ID) || null;
  if (!entry) return { present: false };
  const value = entry.fieldValue !== undefined ? entry.fieldValue : entry.fieldValueNumber;
  return { present: true, value, entry };
}
function sameFieldState(a, b) {
  if (a.present !== b.present) return false;
  if (!a.present) return true;
  return Number(a.value) === Number(b.value) && JSON.stringify(a.entry) === JSON.stringify(b.entry);
}
function matchesExpectation(state, expected) {
  if (!expected.present) return !state.present;
  return state.present && Number(state.value) === expected.value;
}
const sortById = (list) => [...(list || [])].sort((x, y) => String(x && x.id).localeCompare(String(y && y.id)));

async function readConversations(api) {
  const search = await api.request('GET', `/conversations/search?${new URLSearchParams({ locationId: LOCATION_ID, contactId: CONTACT_ID })}`).catch((e) => ({ ok: false, status: 0, text: api.scrub(e && e.message) }));
  if (!search.ok) return { readable: false, status: search.status };
  const conversations = (search.json && search.json.conversations) || [];
  const out = [];
  for (const c of conversations) {
    if (!c || !c.id) return { readable: false, status: search.status, reason: 'conversation without id' };
    const messages = [];
    let lastMessageId;
    for (let page = 0; page < MESSAGE_PAGE_CAP; page++) {
      const params = new URLSearchParams({ limit: '100' });
      if (lastMessageId) params.set('lastMessageId', lastMessageId);
      const res = await api.request('GET', `/conversations/${c.id}/messages?${params}`).catch(() => ({ ok: false, status: 0 }));
      if (!res.ok) return { readable: false, status: res.status, reason: 'messages unreadable' };
      const body = res.json || {};
      const rows = (body.messages && body.messages.messages) || (Array.isArray(body.messages) ? body.messages : []);
      for (const m of rows) messages.push({ id: m.id, type: m.messageType || m.type || null, direction: m.direction || null, status: m.status || null, dateAdded: m.dateAdded || null });
      lastMessageId = body.messages && body.messages.lastMessageId;
      if (!(body.messages && body.messages.nextPage) || !lastMessageId || rows.length === 0) break;
    }
    out.push({ id: c.id, messages: messages.sort((x, y) => String(x.id).localeCompare(String(y.id))) });
  }
  return { readable: true, conversations: out.sort((x, y) => String(x.id).localeCompare(String(y.id))) };
}

/** A fresh, full observation of the fixture. */
async function observe(api) {
  const oppBody = await api.getOk(`/opportunities/${OPPORTUNITY_ID}`);
  const opportunity = (oppBody && (oppBody.opportunity || oppBody)) || {};
  const contactBody = await api.getOk(`/contacts/${CONTACT_ID}`);
  const contact = (contactBody && contactBody.contact) || {};
  return {
    opportunity: {
      id: opportunity.id, locationId: opportunity.locationId, contactId: opportunity.contactId,
      pipelineId: opportunity.pipelineId, pipelineStageId: opportunity.pipelineStageId, status: opportunity.status,
      monetaryValue: opportunity.monetaryValue === undefined ? null : opportunity.monetaryValue,
      assignedTo: opportunity.assignedTo === undefined ? null : opportunity.assignedTo,
      name: opportunity.name === undefined ? null : opportunity.name,
    },
    target: fieldState(opportunity),
    otherOpportunityFields: sortById((opportunity.customFields || []).filter((f) => f && f.id !== CURRENT_OFFER_FIELD_ID)),
    contact: {
      id: contact.id, locationId: contact.locationId,
      tags: [...(contact.tags || [])].sort(),
      customFields: sortById(contact.customFields),
      dnd: contact.dnd === undefined ? null : contact.dnd,
    },
    conversations: await readConversations(api),
  };
}

function identityProblems(obs) {
  const p = [];
  const o = obs.opportunity, c = obs.contact;
  if (o.id !== OPPORTUNITY_ID) p.push(`opportunity id is ${o.id}`);
  if (o.locationId !== LOCATION_ID) p.push(`opportunity location is ${o.locationId}`);
  if (o.contactId !== CONTACT_ID) p.push(`opportunity contact is ${o.contactId}`);
  if (o.pipelineId !== PIPELINE_ID) p.push(`opportunity pipeline is ${o.pipelineId}`);
  if (o.pipelineStageId !== UNDER_CONTRACT_STAGE_ID) p.push(`opportunity stage is ${o.pipelineStageId}`);
  if (o.status !== EXPECTED_STATUS) p.push(`opportunity status is ${o.status}`);
  if (c.id !== CONTACT_ID) p.push(`contact id is ${c.id}`);
  if (c.locationId !== LOCATION_ID) p.push(`contact location is ${c.locationId}`);
  return p;
}

/** Everything except the target field, compared to the starting state. */
function sideEffectDiffs(start, now) {
  const d = [];
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (!eq(start.opportunity, now.opportunity)) d.push('opportunity core (id/location/contact/pipeline/stage/status/value/assignee/name) changed');
  if (!eq(start.otherOpportunityFields, now.otherOpportunityFields)) d.push('another opportunity custom field changed');
  if (!eq(start.contact.tags, now.contact.tags)) d.push('contact tags changed');
  if (!eq(start.contact.customFields, now.contact.customFields)) d.push('contact custom fields changed');
  if (!eq(start.contact.dnd, now.contact.dnd)) d.push('contact DND changed');
  if (start.conversations.readable && now.conversations.readable) {
    if (!eq(start.conversations.conversations, now.conversations.conversations)) d.push('conversations/messages changed (possible message attempt)');
  } else if (start.conversations.readable !== now.conversations.readable) {
    d.push('conversation readability changed between observations');
  }
  return d;
}

function summarize(obs) {
  return {
    opportunity: obs.opportunity, target: obs.target, otherOpportunityFieldCount: obs.otherOpportunityFields.length,
    contactTags: obs.contact.tags, conversationsReadable: obs.conversations.readable,
    messageIds: obs.conversations.readable ? obs.conversations.conversations.flatMap((c) => c.messages.map((m) => m.id)) : null,
  };
}

async function putTarget(api, fieldValue) {
  const body = { customFields: [{ id: CURRENT_OFFER_FIELD_ID, field_value: fieldValue }] };
  try {
    const res = await api.request('PUT', `/opportunities/${OPPORTUNITY_ID}`, body);
    return { body, outcome: res.ok ? 'submitted' : 'rejected', httpStatus: res.status, response: res.ok ? null : res.text };
  } catch (e) {
    return { body, outcome: 'ambiguous', httpStatus: null, response: api.scrub(e && e.message) };
  }
}

function startRecord(evidence) {
  const ok = evidence.filter((r) => r.mode === 'precheck' && r.phase === 'after' && r.result === 'ok');
  if (ok.length !== 1) return null;
  return ok[0];
}

async function pollUntil(api, predicate, sleep, pollDelayMs) {
  const seen = [];
  let obs = null;
  for (let i = 1; i <= POLLS; i++) {
    obs = await observe(api);
    seen.push({ poll: i, target: obs.target });
    if (predicate(obs)) return { obs, seen, matched: true };
    if (i < POLLS) await sleep(pollDelayMs);
  }
  return { obs, seen, matched: false };
}

// ---- Modes -------------------------------------------------------------------
async function run(argv, deps) {
  const out = deps.stdout || ((s) => process.stdout.write(s + '\n'));
  const err = deps.stderr || ((s) => process.stderr.write(s + '\n'));
  const now = deps.now || (() => new Date().toISOString());
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const pollDelayMs = deps.pollDelayMs === undefined ? 2000 : deps.pollDelayMs;
  let args, evidencePath, mode = null;
  try {
    args = parseArgs(argv);
    mode = args.mode; evidencePath = args.evidencePath;
    const token = readCredential(args.credentialFile);
    const api = client(deps.fetch, token);
    const evidence = readEvidence(evidencePath);
    const record = (phase, extra) => appendEvidence(evidencePath, Object.assign({ mode, phase, at: now(), fixture: { locationId: LOCATION_ID, contactId: CONTACT_ID, opportunityId: OPPORTUNITY_ID, fieldId: CURRENT_OFFER_FIELD_ID } }, extra));

    if (mode === 'precheck') {
      if (evidence.length > 0) throw new Stop(EXIT.REFUSED, 'precheck requires a NEW evidence file; this one already holds records.');
      record('before', { expectField: args.expectField });
      const obs = await observe(api);
      const problems = identityProblems(obs);
      if (!matchesExpectation(obs.target, args.expectField)) problems.push(`Current Offer starting state ${JSON.stringify(obs.target)} does not match --expect-field ${JSON.stringify(args.expectField)}`);
      if (problems.length) {
        record('after', { result: 'refused', problems, observed: summarize(obs) });
        throw new Stop(EXIT.REFUSED, 'PRECHECK REFUSED: ' + problems.join('; '));
      }
      const tempValue = obs.target.present && Number(obs.target.value) === PRIMARY_TEMP_VALUE ? ALTERNATE_TEMP_VALUE : PRIMARY_TEMP_VALUE;
      record('after', { result: 'ok', start: obs, tempValue });
      out(`PRECHECK ok. Starting Current Offer: ${obs.target.present ? JSON.stringify(obs.target.value) : 'ABSENT'}. Temporary value: ${tempValue}. Conversations readable: ${obs.conversations.readable}.`);
      if (!obs.conversations.readable) err('WARNING: conversations are not API-readable with this credential -- message-attempt evidence must come from Spock\'s UI snapshots.');
      out('HANDOFF: Spock UI snapshot S0 (tags, workflows, enrollments, conversation) BEFORE --mode write.');
      return EXIT.OK;
    }

    record('before', {});
    const start = startRecord(evidence);
    if (!start) throw new Stop(EXIT.REFUSED, `${mode} requires exactly one successful precheck in this evidence file.`);
    const writeAttempts = evidence.filter((r) => r.mode === 'write' && r.phase === 'put_before');
    const restoreAfters = evidence.filter((r) => r.mode === 'restore' && r.phase === 'after');

    if (mode === 'write') {
      if (writeAttempts.length > 0) throw new Stop(EXIT.REFUSED, 'a write was already attempted for this evidence file -- never re-run write; use --mode verify (read-only).');
      const obs = await observe(api);
      const problems = identityProblems(obs);
      if (!sameFieldState(obs.target, start.start.target)) problems.push('Current Offer no longer matches the recorded starting state');
      if (problems.length) {
        record('refused', { problems, observed: summarize(obs) });
        throw new Stop(EXIT.REFUSED, 'WRITE REFUSED (nothing sent): ' + problems.join('; '));
      }
      record('put_before', { putBody: { customFields: [{ id: CURRENT_OFFER_FIELD_ID, field_value: start.tempValue }] }, observed: summarize(obs) });
      const put = await putTarget(api, start.tempValue);
      record('after', put);
      if (put.outcome !== 'submitted') {
        throw new Stop(EXIT.WRITE_NOT_CONFIRMED, `WRITE ${put.outcome.toUpperCase()} (HTTP ${put.httpStatus}). Not retried. Next: --mode verify (read-only) to observe the actual state.`);
      }
      out(`WRITE submitted (HTTP ${put.httpStatus}). Next: --mode verify.`);
      return EXIT.OK;
    }

    if (mode === 'verify') {
      if (writeAttempts.length === 0) throw new Stop(EXIT.REFUSED, 'verify requires a recorded write attempt.');
      const polled = await pollUntil(api, (o) => o.target.present && Number(o.target.value) === start.tempValue, sleep, pollDelayMs);
      const problems = identityProblems(polled.obs);
      const diffs = sideEffectDiffs(start.start, polled.obs);
      const result = !polled.matched ? 'temp_not_observed' : (problems.length || diffs.length) ? 'side_effect_detected' : 'temp_confirmed';
      record('after', { result, polls: polled.seen, problems, diffs, observed: summarize(polled.obs) });
      if (result !== 'temp_confirmed') throw new Stop(EXIT.CHECK_FAILED, `VERIFY ${result}: ${[...problems, ...diffs].join('; ') || 'temporary value not observed after ' + POLLS + ' reads'}.`);
      out(`VERIFY ok: temporary value ${start.tempValue} observed; nothing else changed.`);
      out('HANDOFF: hold ~5 minutes, then Spock UI snapshot S1 BEFORE --mode restore.');
      return EXIT.OK;
    }

    if (mode === 'restore') {
      if (writeAttempts.length === 0) throw new Stop(EXIT.REFUSED, 'restore requires a recorded write attempt.');
      const obs = await observe(api);
      const problems = identityProblems(obs);
      if (problems.length) {
        record('refused', { problems, observed: summarize(obs) });
        throw new Stop(EXIT.REFUSED, 'RESTORE REFUSED (nothing sent): ' + problems.join('; '));
      }
      if (sameFieldState(obs.target, start.start.target)) {
        record('after', { outcome: 'already_at_start', put: null, observed: summarize(obs) });
        out('RESTORE not needed: a fresh read already shows the recorded starting state. Nothing sent. Next: --mode final.');
        return EXIT.OK;
      }
      const startValue = start.start.target.present ? start.start.target.value : '';
      record('put_before', { putBody: { customFields: [{ id: CURRENT_OFFER_FIELD_ID, field_value: startValue }] }, observed: summarize(obs) });
      const put = await putTarget(api, startValue);
      record('after', put);
      if (put.outcome !== 'submitted') {
        throw new Stop(EXIT.WRITE_NOT_CONFIRMED, `RESTORE ${put.outcome.toUpperCase()} (HTTP ${put.httpStatus}). Not retried. THE FIELD MAY STILL HOLD ${start.tempValue} -- run --mode final (read-only) and escalate; a second restore is a separately approved invocation.`);
      }
      out(`RESTORE submitted (HTTP ${put.httpStatus}). Next: --mode final.`);
      return EXIT.OK;
    }

    // final
    if (restoreAfters.length === 0) throw new Stop(EXIT.REFUSED, 'final requires a recorded restore.');
    const polled = await pollUntil(api, (o) => sameFieldState(o.target, start.start.target), sleep, pollDelayMs);
    const problems = identityProblems(polled.obs);
    const diffs = sideEffectDiffs(start.start, polled.obs);
    const result = !polled.matched ? 'start_not_restored' : (problems.length || diffs.length) ? 'side_effect_detected' : 'restored_clean';
    record('after', { result, polls: polled.seen, problems, diffs, observed: summarize(polled.obs) });
    if (result !== 'restored_clean') throw new Stop(EXIT.CHECK_FAILED, `FINAL ${result}: ${[...problems, ...diffs].join('; ') || 'starting state not observed after ' + POLLS + ' reads -- THE FIELD MAY STILL HOLD ' + start.tempValue}.`);
    out('FINAL ok: Current Offer is back to its exact starting state and nothing else changed.');
    out('HANDOFF: hold ~5 minutes, then Spock UI snapshot S2. The proof passes only if S0 -> S1 -> S2 show zero new enrollments and zero new message attempts.');
    return EXIT.OK;
  } catch (e) {
    const code = e instanceof Stop ? e.exitCode : EXIT.READ_FAILED;
    const message = e instanceof Stop ? e.message : 'unexpected error: ' + String(e && e.message).slice(0, 300);
    if (evidencePath && mode && !(e instanceof Stop && e.exitCode === EXIT.USAGE)) {
      try { appendEvidence(evidencePath, { mode, phase: 'error', at: now(), exitCode: code, message }); } catch { /* evidence path unwritable -- still report */ }
    }
    err('STOP: ' + message);
    return code;
  }
}

module.exports = {
  run, parseArgs, EXIT,
  CONSTANTS: { LOCATION_ID, CONTACT_ID, OPPORTUNITY_ID, PIPELINE_ID, UNDER_CONTRACT_STAGE_ID, CURRENT_OFFER_FIELD_ID, EXPECTED_STATUS, PRIMARY_TEMP_VALUE, ALTERNATE_TEMP_VALUE },
};

if (require.main === module) {
  run(process.argv.slice(2), { fetch: globalThis.fetch }).then((code) => { process.exitCode = code; });
}
