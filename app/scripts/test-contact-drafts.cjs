/**
 * B15-27b P2 -- unit checks for src/lib/contact-drafts.ts (pure parts):
 * identity-scoped keys (B15-25's rules: environment, operator, contact and, for
 * a deal draft, opportunity; a missing part is refused, never broadened),
 * strict parsing, read-back saves, checked removals, the memory fallback, and
 * which save errors are "uncertain".
 */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const APP = path.resolve(__dirname, '..');
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
Module._resolveFilename = ((original) => function (name, parent, ...rest) {
  if (name.startsWith('.') && parent) {
    const candidate = path.resolve(path.dirname(parent.filename), name + '.ts');
    if (fs.existsSync(candidate)) return candidate;
  }
  return original.call(this, name, parent, ...rest);
})(Module._resolveFilename);
const D = require(path.join(APP, 'src/lib/contact-drafts.ts'));

let checks = 0, failures = 0;
const check = (name, ok, detail) => { checks += 1; if (!ok) failures += 1; console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); };
const throws = (fn) => { try { fn(); return false; } catch (e) { return e instanceof D.ContactDraftIdentityError; } };

const TEST = 'SoTgVoaFGHtBdRFvXWQV', PROD = 'jmHG4B8RdzwpfqruNf68';
const note = (o = {}) => ({ scope: 'note', env: TEST, operator: 'op-one', contactId: 'A', ...o });
const outcome = (o = {}) => ({ scope: 'outcome', env: TEST, operator: 'op-one', contactId: 'A', opportunityId: 'A-opp', ...o });

// Keys
check('K1 a contact draft key names kind, environment, operator and contact', D.contactDraftKey(note()) === `${D.CONTACT_DRAFT_PREFIX}note|${TEST}|op-one|A`);
check('K2 a deal draft key also names the opportunity', D.contactDraftKey(outcome()) === `${D.CONTACT_DRAFT_PREFIX}outcome|${TEST}|op-one|A|A-opp`);
check('K3 Test and Production never share a key', D.contactDraftKey(note()) !== D.contactDraftKey(note({ env: PROD })));
check('K4 two operators never share a key', D.contactDraftKey(note()) !== D.contactDraftKey(note({ operator: 'op-two' })));
check('K5 two contacts / two deals never share a key', D.contactDraftKey(note()) !== D.contactDraftKey(note({ contactId: 'B' }))
  && D.contactDraftKey(outcome()) !== D.contactDraftKey(outcome({ opportunityId: 'A-opp-2' })));
check('K6 a missing part is refused, never broadened', ['env', 'operator', 'contactId'].every((k) => throws(() => D.contactDraftKey(note({ [k]: '' }))))
  && throws(() => D.contactDraftKey(outcome({ opportunityId: undefined }))) && throws(() => D.contactDraftKey(note({ contactId: '  ' }))));
check('K7 a contact draft never carries an opportunity; an unknown kind is refused', throws(() => D.contactDraftKey(note({ opportunityId: 'x' }))) && throws(() => D.contactDraftKey({ ...note(), scope: 'other' })));
check('K8 parts are encoded (a "|" cannot forge another identity)', D.contactDraftKey(note({ contactId: 'A|B' })) !== D.contactDraftKey(note({ contactId: 'A', operator: 'op-one|B' })));
check('K9 the operator: write session, else the last seen, else this browser',
  D.draftOperator({ operator: 'x', lastOperator: 'y' }) === 'x' && D.draftOperator({ operator: null, lastOperator: 'y' }) === 'y' && D.draftOperator({ operator: null, lastOperator: null }) === 'this-browser');

// Values
check('V1 only the kind\'s own fields, as strings', JSON.stringify(D.normalizeValues('calllog', { result: 'Voicemail', text: 5, extra: 'x' })) === JSON.stringify({ result: 'Voicemail', text: '' }));
check('V2 an outcome form with no typed text is empty (a choice alone is not kept)', D.isEmptyDraft('outcome', { form: 'pass', passReason: '', followUpAt: '' }) && !D.isEmptyDraft('outcome', { form: 'pass', passReason: 'r', followUpAt: '' }));

// Parsing
const rec = (id, values, extra = {}) => JSON.stringify({ version: 1, identity: id, savedAt: '2026-11-04T00:00:00.000Z', values, notice: null, ...extra });
const ok = (r) => r.ok && r.draft;
check('P1 a matching record parses', ok(D.parseStoredDraft(rec(note(), { text: 'hi' }), note())) && D.parseStoredDraft(rec(note(), { text: 'hi' }), note()).draft.values.text === 'hi');
check('P2 a record for another identity is refused', D.parseStoredDraft(rec(note({ operator: 'op-two' }), { text: 'hi' }), note()).reason === 'identity'
  && D.parseStoredDraft(rec(note({ contactId: 'B' }), { text: 'hi' }), note()).reason === 'identity');
check('P3 another version, malformed JSON, a foreign or non-string field, a bad notice are refused',
  D.parseStoredDraft(rec(note(), { text: 'hi' }).replace('"version":1', '"version":2'), note()).reason === 'version'
  && D.parseStoredDraft('{', note()).reason === 'malformed'
  && D.parseStoredDraft(rec(note(), { text: 'hi', other: 'x' }), note()).reason === 'malformed'
  && D.parseStoredDraft(rec(note(), { text: 3 }), note()).reason === 'malformed'
  && D.parseStoredDraft(rec(note(), { text: 'hi' }, { notice: { kind: 'odd' } }), note()).reason === 'malformed');
check('P4 nothing stored is "no draft"', D.parseStoredDraft(null, note()).ok && D.parseStoredDraft(null, note()).draft === null);

// Store
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const s1 = mem();
const store = D.openContactDraftStore(() => s1);
const draft = { version: 1, identity: note(), savedAt: 'now', values: { text: 'hi' }, notice: { kind: 'failed', message: 'why' } };
check('S1 a save is confirmed by reading it back; it loads for its identity only', store.persistent && store.save(draft) && store.load(note()).draft.notice.message === 'why' && store.load(note({ operator: 'op-two' })).draft === null);
check('S2 a removal is confirmed (nothing left)', store.remove(note()) && store.load(note()).draft === null && s1.m.size === 0);
const lying = { getItem: () => 'other', setItem: () => {}, removeItem: () => {} };
check('S3 a save that does not read back is reported as failed', !D.openContactDraftStore(() => lying).save(draft));
const blocked = D.openContactDraftStore(() => { throw new Error('blocked'); });
check('S4 unavailable storage falls back to this tab\'s memory (not persistent, still works)', !blocked.persistent && blocked.save(draft) && blocked.load(note()).draft.values.text === 'hi');

// Uncertain failures
const { AppWriteSignInRequired } = require(path.join(APP, 'src/lib/app-write-session.ts'));
check('U1 only the sign-in refusal (nothing was sent) is a definite failure', D.isDefiniteFailure(new AppWriteSignInRequired('Sign in')) && !D.isUncertainFailure(new AppWriteSignInRequired('Sign in')));
check('U2 a server-declared 409 indeterminate, any other HTTP error, a parse error, a network error or an abort is uncertain (Bones finding 2)',
  [new Error('The save may have reached GHL; it is unresolved'), new Error('Write refused or unconfirmed'), new SyntaxError('Unexpected token'),
    new TypeError('Failed to fetch'), Object.assign(new Error('aborted'), { name: 'AbortError' })].every((e) => D.isUncertainFailure(e) && !D.isDefiniteFailure(e)));

check('U3 an uncertain notice keeps exactly what was sent; a malformed one is refused',
  D.parseStoredDraft(rec(note(), { text: 'hi' }, { notice: { kind: 'sending', sent: { text: 'hi' } } }), note()).draft.notice.sent.text === 'hi'
  && D.parseStoredDraft(rec(note(), { text: 'hi' }, { notice: { kind: 'sending', sent: { text: 3 } } }), note()).reason === 'malformed');

console.log(`\ncontact-drafts: ${checks - failures}/${checks} checks passed`);
process.exit(failures === 0 && checks >= 22 ? 0 : 1);
