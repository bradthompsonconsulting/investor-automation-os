/**
 * B14-12 / INV-94 — Do Not Call (GHL-native handoff design, Jess 2026-10-03). Offline.
 *
 * 1. The pure rules (src/lib/dnc.ts): which channels GHL shows suppressed,
 *    the calling-list predicate, and the exact note — worded as what GHL
 *    showed AT VERIFICATION, not a guarantee.
 * 2. IAOS NEVER WRITES DND: no named operation, client method or GHL call
 *    anywhere in the app sends dndSettings (or the top-level dnd). The former
 *    contact.dnc operation is gone and is refused as unknown.
 * The server's note check (re-read under the contact lock before accepting the
 * note) is exercised through the real ghl-write handler in
 * test-write-boundaries.cjs; the browser flow in test-contact-isolation.cjs.
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
let checks = 0, failures = 0;
async function check(name, fn) {
  checks += 1;
  try { await fn(); console.log('PASS  ' + name); }
  catch (e) { failures += 1; console.error('FAIL  ' + name + '\n      ' + (e && e.message)); }
}
const STOP = { status: 'permanent', message: 'STOP_KEYWORD' };
const UNSUB = { status: 'active', message: 'User clicked on the unsubscribe link' };
const ON = { status: 'active', message: '' };

(async () => {
  // ── 1. Pure rules ───────────────────────────────────────────────────────
  await check('suppressed = status active or permanent, whatever the message (a STOP counts)', () => {
    assert.equal(dnc.isSuppressing(STOP), true);
    assert.equal(dnc.isSuppressing(UNSUB), true);
    assert.equal(dnc.isSuppressing({ status: 'inactive' }), false);
    assert.equal(dnc.isSuppressing(undefined), false);
  });
  await check('unsuppressedChannels lists calls, SMS and email that GHL does not show suppressed, in order', () => {
    assert.deepEqual(dnc.unsuppressedChannels({}), ['Call', 'SMS', 'Email']);
    assert.deepEqual(dnc.unsuppressedChannels({ SMS: STOP, RCS: STOP }), ['Call', 'Email']);
    assert.deepEqual(dnc.unsuppressedChannels({ Call: ON, SMS: STOP, Email: UNSUB }), []);
    assert.deepEqual(dnc.unsuppressedChannels({ Call: ON, SMS: { status: 'inactive' }, Email: ON }), ['SMS']);
    for (const v of [undefined, null, [], 'x']) assert.deepEqual(dnc.unsuppressedChannels(v), ['Call', 'SMS', 'Email']);
  });
  await check('isDncComplete only when all three are suppressed; other channels (RCS, WhatsApp) do not count', () => {
    assert.equal(dnc.isDncComplete({ Call: ON, SMS: STOP, Email: UNSUB }), true);
    assert.equal(dnc.isDncComplete({ Call: ON, SMS: STOP, RCS: STOP }), false);
  });
  await check('calling lists key on the Call channel only; STOP on SMS alone does not exclude', () => {
    assert.equal(dnc.isCallSuppressed({ Call: ON }), true);
    assert.equal(dnc.isCallSuppressed({ Call: { status: 'permanent' } }), true);
    assert.equal(dnc.isCallSuppressed({ SMS: STOP, RCS: STOP }), false);
    assert.equal(dnc.isCallSuppressed(undefined), false);
  });
  await check('note: states what GHL showed at verification — not a guarantee', () => {
    const n = dnc.dncNote('  Seller asked us not to contact them again.  ');
    assert.equal(n, 'Do Not Call (recorded by Brad in IAOS): Seller asked us not to contact them again.\nAt verification, GHL showed calls, SMS and email suppressed.');
    assert.equal(dnc.isDncNoteBody(n), true);
    assert.equal(dnc.isDncNoteBody(dnc.dncNote('x'.repeat(500))), true);
    assert.equal(/guarantee|permanently|will stay|remains/i.test(dnc.DNC_NOTE_OBSERVED_LINE), false);
  });
  await check('note: anything but the exact two lines is not a Do Not Call note', () => {
    for (const bad of [dnc.dncNote('x'.repeat(501)), 'Do Not Call (recorded by Brad in IAOS): \nAt verification, GHL showed calls, SMS and email suppressed.',
      'Do Not Call (recorded by Brad in IAOS):  padded\nAt verification, GHL showed calls, SMS and email suppressed.',
      'Do Not Call (recorded by Brad in IAOS): a\nb\nAt verification, GHL showed calls, SMS and email suppressed.',
      'Do Not Call (recorded by Brad in IAOS): a\nSuppressed in GHL: calls, SMS and email.',
      'IAOS Do Not Call: a\nAt verification, GHL showed calls, SMS and email suppressed.', 'plain note', null]) {
      assert.equal(dnc.isDncNoteBody(bad), false, JSON.stringify(bad));
    }
    assert.equal(dnc.dncNote('x').startsWith('IAOS '), false, 'the server note guard refuses undeclared IAOS-prefixed ledgers');
  });
  await check('copy: set in GHL itself; opt-outs kept; removal also in GHL', () => {
    assert.ok(/Do Not Call is set in GHL itself/.test(dnc.DNC_CONSEQUENCE) && /Existing opt-outs such as STOP stay in place/.test(dnc.DNC_CONSEQUENCE) && /Removing Do Not Call later is also done in GHL/.test(dnc.DNC_CONSEQUENCE));
  });

  // ── 2. IAOS never writes DND ────────────────────────────────────────────
  const files = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); } else if (/\.(ts|tsx)$/.test(e.name)) files.push(p); } };
  for (const d of ['src', 'netlify', 'shared']) walk(path.join(APP, d));
  const srcOf = (f) => fs.readFileSync(f, 'utf8');
  await check('no app source sends dndSettings or the top-level dnd in any request body', () => {
    const offenders = files.filter((f) => /dndSettings\s*:\s*(plan|next|\{|settings|d\b)|["']dnd["']\s*:|\bdnd\s*:\s*(true|false)/.test(srcOf(f)) && !/\/src\/lib\/dnc\.ts$/.test(f.replace(/\\/g, '/')));
    assert.deepEqual(offenders.map((f) => path.relative(APP, f)), []);
  });
  await check('the former write path is gone everywhere (contact.dnc, setDnc, planDnc, GhlBoundary.dnc)', () => {
    const offenders = files.filter((f) => /contact\.dnc|setDnc|planDnc|verifyDnc|boundary\.dnc|async dnc\(/.test(srcOf(f)));
    assert.deepEqual(offenders.map((f) => path.relative(APP, f)), []);
  });
  const contracts = require(path.join(APP, 'netlify/functions/lib/write-contracts.ts'));
  const { getConfig } = require(path.join(APP, 'shared/ghl-config.ts'));
  await check('ghl-write refuses contact.dnc as an unknown operation', () => {
    assert.throws(() => contracts.planWrite('contact.dnc', { confirm: 'DO_NOT_CALL' }, getConfig('test')), /Unknown write operation/);
  });
  await check('the dialer webhook list is unchanged: Do Not Call is still not one of its six', () => {
    assert.equal(contracts.dispositions.includes('Do Not Call'), false);
    assert.equal(contracts.dispositions.length, 6);
  });

  console.log(`\nB14-12 Do Not Call: ${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
})();
