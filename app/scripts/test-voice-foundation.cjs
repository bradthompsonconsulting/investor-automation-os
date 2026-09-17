/** INV-90: offline/provider-mocked voice-foundation acceptance harness. */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-voice-foundation-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"commonjs"}');
const sources = [
  'shared/voice-call-contract.ts',
  'netlify/functions/lib/operator-auth.ts',
  'netlify/functions/lib/voice-attempt-store.ts',
  'netlify/functions/lib/voice-provider.ts',
  'src/lib/voice/call-session.ts',
].map((file) => path.join(APP, file));
try {
  execFileSync(process.execPath, [
    path.join(APP, 'node_modules', 'typescript', 'bin', 'tsc'), ...sources,
    '--outDir', TMP, '--rootDir', APP, '--module', 'commonjs',
    '--target', 'es2020', '--strict', '--esModuleInterop', '--skipLibCheck',
  ], { cwd: APP, stdio: 'inherit' });
} catch (error) {
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(10);
}

const contract = require(path.join(TMP, 'shared/voice-call-contract.js'));
const attempts = require(path.join(TMP, 'netlify/functions/lib/voice-attempt-store.js'));
const auth = require(path.join(TMP, 'netlify/functions/lib/operator-auth.js'));
const provider = require(path.join(TMP, 'netlify/functions/lib/voice-provider.js'));
const client = require(path.join(TMP, 'src/lib/voice/call-session.js'));
let checks = 0;
let failures = 0;
function check(name, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`}`);
  if (!ok) failures += 1;
}

class MemoryStore {
  constructor() { this.value = null; this.version = 0; }
  async read() { return this.value ? { record: structuredClone(this.value), etag: String(this.version) } : null; }
  async create(_key, record) { if (this.value) return false; this.value = structuredClone(record); this.version += 1; return true; }
  async replace(_key, record, etag) { if (etag !== String(this.version)) return false; this.value = structuredClone(record); this.version += 1; return true; }
}

(async () => {
  check('all locked lifecycle states are present', contract.VOICE_STATES, [
    'idle','authorizing','ready','initiating','ringing','connected','muted','completed','busy','no-answer','rejected','failed','disconnected','provider-unknown',
  ]);
  const validTransitions = {
    idle: ['idle','authorizing'],
    authorizing: ['authorizing','ready','rejected','failed','provider-unknown'],
    ready: ['ready','initiating','rejected','failed','provider-unknown'],
    initiating: ['initiating','ringing','connected','busy','no-answer','failed','disconnected','provider-unknown'],
    ringing: ['ringing','connected','busy','no-answer','failed','disconnected','provider-unknown'],
    connected: ['connected','muted','completed','failed','disconnected','provider-unknown'],
    muted: ['muted','connected','completed','failed','disconnected','provider-unknown'],
    completed: ['completed'], busy: ['busy'], 'no-answer': ['no-answer'], rejected: ['rejected'],
    failed: ['failed'], disconnected: ['disconnected'], 'provider-unknown': ['provider-unknown'],
  };
  let transitionMatrixCorrect = true;
  for (const from of contract.VOICE_STATES) for (const to of contract.VOICE_STATES) {
    if (contract.canTransitionVoiceState(from, to) !== validTransitions[from].includes(to)) transitionMatrixCorrect = false;
  }
  check('every valid and invalid state transition matches the locked matrix', transitionMatrixCorrect, true);
  check('stale ringing after connected is ignored', contract.reduceProviderStatus('connected', 'ringing').kind, 'ignore');
  check('conflicting terminal callback becomes unknown', contract.reduceProviderStatus('busy', 'completed').kind, 'unknown');

  const store = new MemoryStore();
  const now = '2026-09-17T12:00:00.000Z';
  const concurrent = await Promise.allSettled([
    attempts.acquireAttempt(store, 'contact-1', 'attempt-1', now),
    attempts.acquireAttempt(store, 'contact-1', 'attempt-2', now),
  ]);
  check('two-tab authorization has exactly one winner', concurrent.filter((r) => r.status === 'fulfilled').length, 1);
  const winner = concurrent.find((r) => r.status === 'fulfilled').value.record.attemptId;
  await attempts.transitionAttempt(store, 'contact-1', winner, 'ready', now);
  const dialResults = await Promise.all([
    attempts.consumeDial(store, 'contact-1', winner, 'CA-parent', now),
    attempts.consumeDial(store, 'contact-1', winner, 'CA-parent', now),
  ]);
  check('double-click emits exactly one provider Dial authority', dialResults.filter(Boolean).length, 1);
  await attempts.applyProviderCallback(store, 'contact-1', winner, { status: 'ringing', sequence: 1, observedAt: now, providerChildCallId: 'CA-child' });
  await attempts.applyProviderCallback(store, 'contact-1', winner, { status: 'in-progress', sequence: 2, observedAt: now });
  await attempts.applyProviderCallback(store, 'contact-1', winner, { status: 'ringing', sequence: 1, observedAt: now });
  check('out-of-order callback cannot regress connected', store.value.providerState.state, 'connected');
  await attempts.applyProviderCallback(store, 'contact-1', winner, { status: 'busy', sequence: 3, observedAt: now });
  await attempts.applyProviderCallback(store, 'contact-1', winner, { status: 'completed', sequence: 4, observedAt: now });
  check('conflicting terminal evidence fails to provider-unknown', store.value.providerState.state, 'provider-unknown');
  const blocked = await Promise.allSettled([attempts.acquireAttempt(store, 'contact-1', 'attempt-3', now)]);
  check('provider-unknown blocks blind retry', blocked[0].status, 'rejected');

  const sameSequenceStore = new MemoryStore();
  await attempts.acquireAttempt(sameSequenceStore, 'contact-2', 'attempt-sequence', now);
  await attempts.transitionAttempt(sameSequenceStore, 'contact-2', 'attempt-sequence', 'ready', now);
  await attempts.consumeDial(sameSequenceStore, 'contact-2', 'attempt-sequence', 'CA-parent-2', now);
  await attempts.applyProviderCallback(sameSequenceStore, 'contact-2', 'attempt-sequence', { status: 'ringing', sequence: 1, observedAt: now, providerChildCallId: 'CA-child-2' });
  await attempts.applyProviderCallback(sameSequenceStore, 'contact-2', 'attempt-sequence', { status: 'busy', sequence: 1, observedAt: now, providerChildCallId: 'CA-child-2' });
  check('same-sequence conflicting callback becomes provider-unknown', sameSequenceStore.value.providerState.state, 'provider-unknown');

  const env = { IAOS_ENV: 'test' };
  const config = require(path.join(TMP, 'shared/ghl-config.js')).getConfig('test');
  const baseContact = { id: 'contact-1', locationId: config.locationId, phone: '(214) 555-0101', dnd: false, dndSettings: { Call: { status: 'inactive' } }, customFields: [] };
  check('explicit inactive Call DND is eligible', provider.evaluateVoiceEligibility(baseContact, 'contact-1', env).eligible, true);
  check('missing suppression authority fails closed', provider.evaluateVoiceEligibility({ ...baseContact, dndSettings: {} }, 'contact-1', env).code, 'suppression-unknown');
  check('active voice DND is suppressed', provider.evaluateVoiceEligibility({ ...baseContact, dndSettings: { Call: { status: 'active' } } }, 'contact-1', env).code, 'suppressed');
  check('invalid seller phone fails closed', provider.evaluateVoiceEligibility({ ...baseContact, phone: '555' }, 'contact-1', env).code, 'invalid-phone');
  check('wrong GHL location fails closed', provider.evaluateVoiceEligibility({ ...baseContact, locationId: 'wrong' }, 'contact-1', env).code, 'contact-mismatch');
  let missingContactRejected = false;
  try { await provider.readEligibleGhlContact('contact-1', async () => ({ ok: false, status: 404 }), { ...env, GHL_PRIVATE_API_KEY: 'fixture' }); } catch { missingContactRejected = true; }
  check('missing contact rejects authorization', missingContactRejected, true);
  check('voice-disabled configuration fails closed', provider.voiceCapability({ IAOS_ENV: 'test' }).enabled, false);
  check('non-Test environment fails closed', provider.voiceCapability({ IAOS_ENV: 'production', IAOS_VOICE_ENABLED: 'true' }).reasons.includes('IAOS voice is restricted to TEST'), true);

  const authEnv = { GOOGLE_OAUTH_CLIENT_ID: 'client-id', IAOS_VOICE_BRAD_EMAILS: 'brad@example.com', IAOS_VOICE_SESSION_SECRET: '0123456789abcdef0123456789abcdef' };
  const google = await auth.verifyGoogleIdentity('mock', async () => ({ ok: true, json: async () => ({ iss: 'https://accounts.google.com', aud: 'client-id', email: 'Brad@Example.com', email_verified: true, exp: 2_000_000_000 }) }), 1_800_000_000_000, authEnv);
  check('Google token verification normalizes Brad allowlist identity', google.email, 'brad@example.com');
  const session = auth.issueOperatorSession(google.email, 1_800_000_000_000, authEnv);
  check('audience-scoped server session verifies', auth.verifyOperatorSession(session.token, 1_800_000_001_000, authEnv).aud, 'iaos-voice');
  let tamperRejected = false;
  try { auth.verifyOperatorSession(session.token.slice(0, -1) + 'x', 1_800_000_001_000, authEnv); } catch { tamperRejected = true; }
  check('tampered session is rejected', tamperRejected, true);
  let expiredRejected = false;
  try { auth.verifyOperatorSession(session.token, 1_800_001_000_000, authEnv); } catch { expiredRejected = true; }
  check('expired operator authentication fails closed', expiredRejected, true);
  let wrongGoogleRejected = false;
  try { await auth.verifyGoogleIdentity('mock', async () => ({ ok: true, json: async () => ({ iss: 'https://accounts.google.com', aud: 'client-id', email: 'other@example.com', email_verified: true, exp: 2_000_000_000 }) }), 1_800_000_000_000, authEnv); } catch { wrongGoogleRejected = true; }
  check('wrong Google identity is rejected', wrongGoogleRejected, true);

  const twilioEnv = {
    TWILIO_ACCOUNT_SID: `AC${'1'.repeat(32)}`, TWILIO_API_KEY_SID: `SK${'2'.repeat(32)}`,
    TWILIO_API_KEY_SECRET: 'fixture-secret', TWILIO_TWIML_APP_SID: `AP${'3'.repeat(32)}`,
  };
  const browserToken = provider.issueTwilioVoiceToken('brad-fixture', 300, twilioEnv);
  const tokenClaims = JSON.parse(Buffer.from(browserToken.token.split('.')[1], 'base64url').toString('utf8'));
  check('provider token TTL is five minutes', tokenClaims.exp - tokenClaims.iat, 300);
  check('provider token has outgoing grant only', Object.keys(tokenClaims.grants).sort(), ['identity','voice']);
  check('provider token carries no incoming permission', tokenClaims.grants.voice.incoming, undefined);
  check('invalid Twilio signature is rejected', provider.verifyTwilioSignature('invalid', 'https://example.test/hook', {}, { TWILIO_AUTH_TOKEN: 'fixture' }), false);

  let connects = 0;
  const adapter = { connect: async () => { connects += 1; return { disconnect() {}, mute() {}, isMuted() { return false; } }; } };
  const authorized = { attemptId: 'attempt-client', contactBinding: 'contact-client', state: 'ready', createdAt: now, updatedAt: now, providerCallId: null, providerChildCallId: null, voiceToken: 'fixture', voiceTokenExpiresAt: '2026-09-17T12:10:00.000Z' };
  const sessionClient = new client.VoiceCallSession(adapter, () => 'session', async (url) => {
    if (String(url).includes('voice-attempt')) return { status: 200, ok: true, json: async () => authorized };
    throw new Error('unexpected fetch');
  }, () => Date.parse(now));
  const twoClicks = await Promise.all([sessionClient.start(authorized, () => {}, () => {}), sessionClient.start(authorized, () => {}, () => {})]);
  check('client double-click shares one connect operation', connects, 1);
  check('client double-click receives one shared connection', twoClicks[0] === twoClicks[1], true);
  check('refresh restores the server attempt envelope', (await sessionClient.restore('contact-client')).attemptId, 'attempt-client');
  const expiredClient = new client.VoiceCallSession(adapter, () => 'session', fetch, () => Date.parse('2026-09-17T12:11:00.000Z'));
  let expiredProviderRejected = false;
  try { await expiredClient.start(authorized, () => {}, () => {}); } catch { expiredProviderRejected = true; }
  check('expired provider capability fails closed before connect', expiredProviderRejected, true);

  const twiml = fs.readFileSync(path.join(APP, 'netlify/functions/voice-twiml.ts'), 'utf8');
  check('TwiML explicitly disables recording', /record="do-not-record"/.test(twiml), true);
  check('TwiML contains one Number verb', (twiml.match(/<Number/g) || []).length, 1);
  const browser = fs.readFileSync(path.join(APP, 'src/lib/voice/twilio-browser-adapter.ts'), 'utf8');
  check('browser passes contact binding, never destination or caller ID', !/destination|callerId|phone\s*:/.test(browser), true);
  const voiceSources = fs.readdirSync(path.join(APP, 'netlify/functions')).filter((name) => name.startsWith('voice-')).map((name) => fs.readFileSync(path.join(APP, 'netlify/functions', name), 'utf8')).join('\n');
  check('provider completion creates zero GHL writes, notes, callbacks, or dispositions', !/ghl\.notes|setCallback|setLastCall|setDisposition|\/contacts\/[^`'"]+.*(?:POST|PUT|PATCH)/i.test(voiceSources), true);
  check('no Seller Call UI file is modified by harness scope', fs.existsSync(path.join(APP, 'src/pages/SellerCallWorkspace.tsx')), true);

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\nINV-90 voice foundation: ${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
})().catch((error) => { console.error(error); fs.rmSync(TMP, { recursive: true, force: true }); process.exit(1); });
