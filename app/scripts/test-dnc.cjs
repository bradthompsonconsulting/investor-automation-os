/**
 * B14-12 / INV-94 — Do Not Call, simplified (Brad 2026-10-04): a button that
 * opens this contact in GHL, and a read-only check of what GHL holds. Offline.
 *
 * 1. The pure rules (src/lib/dnc.ts): which channels GHL shows suppressed,
 *    the calling-list predicate, and the status sentence IAOS shows.
 * 2. IAOS NEVER WRITES DND AND WRITES NO DO NOT CALL RECORD: no named
 *    operation, client method or GHL call anywhere in the app sends
 *    dndSettings (or the top-level dnd); the retired reason/note helpers are
 *    gone. The browser flow is in test-contact-isolation.cjs.
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
  await check('status: what GHL holds for calls, SMS and email, and what it means for calling lists', () => {
    assert.equal(dnc.dncStatusText({ Call: ON, SMS: STOP, Email: UNSUB }), 'GHL shows Do Not Disturb on calls, SMS and email. This contact is out of IAOS calling lists.');
    assert.equal(dnc.dncStatusText({}), "GHL doesn't show Do Not Disturb on calls, SMS or email. It stays on IAOS calling lists while calls are not suppressed.");
    assert.equal(dnc.dncStatusText({ Call: ON }), 'GHL shows Do Not Disturb on calls, not on SMS or email. This contact is out of IAOS calling lists.');
    assert.equal(dnc.dncStatusText({ SMS: STOP, RCS: STOP }), 'GHL shows Do Not Disturb on SMS, not on calls or email. It stays on IAOS calling lists while calls are not suppressed.');
    assert.equal(dnc.dncStatusText({ Call: ON, Email: ON, SMS: { status: 'inactive' } }), 'GHL shows Do Not Disturb on calls and email, not on SMS. This contact is out of IAOS calling lists.');
    assert.equal(dnc.dncStatusText(undefined), dnc.dncStatusText({}));
  });
  await check('copy: the button opens GHL; nothing claims IAOS set DND or recorded anything; no reason is asked for', () => {
    assert.equal(dnc.DNC_BUTTON, 'Do Not Call (opens GHL)');
    assert.ok(/Turn on Do Not Disturb there for Calls & Voicemails, Text Messages and Emails/.test(dnc.DNC_HANDOFF_OPENED) && /IAOS doesn't change Do Not Disturb itself/.test(dnc.DNC_HANDOFF_OPENED));
    assert.ok(/Existing opt-outs such as STOP stay in place/.test(dnc.DNC_KEEPS_OPT_OUTS));
    const all = Object.values(dnc).filter((v) => typeof v === 'string').join('\n');
    assert.equal(/recorded|reason|IAOS (set|turned on|suppressed)/i.test(all), false, all);
  });
  await check('the retired reason/note helpers are gone', () => {
    for (const k of ['dncNote', 'isDncNoteBody', 'DNC_NOTE_PREFIX', 'DNC_NOTE_OBSERVED_LINE', 'DNC_REASON_MAX', 'DNC_REASON_PLACEHOLDER', 'DNC_CONSEQUENCE']) assert.equal(k in dnc, false, k);
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
  await check('the former write paths are gone everywhere (contact.dnc, setDnc, planDnc, GhlBoundary.dnc, the DNC note and its Production class)', () => {
    const offenders = files.filter((f) => /contact\.dnc|setDnc|planDnc|verifyDnc|boundary\.dnc|async dnc\(|isDncNoteBody|dncNote\(|productionDnc|PRODUCTION_DNC|iaos-dnc-not-held/.test(srcOf(f)));
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
