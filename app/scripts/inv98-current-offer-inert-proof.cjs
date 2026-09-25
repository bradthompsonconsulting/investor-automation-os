/**
 * INV-98 Board #9 -- fixture-locked Current Offer side-effect (inert) proof.
 *
 * Reuses the INV-70 mechanism proven on Production (a single-custom-field
 * `PUT /opportunities/{id}` + singular-GET readback + `field_value: ""`
 * clear -- `inv70-current-offer-inert-proof.cjs`), and adds what INV-70
 * never recorded: the fixture's identity, stage/status (and their change
 * timestamps), other fields, source, followers, DND, contact tags and
 * conversation state before and after, so the proof can show the write
 * changed the target field and nothing else.
 *
 * FIXTURE-LOCKED BY CONSTRUCTION. Every id below is hardcoded; there is no
 * flag that points this script at any other location, contact,
 * opportunity or field, and every mode re-verifies the fixture's identity
 * from a fresh GET before acting.
 *
 * PROCEDURE -- each step is its own, separately approved increment
 * (PHASE_B_INERT_PROOFS.md practice). Only `write` and `restore` ever PUT,
 * each AT MOST ONCE per invocation. Nothing retries.
 *
 *    1. --mode precheck   READ-ONLY. Refuses unless ids, pipeline, Under
 *                         Contract stage, status "open" and the Current
 *                         Offer starting state (`--expect-field absent` or
 *                         `--expect-field <number>`; a present NON-numeric
 *                         value is refused, never coerced) all match.
 *                         Captures the exact starting baseline. NEW file.
 *    2. Spock UI snapshot S0.
 *    3. --mode write      One PUT of the temporary value -- refused unless a
 *                         fresh GET still shows the identity, the recorded
 *                         Current Offer state AND every monitored baseline
 *                         item unchanged since precheck.
 *    4. --mode verify     READ-ONLY, pass 1.
 *    5. Hold >= 5 minutes; Spock UI snapshot S1.
 *    6. --mode verify     READ-ONLY, pass 2 -- refused until 5 minutes after
 *                         pass 1.
 *    7. --mode restore    One PUT of the RECORDED starting state (`""` if
 *                         the field was absent, else the exact starting
 *                         value); skipped if a fresh GET already shows it.
 *                         Never blocked by a failed verify.
 *    8. --mode final      READ-ONLY, pass 1.
 *    9. Hold >= 5 minutes; Spock UI snapshot S2.
 *   10. --mode final      READ-ONLY, pass 2 -- refused until 5 minutes after
 *                         pass 1; computes the DATA verdict.
 *
 * VERDICT. The script's own verdict is never an unqualified pass: at best
 * it is "DATA CHECKS PASSED", which holds only if both verify passes saw
 * the temporary value with nothing else changed, both final passes saw
 * the exact starting state with nothing else changed, AND conversation
 * reads succeeded throughout. If any conversation read failed, message
 * verification is INCOMPLETE (evidence, result and exit code all say so).
 * The inert-proof passes only if Spock's S0/S1/S2 UI review is also clean.
 *
 * MONITORED BASELINE (any change is a side effect): opportunity id,
 * location, contact, pipeline, stage, status, lastStageChangeAt,
 * lastStatusChangeAt, monetary value, assignee, name, source, followers,
 * every other opportunity custom field; contact tags, custom fields, dnd,
 * per-channel dndSettings, source, followers; every conversation's
 * message ids/types/directions/statuses/timestamps. A key the API does not
 * return is recorded as "UNKNOWN". `updatedAt` / `dateUpdated` are
 * captured for chronology only -- a Current Offer write is expected to
 * change them, so they are never treated as a failure.
 *
 * AMBIGUOUS WRITES ARE NEVER RETRIED. A PUT that throws (no HTTP response)
 * is recorded "ambiguous"; a non-2xx is recorded "rejected". Either way the
 * mode exits non-zero and names the next READ-ONLY step. A second restore
 * is a new, separately approved invocation.
 *
 * DURABLE EVIDENCE. Every mode appends a JSON line (fsync'd) to
 * `--evidence <file>` at entry, before any PUT (`put_before`), and after
 * its action or on any error. Never message bodies, never the credential.
 *
 * ONE RUN AT A TIME. Each invocation first creates `<evidence>.lock` with
 * an exclusive create (O_EXCL, `fs.openSync(path, "wx")` -- atomic on a
 * local filesystem) and removes it when it finishes. A second concurrent
 * invocation on the same evidence file is refused before any read or
 * write. A lock left by a crashed run is NEVER auto-removed: a human
 * inspects the evidence, then deletes the lock file.
 *
 * SPOCK'S UI HANDOFF (workflow enrollment is not API-readable, spec §4.6).
 * At S0, S1 and S2 Spock records, for contact PyytyrvpIv8ndpJWK4kk /
 * opportunity EYPJ0L2ADOQVgPBdIods:
 *   - the contact's tags;
 *   - the contact's OWN workflow history (Workflows panel, active and past,
 *     and its execution-log entries);
 *   - enrollment totals and this contact's execution logs for
 *     Seller - Under Contract Exit, Seller - Follow Up, Seller - Not
 *     Interested, Seller - Route to Long-Term Nurture, Seller 6, Seller 7,
 *     Seller 8, Phone Type Validation, AND the six opportunity-trigger
 *     workflows from Spock's Production builder audit (listed by name in
 *     the S0 record);
 *   - the contact's OWN message-attempt view (conversation, every channel,
 *     including failed or skipped sends).
 * The proof passes only if the fixture's own workflow history and
 * message-attempt view show nothing new across S0 -> S1 -> S2.
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
const HOLD_MS = 5 * 60 * 1000;
const UNKNOWN = 'UNKNOWN';

const EXIT = { OK: 0, USAGE: 2, REFUSED: 3, WRITE_NOT_CONFIRMED: 4, CHECK_FAILED: 5, READ_FAILED: 6, INCOMPLETE: 7, LOCKED: 8 };

const HANDOFF = {
  S0: 'HANDOFF S0 (before --mode write): Spock records the contact\'s tags, its OWN workflow history (Workflows panel active+past, execution-log entries), enrollment totals + this contact\'s execution logs for Seller - Under Contract Exit, Seller - Follow Up, Seller - Not Interested, Seller - Route to Long-Term Nurture, Seller 6, Seller 7, Seller 8, Phone Type Validation and the six opportunity-trigger workflows from the Production builder audit (named in the S0 record), and its OWN message-attempt view (every channel, incl. failed/skipped).',
  S1: 'HANDOFF S1: hold >= 5 minutes after this verify, Spock repeats the S0 snapshot, then run --mode verify again (pass 2) BEFORE --mode restore.',
  S2: 'HANDOFF S2: hold >= 5 minutes after this final, Spock repeats the S0 snapshot, then run --mode final again (pass 2).',
  PASS: 'The inert-proof passes ONLY if Spock\'s S0 -> S1 -> S2 UI review also shows no new entry in the fixture\'s own workflow history and message-attempt view.',
};

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

// ---- Exclusive run lock --------------------------------------------------------
function acquireLock(evidencePath, now) {
  const lockPath = evidencePath + '.lock';
  let fd;
  try { fd = fs.openSync(lockPath, 'wx'); } catch (e) {
    if (e && e.code === 'EEXIST') throw new Stop(EXIT.LOCKED, `another run holds ${lockPath}. If no run is active, a previous run crashed: inspect the evidence file, then delete the lock file by hand. Nothing was read or written.`);
    throw new Stop(EXIT.LOCKED, `could not create ${lockPath}: ${e && e.code}. Nothing was read or written.`);
  }
  try { fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: now() }) + '\n'); } finally { fs.closeSync(fd); }
  return () => { try { fs.unlinkSync(lockPath); } catch { /* already gone */ } };
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

/** A strictly numeric Current Offer value, or null. Never coerces "" / null / text to a number. */
function numericOf(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && /^\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return null;
}
function fieldState(opportunity) {
  const entry = (opportunity.customFields || []).find((f) => f && f.id === CURRENT_OFFER_FIELD_ID) || null;
  if (!entry) return { present: false };
  const value = entry.fieldValue !== undefined ? entry.fieldValue : entry.fieldValueNumber;
  return { present: true, value: value === undefined ? null : value, numeric: numericOf(value), entry };
}
function sameFieldState(a, b) {
  if (a.present !== b.present) return false;
  if (!a.present) return true;
  return a.numeric !== null && a.numeric === b.numeric && JSON.stringify(a.entry) === JSON.stringify(b.entry);
}
function matchesExpectation(state, expected) {
  if (!expected.present) return !state.present;
  return state.present && state.numeric !== null && state.numeric === expected.value;
}
const holdsTemp = (obs, temp) => obs.target.present && obs.target.numeric === temp;
const sortById = (list) => [...(list || [])].sort((x, y) => String(x && x.id).localeCompare(String(y && y.id)));
const known = (obj, key, map) => (obj && Object.prototype.hasOwnProperty.call(obj, key) ? (map ? map(obj[key]) : obj[key]) : UNKNOWN);
const sortedIfArray = (v) => (Array.isArray(v) ? [...v].sort() : v);

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
      lastStageChangeAt: known(opportunity, 'lastStageChangeAt'),
      lastStatusChangeAt: known(opportunity, 'lastStatusChangeAt'),
      monetaryValue: known(opportunity, 'monetaryValue'),
      assignedTo: known(opportunity, 'assignedTo'),
      name: known(opportunity, 'name'),
      source: known(opportunity, 'source'),
      followers: known(opportunity, 'followers', sortedIfArray),
    },
    target: fieldState(opportunity),
    otherOpportunityFields: sortById((opportunity.customFields || []).filter((f) => f && f.id !== CURRENT_OFFER_FIELD_ID)),
    contact: {
      id: contact.id, locationId: contact.locationId,
      tags: [...(contact.tags || [])].sort(),
      customFields: sortById(contact.customFields),
      dnd: known(contact, 'dnd'),
      dndSettings: known(contact, 'dndSettings'),
      source: known(contact, 'source'),
      followers: known(contact, 'followers', sortedIfArray),
    },
    // Chronology only -- expected to change with the write; never compared.
    chronology: { opportunityUpdatedAt: known(opportunity, 'updatedAt'), contactDateUpdated: known(contact, 'dateUpdated') },
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

/**
 * Every monitored baseline item except the target field, compared to the
 * starting state. `messageVerification` is "complete" only when the
 * conversations were readable in BOTH observations.
 */
function sideEffectDiffs(start, now) {
  const d = [];
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const key of Object.keys(start.opportunity)) if (!eq(start.opportunity[key], now.opportunity[key])) d.push(`opportunity ${key} changed`);
  if (!eq(start.otherOpportunityFields, now.otherOpportunityFields)) d.push('another opportunity custom field changed');
  for (const key of ['tags', 'customFields', 'dnd', 'dndSettings', 'source', 'followers']) if (!eq(start.contact[key], now.contact[key])) d.push(`contact ${key} changed`);
  let messageVerification = 'incomplete';
  if (start.conversations.readable && now.conversations.readable) {
    messageVerification = 'complete';
    if (!eq(start.conversations.conversations, now.conversations.conversations)) d.push('conversations/messages changed (possible message attempt)');
  } else if (start.conversations.readable !== now.conversations.readable) {
    d.push('conversation readability changed between observations');
  }
  return { diffs: d, messageVerification };
}

function summarize(obs) {
  return {
    opportunity: obs.opportunity, target: obs.target, otherOpportunityFieldCount: obs.otherOpportunityFields.length,
    contact: { tags: obs.contact.tags, dnd: obs.contact.dnd, dndSettings: obs.contact.dndSettings, source: obs.contact.source, followers: obs.contact.followers },
    chronology: obs.chronology, conversationsReadable: obs.conversations.readable,
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
    seen.push({ poll: i, target: obs.target, chronology: obs.chronology });
    if (predicate(obs)) return { obs, seen, matched: true };
    if (i < POLLS) await sleep(pollDelayMs);
  }
  return { obs, seen, matched: false };
}

/** Refuses a pass-2 read until HOLD_MS after the pass-1 record. */
function requireHold(previous, nowIso, label) {
  const elapsed = Date.parse(nowIso) - Date.parse(previous.at);
  if (!(elapsed >= HOLD_MS)) {
    throw new Stop(EXIT.REFUSED, `${label} pass 2 refused: only ${Math.max(0, Math.floor(elapsed / 1000))}s since pass 1; the hold is ${HOLD_MS / 1000}s. Nothing was read.`);
  }
}

/** The script's DATA verdict, computed from the evidence at final pass 2 (or later). */
function dataVerdict(evidence) {
  const verifies = evidence.filter((r) => r.mode === 'verify' && r.phase === 'after');
  const finals = evidence.filter((r) => r.mode === 'final' && r.phase === 'after');
  const reasons = [];
  if (verifies.length < 2) reasons.push('fewer than two verify passes');
  if (finals.length < 2) reasons.push('fewer than two final passes');
  const firstTwoVerifies = verifies.slice(0, 2), lastTwoFinals = finals.slice(-2);
  for (const v of firstTwoVerifies) if (v.result !== 'temp_confirmed') reasons.push(`a verify pass was ${v.result}`);
  for (const f of lastTwoFinals) if (f.result !== 'restored_clean') reasons.push(`a final pass was ${f.result}`);
  if (reasons.length) return { verdict: 'FAILED', reasons };
  const incomplete = [...firstTwoVerifies, ...lastTwoFinals].some((r) => r.messageVerification !== 'complete');
  return incomplete ? { verdict: 'INCOMPLETE', reasons: ['message verification incomplete: a conversation read failed'] } : { verdict: 'DATA_CHECKS_PASSED', reasons: [] };
}

// ---- Modes -------------------------------------------------------------------
async function run(argv, deps) {
  const out = deps.stdout || ((s) => process.stdout.write(s + '\n'));
  const err = deps.stderr || ((s) => process.stderr.write(s + '\n'));
  const now = deps.now || (() => new Date().toISOString());
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const pollDelayMs = deps.pollDelayMs === undefined ? 2000 : deps.pollDelayMs;
  let args, evidencePath, mode = null, release = null;
  try {
    args = parseArgs(argv);
    mode = args.mode; evidencePath = args.evidencePath;
    release = acquireLock(evidencePath, now);
    const token = readCredential(args.credentialFile);
    const api = client(deps.fetch, token);
    const evidence = readEvidence(evidencePath);
    const record = (phase, extra) => appendEvidence(evidencePath, Object.assign({ mode, phase, at: now(), fixture: { locationId: LOCATION_ID, contactId: CONTACT_ID, opportunityId: OPPORTUNITY_ID, fieldId: CURRENT_OFFER_FIELD_ID } }, extra));

    if (mode === 'precheck') {
      if (evidence.length > 0) throw new Stop(EXIT.REFUSED, 'precheck requires a NEW evidence file; this one already holds records.');
      record('before', { expectField: args.expectField });
      const obs = await observe(api);
      const problems = identityProblems(obs);
      if (obs.target.present && obs.target.numeric === null) problems.push(`Current Offer is present but not numeric (${JSON.stringify(obs.target.value)}) -- refused, never coerced`);
      else if (!matchesExpectation(obs.target, args.expectField)) problems.push(`Current Offer starting state ${JSON.stringify(obs.target)} does not match --expect-field ${JSON.stringify(args.expectField)}`);
      if (problems.length) {
        record('after', { result: 'refused', problems, observed: summarize(obs) });
        throw new Stop(EXIT.REFUSED, 'PRECHECK REFUSED: ' + problems.join('; '));
      }
      const tempValue = obs.target.present && obs.target.numeric === PRIMARY_TEMP_VALUE ? ALTERNATE_TEMP_VALUE : PRIMARY_TEMP_VALUE;
      const messageVerification = obs.conversations.readable ? 'complete' : 'incomplete';
      record('after', { result: 'ok', start: obs, tempValue, messageVerification });
      out(`PRECHECK ok. Starting Current Offer: ${obs.target.present ? JSON.stringify(obs.target.value) : 'ABSENT'}. Temporary value: ${tempValue}. Conversations readable: ${obs.conversations.readable}.`);
      if (!obs.conversations.readable) err('WARNING: conversations are not API-readable with this credential -- MESSAGE VERIFICATION WILL BE INCOMPLETE; the script cannot report a clean data pass.');
      out(HANDOFF.S0);
      return EXIT.OK;
    }

    record('before', {});
    const start = startRecord(evidence);
    if (!start) throw new Stop(EXIT.REFUSED, `${mode} requires exactly one successful precheck in this evidence file.`);
    const writeAttempts = evidence.filter((r) => r.mode === 'write' && r.phase === 'put_before');
    const restoreAfters = evidence.filter((r) => r.mode === 'restore' && r.phase === 'after');
    const verifyAfters = evidence.filter((r) => r.mode === 'verify' && r.phase === 'after');
    const finalAfters = evidence.filter((r) => r.mode === 'final' && r.phase === 'after');

    if (mode === 'write') {
      if (writeAttempts.length > 0) throw new Stop(EXIT.REFUSED, 'a write was already attempted for this evidence file -- never re-run write; use --mode verify (read-only).');
      const obs = await observe(api);
      const problems = identityProblems(obs);
      if (!sameFieldState(obs.target, start.start.target)) problems.push('Current Offer no longer matches the recorded starting state');
      const drift = sideEffectDiffs(start.start, obs);
      problems.push(...drift.diffs.map((x) => 'baseline drift since precheck: ' + x));
      if (problems.length) {
        record('refused', { problems, observed: summarize(obs) });
        throw new Stop(EXIT.REFUSED, 'WRITE REFUSED (nothing sent): ' + problems.join('; '));
      }
      record('put_before', { putBody: { customFields: [{ id: CURRENT_OFFER_FIELD_ID, field_value: start.tempValue }] }, messageVerification: drift.messageVerification, observed: summarize(obs) });
      const put = await putTarget(api, start.tempValue);
      record('after', put);
      if (put.outcome !== 'submitted') {
        throw new Stop(EXIT.WRITE_NOT_CONFIRMED, `WRITE ${put.outcome.toUpperCase()} (HTTP ${put.httpStatus}). Not retried. Next: --mode verify (read-only) to observe the actual state.`);
      }
      out(`WRITE submitted (HTTP ${put.httpStatus}). Next: --mode verify (pass 1).`);
      return EXIT.OK;
    }

    if (mode === 'verify') {
      if (writeAttempts.length === 0) throw new Stop(EXIT.REFUSED, 'verify requires a recorded write attempt.');
      if (restoreAfters.length > 0 || evidence.some((r) => r.mode === 'restore' && r.phase === 'put_before')) throw new Stop(EXIT.REFUSED, 'verify observes the temporary state; a restore was already attempted -- use --mode final.');
      const pass = verifyAfters.length + 1;
      if (pass === 2) requireHold(verifyAfters[0], now(), 'verify');
      const polled = await pollUntil(api, (o) => holdsTemp(o, start.tempValue), sleep, pollDelayMs);
      const problems = identityProblems(polled.obs);
      const cmp = sideEffectDiffs(start.start, polled.obs);
      const result = !polled.matched ? 'temp_not_observed' : (problems.length || cmp.diffs.length) ? 'side_effect_detected' : 'temp_confirmed';
      record('after', { pass, result, messageVerification: cmp.messageVerification, polls: polled.seen, problems, diffs: cmp.diffs, observed: summarize(polled.obs) });
      if (result !== 'temp_confirmed') throw new Stop(EXIT.CHECK_FAILED, `VERIFY pass ${pass} ${result}: ${[...problems, ...cmp.diffs].join('; ') || 'temporary value not observed after ' + POLLS + ' reads'}.`);
      const next = pass === 1 ? HANDOFF.S1 : 'Next: --mode restore.';
      if (cmp.messageVerification !== 'complete') {
        err(`VERIFY pass ${pass}: temporary value ${start.tempValue} observed and no data change, but MESSAGE VERIFICATION INCOMPLETE (a conversation read failed).`);
        out(next);
        return EXIT.INCOMPLETE;
      }
      out(`VERIFY pass ${pass} ok: temporary value ${start.tempValue} observed; no monitored baseline item changed; messages verified.`);
      out(next);
      return EXIT.OK;
    }

    if (mode === 'restore') {
      if (writeAttempts.length === 0) throw new Stop(EXIT.REFUSED, 'restore requires a recorded write attempt.');
      const obs = await observe(api);
      const problems = identityProblems(obs);
      if (problems.length) {
        record('refused', { problems, observed: summarize(obs) });
        throw new Stop(EXIT.REFUSED, 'RESTORE REFUSED (nothing sent): ' + problems.join('; ') + ' -- escalate.');
      }
      if (sameFieldState(obs.target, start.start.target)) {
        record('after', { outcome: 'already_at_start', put: null, observed: summarize(obs) });
        out('RESTORE not needed: a fresh read already shows the recorded starting state. Nothing sent. Next: --mode final (pass 1).');
        return EXIT.OK;
      }
      const startValue = start.start.target.present ? start.start.target.value : '';
      record('put_before', { putBody: { customFields: [{ id: CURRENT_OFFER_FIELD_ID, field_value: startValue }] }, verifyPassesBeforeRestore: verifyAfters.length, observed: summarize(obs) });
      const put = await putTarget(api, startValue);
      record('after', put);
      if (put.outcome !== 'submitted') {
        throw new Stop(EXIT.WRITE_NOT_CONFIRMED, `RESTORE ${put.outcome.toUpperCase()} (HTTP ${put.httpStatus}). Not retried. THE FIELD MAY STILL HOLD ${start.tempValue} -- run --mode final (read-only) and escalate; a second restore is a separately approved invocation.`);
      }
      out(`RESTORE submitted (HTTP ${put.httpStatus}). Next: --mode final (pass 1).`);
      return EXIT.OK;
    }

    // final
    if (restoreAfters.length === 0) throw new Stop(EXIT.REFUSED, 'final requires a recorded restore.');
    const pass = finalAfters.length + 1;
    if (pass >= 2) requireHold(finalAfters[finalAfters.length - 1], now(), 'final');
    const polled = await pollUntil(api, (o) => sameFieldState(o.target, start.start.target), sleep, pollDelayMs);
    const problems = identityProblems(polled.obs);
    const cmp = sideEffectDiffs(start.start, polled.obs);
    const result = !polled.matched ? 'start_not_restored' : (problems.length || cmp.diffs.length) ? 'side_effect_detected' : 'restored_clean';
    const thisRecord = { mode: 'final', phase: 'after', pass, result, messageVerification: cmp.messageVerification };
    const verdict = pass >= 2 ? dataVerdict([...evidence, thisRecord]) : null;
    record('after', { pass, result, messageVerification: cmp.messageVerification, verdict, polls: polled.seen, problems, diffs: cmp.diffs, observed: summarize(polled.obs) });
    if (result !== 'restored_clean') throw new Stop(EXIT.CHECK_FAILED, `FINAL pass ${pass} ${result}: ${[...problems, ...cmp.diffs].join('; ') || 'starting state not observed after ' + POLLS + ' reads -- THE FIELD MAY STILL HOLD ' + start.tempValue}.`);
    if (pass === 1) {
      if (cmp.messageVerification !== 'complete') err('FINAL pass 1: starting state restored and no data change, but MESSAGE VERIFICATION INCOMPLETE (a conversation read failed).');
      else out('FINAL pass 1 ok: Current Offer is back to its exact starting state; no monitored baseline item changed; messages verified.');
      out(HANDOFF.S2);
      return cmp.messageVerification !== 'complete' ? EXIT.INCOMPLETE : EXIT.OK;
    }
    if (verdict.verdict === 'DATA_CHECKS_PASSED') {
      out('DATA CHECKS PASSED (script evidence only): both verify passes saw the temporary value alone, both final passes saw the exact starting state, messages verified throughout.');
      out(HANDOFF.PASS);
      return EXIT.OK;
    }
    if (verdict.verdict === 'INCOMPLETE') {
      err('DATA CHECKS INCOMPLETE: ' + verdict.reasons.join('; ') + '. This is NOT a clean pass.');
      out(HANDOFF.PASS);
      return EXIT.INCOMPLETE;
    }
    throw new Stop(EXIT.CHECK_FAILED, 'DATA CHECKS FAILED: ' + verdict.reasons.join('; ') + '.');
  } catch (e) {
    const code = e instanceof Stop ? e.exitCode : EXIT.READ_FAILED;
    const message = e instanceof Stop ? e.message : 'unexpected error: ' + String(e && e.message).slice(0, 300);
    if (evidencePath && mode && !(e instanceof Stop && (e.exitCode === EXIT.USAGE || e.exitCode === EXIT.LOCKED))) {
      try { appendEvidence(evidencePath, { mode, phase: 'error', at: now(), exitCode: code, message }); } catch { /* evidence path unwritable -- still report */ }
    }
    err('STOP: ' + message);
    return code;
  } finally {
    if (release) release();
  }
}

module.exports = {
  run, parseArgs, EXIT, HANDOFF, HOLD_MS,
  CONSTANTS: { LOCATION_ID, CONTACT_ID, OPPORTUNITY_ID, PIPELINE_ID, UNDER_CONTRACT_STAGE_ID, CURRENT_OFFER_FIELD_ID, EXPECTED_STATUS, PRIMARY_TEMP_VALUE, ALTERNATE_TEMP_VALUE },
};

if (require.main === module) {
  run(process.argv.slice(2), { fetch: globalThis.fetch }).then((code) => { process.exitCode = code; });
}
