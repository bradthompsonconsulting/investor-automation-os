/**
 * B15-03 / INV-103 -- Revision 6 guided seller conversation, slices 1-2: the
 * pure data module `src/lib/seller-conversation.ts`. Offline; no browser, no GHL.
 *
 * Checks:
 *  - structure: the opening + nine questions in the Rev 6 final order, unique
 *    stable ids, every question has fields and a source, three openings;
 *  - wording: the settled W1-W6 lines and the Rev 6 candidates are the
 *    prototype's text verbatim; the removed permission/interest wording and
 *    the "If interested" cue are absent; no banned copy;
 *  - the eight approved lines in seller-call-script.ts are untouched (pinned
 *    by hash of the LF-normalized file);
 *  - never blocking: moves to any index work with every answer blank;
 *    unanswered stays unanswered (no zero/false/None); marks and text are
 *    independent; Return to unanswered finds Unanswered and Skipped only;
 *  - the engine's pick maps to a seller question only for seller categories;
 *  - the on-record projection shows only what it is given, with a source,
 *    and never merges the seller's stated price into the asking price.
 *
 *   node scripts/test-seller-conversation.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
require('./harness/ts-loader.cjs');

const APP = path.resolve(__dirname, '..');
const C = require(path.join(APP, 'src/lib/seller-conversation.ts'));

const FLOOR = 69;
let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail === undefined ? '' : ` -- ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`); }
}

/* ---------- structure ---------- */
const ORDER = ['opening', 'address', 'ownership', 'occupancy', 'reason', 'timing', 'price', 'asis', 'condition', 'summary'];
const ids = C.QUESTIONS.map((q) => q.id);
check('structure: the opening plus nine questions, in the Rev 6 final order', JSON.stringify(ids) === JSON.stringify(ORDER), ids);
check('structure: question ids are unique', new Set(ids).size === ids.length);
check('structure: QUESTION_INDEX matches the order', ORDER.every((id, i) => C.QUESTION_INDEX[id] === i));
check('structure: every question has at least one answer field with a known control kind',
  C.QUESTIONS.every((q) => q.fields.length > 0 && q.fields.every((f) => ['text', 'textarea', 'date', 'money', 'choice'].includes(f.kind))));
check('structure: field ids are unique within each question', C.QUESTIONS.every((q) => new Set(q.fields.map((f) => f.id)).size === q.fields.length));
check('structure: every question carries a known source label', C.QUESTIONS.every((q) => typeof C.SOURCE_LABEL[q.source] === 'string'));
check('structure: three openings, Cold Outreach / Inbound Inquiry / Follow-up',
  JSON.stringify(C.OPENINGS.map((o) => [o.id, o.label])) === JSON.stringify([['cold', 'Cold Outreach'], ['inbound', 'Inbound Inquiry'], ['follow_up', 'Follow-up']]));
check('structure: occupancy choices are exactly the three values contact.occupancy permits (no "Other")',
  JSON.stringify(C.QUESTIONS.find((q) => q.id === 'occupancy').fields.find((f) => f.id === 'occupancy').options) === JSON.stringify(['Owner Occupied', 'Tenant Occupied', 'Vacant']));

/* ---------- wording (verbatim from IAOS-Seller-Conversation-Revision-6.html, sha256 ae25ea02...) ---------- */
const say = (id) => C.QUESTIONS.find((q) => q.id === id).say;
const src = (id) => C.QUESTIONS.find((q) => q.id === id).source;
const SETTLED = {
  address: 'Just to make sure I’m looking at the right property, can I confirm the address?',
  occupancy: 'Is anyone living in the property right now, or is it vacant?',
  condition: 'Tell me a little about the house. How would you describe its overall condition?',
  timing: 'If everything worked out the way you’d want, when would you like to have the property sold?',
};
for (const [id, text] of Object.entries(SETTLED)) {
  check(`wording: ${id} is the settled Rev 6 line verbatim and is tagged settled`, say(id) === text && src(id) === 'rev6-settled', say(id));
}
/* Captain, hosted Test 2026-11-03 (INV-103): exact wording. */
const CAPTAIN = {
  ownership: 'Is the property owned in your name, or is anyone else involved in making the decision to sell?',
  price: 'What price were you hoping to get for the property?',
  asis: "What if you could sell it exactly as it sits, with no repairs or cleanup, leave behind anything you don't want, and close on a timeline that works for you? Would that take some weight off your shoulders?",
};
for (const [id, text] of Object.entries(CAPTAIN)) {
  check(`wording: ${id} is the Captain's 2026-11-03 line verbatim and is tagged as his`, say(id) === text && src(id) === 'captain-2026-11-03', say(id));
}
check('wording: Price offers the Captain\'s alternate line', JSON.stringify(C.QUESTIONS.find((q) => q.id === 'price').alternates) === JSON.stringify(['What would you need to walk away with from the sale for this to make sense?']));
check('wording: As-is is followed by "Is that something you\'d consider?"', C.QUESTIONS.find((q) => q.id === 'asis').then === "Is that something you'd consider?");
check('wording: the Reason answer is labelled "Reason for selling"', C.QUESTIONS.find((q) => q.id === 'reason').fields.map((f) => f.label).join('|') === 'Reason for selling');
/* Captain 2026-11-03: one answer control per question (a specific field plus notes only where he listed it). */
const CONTROLS = {
  opening: ['textarea'], address: ['text', 'text', 'text', 'text', 'text'], ownership: ['textarea'], occupancy: ['choice', 'textarea'],
  reason: ['textarea'], timing: ['text'], price: ['money', 'textarea'], asis: ['textarea'], condition: ['textarea'], summary: ['textarea', 'date'],
};
check('controls: each question has exactly the Captain-approved controls', ORDER.every((id) => JSON.stringify(C.QUESTIONS.find((q) => q.id === id).fields.map((f) => f.kind)) === JSON.stringify(CONTROLS[id])),
  Object.fromEntries(ORDER.map((id) => [id, C.QUESTIONS.find((q) => q.id === id).fields.map((f) => f.kind)])));
check('controls: the address is street / unit / city / state / ZIP', C.QUESTIONS.find((q) => q.id === 'address').fields.map((f) => f.label).join('|') === 'Street|Unit|City|State|ZIP');
check('controls: no duplicated narrative box ("Representation / title questions", desired outcome, objections are gone)', !/Representation|Desired outcome|Objections|Flexibility|Repairs \/ updates/.test(JSON.stringify(C.QUESTIONS.map((q) => q.fields))));
const GHL = Object.fromEntries(C.QUESTIONS.map((q) => [q.id, q.fields.filter((f) => f.ghl).map((f) => `${f.id}=${f.ghl}`)]));
check('controls: GHL-backed fields name their GHL record (address, occupancy, reason, timing, price) and nothing else does',
  GHL.address.length === 5 && GHL.occupancy.join() === 'occupancy=Contact · Occupancy Status' && GHL.reason.join() === 'reason=Deal · Seller Reason (Test)'
  && GHL.timing.join() === 'timing=Transaction assumptions · Closing / possession' && GHL.price.join() === 'amount=Seller price position'
  && ['opening', 'ownership', 'asis', 'condition', 'summary'].every((id) => GHL[id].length === 0), GHL);
const CANDIDATE = {
  reason: 'Can you tell me the reason for wanting to move or sell?',
  summary: 'Let me make sure I’ve got everything right. Did I understand your situation correctly?',
};
for (const [id, text] of Object.entries(CANDIDATE)) {
  check(`wording: ${id} is the Rev 6 line verbatim and is tagged a Test candidate`, say(id) === text && src(id) === 'rev6-candidate', say(id));
}
check('wording: the Price follow-up transition is the R6:88 override', C.QUESTIONS.find((q) => q.id === 'price').then === 'And how did you arrive at that number?');
const OPEN = {
  cold: "Hey {firstName}, this is Brad Thompson. I'm a real estate investor calling about your property on {street}. Have you ever considered selling it?",
  inbound: "Hey {firstName}, this is Brad Thompson. I'm following up on your inquiry about selling your property on {street}. What are you hoping to accomplish with the sale?",
  follow_up: "Hey {firstName}, this is Brad Thompson. We spoke about your property on {street}, and I'm following up on our conversation. What's changed since we last talked?",
};
for (const o of C.OPENINGS) check(`wording: ${o.id} opening is the Rev 6 text (Alex/\${street} made placeholders) and tagged a candidate`, o.say === OPEN[o.id] && o.source === 'rev6-candidate', o.say);
const ALL_TEXT = [
  ...C.OPENINGS.map((o) => o.say), C.OPENING_THEN.say,
  ...C.QUESTIONS.flatMap((q) => [q.say, q.then || '', ...q.followUps, ...q.fields.map((f) => `${f.label} ${f.hint || ''}`)]),
].join('\n');
check('wording: no permission-to-talk wording ("good time", "okay time")', !/good time|okay time|good time to talk/i.test(ALL_TEXT));
check('wording: no "If interested" cue and no as-is consent control', !/if interested/i.test(ALL_TEXT) && !C.QUESTIONS.find((q) => q.id === 'asis').fields.some((f) => f.kind === 'choice'));
check('wording: no banned copy ("just checking in", "we buy", "cash", "24 hours")', !/just checking in|we buy|\bcash\b|24 hours/i.test(ALL_TEXT));
check('wording: the previously approved complications line is offered as an Ownership follow-up (W7 recommendation)',
  C.QUESTIONS.find((q) => q.id === 'ownership').followUps.includes('Is there anything with the property or ownership that you think could complicate a sale?'));
check('wording: fillLine fills a known name and street', C.fillLine(OPEN.cold, { firstName: 'Ready', street: '123 Fixture Ln' }).startsWith('Hey Ready,') && C.fillLine(OPEN.cold, { firstName: 'Ready', street: '123 Fixture Ln' }).includes('on 123 Fixture Ln.'));
check('wording: fillLine never guesses a missing name or street', C.fillLine(OPEN.cold, { firstName: '', street: null }).includes('Hey [first name],') && C.fillLine(OPEN.cold, { firstName: '', street: null }).includes('on [street].'));

/* ---------- the eight approved lines are untouched ---------- */
const scriptLf = fs.readFileSync(path.join(APP, 'src/lib/seller-call-script.ts'), 'utf8').replace(/\r\n/g, '\n');
const scriptHash = crypto.createHash('sha256').update(scriptLf, 'utf8').digest('hex');
check('history: seller-call-script.ts (the eight approved lines) is byte-unchanged from main 768c7b1',
  scriptHash === 'd2aecfc1b059c1f271cf353e518fb7ab8d54dcfa13a40caeb105fc00d01c4b1f', scriptHash);
const moduleSrc = fs.readFileSync(path.join(APP, 'src/lib/seller-conversation.ts'), 'utf8');
check('history: the conversation module does not import or edit the approved-script module', !/seller-call-script/.test(moduleSrc.split('*/').slice(1).join('*/')));
check('isolation: the module has no I/O, GHL or React import', !/from\s+["'](\.\.\/)*(lib\/)?ghl|from\s+["']react|fetch\(|localStorage/.test(moduleSrc.split('*/').slice(1).join('*/')));

/* ---------- never blocking ---------- */
const NONE = {};
let d = C.EMPTY_CONVERSATION;
let visited = [];
for (let i = 0; i < C.QUESTIONS.length + 3; i++) { visited.push(d.current); d = C.moveTo(d, d.current + 1); }
check('navigation: Next walks every question with every answer blank and stops at the last', JSON.stringify([...new Set(visited)]) === JSON.stringify(ORDER.map((_, i) => i)) && d.current === ORDER.length - 1);
check('navigation: a jump to any question works with nothing answered', ORDER.every((_, i) => C.moveTo(C.EMPTY_CONVERSATION, i).current === i));
check('navigation: out-of-range moves are clamped, never refused', C.moveTo(C.EMPTY_CONVERSATION, -5).current === 0 && C.moveTo(C.EMPTY_CONVERSATION, 99).current === ORDER.length - 1);
check('status: with nothing typed and nothing on record, every question is Unanswered', ORDER.every((id) => C.questionStatus(id, C.EMPTY_CONVERSATION, NONE) === 'unanswered'));
let e = C.withField(C.EMPTY_CONVERSATION, 'price', 'amount', '   ');
check('status: whitespace is not an answer (stays Unanswered, never zero)', C.questionStatus('price', e, NONE) === 'unanswered');
e = C.withField(e, 'price', 'amount', '250000');
check('status: typed text is Draft', C.questionStatus('price', e, NONE) === 'draft');
e = C.withMark(e, 'price', 'skipped');
check('status: typed text outranks a mark, and the mark does not discard the text', C.questionStatus('price', e, NONE) === 'draft' && e.answers.price.fields.amount === '250000' && e.answers.price.mark === 'skipped');
e = C.withField(e, 'price', 'amount', '');
check('status: clearing the text reveals the mark (Skipped)', C.questionStatus('price', e, NONE) === 'skipped');
e = C.withMark(e, 'price', 'seller_doesnt_know');
check('status: Seller doesn\'t know is its own state', C.questionStatus('price', e, NONE) === 'seller_doesnt_know');
e = C.withMark(e, 'price', null);
const rec = { price: [{ label: 'x', value: 'y', source: 'z' }] };
check('status: with no draft and no mark, a record shows On Record; without one, Unanswered', C.questionStatus('price', e, rec) === 'on_record' && C.questionStatus('price', e, NONE) === 'unanswered');
check('status: a draft on a recorded question shows Draft (this call first)', C.questionStatus('price', C.withField(e, 'price', 'basis', 'agent opinion'), rec) === 'draft');
const st = ['draft', 'on_record', 'seller_doesnt_know', 'skipped', 'unanswered', 'on_record', 'draft', 'unanswered', 'on_record', 'on_record'];
check('return-to-unanswered: finds the next Skipped or Unanswered after the current one', C.nextOpenQuestion(0, st) === 3 && C.nextOpenQuestion(3, st) === 4 && C.nextOpenQuestion(4, st) === 7);
check('return-to-unanswered: wraps around, and skips Seller doesn\'t know / Draft / On Record', C.nextOpenQuestion(8, st) === 3);
check('return-to-unanswered: null when nothing is left open', C.nextOpenQuestion(0, ['draft', 'on_record', 'seller_doesnt_know']) === null);
check('drafts: EMPTY_CONVERSATION is frozen (no shared mutation between deals)', Object.isFrozen(C.EMPTY_CONVERSATION));

/* ---------- guidance mapping ---------- */
const q = (category) => ({ kind: 'question', source: { kind: 'category', category, level: 'UNKNOWN' } });
check('guidance: seller categories map to their questions',
  C.recommendedQuestion(q('property_identity')) === 'address' && C.recommendedQuestion(q('repairs_condition')) === 'condition'
  && C.recommendedQuestion(q('transaction_assumptions')) === 'timing' && C.recommendedQuestion(q('seller_price_position')) === 'price');
check('guidance: ARV and deal economics are never a seller question', C.recommendedQuestion(q('arv')) === null && C.recommendedQuestion(q('deal_economics')) === null);
check('guidance: offer_ready / operator_only / material unknown / none mark nothing',
  [{ kind: 'offer_ready', message: '' }, { kind: 'operator_only', message: '' }, { kind: 'question', source: { kind: 'material_unknown', unknownCode: 'x' } }, null].every((n) => C.recommendedQuestion(n) === null));

/* ---------- on-record projection ---------- */
const empty = { address: null, identityConfirmedAt: null, occupancy: { kind: 'empty' }, transaction: null, sellerPrice: null, askingPrice: null, repairs: null, outcome: null };
check('on record: nothing given, nothing shown', Object.keys(C.onRecordFor(empty)).length === 0);
const full = C.onRecordFor({
  address: '123 Fixture Ln, Austin, TX, 78701', identityConfirmedAt: '2026-09-30T15:01:00.000Z', occupancy: { kind: 'value', value: 'Vacant' },
  transaction: { at: '2026-09-30T15:02:00.000Z', transactionStructure: { kind: 'value', value: 'Assignment of contract' }, closingPossession: { kind: 'value', value: 'Close in 30 days' }, titleComplications: { kind: 'none' } },
  sellerPrice: { at: '2026-09-30T15:03:00.000Z', kind: 'price', price: 425000 }, askingPrice: 450000,
  repairs: { amount: 40000, provenance: 'On file, not verified as operator-approved' },
  outcome: { kind: 'follow_up', at: '2026-10-01T15:00:00.000Z', followUpAt: '2026-10-08T15:00:00.000Z' },
});
check('on record: every item names its source', Object.values(full).flat().every((i) => typeof i.source === 'string' && i.source.length > 3));
check('on record: the seller\'s stated price and the asking price are two separate items with their own sources',
  full.price.length === 2 && full.price[0].label === 'Seller price position' && full.price[0].value === '$425,000' && full.price[1].label === 'Asking price' && full.price[1].value === '$450,000' && full.price[0].source !== full.price[1].source);
check('on record: a recorded None is shown as None (recorded), not dropped and not blank', full.ownership.some((i) => i.label === 'Title complications' && i.value === 'None (recorded)'));
const partial = C.onRecordFor({ ...empty, transaction: { at: '2026-09-30T15:02:00.000Z', transactionStructure: { kind: 'unanswered' }, closingPossession: { kind: 'unanswered' }, titleComplications: { kind: 'unanswered' } } });
check('on record: a v2 "not yet answered" item is not shown as an answer', Object.keys(partial).length === 0, partial);
const unrec = C.onRecordFor({ ...empty, occupancy: { kind: 'unrecognised', raw: 'Squatters' } });
check('on record: an unrecognised occupancy value is shown as unrecognised, never mapped', unrec.occupancy[0].value === 'Unrecognised value "Squatters"');

/* ---------- The structured call note (Captain C8 / plan A7; replaces the superseded P2-2 recap) ---------- */
let r = C.withField(C.EMPTY_CONVERSATION, 'price', 'amount', '410000');
r = C.withField(r, 'opening', 'response', 'Open to talking');
r = C.withField(r, 'summary', 'next', 'Send numbers Friday');
r = C.withField(r, 'summary', 'followup', '2026-11-10');
r = C.withMark(r, 'asis', 'seller_doesnt_know');
r = { ...r, notes: 'Dog on site' };
const note = C.noteFor(r);
const row = (id) => note.find((x) => x.id === id);
check('note: every question in order -- Opening through Summary -- then General notes',
  JSON.stringify(note.map((x) => x.id)) === JSON.stringify([...ORDER, 'general']), note.map((x) => x.id));
check('note: each question row lists every one of its fields, in order', note.filter((x) => x.kind === 'question').every((x) => JSON.stringify(x.answers.map((a) => a.fieldId)) === JSON.stringify(C.QUESTIONS.find((q) => q.id === x.id).fields.map((f) => f.id))));
check('note: Opening, Summary + follow-up date and General notes carry their drafts',
  row('opening').answers[0].value === 'Open to talking' && row('summary').answers.map((a) => a.value).join('|') === 'Send numbers Friday|2026-11-10' && row('general').value === 'Dog on site');
check('note: a blank answer is the empty string (shown blank), never a word like "Unanswered"',
  row('reason').answers[0].value === '' && !JSON.stringify(note).includes('Unanswered'));
check('note: "Seller doesn\'t know" is a flag on that question only', row('asis').dontKnow === true && note.filter((x) => x.kind === 'question' && x.dontKnow).length === 1);
check('note: values are exactly the draft text (no formatting, no recorded GHL value mixed in)', row('price').answers[0].value === '410000' && !note.some((x) => x.kind === 'question' && x.answers.some((a) => a.value.includes('$'))));
check('note: headings number the questions as the navigator does', row('opening').heading === 'Opening' && row('price').heading === '6. Price expectations' && row('general').heading === 'General notes');
check('note: the projection is the draft only (EMPTY gives all blanks and no marks)', C.noteFor(C.EMPTY_CONVERSATION).every((x) => x.kind === 'general' ? x.value === '' : (!x.dontKnow && x.answers.every((a) => a.value === ''))));

if (checks !== FLOOR) { console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}.`); process.exit(2); }
console.log(`\nchecksRun=${checks} failures=${failures} floor=${FLOOR} ${failures === 0 ? 'OK' : 'FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
