/**
 * B15-25 (INV-133) Phase 1 -- unit checks of src/lib/calculator-drafts.ts (Deal Calculator local autosave).
 * Ported from the Bones-accepted prototype's model checks (487c35fa), adapted to the application module:
 * scratch vs deal identities, the contact-seed evidence reader, the itemized-repair text. Offline, synthetic.
 *
 * NEGATIVE CONTROL: `--mutate=<name>` runs the same checks against a mutant of the module
 * (scripts/harness/calculator-drafts/mutations.cjs, model mutants); each must FAIL (exit 1).
 */
require('./harness/ts-loader.cjs');
const { writeMutant, removeMutants, MODEL_MUTATIONS } = require('./harness/calculator-drafts/mutations.cjs');

const mutateArg = process.argv.find((a) => a.startsWith('--mutate='));
const MUTATE = mutateArg ? mutateArg.slice('--mutate='.length) : null;
removeMutants();
let MODULE = '../src/lib/calculator-drafts.ts';
if (MUTATE) {
  if (!MODEL_MUTATIONS[MUTATE]) { console.error(`FAILED: --mutate=${MUTATE} is not a model mutant; nothing run.`); process.exit(2); }
  try { MODULE = writeMutant(MUTATE).file; } catch (e) { console.error(`FAILED: ${e.message}; nothing run.`); process.exit(2); }
  console.log(`NEGATIVE CONTROL: checking the module with --mutate=${MUTATE}; this run must fail.`);
}
const done = (code) => { removeMutants(); process.exit(code); };

/** Taken from the finished file: 30 check() call sites. */
const FLOOR = 30;
let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}
const throws = (f) => { try { f(); return false; } catch { return true; } };

try {
  const M = require(MODULE);
  const ENV = 'SoTgVoaFGHtBdRFvXWQV';
  const D = { kind: 'deal', env: ENV, operator: 'op-a', contactId: 'c-kay', propertyId: 'o-kay-1', opportunityId: 'o-kay-1' };
  const S = { kind: 'scratch', env: ENV, operator: 'op-a' };
  const v = (value) => ({ kind: 'value', value });
  const ghl = (values) => ({ kind: 'ok', values: Object.fromEntries(Object.entries(values).map(([k, x]) => [k, typeof x === 'string' ? v(x) : x])) });
  const T = '2026-10-30T12:00:00.000Z';

  // ── identity / isolation ──
  const keyD = M.draftKey(D);
  const dealParts = ['env', 'operator', 'contactId', 'propertyId', 'opportunityId'];
  const others = dealParts.map((k) => M.draftKey({ ...D, [k]: `${D[k]}-other` }));
  check('every deal identity part changes the key (environment, operator, contact, property, opportunity)', others.every((k) => k !== keyD) && new Set(others).size === others.length, { keyD, others });
  check('scratch drafts are isolated by environment and operator', M.draftKey(S) !== M.draftKey({ ...S, env: 'jmHG4B8RdzwpfqruNf68' }) && M.draftKey(S) !== M.draftKey({ ...S, operator: 'op-b' }));
  check('an unlinked scratch draft and a deal draft never share a key, even for the same environment and operator', M.draftKey(S) !== M.draftKey(D) && M.draftKey(S) !== M.draftKey({ ...D, contactId: 'x', propertyId: 'x', opportunityId: 'x' }));
  check('a draft needs every identity part for its kind; a missing one never falls back to a broader key',
    dealParts.every((k) => throws(() => M.draftKey({ ...D, [k]: '' })) && throws(() => M.draftKey({ ...D, [k]: undefined })))
    && ['env', 'operator'].every((k) => throws(() => M.draftKey({ ...S, [k]: '' }))) && throws(() => M.draftKey({ env: ENV, operator: 'op-a' })));
  check('identity parts cannot run together into another record\'s key', M.draftKey({ ...D, contactId: 'a|b', propertyId: 'c' }) !== M.draftKey({ ...D, contactId: 'a', propertyId: 'b|c' }));
  const d1 = M.recordEdit(null, D, 'arv', '305000', ghl({ arv: '310000' }), T);
  check('an edit cannot be recorded into another record\'s draft', throws(() => M.recordEdit(d1, { ...D, opportunityId: 'o-kay-2', propertyId: 'o-kay-2' }, 'arv', '1', ghl({}), T)) && throws(() => M.recordEdit(d1, S, 'arv', '1', M.NO_GHL, T)));
  check('a stored draft is refused for another record, another kind or another operator',
    !M.parseStored(JSON.stringify(d1), { ...D, opportunityId: 'o-kay-2', propertyId: 'o-kay-2' }).ok && !M.parseStored(JSON.stringify(d1), S).ok && !M.parseStored(JSON.stringify(d1), { ...D, operator: 'op-b' }).ok);

  // ── base capture and states ──
  check('the first edit records the GHL value shown as its base', d1.fields.arv.base.kind === 'value' && d1.fields.arv.base.value === '310000', d1.fields.arv);
  const d2 = M.recordEdit(d1, D, 'arv', '306000', ghl({ arv: '999' }), T);
  check('later edits keep the original base', d2.fields.arv.base.value === '310000' && d2.fields.arv.value === '306000', d2.fields.arv);
  check('unchanged GHL: the field is a draft', M.assess(d2, ghl({ arv: '310000' })).arv.state === 'draft');
  const c = M.assess(d2, ghl({ arv: '320000' })).arv;
  check('changed GHL: conflict, with both versions and neither replaced', c.state === 'conflict' && c.draft === '306000' && c.ghl.value === '320000', c);
  check('GHL newly recording a value, or clearing one, under a draft is a conflict',
    M.assess(M.recordEdit(null, D, 'repairsQuick', '20000', ghl({}), T), ghl({ repairsQuick: '21000' })).repairsQuick.state === 'conflict' && M.assess(d2, ghl({})).arv.state === 'conflict');
  check('GHL unreadable now, or when the field was first kept: unchecked, never a conflict or a match',
    M.assess(d2, { kind: 'unavailable' }).arv.state === 'unchecked' && M.assess(M.recordEdit(null, D, 'arv', '1', { kind: 'unavailable' }, T), ghl({ arv: '1' })).arv.state === 'unchecked');
  check('scratch work has no GHL value: its drafts are plain drafts', M.assess(M.recordEdit(null, S, 'arv', '300000', M.NO_GHL, T), M.NO_GHL).arv.state === 'draft');
  check('figures and modes are draft fields', ['arv', 'repairsQuick', 'testPrice', 'assignmentMode', 'manualAmount', 'repairsMode', 'repairItems'].every((f) => M.FIELDS.includes(f)) && M.FIELDS.length === 7);

  // ── contact seed evidence (absent vs unparsable) ──
  const F = 'QkWl09I9yXGz8OIcs5Xd';
  const seeds = {
    absent: M.seedEvidence([{ id: 'other', value: '1' }], F), empty: M.seedEvidence([{ id: F, value: '' }], F), nul: M.seedEvidence([{ id: F, value: null }], F),
    num: M.seedEvidence([{ id: F, value: 310000 }], F), text: M.seedEvidence([{ id: F, value: '310000' }], F),
    bad: M.seedEvidence([{ id: F, value: 'abc' }], F), notArray: M.seedEvidence(null, F),
  };
  check('a contact seed that is absent or empty is none; a number is its value; an unparsable value or an unreadable field list is unavailable',
    ['absent', 'empty', 'nul'].every((k) => seeds[k].kind === 'none') && seeds.num.kind === 'value' && seeds.num.value === '310000' && seeds.text.value === '310000'
    && seeds.bad.kind === 'unavailable' && seeds.notArray.kind === 'unavailable', seeds);
  check('a draft over an unparsable seed stays unchecked, and its choices are refused', (() => {
    const g = { kind: 'ok', values: { arv: M.seedEvidence([{ id: F, value: 'abc' }], F) } };
    return M.assess(d2, g).arv.state === 'unchecked' && !M.canResolve(g, 'arv') && M.useGhl(d2, 'arv', g) === d2 && M.keepMine(d2, 'arv', g, T) === d2;
  })());

  // ── resolution ──
  const kept = M.keepMine(d2, 'arv', ghl({ arv: '320000' }), T);
  check('Keep My Draft keeps the draft value, unsaved, re-based on GHL now', kept.fields.arv.value === '306000' && kept.fields.arv.base.value === '320000' && M.assess(kept, ghl({ arv: '320000' })).arv.state === 'draft', kept.fields.arv);
  const both = M.recordEdit(d2, D, 'testPrice', '250000', ghl({}), T);
  const used = M.useGhl(both, 'arv', ghl({ arv: '320000' }));
  check('Use GHL discards only that field\'s draft; on the last field it leaves no draft', used && !used.fields.arv && used.fields.testPrice.value === '250000' && M.useGhl(d2, 'arv', ghl({ arv: '320000' })) === null, used);
  check('Keep My Draft and Use GHL are refused while GHL is unreadable', M.useGhl(d2, 'arv', { kind: 'unavailable' }) === d2 && M.useGhl(d2, 'arv', null) === d2 && M.keepMine(d2, 'arv', null, T) === d2);
  const back = M.withoutField(both, 'arv');
  check('a field back at its seed or default leaves the draft (only that field); the last one leaves no draft',
    back && !back.fields.arv && back.fields.testPrice.value === '250000' && M.withoutField(d2, 'arv') === null && M.withoutField(null, 'arv') === null, back);

  // ── itemized repairs ──
  const items = M.serializeRepairItems({ roof: { condition: 'good', amount: '', quantity: '', dirty: false } }, { description: 'Gutters', amount: '1,800' });
  const parsed = M.parseRepairItems(items);
  check('itemized answers and Miscellaneous round-trip exactly', parsed && parsed.answers.roof.condition === 'good' && parsed.misc.description === 'Gutters' && parsed.misc.amount === '1,800', parsed);
  check('malformed itemized text is refused, never partly applied',
    [ '{', '[]', '{"answers":{},"misc":null}', '{"answers":[],"misc":{"description":"","amount":""}}', '{"answers":{"roof":{"condition":"bad","amount":"","quantity":"","dirty":false}},"misc":{"description":"","amount":""}}',
      '{"answers":{"roof":{"condition":"good","amount":1,"quantity":"","dirty":false}},"misc":{"description":"","amount":""}}' ].every((t) => M.parseRepairItems(t) === null)
    && !M.parseStored(JSON.stringify(M.recordEdit(null, D, 'repairItems', '{"answers":[]}', ghl({}), T)), D).ok);

  // ── recovery and storage ──
  check('a stored draft round-trips exactly', JSON.stringify(M.parseStored(JSON.stringify(both), D).draft) === JSON.stringify(both));
  check('malformed, wrong-version or unknown-field records are refused',
    !M.parseStored('{not json', D).ok && !M.parseStored(JSON.stringify({ ...both, version: 99 }), D).ok
    && !M.parseStored(JSON.stringify({ ...both, fields: { ...both.fields, approved: { value: 'yes', base: { kind: 'none' } } } }), D).ok);
  const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, x) => m.set(k, String(x)), removeItem: (k) => m.delete(k) }; };
  const s = M.openStore(() => mem());
  s.save(both);
  check('the store keeps one record per identity', s.available && s.load(D).draft?.fields.testPrice.value === '250000' && s.load({ ...D, operator: 'op-b' }).draft === null && s.load(S).draft === null);
  const flaky = (opts) => { const m = new Map(); let n = 0; return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, x) => { n += 1; if (opts.failAfter && n > opts.failAfter) throw new Error('QuotaExceededError'); if (!opts.drop || n <= 1) m.set(k, String(x)); },
    removeItem: (k) => { if (opts.failRemove) throw new Error('blocked'); if (!opts.keep) m.delete(k); } }; };
  const late = M.openStore(() => flaky({ failAfter: 1 }));
  const dropping = M.openStore(() => flaky({ drop: true }));
  check('a save that throws after a good start, or silently stores nothing, returns false', late.available && late.save(both) === false && dropping.available && dropping.save(both) === false);
  const rmFail = flaky({}); const rmStore = M.openStore(() => rmFail); rmStore.save(both); rmFail.removeItem = () => { throw new Error('blocked'); };
  const rmKeep = flaky({}); const keepStore = M.openStore(() => rmKeep); keepStore.save(both); rmKeep.removeItem = () => {};
  const ok = M.openStore(() => mem()); ok.save(both);
  check('a removal that fails or leaves the draft behind returns false; a real one returns true and nothing comes back',
    rmStore.remove(D) === false && keepStore.remove(D) === false && keepStore.load(D).draft !== null && ok.remove(D) === true && ok.load(D).draft === null);
  const broken = M.openStore(() => ({ getItem() { throw new Error('x'); }, setItem() { throw new Error('quota'); }, removeItem() {} }));
  check('storage that throws at start reports itself unavailable and claims nothing is kept', broken.available === false && broken.save(both) === false && broken.load(D).draft === null);

  // ── never an approval ──
  const states = new Set(Object.values(M.assess(both, ghl({ arv: '1' }))).map((x) => x.state));
  check('no state, field or record marks a draft confirmed or approved', [...states].every((x) => ['draft', 'conflict', 'unchecked', 'ghl', 'empty', 'unavailable'].includes(x))
    && !/approv|confirm/i.test(JSON.stringify(both)) && !M.FIELDS.some((f) => /approv|confirm/i.test(f)), [...states]);
} catch (e) {
  console.error(`FAIL  ${e.stack || e.message}`);
  failures += 1;
}

console.log('');
console.log(`checksRun=${checks} failures=${failures} floor=${FLOOR}${MUTATE ? ` (negative control vs --mutate=${MUTATE})` : ''}`);
if (checks !== FLOOR) { console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}.`); done(failures > 0 ? 1 : 2); }
else if (failures > 0) { console.error('FAILED'); done(1); }
else { console.log('OK'); done(0); }
