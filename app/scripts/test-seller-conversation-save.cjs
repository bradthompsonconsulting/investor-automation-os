/**
 * B15-03 / INV-103 slice C -- Save at Summary, offline unit suite.
 *
 *   A. The structured conversation note carrier (src/lib/seller-conversation-note.ts): exact v1 format, strict
 *      positional parse, round trips, refusals, the frozen schema still matches QUESTIONS, supersede by call id.
 *   B. The save plan (src/lib/seller-conversation-save.ts buildSavePlan): one note; canonical updates only where the
 *      draft differs from the record; timing carries Transaction assumptions' other two items; invalid price; the
 *      three occupancy values; address / reason "not saved: not enabled" and never written; the integrated
 *      sections; conflicts; results (uncertain blocks, confirmed identical is done).
 *   C. Response classification (confirmed / refused / uncertain) and the timeout helper.
 *   D. The coordinator: order, one save in flight, no resend of uncertain or confirmed-identical items, Check again
 *      (found -> confirmed, not found -> a FRESH resend), per-deal isolation.
 *   E. Server and config: the ledger guard validates the carrier (ownership, call-id binding); Production write scope
 *      refuses it unconditionally; the flag is DISABLED in both environments and projects disabled; the browser
 *      refuses a malformed projection; the INV95 row exists and says DISABLED.
 *
 *   node scripts/test-seller-conversation-save.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
require('./harness/ts-loader.cjs');
process.env.IAOS_ENV = process.env.IAOS_ENV || 'test';

const APP = path.resolve(__dirname, '..');
const C = require(path.join(APP, 'src/lib/seller-conversation.ts'));
const N = require(path.join(APP, 'src/lib/seller-conversation-note.ts'));
const S = require(path.join(APP, 'src/lib/seller-conversation-save.ts'));
const R = require(path.join(APP, 'src/lib/seller-call-readiness-carriers.ts'));
const SP = require(path.join(APP, 'src/lib/seller-call-seller-position-note.ts'));
const CFG = require(path.join(APP, 'shared/ghl-config.ts'));

const FLOOR = 130;
let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail === undefined ? '' : ` -- ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`); }
}
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const OPP = 'opp-fixture-1';
const CALL = 'call-0001';
const AT = '2026-11-03T15:04:05.000Z';
let d = C.EMPTY_CONVERSATION;
d = C.withField(d, 'opening', 'response', 'Open to talking');
d = C.withField(d, 'ownership', 'owners', 'Ready and a sibling\n  (sibling lives in Ohio)  ');
d = C.withField(d, 'occupancy', 'occupancy', 'Tenant Occupied');
d = C.withField(d, 'price', 'amount', '410000');
d = C.withField(d, 'price', 'basis', 'Said "about" 410 — maybe less');
d = C.withMark(d, 'asis', 'seller_doesnt_know');
d = C.withField(d, 'summary', 'followup', '2026-11-10');
d = { ...d, opening: 'inbound', notes: 'Seller prefers mornings.\nDog on site.' };
const ROWS = C.noteFor(d);
const input = (over = {}) => ({ opportunityId: OPP, callId: CALL, at: AT, operator: null, opening: d.opening, rows: ROWS, ...over });
const body = N.formatSellerConversationNote(input());
const lines = body.split('\n');

/* ===================== A. carrier ===================== */
check('A: exact header line', lines[0] === 'IAOS SELLER CONVERSATION — iaos-seller-conversation-v1', lines[0]);
check('A: metadata lines in order: Recorded at, Operator (UNAVAILABLE when unknown), Opportunity, Call, Opening type',
  same(lines.slice(1, 6), [`Recorded at: ${AT}`, 'Operator: UNAVAILABLE', `Opportunity: ${OPP}`, `Call: ${CALL}`, 'Opening type: Inbound Inquiry']), lines.slice(1, 6));
const headings = lines.filter((l) => l.startsWith('## '));
check('A: every question heading in order, then General notes', same(headings, [...C.QUESTIONS.map((q, i) => `## ${i === 0 ? q.title : `${i}. ${q.title}`}`), '## General notes']), headings);
check('A: "Seller doesn\'t know" is its own literal line under As-is', lines[lines.indexOf('## 7. As-is sale fit') + 1] === "Seller doesn't know");
check('A: a blank answer is an empty string, never "Unanswered"', lines.includes('Street: ""') && !body.includes('Unanswered'));
check('A: answers are exactly the noteFor values (JSON string literal per line)', lines.includes(`Owner / decision-maker: ${JSON.stringify('Ready and a sibling\n  (sibling lives in Ohio)  ')}`) && lines.includes('Occupancy: "Tenant Occupied"') && lines.includes(`Price notes: ${JSON.stringify('Said "about" 410 — maybe less')}`));
check('A: General notes are the last line', lines[lines.length - 1] === `General notes: ${JSON.stringify('Seller prefers mornings.\nDog on site.')}`);
check('A: every noteFor answer appears in the note (all answers + General notes represented)',
  ROWS.every((r) => (r.kind === 'general' ? body.includes(JSON.stringify(r.value)) : r.answers.every((a) => lines.includes(`${a.label}: ${JSON.stringify(a.value)}`)))));
const parsed = N.parseSellerConversationNote(body);
check('A: parses back to the same call, opportunity, time, operator and opening', !!parsed && parsed.callId === CALL && parsed.opportunityId === OPP && parsed.at === AT && parsed.operator === null && parsed.opening === 'inbound');
check('A: round trip: every answer and mark equals the draft projection', !!parsed && parsed.questions.every((q, i) => ROWS[i].id === q.id && ROWS[i].dontKnow === q.dontKnow && ROWS[i].answers.every((a) => q.answers[a.fieldId] === a.value)) && parsed.general === d.notes);
const reformat = parsed && N.formatSellerConversationNote({ opportunityId: parsed.opportunityId, callId: parsed.callId, at: parsed.at, operator: parsed.operator, opening: parsed.opening,
  rows: [...C.QUESTIONS.map((q, i) => ({ kind: 'question', id: q.id, heading: i === 0 ? q.title : `${i}. ${q.title}`, dontKnow: parsed.questions[i].dontKnow, answers: q.fields.map((f) => ({ fieldId: f.id, label: f.label, value: parsed.questions[i].answers[f.id] })) })), { kind: 'general', id: 'general', heading: 'General notes', value: parsed.general }] });
check('A: round trip: format(parse(body)) is byte-identical', reformat === body);
const emptyBody = N.formatSellerConversationNote(input({ rows: C.noteFor(C.EMPTY_CONVERSATION), opening: 'cold' }));
check('A: an all-blank call formats and parses (every value "")', !!N.parseSellerConversationNote(emptyBody) && N.parseSellerConversationNote(emptyBody).questions.every((q) => Object.values(q.answers).every((v) => v === '')));
check('A: a named operator round-trips', N.parseSellerConversationNote(N.formatSellerConversationNote(input({ operator: 'brad' }))).operator === 'brad');
const mutate = (fn) => N.parseSellerConversationNote(fn(body));
check('A refuse: another header or version', mutate((b) => b.replace('iaos-seller-conversation-v1', 'iaos-seller-conversation-v2')) === null && mutate((b) => b.replace('IAOS SELLER CONVERSATION', 'IAOS SELLER CONVERSATIONS')) === null);
check('A refuse: a missing line', mutate((b) => b.split('\n').filter((l) => l !== 'Unit: ""').join('\n')) === null);
check('A refuse: an extra line or a trailing newline', mutate((b) => `${b}\nExtra: "x"`) === null && mutate((b) => `${b}\n`) === null);
check('A refuse: two lines swapped', mutate((b) => { const x = b.split('\n'); const i = x.indexOf('Street: ""'); [x[i], x[i + 1]] = [x[i + 1], x[i]]; return x.join('\n'); }) === null);
check('A refuse: an unquoted, single-quoted or non-canonical value', mutate((b) => b.replace('Street: ""', 'Street: ')) === null && mutate((b) => b.replace('Street: ""', "Street: ''")) === null
  && mutate((b) => b.replace('Occupancy: "Tenant Occupied"', 'Occupancy: "Tenant\\u0020Occupied"')) === null && mutate((b) => b.replace('Street: ""', 'Street: "" ')) === null);
check('A refuse: a non-canonical timestamp', mutate((b) => b.replace(AT, '2026-11-03T15:04:05Z')) === null);
check('A refuse: an unknown opening type', mutate((b) => b.replace('Opening type: Inbound Inquiry', 'Opening type: Walk-in')) === null);
check('A refuse: a bad opportunity or call id', mutate((b) => b.replace(`Opportunity: ${OPP}`, 'Opportunity: bad id!')) === null && mutate((b) => b.replace(`Call: ${CALL}`, 'Call: ')) === null);
check('A refuse: a "Seller doesn\'t know" line in the wrong place', mutate((b) => b.replace('## 1. Property address\n', "## 1. Property address\nStreet: \"\"\nSeller doesn't know\n").replace('Street: ""\nStreet', 'Street')) === null);
check('A format refuses: a body over the size limit', throws(() => N.formatSellerConversationNote(input({ rows: C.noteFor({ ...d, notes: 'x'.repeat(N.SELLER_CONVERSATION_NOTE_MAX_LENGTH) }) }))));
check('A parse refuses: a body over the size limit', N.parseSellerConversationNote(body + 'x'.repeat(N.SELLER_CONVERSATION_NOTE_MAX_LENGTH)) === null);
check('A format refuses: rows that are not the v1 schema (a missing General notes row, a renamed label)',
  throws(() => N.formatSellerConversationNote(input({ rows: ROWS.slice(0, -1) }))) && throws(() => N.formatSellerConversationNote(input({ rows: ROWS.map((r) => (r.id === 'timing' ? { ...r, answers: [{ ...r.answers[0], label: 'When' }] } : r)) }))));
check('A format refuses: a non-canonical time or a bad id', throws(() => N.formatSellerConversationNote(input({ at: '2026-11-03' }))) && throws(() => N.formatSellerConversationNote(input({ callId: 'a b' }))));
const derived = C.QUESTIONS.map((q, i) => ({ id: q.id, heading: i === 0 ? q.title : `${i}. ${q.title}`, fields: q.fields.map((f) => ({ id: f.id, label: f.label })) }));
check('A: the frozen v1 schema equals what QUESTIONS projects today (a change here needs a v2 carrier)', same(derived, N.SELLER_CONVERSATION_V1_SCHEMA));
check('A: the frozen opening labels equal OPENINGS', same(Object.fromEntries(C.OPENINGS.map((o) => [o.id, o.label])), N.SELLER_CONVERSATION_OPENING_LABELS));
const later = N.formatSellerConversationNote(input({ at: '2026-11-03T16:00:00.000Z', rows: C.noteFor({ ...d, notes: 'corrected' }) }));
const otherCall = N.formatSellerConversationNote(input({ callId: 'call-0002' }));
const otherOpp = N.formatSellerConversationNote(input({ opportunityId: 'opp-other', callId: 'call-0003' }));
const latest = N.latestSellerConversationsForOpportunity([{ body: later }, { body }, { body: otherCall }, { body: otherOpp }, { body: 'IAOS SELLER CONVERSATION — junk' }], OPP);
check('A: supersede by call id: the latest (by embedded time) wins for each call; other calls kept; other deals ignored',
  latest.size === 2 && latest.get(CALL).general === 'corrected' && latest.get('call-0002').at === AT && !latest.has('call-0003'));
check('A: the carrier family is recognised by its prefix (well-formed or not)', N.isSellerConversationNoteText(body) && N.isSellerConversationNoteText('IAOS SELLER CONVERSATION — junk') && !N.isSellerConversationNoteText('Call note'));
check('A: the note is not any existing carrier (Transaction assumptions, price, Seller Position parsers refuse it)', R.parseTransactionAssumptionsNote(body) === null && R.parseSellerPricePositionNote(body) === null && SP.parseSellerPositionNote(body) === null);

/* ===================== B. the save plan ===================== */
const TA_REC = { transactionStructure: { kind: 'value', value: 'Assignment of contract' }, closingPossession: { kind: 'value', value: 'Close in 30 days' }, titleComplications: { kind: 'none' } };
const REC = { transaction: TA_REC, sellerPrice: { kind: 'price', price: 425000 }, sellerPosition: null, occupancy: null };
const plan = (draft, over = {}) => S.buildSavePlan({ opportunityId: OPP, callId: CALL, draft, record: REC, sections: null, results: {}, previewAt: AT, ...over });
const byId = (p, id) => p.items.find((i) => i.id === id);
const p0 = plan(C.EMPTY_CONVERSATION);
check('B: an empty call: nothing to write, nothing unsaved', p0.writes.length === 0 && !p0.unsaved && byId(p0, 'note').action === 'none');
let t = C.withField(C.EMPTY_CONVERSATION, 'timing', 'timing', 'Wants to close by March');
const pT = plan(t);
check('B: any content: one conversation note is planned first', pT.writes[0].id === 'note' && pT.writes.filter((w) => w.id === 'note').length === 1);
const taBody = byId(pT, 'timing').write.body(AT);
const taParsed = R.parseTransactionAssumptionsNote(taBody);
check('B: timing writes Transaction assumptions v2 (closing/possession from the answer)', !!taParsed && taParsed.version === 2 && same(taParsed.closingPossession, { kind: 'value', value: 'Wants to close by March' }));
check('B: timing carries the latest record\'s other two items unchanged', same(taParsed.transactionStructure, TA_REC.transactionStructure) && same(taParsed.titleComplications, TA_REC.titleComplications));
check('B: timing with no record: the other two items are "not yet answered" (never None)', (() => { const x = R.parseTransactionAssumptionsNote(byId(plan(t, { record: { ...REC, transaction: null } }), 'timing').write.body(AT)); return x.transactionStructure.kind === 'unanswered' && x.titleComplications.kind === 'unanswered'; })());
check('B: timing equal to the record: no write ("matches")', byId(plan(C.withField(C.EMPTY_CONVERSATION, 'timing', 'timing', ' Close in 30 days ')), 'timing').action === 'none');
check('B: timing that reads as a reserved marker is not saved, with a reason', byId(plan(C.withField(C.EMPTY_CONVERSATION, 'timing', 'timing', '(not yet answered)')), 'timing').action === 'not_saved');
const pPrice = plan(C.withField(C.EMPTY_CONVERSATION, 'price', 'amount', '$410,000'));
const priceParsed = R.parseSellerPricePositionNote(byId(pPrice, 'price').write.body(AT));
check('B: a valid stated price writes a Seller price position note with that number', priceParsed && priceParsed.kind === 'price' && priceParsed.price === 410000 && priceParsed.opportunityId === OPP);
for (const bad of ['about 400k', '0', '-5', 'NaN']) {
  const it = byId(plan(C.withField(C.EMPTY_CONVERSATION, 'price', 'amount', bad)), 'price');
  check(`B: an invalid price ("${bad}") is "not saved: not a valid price" and never written`, it.action === 'not_saved' && it.text === 'Not saved: not a valid price.' && it.write === null);
}
check('B: a stated price equal to the record writes nothing', byId(plan(C.withField(C.EMPTY_CONVERSATION, 'price', 'amount', '425000')), 'price').action === 'none');
for (const v of C.OCCUPANCY_CHOICES) {
  const it = byId(plan(C.withField(C.EMPTY_CONVERSATION, 'occupancy', 'occupancy', v)), 'occupancy');
  check(`B: occupancy "${v}" plans contact.occupancy with exactly that value`, it.action === 'write' && it.write.kind === 'occupancy' && it.write.value === v);
}
check('B: occupancy outside the three values is never written', byId(plan(C.withField(C.EMPTY_CONVERSATION, 'occupancy', 'occupancy', 'Other')), 'occupancy').action === 'not_saved');
check('B: occupancy equal to the record writes nothing', byId(plan(C.withField(C.EMPTY_CONVERSATION, 'occupancy', 'occupancy', 'Vacant'), { record: { ...REC, occupancy: 'Vacant' } }), 'occupancy').action === 'none');
let ar = C.withField(C.EMPTY_CONVERSATION, 'address', 'street', '1 Main St');
ar = C.withField(ar, 'reason', 'reason', 'Relocating');
const pAR = plan(ar);
check('B: a typed address is "not saved: not enabled" and never written', byId(pAR, 'address').action === 'not_saved' && /not enabled/.test(byId(pAR, 'address').text) && !pAR.writes.some((w) => w.id === 'address'));
check('B: a typed reason is "not saved: not enabled" and never written', byId(pAR, 'reason').action === 'not_saved' && /not enabled/.test(byId(pAR, 'reason').text) && !pAR.writes.some((w) => w.id === 'reason'));
check('B: address and reason still go into the conversation note', byId(pAR, 'note').preview.includes('Street: "1 Main St"') && byId(pAR, 'note').preview.includes('Reason for selling: "Relocating"'));
check('B: writes are ordered note, timing, price, occupancy', same(plan(d).writes.map((w) => w.id), ['note', 'price', 'occupancy']) && same(plan(C.withField(d, 'timing', 'timing', 'March')).writes.map((w) => w.id), ['note', 'timing', 'price', 'occupancy']));
check('B: with Save disabled (sections null) Seller Position is not part of the plan', !plan(d).items.some((i) => i.id === 'sellerPosition'));
check('B: unsaved is true whenever something would be written or cannot be saved', plan(d).unsaved && pAR.unsaved);
check('B: the note preview is the exact note text for this call', byId(plan(d), 'note').preview === N.formatSellerConversationNote({ opportunityId: OPP, callId: CALL, at: AT, operator: null, opening: d.opening, rows: C.noteFor(d) }));
check('B: an over-long note is "not saved" with its length, and not written', (() => { const it = byId(plan({ ...d, notes: 'y'.repeat(20000) }), 'note'); return it.action === 'not_saved' && /limit is 16000/.test(it.text) && it.write === null; })());
// Sections integrated (Save enabled).
const SEC = { ta: { fields: TA_REC, problem: null }, price: { kind: 'blank' }, sellerPosition: { kind: 'empty' } };
const ps = (draft, sec, over = {}) => plan(draft, { sections: { ...SEC, ...sec }, ...over });
const secTa = byId(ps(C.EMPTY_CONVERSATION, { ta: { fields: { ...TA_REC, titleComplications: { kind: 'value', value: 'Lien' } }, problem: null } }), 'timing');
check('B sections: a Transaction assumptions section edit joins the plan', secTa.action === 'write' && R.parseTransactionAssumptionsNote(secTa.write.body(AT)).titleComplications.value === 'Lien');
const both = byId(ps(t, { ta: { fields: { ...TA_REC, titleComplications: { kind: 'value', value: 'Lien' } }, problem: null } }), 'timing');
check('B sections: the Timing answer and a section title edit become ONE record', both.action === 'write' && (() => { const x = R.parseTransactionAssumptionsNote(both.write.body(AT)); return x.closingPossession.value === 'Wants to close by March' && x.titleComplications.value === 'Lien'; })());
const clash = byId(ps(t, { ta: { fields: { ...TA_REC, closingPossession: { kind: 'value', value: 'Close in 90 days' } }, problem: null } }), 'timing');
check('B sections: two different closing entries are never resolved silently (not saved, says why)', clash.action === 'not_saved' && /differ/.test(clash.text));
check('B sections: a section price change joins the plan', byId(ps(C.EMPTY_CONVERSATION, { price: { kind: 'price', price: 400000 } }), 'price').action === 'write');
check('B sections: a documented refusal joins the plan as the refused record', R.parseSellerPricePositionNote(byId(ps(C.EMPTY_CONVERSATION, { price: { kind: 'refused' } }), 'price').write.body(AT)).kind === 'refused');
check('B sections: the stated price and a different section price conflict', byId(ps(C.withField(C.EMPTY_CONVERSATION, 'price', 'amount', '410000'), { price: { kind: 'price', price: 400000 } }), 'price').action === 'not_saved');
check('B sections: an invalid section price is not saved', byId(ps(C.EMPTY_CONVERSATION, { price: { kind: 'invalid', reason: 'x' } }), 'price').action === 'not_saved');
const spItem = byId(ps(C.EMPTY_CONVERSATION, { sellerPosition: { kind: 'value', value: 390000 } }), 'sellerPosition');
check('B sections: Seller Position joins the plan as its own ledger note', spItem.action === 'write' && SP.parseSellerPositionNote(spItem.write.body(AT)).value === 390000);
check('B sections: clearing a recorded Seller Position plans a "cleared" note; unchanged plans nothing',
  SP.parseSellerPositionNote(byId(ps(C.EMPTY_CONVERSATION, { sellerPosition: { kind: 'empty' } }, { record: { ...REC, sellerPosition: 5 } }), 'sellerPosition').write.body(AT)).kind === 'cleared'
  && !ps(C.EMPTY_CONVERSATION, {}).items.some((i) => i.id === 'sellerPosition'));
// Results.
const noteSig = byId(plan(d), 'note').signature;
const sent = { kind: 'note', contactId: 'c', body: 'x', at: AT };
check('B results: an uncertain item is blocked and not in the writes', (() => { const p = plan(d, { results: { note: { status: 'uncertain', signature: noteSig, sent, message: 'm' } } }); return byId(p, 'note').action === 'blocked' && !p.writes.some((w) => w.id === 'note') && p.unsaved; })());
check('B results: still blocked after the draft changes (an uncertain item needs Check again first)', byId(plan({ ...d, notes: 'changed' }, { results: { note: { status: 'uncertain', signature: noteSig, sent, message: 'm' } } }), 'note').action === 'blocked');
check('B results: an uncertain canonical item stays blocked even when it now reads as unchanged', byId(plan(C.EMPTY_CONVERSATION, { results: { occupancy: { status: 'uncertain', signature: 'Vacant', sent: { kind: 'occupancy', contactId: 'c', value: 'Vacant', at: AT }, message: 'm' } } }), 'occupancy').action === 'blocked');
check('B results: a confirmed identical item is done (not re-sent) and not unsaved', (() => { const p = plan(C.withField(C.EMPTY_CONVERSATION, 'occupancy', 'occupancy', 'Vacant'), { results: { occupancy: { status: 'confirmed', signature: 'Vacant', sent, message: '' } } }); return byId(p, 'occupancy').action === 'done' && p.writes.length === 1 && p.writes[0].id === 'note'; })());
check('B results: a confirmed note is written again only after the call content changes (supersede)', byId(plan(d, { results: { note: { status: 'confirmed', signature: noteSig, sent, message: '' } } }), 'note').action === 'done'
  && byId(plan({ ...d, notes: 'corrected' }, { results: { note: { status: 'confirmed', signature: noteSig, sent, message: '' } } }), 'note').action === 'write');
check('B results: a refused item (definitively not sent) may be sent again by an explicit Save', byId(plan(d, { results: { note: { status: 'refused', signature: noteSig, message: 'no' } } }), 'note').action === 'write');

/* ===================== C. classification ===================== */
const cls = (status, body) => S.classifyWriteResponse(status, typeof body === 'string' ? body : JSON.stringify(body)).kind;
check('C: 200 confirmed', cls(200, { confirmed: true }) === 'confirmed' && cls(200, { note: { id: 'n' } }) === 'confirmed');
check('C: 200 with confirmed:false is uncertain (sent, readback did not confirm)', cls(200, { confirmed: false }) === 'uncertain');
check('C: outcome not_sent is refused, with the server\'s reason', cls(403, { outcome: 'not_sent', error: 'Seller conversation note not enabled' }) === 'refused' && S.classifyWriteResponse(403, JSON.stringify({ outcome: 'not_sent', error: 'Seller conversation note not enabled' })).message === 'Seller conversation note not enabled');
check('C: definitive 4xx refusals are refused (400, 401, 403)', cls(400, { error: 'Invalid named write request' }) === 'refused' && cls(401, { error: 'sign in' }) === 'refused' && cls(403, { error: 'origin' }) === 'refused');
check('C: indeterminate, the generic 409, 5xx and 202 are uncertain', cls(409, { outcome: 'indeterminate', error: 'x' }) === 'uncertain' && cls(409, { error: 'Write refused or unconfirmed; refresh and inspect before retrying' }) === 'uncertain' && cls(502, { error: 'bad gateway' }) === 'uncertain' && cls(202, {}) === 'uncertain');
check('C: an unreadable response is uncertain', cls(200, '<html>') === 'uncertain' && cls(500, '') === 'uncertain');

/* ===================== D. coordinator ===================== */
function fakeClient(script) {
  const log = [];
  let clock = Date.parse(AT);
  const notes = [];
  return {
    log, notes,
    occupancy: null,
    async send(op, target, args) { log.push({ op, target, args }); const r = script.shift() ?? { kind: 'confirmed' }; if (r.kind === 'confirmed' || r.landed) { if (op === 'note.create') notes.push({ body: args.body }); else this.occupancy = args.value; } return r.landed ? { kind: 'uncertain', message: 'timeout' } : r; },
    async readNotes() { return notes.map((n) => ({ ...n })); },
    async readOccupancy() { return this.occupancy; },
    now() { clock += 1000; return new Date(clock).toISOString(); },
  };
}
(async () => {
  const draftAll = C.withField(d, 'timing', 'timing', 'March');
  const KEY = 'c1|opp-fixture-1';
  {
    const co = new S.SellerConversationSaveCoordinator();
    const cl = fakeClient([]);
    const confirmed = [];
    await co.save(KEY, 'c1', plan(draftAll), cl, { onConfirmed: (i) => confirmed.push(i.id) });
    check('D: writes are sent in plan order through the two named operations only', same(cl.log.map((x) => x.op), ['note.create', 'note.create', 'note.create', 'contact.occupancy']) && cl.log.every((x) => x.target === 'c1'));
    check('D: the first write is the conversation note; each body carries its own fresh canonical time', N.parseSellerConversationNote(cl.log[0].args.body) !== null && new Set(cl.log.slice(0, 3).map((x) => x.args.body.split('\n')[1])).size === 3);
    check('D: every item reports confirmed, and onConfirmed fired for each', ['note', 'timing', 'price', 'occupancy'].every((id) => co.results(KEY)[id].status === 'confirmed') && same(confirmed, ['note', 'timing', 'price', 'occupancy']));
    const again = plan(draftAll, { results: co.results(KEY) });
    await co.save(KEY, 'c1', again, cl);
    check('D: a second Save with nothing changed sends nothing (no duplicate)', cl.log.length === 4 && again.writes.length === 0);
    await co.save(KEY, 'c1', plan(draftAll), cl);
    check('D: even a stale plan cannot re-send a confirmed identical item (coordinator re-checks)', cl.log.length === 4);
  }
  {
    const co = new S.SellerConversationSaveCoordinator();
    const cl = fakeClient([{ kind: 'confirmed' }, { kind: 'refused', message: 'Malformed or undeclared' }, { kind: 'uncertain', message: 'No answer within 30 seconds' }, { kind: 'confirmed' }]);
    await co.save(KEY, 'c1', plan(draftAll), cl);
    const r = co.results(KEY);
    check('D: each item is reported individually: confirmed / refused (reason) / uncertain', r.note.status === 'confirmed' && r.timing.status === 'refused' && r.timing.message === 'Malformed or undeclared' && r.price.status === 'uncertain' && r.occupancy.status === 'confirmed');
    check('D: a failure does not stop later independent items', cl.log.length === 4);
    const next = plan(draftAll, { results: r });
    check('D: next plan: refused is offered again, uncertain is blocked, confirmed is done', byId(next, 'timing').action === 'write' && byId(next, 'price').action === 'blocked' && byId(next, 'note').action === 'done' && byId(next, 'occupancy').action === 'done');
    await co.save(KEY, 'c1', next, cl);
    check('D: Save never re-sends the uncertain item (only the refused one went again)', cl.log.length === 5 && cl.log[4].args.body.startsWith('IAOS TRANSACTION ASSUMPTIONS'));
    await co.save(KEY, 'c1', plan(draftAll), cl);
    check('D: not even from a stale plan', cl.log.filter((x) => x.args.body && x.args.body.startsWith('IAOS SELLER PRICE')).length === 1);
    await co.check(KEY, 'price', cl);
    check('D: Check again with nothing on record leaves it UNCERTAIN (an empty read proves nothing; reads only, sends nothing)', co.results(KEY).price.status === 'uncertain' && /does not show it was not saved/.test(co.results(KEY).price.message) && cl.log.length === 5);
    await co.save(KEY, 'c1', plan(draftAll, { results: co.results(KEY) }), cl);
    const priceSends = cl.log.filter((x) => x.args.body && x.args.body.startsWith('IAOS SELLER PRICE'));
    check('D: after an empty Check again, Save still does not send the price (blocked)', priceSends.length === 1 && byId(plan(draftAll, { results: co.results(KEY) }), 'price').action === 'blocked');
  }
  {
    const co = new S.SellerConversationSaveCoordinator();
    const cl = fakeClient([{ kind: 'uncertain', landed: true }]);
    await co.save(KEY, 'c1', plan(C.withField(C.EMPTY_CONVERSATION, 'opening', 'response', 'hi')), cl);
    check('D: an uncertain write that actually landed is uncertain until checked', co.results(KEY).note.status === 'uncertain');
    const confirmed = [];
    await co.check(KEY, 'note', cl, { onConfirmed: (i) => confirmed.push(i.id) });
    check('D: Check again finds the exact body -> confirmed, nothing re-sent, onConfirmed fired', co.results(KEY).note.status === 'confirmed' && cl.log.length === 1 && same(confirmed, ['note']));
    const cl2 = fakeClient([{ kind: 'confirmed' }, { kind: 'uncertain', landed: true }]);
    await co.save('c2|o2', 'c2', plan(C.withField(C.EMPTY_CONVERSATION, 'occupancy', 'occupancy', 'Vacant'), { opportunityId: 'o2' }), cl2);
    await co.check('c2|o2', 'occupancy', cl2);
    check('D: Check again for occupancy reads the contact value', co.results('c2|o2').occupancy.status === 'confirmed' && cl2.log.filter((x) => x.op === 'contact.occupancy').length === 1);
    check('D: results are per deal (deal 2 did not change deal 1)', co.results(KEY).occupancy === undefined && co.results('c2|o2').note.status === 'confirmed');
    const broken = { ...fakeClient([]), readNotes: async () => { throw new Error('offline'); } };
    const co3 = new S.SellerConversationSaveCoordinator();
    await co3.save(KEY, 'c1', plan(C.withField(C.EMPTY_CONVERSATION, 'opening', 'response', 'hi')), { ...broken, send: async () => ({ kind: 'uncertain', message: 'x' }) });
    await co3.check(KEY, 'note', broken);
    check('D: a failed check read leaves it uncertain (still blocked)', co3.results(KEY).note.status === 'uncertain');
  }
  {
    const co = new S.SellerConversationSaveCoordinator();
    let release; const gate = new Promise((r) => { release = r; });
    const cl = fakeClient([]);
    const slow = { ...cl, send: async (...a) => { await gate; return cl.send(...a); } };
    const first = co.save(KEY, 'c1', plan(C.withField(C.EMPTY_CONVERSATION, 'opening', 'response', 'hi')), slow);
    const second = await co.save('c9|o9', 'c9', plan(C.withField(C.EMPTY_CONVERSATION, 'opening', 'response', 'other')), slow);
    check('D: one save in flight: a second Save (any deal) is refused as busy and sends nothing', second === 'busy' && co.busy());
    release(); await first;
    check('D: when the first finishes, exactly one write was sent', cl.log.length === 1 && !co.busy());
  }
  /* ===== C1 (Bones, 2026-11-03): an empty read never settles an unresolved write ===== */
  const lateClient = (answers) => {
    const st = { notes: [], ids: [], sends: 0, lates: [], clock: Date.parse(AT) };
    st.client = {
      requestId: () => `req-${st.ids.length + 1}`,
      async send(op, target, args, requestId, onLate) {
        st.sends += 1; st.ids.push(requestId); st.lates.push({ onLate, args, requestId });
        const a = answers.shift() ?? { kind: 'confirmed' };
        if (a.kind === 'confirmed' && op === 'note.create') st.notes.push({ body: args.body });
        if (a.racing) { onLate(a.racing); return { kind: 'uncertain', message: 'No answer within 30 seconds; it may have been saved.' }; }
        return a;
      },
      readNotes: async () => (st.readGate ? st.readGate : Promise.resolve()).then(() => st.notes.map((n) => ({ ...n }))),
      async readOccupancy() { return null; },
      now() { st.clock += 1000; return new Date(st.clock).toISOString(); },
    };
    return st;
  };
  const UNC = { kind: 'uncertain', message: 'No answer within 30 seconds; it may have been saved.' };
  const hi = C.withField(C.EMPTY_CONVERSATION, 'opening', 'response', 'hi');
  {
    // Bones's probe sequence: uncertain send -> empty read -> explicit Save -> the ORIGINAL completes.
    const co = new S.SellerConversationSaveCoordinator();
    const st = lateClient([UNC]);
    const confirmed = [];
    const hooks = { onConfirmed: (i) => confirmed.push(i.id) };
    await co.save(KEY, 'c1', plan(hi), st.client, hooks);
    const r0 = co.results(KEY).note;
    check('C1: a timed-out write is uncertain and keeps its operation identity (request id + exact body)', r0.status === 'uncertain' && r0.requestId === 'req-1' && r0.sent.body === st.lates[0].args.body && st.sends === 1);
    await co.check(KEY, 'note', st.client);
    check('C1: an empty read leaves it uncertain with the SAME request id (never "not found, send again")', co.results(KEY).note.status === 'uncertain' && co.results(KEY).note.requestId === 'req-1' && st.sends === 1);
    await co.save(KEY, 'c1', plan(hi, { results: co.results(KEY) }), st.client, hooks);
    await co.save(KEY, 'c1', plan(hi), st.client, hooks);
    check('C1: an explicit Save after the empty read sends nothing (not even from a stale plan)', st.sends === 1);
    st.notes.push({ body: st.lates[0].args.body });
    st.lates[0].onLate({ kind: 'confirmed' });
    check('C1: Bones sequence fixed -- the original\'s own late answer confirms it: sends=1 records=1, onConfirmed once', co.results(KEY).note.status === 'confirmed' && st.sends === 1 && st.notes.length === 1 && same(confirmed, ['note']));
    st.lates[0].onLate({ kind: 'confirmed' });
    check('C1: a repeated late answer changes nothing', same(confirmed, ['note']) && co.results(KEY).note.status === 'confirmed');
  }
  {
    // A late definitive "nothing was sent" releases the item; only then does Save send it, as a NEW operation.
    const co = new S.SellerConversationSaveCoordinator();
    const st = lateClient([UNC, { kind: 'confirmed' }]);
    await co.save(KEY, 'c1', plan(hi), st.client);
    await co.check(KEY, 'note', st.client);
    st.lates[0].onLate({ kind: 'refused', message: 'Nothing was sent' });
    check('C1: a late "nothing was sent" from the original request marks it refused (definitive non-delivery)', co.results(KEY).note.status === 'refused' && /nothing was saved/.test(co.results(KEY).note.message));
    await co.save(KEY, 'c1', plan(hi, { results: co.results(KEY) }), st.client);
    check('C1: only then does Save send it again, under a NEW request id', st.sends === 2 && st.ids[1] === 'req-2' && co.results(KEY).note.status === 'confirmed');
    st.lates[0].onLate({ kind: 'confirmed' });
    check('C1: a late answer for an OLDER operation never touches the newer one', co.results(KEY).note.status === 'confirmed' && /confirmed\)\./.test(co.results(KEY).note.message) && st.sends === 2);
  }
  {
    // A late indeterminate answer keeps it uncertain; a late answer during Check again stands over the read.
    const co = new S.SellerConversationSaveCoordinator();
    const st = lateClient([UNC]);
    await co.save(KEY, 'c1', plan(hi), st.client);
    st.lates[0].onLate({ kind: 'uncertain', message: 'The save may have reached GHL; it is unresolved.' });
    check('C1: a late indeterminate answer keeps it uncertain (same request id) and says so', co.results(KEY).note.status === 'uncertain' && co.results(KEY).note.requestId === 'req-1' && /without settling it/.test(co.results(KEY).note.message));
    let open; st.readGate = new Promise((r) => { open = r; });
    const pending = co.check(KEY, 'note', st.client);
    st.notes.push({ body: st.lates[0].args.body });
    st.lates[0].onLate({ kind: 'confirmed' });
    st.notes.length = 0; open(); await pending;
    check('C1: a late confirmation that arrives while Check again reads stands (the read cannot undo it)', co.results(KEY).note.status === 'confirmed' && !co.busy());
  }
  {
    const co = new S.SellerConversationSaveCoordinator();
    const st = lateClient([{ racing: { kind: 'confirmed' } }]);
    await co.save(KEY, 'c1', plan(hi), st.client);
    check('C1: a late answer racing the timeout is applied, not lost', co.results(KEY).note.status === 'confirmed' && st.sends === 1);
  }
  {
    const co = new S.SellerConversationSaveCoordinator();
    const cl = { ...fakeClient([]) };
    delete cl.requestId;
    await co.save(KEY, 'c1', plan(hi), cl);
    const one = co.results(KEY).note;
    await co.save(KEY, 'c1', plan(C.withField(hi, 'opening', 'response', 'hi again')), cl);
    check('C1: each new operation gets its own request id (crypto fallback when the client gives none)', one.status === 'confirmed' && cl.log.length === 2);
  }
  {
    const fs2 = require('node:fs');
    const LG = require(path.join(APP, 'src/lib/leave-guard.ts'));
    check('C2: leavesPage -- another path leaves, the same path with another query leaves, a hash-only change stays',
      LG.leavesPage({ pathname: '/a', search: '' }, { pathname: '/b', search: '' }) && LG.leavesPage({ pathname: '/a', search: '' }, { pathname: '/a', search: '?deal=2' }) && !LG.leavesPage({ pathname: '/a', search: '?x=1' }, { pathname: '/a', search: '?x=1', hash: '#n' }));
    const click = (href) => ({ defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, target: { closest: () => ({ getAttribute: (n) => (n === 'href' ? href : null), hasAttribute: () => false }) } });
    const here = { origin: 'http://h', pathname: '/contacts/c1/seller-call', search: '' };
    check('C2 fallback: a link to the same path with another query leaves; a hash link stays', LG.leavingHref(click('/contacts/c1/seller-call?deal=2'), here) !== null && LG.leavingHref(click('#notes'), here) === null && LG.leavingHref(click('/contacts/c1'), here) !== null);
    const app = fs2.readFileSync(path.join(APP, 'src/App.tsx'), 'utf8');
    check('C2: the App uses a data router (createBrowserRouter + RouterProvider), so useBlocker guards every navigation', /createBrowserRouter\(/.test(app) && /<RouterProvider router=\{router\} \/>/.test(app) && !/<BrowserRouter>/.test(app));
  }
  {
    const r = await S.withTimeout(new Promise(() => {}), 20).then(() => 'resolved', (e) => e);
    check('D: the timeout helper rejects with SaveTimeout', r instanceof S.SaveTimeout);
    check('D: the timeout helper passes a fast result through', (await S.withTimeout(Promise.resolve(7), 50)) === 7);
  }

  /* ===================== E. server and config ===================== */
  const guard = require(path.join(APP, 'netlify/functions/lib/write-note-guard.ts'));
  const boundary = (notes, owner = 'c1') => ({ opportunity: async (id) => ({ id, contactId: owner, customFields: [] }), notes: async () => notes });
  const ok = async (fn) => { try { await fn(); return true; } catch { return false; } };
  check('E guard: a well-formed note on the contact\'s own opportunity is accepted', await ok(() => guard.validateLedgerNote(boundary([]), 'c1', body, 'brad@example.invalid')));
  check('E guard: an opportunity owned by another contact is refused', !(await ok(() => guard.validateLedgerNote(boundary([], 'someone-else'), 'c1', body, 'brad@example.invalid'))));
  check('E guard: a malformed conversation note is refused ("IAOS SELLER" is a reserved header)', !(await ok(() => guard.validateLedgerNote(boundary([]), 'c1', body.replace('Street: ""', 'Street: x'), 'brad@example.invalid'))));
  const foreign = N.formatSellerConversationNote(input({ opportunityId: 'opp-elsewhere' }));
  check('E guard: a call id already used on another opportunity is refused', !(await ok(() => guard.validateLedgerNote(boundary([{ body: foreign }]), 'c1', body, 'brad@example.invalid'))));
  check('E guard: a corrected re-save on the same deal (same call id) is accepted', await ok(() => guard.validateLedgerNote(boundary([{ body }]), 'c1', later, 'brad@example.invalid')));
  check('E guard: an operator other than Brad is refused', !(await ok(() => guard.validateLedgerNote(boundary([]), 'c1', N.formatSellerConversationNote(input({ operator: 'mallory' })), 'brad@example.invalid'))));
  const scope = require(path.join(APP, 'netlify/functions/lib/production-write-scope.ts'));
  const PROD = CFG.getConfig('production');
  const prodAllOn = { ...PROD, sellerConversationSave: CFG.SELLER_CONVERSATION_SAVE_ENABLED, productionSellerCallAutosave: CFG.PRODUCTION_SELLER_CALL_AUTOSAVE_ENABLED, productionSellerCallNegotiation: CFG.PRODUCTION_SELLER_CALL_NEGOTIATION_ENABLED, productionCallLog: CFG.PRODUCTION_CALL_LOG_ENABLED };
  const pinned = PROD.productionProofScope;
  const prodBody = N.formatSellerConversationNote(input({ opportunityId: pinned.opportunityId }));
  const r1 = scope.evaluateProductionGhlWriteScope(prodAllOn, { operation: 'note.create', targetId: pinned.contactId, args: { body: prodBody } });
  const r2 = scope.evaluateProductionGhlWriteScope(prodAllOn, { operation: 'note.create', targetId: 'any-contact', args: { body } });
  check('E scope: Production refuses the conversation note unconditionally (every class on, even the pinned pair)', r1.ok === false && r2.ok === false, { r1, r2 });
  check('E scope: the carrier is classified in PRODUCTION_NOTE_SCOPE as refused', scope.PRODUCTION_NOTE_SCOPE.some((e) => e.parse.name === 'parseSellerConversationNote' && e.allow === null));
  check('E scope: Test is unchanged (scope ok; the flag gate in ghl-write decides)', scope.evaluateProductionGhlWriteScope(CFG.getConfig('test'), { operation: 'note.create', targetId: 'c1', args: { body } }).ok === true);
  check('E config: sellerConversationSave is DISABLED in BOTH Test and Production', CFG.getConfig('test').sellerConversationSave === CFG.SELLER_CONVERSATION_SAVE_DISABLED && PROD.sellerConversationSave === CFG.SELLER_CONVERSATION_SAVE_DISABLED);
  check('E config: the server predicate is true only for the exact sentinel', CFG.sellerConversationSaveEnabled({ sellerConversationSave: CFG.SELLER_CONVERSATION_SAVE_ENABLED }) && !CFG.sellerConversationSaveEnabled({ sellerConversationSave: 'true' }) && !CFG.sellerConversationSaveEnabled({ sellerConversationSave: CFG.SELLER_CONVERSATION_SAVE_DISABLED }));
  const proj = (cfg, env) => CFG.projectRuntimeConfig(cfg, env).sellerConversationSave;
  check('E config: the committed configs project disabled everywhere', same(proj(CFG.getConfig('test'), 'test'), { enabled: false }) && same(proj(PROD, 'production'), { enabled: false }) && same(proj(CFG.getConfig('test')), { enabled: false }));
  check('E config: enabled projects true ONLY for Test (Production with the sentinel still projects false)',
    same(proj({ ...CFG.getConfig('test'), sellerConversationSave: CFG.SELLER_CONVERSATION_SAVE_ENABLED }, 'test'), { enabled: true }) && same(proj({ ...PROD, sellerConversationSave: CFG.SELLER_CONVERSATION_SAVE_ENABLED }, 'production'), { enabled: false }));
  const good = CFG.projectRuntimeConfig(CFG.getConfig('test'), 'test');
  check('E config: the browser refuses a malformed projection and accepts an absent one (absent = disabled)',
    throws(() => CFG.setRuntimeConfig({ ...good, sellerConversationSave: { enabled: 'yes' } })) && throws(() => CFG.setRuntimeConfig({ ...good, sellerConversationSave: { enabled: true, extra: 1 } }))
    && !throws(() => { const { sellerConversationSave, ...rest } = good; CFG.setRuntimeConfig(rest); }) && !throws(() => CFG.setRuntimeConfig(good)));
  check('E client: the capability is true only for exactly { enabled: true }', S.sellerConversationSaveAvailable({ sellerConversationSave: { enabled: true } }) && !S.sellerConversationSaveAvailable({ sellerConversationSave: { enabled: 'true' } }) && !S.sellerConversationSaveAvailable({}) && !S.sellerConversationSaveAvailable(good));
  const doc = fs.readFileSync(path.join(APP, '../docs/INV95_WRITE_BOUNDARIES.md'), 'utf8');
  const row = doc.split(/\r?\n/).find((l) => l.includes('IAOS SELLER CONVERSATION'));
  check('E docs: INV95 has the named row for the carrier, marked DISABLED / pending approval', !!row && /DISABLED/.test(row) && /pending/i.test(row) && /Production/.test(row), row);

  if (checks !== FLOOR) { console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}.`); process.exit(2); }
  console.log(`\nchecksRun=${checks} failures=${failures} floor=${FLOOR} ${failures === 0 ? 'OK' : 'FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('FAIL  ', e); process.exit(1); });
