/**
 * B15-03 / INV-103 slice C -- Save at Summary on the REAL Seller Call page.
 *
 * OFFLINE, MOCKED BROWSER: the real App (app-routes harness) on /contacts/:id/seller-call with GHL data from
 * scripts/harness/seller-call-offer-ready-fixture.cjs. Every non-localhost request is aborted and counted. Every
 * write (POST ghl-write) is logged; in the flag-OFF runs every write is refused (405) and counted.
 *
 * The flag-ON runs ask the harness (init script, `__iaosHarnessOverride`) for the Save-enabled projection computed
 * by the REAL projectRuntimeConfig from the Test config with only the sentinel switched, and a placeholder write
 * session. The committed configuration stays DISABLED; nothing here changes it. Simulated ghl-write responses:
 * confirmed (200), refused (not_sent with a reason), uncertain (network abort; unreadable body).
 *
 * Checks:
 *   OFF. Save sits at Summary only; the plan lists every item (note, timing, price, occupancy, address/reason
 *        "not saved: not enabled") with what it WOULD write; the note text carries every answer and General notes;
 *        pressing Save says saving is not enabled and makes ZERO write requests; slice A navigation writes nothing.
 *   OFF-A. The Board 14-13 sections autosave exactly as before (blur writes one Transaction assumptions note;
 *        "Save changes" exists).
 *   LEAVE. With unsaved work an in-app link asks first (Cancel stays, drafts intact; OK leaves) and reload gets the
 *        beforeunload prompt; with nothing unsaved no prompt appears.
 *   ON. Sections do not write on blur/Enter/None/refusal and say they save with the call; no "Save changes"; Save
 *        writes, in order, the conversation note, Transaction assumptions v2 (closing from Timing, structure carried,
 *        the section's title edit), Seller price position, Seller Position, contact.occupancy -- each reported
 *        confirmed; nothing for address/reason; the sections then show the saved values; a second Save sends
 *        nothing; a corrected re-save writes ONE new note with the same call id (supersede).
 *   MIX. Per-item confirmed / refused (server reason shown) / uncertain (network abort; unreadable answer); drafts
 *        kept; the leave warning stays; no automatic retry; Save again re-sends only the refused item; Check again
 *        reads (not found -> Save sends a fresh one; found -> confirmed, never re-sent).
 *   ONE. One save in flight: a double-click sends each item once; the button is disabled while saving.
 *   G. 1100x800 with the plan open: nothing in the panel overflows sideways.
 *   H. Zero foreign requests, zero page errors.
 *
 * SC_SAVE_MUTATION=<name> rewrites source IN THE DEV SERVER ONLY; scripts/test-seller-conversation-save-mutations.cjs
 * requires each to fail a named check here.
 *
 *   node scripts/test-seller-conversation-save-rendered.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
require('./harness/ts-loader.cjs');
const fx = require('./harness/seller-call-offer-ready-fixture.cjs');

const APP = path.resolve(__dirname, '..');
const HARNESS = '/scripts/harness/app-routes/index.html';
const A = fx.CONTACT;
const { getConfig } = require(path.join(APP, 'shared/ghl-config.ts'));
const OCC_ID = getConfig('test').fields.occupancyStatus;
const N = require(path.join(APP, 'src/lib/seller-conversation-note.ts'));
const R = require(path.join(APP, 'src/lib/seller-call-readiness-carriers.ts'));
const SP = require(path.join(APP, 'src/lib/seller-call-seller-position-note.ts'));

const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const watchdog = setTimeout(() => { console.error('FAIL  did not finish within 12 minutes'); process.exit(1); }, 12 * 60_000);

const FLOOR = 64;
const COMP = '/src/components/SellerConversation.tsx';
const SAVE = '/src/lib/seller-conversation-save.ts';
const NOTE = '/src/lib/seller-conversation-note.ts';
const PAGE = '/src/pages/SellerCallWorkspace.tsx';
/* [file, from, to]: each `from` must occur exactly once in its file. */
const MUTATIONS = {
  // Save writes even though the flag is off.
  saveoff: [[COMP, 'if (!save.enabled) { onNotEnabled(); return; }', 'if (!save.enabled) { onNotEnabled(); }']],
  // An uncertain item is sent again by the next Save without a check.
  resenduncertain: [[SAVE, 'if (r.status === "uncertain" || r.status === "checking" || r.status === "saving") {\n    return { ...p, action: "blocked"', 'if (r.status === "checking" || r.status === "saving") {\n    return { ...p, action: "blocked"'],
    [SAVE, '        if (prev && (prev.status === "uncertain" || prev.status === "checking" || prev.status === "saving")) continue;\n', '        if (prev && (prev.status === "checking" || prev.status === "saving")) continue;\n']],
  // An uncertain item is retried automatically.
  autoretry: [[SAVE, '          this.set(dealKey, p.id, { status: "uncertain", signature, sent, message: outcome.message });\n', '          this.set(dealKey, p.id, { status: "uncertain", signature, sent, message: outcome.message });\n          void client.send(sent.kind === "note" ? "note.create" : "contact.occupancy", contactId, sent.kind === "note" ? { body: sent.body } : { value: sent.value });\n']],
  // Drafts are cleared once a failure (refused or uncertain) comes back.
  cleardrafts: [[COMP, 'notEnabledShown={notEnabledShown === key} onNotEnabled={() => setNotEnabledShown(key)} />', 'notEnabledShown={notEnabledShown === key} onNotEnabled={() => { if (save.enabled) setDrafts((all) => ({ ...all, [key]: { ...(all[key] ?? EMPTY_CONVERSATION), answers: {}, notes: "" } })); else setNotEnabledShown(key); }} />'],
    [COMP, '    void save.coordinator.save(dealKey, save.contactId, plan, save.client, hooks);\n', '    void save.coordinator.save(dealKey, save.contactId, plan, save.client, hooks).then(() => { if (Object.values(save.coordinator.results(dealKey)).some((r) => r && (r.status === "refused" || r.status === "uncertain"))) onNotEnabled(); });\n']],
  // A confirmed identical item is sent again.
  duplicate: [[SAVE, '  if (r.status === "confirmed" && r.signature === p.signature) return { ...p, action: "done", text: "Saved (confirmed)." };\n', ''],
    [SAVE, '        if (prev && prev.status === "confirmed" && prev.signature === p.signature) continue;\n', '']],
  // The property address is written.
  addresswritten: [[SAVE, 'items.push(item("address", "not_saved", "Not saved: not enabled. The address stays in the conversation note only."));', 'items.push(item("address", "write", "Address", "addr", { kind: "note", body: (at) => `Property address: ${answer(d, "address", "street")} (${at})` }));']],
  // The note leaves General notes empty.
  nogeneral: [[NOTE, 'lines.push(HEADING_PREFIX + GENERAL_HEADING, `${GENERAL_LABEL}: ${encode(general.value)}`);', 'lines.push(HEADING_PREFIX + GENERAL_HEADING, `${GENERAL_LABEL}: ""`);']],
  // With Save enabled, Transaction assumptions still autosaves on blur.
  autosaveon: [[PAGE, '    if (!t || saveEnabled) return; // slice C: with Save enabled this section joins the Save plan and never writes on its own', '    if (!t) return;']],
  // With Save disabled, Transaction assumptions stops autosaving.
  autosaveoff: [[PAGE, '    if (!t || saveEnabled) return; // slice C: with Save enabled this section joins the Save plan and never writes on its own', '    if (!t || true) return;']],
  // No leave warning.
  noleaveguard: [[COMP, '  useLeaveGuard(!!savePlan && (savePlan.unsaved || !!save?.coordinator.busy()), LEAVE_MESSAGE);', '  useLeaveGuard(false, LEAVE_MESSAGE);']],
  // An unreadable/aborted answer is treated as saved.
  uncertainasconfirmed: [[SAVE, '  let body: any;\n  try { body = JSON.parse(text); } catch { return { kind: "uncertain"', '  let body: any;\n  try { body = JSON.parse(text); } catch { return { kind: "confirmed" } as SendOutcome; return { kind: "uncertain"']],
  // A second Save may start while one is in flight: the coordinator's busy check is removed AND the button stays
  // enabled. (The coordinator check alone is covered by test-seller-conversation-save.cjs "D: one save in flight".)
  noinflight: [[SAVE, '    if (this.inflight !== null) return "busy";\n', ''], [COMP, 'data-testid="sc-save" disabled={busy}', 'data-testid="sc-save" disabled={false}']],
};
const MUTATION = process.env.SC_SAVE_MUTATION || '';
if (MUTATION && !MUTATIONS[MUTATION]) { console.error(`FAIL  unknown SC_SAVE_MUTATION ${MUTATION}`); process.exit(2); }
if (MUTATION) {
  for (const [file, from] of MUTATIONS[MUTATION]) {
    const srcText = fs.readFileSync(path.join(APP, file), 'utf8').replace(/\r\n/g, '\n');
    if (srcText.split(from).length !== 2) { console.error(`FAIL  mutation ${MUTATION}: target not found exactly once in ${file}`); process.exit(2); }
  }
}
let mutationApplied = false;

let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail === undefined ? '' : ` -- ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 600)}`}`); }
}

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const tailwindcss = (await import('@tailwindcss/vite')).default;
  const { chromium } = require('playwright');
  const mutate = {
    name: 'seller-conversation-save-mutation', enforce: 'pre',
    transform(code, id) {
      if (!MUTATION) return null;
      const file = [COMP, SAVE, NOTE, PAGE].find((f) => id.replace(/\\/g, '/').split('?')[0].endsWith(f));
      const mine = file ? MUTATIONS[MUTATION].filter((m) => m[0] === file) : [];
      if (mine.length === 0) return null;
      let out = code.replace(/\r\n/g, '\n');
      for (const [, from, to] of mine) out = out.replace(from, () => to);
      if (!mutationApplied) console.log(`NOTE  mutation ${MUTATION} applied`);
      mutationApplied = true;
      return out;
    },
  };
  const server = await createServer({
    root: APP, configFile: false, plugins: [mutate, react(), tailwindcss()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: [HARNESS.slice(1)], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const log = { foreign: [], pageErrors: [] };

  /** The fixture's own write model: a created note is appended (so a re-read sees it); occupancy is stored on the contact. */
  function land(req) {
    if (req.operation === 'note.create') {
      fx.state.createdNotes += 1;
      fx.state.notes.push({ id: `slice-c-${fx.state.createdNotes}`, body: req.args.body, dateAdded: '2026-11-03T15:00:00.000Z' });
      return { status: 200, body: { confirmed: true, note: { id: `slice-c-${fx.state.createdNotes}` } } };
    }
    if (req.operation === 'contact.occupancy') {
      fx.state.contactFields = fx.state.contactFields.filter((f) => f.id !== OCC_ID);
      if (req.args.value !== '') fx.state.contactFields.push({ id: OCC_ID, value: [req.args.value] });
      return { status: 200, body: { confirmed: true } };
    }
    return { status: 400, body: { error: `fixture does not model ${req.operation}` } };
  }

  /**
   * enabled: ask the harness for the Save-enabled projection + a write session; session: a write session only (flag off).
   * respond(req, n): the answer to the n-th write -- { status, body } | 'abort' | 'unreadable' | a Promise of one;
   * null = refuse with 405 (flag-off runs).
   */
  async function open({ width = 1440, height = 900, enabled = false, session = enabled, respond = null } = {}) {
    const context = await browser.newContext({ viewport: { width, height }, timezoneId: 'America/Chicago', locale: 'en-US' });
    if (enabled || session) await context.addInitScript((o) => { window.__iaosHarnessOverride = o; }, { sellerConversationSave: enabled, writeSession: session });
    const page = await context.newPage();
    page.setDefaultTimeout(8000); // a missing control fails its check quickly instead of stalling the run
    const writes = [];
    const dialogs = [];
    let dialogPolicy = 'dismiss';
    page.on('dialog', async (dlg) => { dialogs.push({ type: dlg.type(), message: dlg.message() }); if (dialogPolicy === 'accept') await dlg.accept(); else await dlg.dismiss(); });
    page.on('pageerror', (e) => log.pageErrors.push(`${width}x${height}: ${String(e)}`));
    if (process.env.SC_SAVE_DEBUG) page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`CONSOLE ${m.type()} ${m.text().slice(0, 300)}`); });
    await context.route('**/*', async (rt) => {
      const r = rt.request();
      const url = r.url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return rt.continue();
      if (!url.includes('/.netlify/functions/')) { log.foreign.push(url); return rt.abort(); }
      const fn = new URL(url).pathname.replace('/.netlify/functions/', '');
      if (r.method() !== 'GET') {
        let post = null; try { post = JSON.parse(r.postData() || 'null'); } catch { /* recorded as is */ }
        const w = { method: r.method(), fn, operation: post && post.operation, targetId: post && post.targetId, requestId: post && post.requestId, args: post && post.args };
        writes.push(w);
        if (!respond || fn !== 'ghl-write') return rt.fulfill(json(405, { error: 'offline test refuses every write' }));
        const a = await respond(w, writes.length);
        if (a === 'abort') return rt.abort('failed');
        if (a === 'unreadable') return rt.fulfill({ status: 200, contentType: 'text/html', body: '<html>gateway</html>' });
        return rt.fulfill(json(a.status, a.body));
      }
      if (fn === 'app-read-session') return rt.fulfill(json(200, { signedIn: true, expiresAt: new Date(Date.now() + 3600_000).toISOString() }));
      const a = fx.answer(fx.classify(url, 'GET', null));
      return rt.fulfill(json(a.status, a.body));
    });
    await page.goto(`${base}${HARNESS}?start=${encodeURIComponent(`/contacts/${A}/seller-call`)}`);
    await page.waitForFunction(() => typeof window.__iaosAppSource === 'string', null, { timeout: 90000 });
    await page.getByTestId('sc-card').waitFor({ timeout: 60000 });
    await page.getByTestId('sc-readiness-status').waitFor({ timeout: 60000 });
    await page.waitForTimeout(300);
    return { context, page, writes, dialogs, setDialogPolicy: (p) => { dialogPolicy = p; } };
  }
  const tid = (page, id) => page.getByTestId(id);
  const press = async (page, id) => { try { await page.getByTestId(id).click({ timeout: 4000 }); return true; } catch { return false; } };
  const fill = async (page, id, v) => { try { await page.getByTestId(id).fill(v, { timeout: 4000 }); return true; } catch { return false; } };
  const itemAttr = (page, id, attr) => page.getByTestId(`sc-save-item-${id}`).getAttribute(attr, { timeout: 500 }).catch(() => null);
  const planIds = (page) => page.locator('[data-testid="sc-save-plan"] > li').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid').replace('sc-save-item-', '')));
  const beforeUnloadBlocked = (page) => page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
  const backLink = (page) => page.locator(`a[href="/contacts/${A}"]`).first();
  const waitIdle = async (page) => { for (let i = 0; i < 60; i++) { if ((await tid(page, 'sc-save').textContent().catch(() => '')) === 'Save') return; await page.waitForTimeout(100); } };
  /** The call answers every flag-on run types. */
  async function typeCall(page, { address = false } = {}) {
    await press(page, 'sc-nav-opening'); await fill(page, 'sc-field-opening-response', 'Open to talking');
    await press(page, 'sc-nav-occupancy'); await page.getByTestId('sc-field-occupancy-occupancy').selectOption('Tenant Occupied').catch(() => {});
    await press(page, 'sc-nav-timing'); await fill(page, 'sc-field-timing-timing', 'Close by March 1');
    await press(page, 'sc-nav-price'); await fill(page, 'sc-field-price-amount', '410000');
    await press(page, 'sc-nav-asis'); await press(page, 'sc-dont-know');
    if (address) {
      await press(page, 'sc-nav-address'); await fill(page, 'sc-field-address-street', '1 Main St');
      await press(page, 'sc-nav-reason'); await fill(page, 'sc-field-reason-reason', 'Relocating for work');
    }
    await fill(page, 'sc-call-notes', 'Seller prefers mornings. Dog on site.');
  }

  /* ===== OFF: flag disabled (the committed configuration) ===== */
  fx.reset();
  {
    const { context, page, writes, dialogs, setDialogPolicy } = await open({ session: true }); // signed in: any attempted write would be visible
    for (let i = 0; i < 9; i++) await press(page, 'sc-next');
    for (let i = 0; i < 9; i++) await press(page, 'sc-prev');
    check('OFF: slice A navigation (Next through every question and back) writes nothing', writes.length === 0, writes);
    check('LEAVE: with nothing typed, no prompt on reload (beforeunload not blocked)', !(await beforeUnloadBlocked(page)));
    await typeCall(page, { address: true });
    await press(page, 'sc-nav-price');
    check('OFF: Save is not offered away from Summary', (await tid(page, 'sc-save').count()) === 0);
    await press(page, 'sc-nav-summary');
    check('OFF: Save is at Summary & next step, marked not enabled', (await tid(page, 'sc-save').count()) === 1 && (await tid(page, 'sc-save-panel').getAttribute('data-enabled')) === 'false');
    const ids = await planIds(page);
    check('OFF: the plan lists the note, timing, price, occupancy, address and reason, in order', JSON.stringify(ids) === JSON.stringify(['note', 'timing', 'price', 'occupancy', 'address', 'reason']), ids);
    const would = [];
    for (const id of ['note', 'timing', 'price', 'occupancy']) would.push((await tid(page, `sc-save-state-${id}`).textContent()) === 'Would save' && (await itemAttr(page, id, 'data-action')) === 'write');
    check('OFF: each changed item says "Would save" (what WOULD be written)', would.every(Boolean), would);
    check('OFF: address and reason are "Not saved: not enabled"', (await tid(page, 'sc-save-text-address').textContent()).startsWith('Not saved: not enabled') && (await tid(page, 'sc-save-text-reason').textContent()).startsWith('Not saved: not enabled'));
    const timingText = await tid(page, 'sc-save-text-timing').textContent();
    check('OFF: timing would write closing/possession and carry structure and title unchanged', timingText.includes('closing/possession → "Close by March 1"') && timingText.includes('structure "Assignment of contract" (unchanged)') && timingText.includes('title None (recorded) (unchanged)'), timingText);
    check('OFF: price would write $410,000 as the Seller price position', (await tid(page, 'sc-save-text-price').textContent()).includes('$410,000'));
    const preview = await tid(page, 'sc-save-note-preview').textContent();
    const pv = N.parseSellerConversationNote(preview);
    check('OFF: the note text is a valid v1 conversation note for this deal', !!pv && pv.opportunityId === fx.OPP && pv.opening === 'cold', preview.slice(0, 200));
    check('OFF: the note text carries every answer typed and the General notes', !!pv && pv.general === 'Seller prefers mornings. Dog on site.' && pv.questions.find((q) => q.id === 'timing').answers.timing === 'Close by March 1'
      && pv.questions.find((q) => q.id === 'address').answers.street === '1 Main St' && pv.questions.find((q) => q.id === 'asis').dontKnow === true && pv.questions.find((q) => q.id === 'occupancy').answers.occupancy === 'Tenant Occupied');
    await press(page, 'sc-save');
    await page.waitForTimeout(600);
    check('OFF: pressing Save says saving is not enabled and nothing was sent', (await tid(page, 'sc-save-not-enabled').textContent().catch(() => '')).includes('Saving is not enabled yet. Nothing was sent.'));
    check('OFF: ZERO write requests after Save', writes.length === 0, writes);
    check('OFF: the drafts are untouched by Save', (await tid(page, 'sc-call-notes').inputValue()) === 'Seller prefers mornings. Dog on site.' && (await tid(page, 'sc-field-summary-next').count()) === 1);

    // LEAVE (flag off: the conversation is unsaved work)
    check('LEAVE: with unsaved work, reload/close is blocked by beforeunload', await beforeUnloadBlocked(page));
    setDialogPolicy('dismiss');
    await backLink(page).click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(500);
    check('LEAVE: an in-app link asks first, naming unsaved work', dialogs.length === 1 && dialogs[0].type === 'confirm' && /unsaved/i.test(dialogs[0].message), dialogs);
    check('LEAVE: Cancel stays on Seller Call with the drafts intact', new URL(page.url()).pathname === `/contacts/${A}/seller-call` && (await tid(page, 'sc-call-notes').inputValue()) === 'Seller prefers mornings. Dog on site.');
    setDialogPolicy('accept');
    await backLink(page).click({ timeout: 4000 }).catch(() => {});
    await page.waitForURL((u) => new URL(u).pathname === `/contacts/${A}`, { timeout: 15000 }).catch(() => {});
    check('LEAVE: OK leaves', new URL(page.url()).pathname === `/contacts/${A}` && dialogs.length === 2);
    check('OFF: still zero writes at the end of the run', writes.length === 0, writes);
    await context.close();
  }

  /* ===== OFF-A: with the flag off the Board 14-13 sections autosave exactly as before ===== */
  fx.reset();
  {
    const { context, page, writes, dialogs } = await open({ session: true, respond: (w) => land(w) });
    await fill(page, 'transaction-closing-input', 'Close in 45 days');
    await tid(page, 'transaction-closing-input').press('Tab');
    for (let i = 0; i < 30 && writes.length === 0; i++) await page.waitForTimeout(100);
    await page.waitForTimeout(400);
    const ta = writes.length === 1 && writes[0].operation === 'note.create' ? R.parseTransactionAssumptionsNote(writes[0].args.body) : null;
    check('OFF-A: leaving the Transaction assumptions field still saves it on its own (one v2 note)', !!ta && ta.version === 2 && ta.closingPossession.value === 'Close in 45 days', writes.map((w) => w.operation));
    check('OFF-A: the section reports Saved as before', (await tid(page, 'transaction-assumptions-save-status').getAttribute('data-state')) === 'saved');
    await fill(page, 'negotiation-seller-position-input', '390000');
    check('OFF-A: "Save changes" still appears for an unsaved section', (await tid(page, 'seller-call-save-changes').count()) === 1);
    check('LEAVE: section-only edits with the flag off do not trigger the conversation warning (sections autosave)', !(await beforeUnloadBlocked(page)) && dialogs.length === 0);
    await context.close();
  }

  /* ===== ON: flag enabled in the harness only; every write confirmed ===== */
  fx.reset();
  {
    const { context, page, writes, dialogs, setDialogPolicy } = await open({ enabled: true, respond: (w) => land(w) });
    // Sections no longer write on their own.
    await press(page, 'transaction-title-none');
    await fill(page, 'transaction-title-input', 'Lien question');
    await tid(page, 'transaction-title-input').press('Enter');
    await tid(page, 'transaction-title-input').press('Tab');
    await fill(page, 'negotiation-seller-position-input', '390000');
    await tid(page, 'negotiation-seller-position-input').press('Tab');
    await page.waitForTimeout(800);
    check('ON: the sections do not write on blur, Enter or None (they join the Save plan)', writes.length === 0, writes.map((w) => w.operation));
    check('ON: no "Save changes" fallback; the sections say they save with the call',
      (await tid(page, 'seller-call-save-changes').count()) === 0 && (await tid(page, 'transaction-assumptions-save-status').textContent()).includes('saved with the call by Save at Summary')
      && (await tid(page, 'negotiation-seller-position-save-status').textContent()).includes('saved with the call by Save at Summary'));
    check('LEAVE: unsaved section edits alone (flag on) block reload', await beforeUnloadBlocked(page));
    await typeCall(page);
    check('ON: the card says drafts are saved only by Save at Summary', (await tid(page, 'sc-draft-note').textContent()).includes('saved only when you press Save at Summary'));
    await press(page, 'sc-nav-summary');
    const ids = await planIds(page);
    check('ON: the plan holds the note, timing, price, Seller Position and occupancy', JSON.stringify(ids) === JSON.stringify(['note', 'timing', 'price', 'sellerPosition', 'occupancy']), ids);
    check('ON: each says "Will save"', (await tid(page, 'sc-save-state-note').textContent()) === 'Will save' && (await tid(page, 'sc-save-state-sellerPosition').textContent()) === 'Will save');
    await press(page, 'sc-save');
    for (let i = 0; i < 80 && writes.length < 5; i++) await page.waitForTimeout(100);
    await waitIdle(page);
    check('ON: Save sent exactly five writes, in order: note, Transaction assumptions, price, Seller Position, occupancy',
      JSON.stringify(writes.map((w) => [w.operation, w.args && w.args.body ? w.args.body.split('\n')[0] : w.args && w.args.value])) === JSON.stringify([
        ['note.create', 'IAOS SELLER CONVERSATION — iaos-seller-conversation-v1'], ['note.create', 'IAOS TRANSACTION ASSUMPTIONS — iaos-transaction-assumptions-v2'],
        ['note.create', 'IAOS SELLER PRICE POSITION — iaos-seller-price-position-v1'], ['note.create', 'IAOS SELLER POSITION — iaos-seller-position-v1'], ['contact.occupancy', 'Tenant Occupied']]),
      writes.map((w) => [w.operation, w.args && w.args.body ? w.args.body.split('\n')[0] : w.args && w.args.value]));
    check('ON: every write targets this contact, through ghl-write, each with its own request id',
      writes.every((w) => w.fn === 'ghl-write' && w.targetId === A) && new Set(writes.map((w) => w.requestId)).size === writes.length);
    const conv = N.parseSellerConversationNote(writes[0].args.body);
    check('ON: the conversation note is for this deal and carries every answer and the General notes', !!conv && conv.opportunityId === fx.OPP && conv.general === 'Seller prefers mornings. Dog on site.'
      && conv.questions.find((q) => q.id === 'opening').answers.response === 'Open to talking' && conv.questions.find((q) => q.id === 'asis').dontKnow === true);
    const ta = R.parseTransactionAssumptionsNote(writes[1].args.body);
    check('ON: Transaction assumptions v2 = closing from Timing, structure carried, the section\'s title edit', !!ta && ta.version === 2 && ta.opportunityId === fx.OPP && ta.closingPossession.value === 'Close by March 1'
      && ta.transactionStructure.value === 'Assignment of contract' && ta.titleComplications.value === 'Lien question');
    const price = R.parseSellerPricePositionNote(writes[2].args.body);
    const sp = SP.parseSellerPositionNote(writes[3].args.body);
    check('ON: Seller price position 410000 and Seller Position 390000, both for this deal', price && price.price === 410000 && price.opportunityId === fx.OPP && sp && sp.value === 390000 && sp.opportunityId === fx.OPP);
    check('ON: nothing was sent for the property address or Seller Reason', !writes.some((w) => /propertyAddress|sellerReason/.test(w.operation || '')));
    const results = [];
    for (const id of ['note', 'timing', 'price', 'sellerPosition', 'occupancy']) results.push(await itemAttr(page, id, 'data-result'));
    check('ON: every item reports Confirmed', results.every((r) => r === 'confirmed'), results);
    check('ON: the sections now show the saved values as saved', (await tid(page, 'transaction-closing-input').inputValue()) === 'Close by March 1'
      && (await tid(page, 'transaction-assumptions-save-status').getAttribute('data-state')) !== 'unsaved' && (await tid(page, 'negotiation-seller-position-save-status').getAttribute('data-state')) !== 'unsaved'
      && (await tid(page, 'seller-price-position-input').inputValue()) === '410000');
    check('ON: the drafts are still on screen (Save never erases what was typed)', (await tid(page, 'sc-call-notes').inputValue()) === 'Seller prefers mornings. Dog on site.');
    check('LEAVE: once everything is saved there is no prompt', !(await beforeUnloadBlocked(page)));
    await press(page, 'sc-save');
    await page.waitForTimeout(800);
    check('ON: a second Save sends nothing (no duplicate)', writes.length === 5, writes.length);
    // Corrected re-save: supersedes by call id.
    await fill(page, 'sc-call-notes', 'Seller prefers mornings. Dog on site. Gate code 1234.');
    check('ON: a corrected call is "Will save" again for the note only', (await itemAttr(page, 'note', 'data-action')) === 'write' && (await page.locator('[data-testid="sc-save-plan"] > li[data-action="write"]').count()) === 1);
    await press(page, 'sc-save');
    for (let i = 0; i < 40 && writes.length < 6; i++) await page.waitForTimeout(100);
    await waitIdle(page);
    const second = writes[5] && N.parseSellerConversationNote(writes[5].args.body);
    check('ON: the re-save writes ONE new conversation note with the same call id and a later time', writes.length === 6 && !!second && second.callId === conv.callId && Date.parse(second.at) > Date.parse(conv.at));
    const latest = N.latestSellerConversationsForOpportunity(fx.state.notes, fx.OPP);
    check('ON: the latest note for that call id is the corrected one', latest.size === 1 && latest.get(conv.callId).general.endsWith('Gate code 1234.'));
    setDialogPolicy('dismiss');
    await backLink(page).click({ timeout: 4000 }).catch(() => {});
    await page.waitForURL((u) => new URL(u).pathname === `/contacts/${A}`, { timeout: 15000 }).catch(() => {});
    check('LEAVE: with nothing unsaved an in-app link leaves without asking', dialogs.length === 0 && new URL(page.url()).pathname === `/contacts/${A}`, dialogs);
    await context.close();
  }

  /* ===== MIX: confirmed / refused / uncertain, individually ===== */
  fx.reset();
  {
    const answers = {
      1: (w) => land(w),                                                                     // conversation note: confirmed
      2: () => ({ status: 409, body: { outcome: 'not_sent', error: 'Malformed or undeclared ledger note' } }), // TA: refused
      3: () => 'abort',                                                                      // price: network error -> uncertain (did not land)
      4: (w) => { land(w); return 'unreadable'; },                                           // occupancy: landed, answer unreadable -> uncertain
    };
    const { context, page, writes, dialogs, setDialogPolicy } = await open({ enabled: true, respond: (w, n) => (answers[n] ? answers[n](w) : land(w)) });
    await typeCall(page, { address: true });
    await press(page, 'sc-nav-summary');
    await press(page, 'sc-save');
    for (let i = 0; i < 80 && writes.length < 4; i++) await page.waitForTimeout(100);
    await waitIdle(page);
    const res = {};
    for (const id of ['note', 'timing', 'price', 'occupancy']) res[id] = await itemAttr(page, id, 'data-result');
    check('MIX: each item reports its own result: confirmed / refused / uncertain / uncertain', JSON.stringify(res) === JSON.stringify({ note: 'confirmed', timing: 'refused', price: 'uncertain', occupancy: 'uncertain' }), res);
    check('MIX: the refusal shows the server\'s reason', (await tid(page, 'sc-save-result-timing').textContent().catch(() => '')).includes('Malformed or undeclared ledger note'));
    check('MIX: the network failure and the unreadable answer are uncertain, never "saved"', /Uncertain: Network error/.test(await tid(page, 'sc-save-result-price').textContent().catch(() => '')) && /could not be read/.test(await tid(page, 'sc-save-result-occupancy').textContent().catch(() => '')));
    check('MIX: an uncertain item offers Check again', (await tid(page, 'sc-save-check-price').count()) === 1 && (await tid(page, 'sc-save-check-occupancy').count()) === 1);
    check('MIX: address and reason were never sent even with Save enabled', writes.length === 4 && !writes.some((w) => w.args && typeof w.args.body === 'string' && w.args.body.includes('1 Main St') && !w.args.body.startsWith('IAOS SELLER CONVERSATION')));
    await press(page, 'sc-nav-timing');
    const kept = (await tid(page, 'sc-field-timing-timing').inputValue()) === 'Close by March 1';
    await press(page, 'sc-nav-price');
    check('MIX: drafts are kept after the failure and the uncertain results', kept && (await tid(page, 'sc-field-price-amount').inputValue()) === '410000' && (await tid(page, 'sc-call-notes').inputValue()) === 'Seller prefers mornings. Dog on site.');
    check('LEAVE: the warning stays while items are refused or uncertain', await beforeUnloadBlocked(page));
    await page.waitForTimeout(2500);
    check('MIX: nothing is retried automatically', writes.length === 4, writes.length);
    await press(page, 'sc-nav-summary');
    check('MIX: the plan now: note Saved, timing Will save, price and occupancy Uncertain (blocked)', (await itemAttr(page, 'note', 'data-action')) === 'done' && (await itemAttr(page, 'timing', 'data-action')) === 'write'
      && (await itemAttr(page, 'price', 'data-action')) === 'blocked' && (await itemAttr(page, 'occupancy', 'data-action')) === 'blocked');
    await press(page, 'sc-save');
    for (let i = 0; i < 40 && writes.length < 5; i++) await page.waitForTimeout(100);
    await waitIdle(page);
    await page.waitForTimeout(300);
    check('MIX: Save again re-sends ONLY the refused item (never the uncertain ones)', writes.length === 5 && writes[4].args.body.startsWith('IAOS TRANSACTION ASSUMPTIONS'), writes.map((w) => w.operation));
    check('MIX: the re-sent item is now confirmed', (await itemAttr(page, 'timing', 'data-result')) === 'confirmed');
    await press(page, 'sc-save-check-price');
    for (let i = 0; i < 40 && (await itemAttr(page, 'price', 'data-result')) !== 'not_found'; i++) await page.waitForTimeout(100);
    check('MIX: Check again reads the record: the price note is not there -> "Not found", nothing sent', (await itemAttr(page, 'price', 'data-result')) === 'not_found' && writes.length === 5);
    await press(page, 'sc-save-check-occupancy');
    for (let i = 0; i < 40 && (await itemAttr(page, 'occupancy', 'data-result')) !== 'confirmed'; i++) await page.waitForTimeout(100);
    check('MIX: Check again finds the occupancy that landed -> Confirmed, never re-sent', (await itemAttr(page, 'occupancy', 'data-result')) === 'confirmed' && writes.length === 5);
    await press(page, 'sc-save');
    for (let i = 0; i < 40 && writes.length < 6; i++) await page.waitForTimeout(100);
    await waitIdle(page);
    await page.waitForTimeout(300);
    const resent = writes[5];
    check('MIX: after "Not found", Save sends the price as a FRESH request (new request id, new time)', writes.length === 6 && !!resent && resent.args.body.startsWith('IAOS SELLER PRICE POSITION')
      && resent.requestId !== writes[2].requestId && resent.args.body !== writes[2].args.body && (await itemAttr(page, 'price', 'data-result')) === 'confirmed');
    check('MIX: only address/reason are left (not saved: not enabled); the warning stays for them', (await page.locator('[data-testid="sc-save-plan"] > li[data-action="write"],[data-testid="sc-save-plan"] > li[data-action="blocked"]').count()) === 0 && (await beforeUnloadBlocked(page)));
    setDialogPolicy('dismiss');
    await context.close();
    void dialogs;
  }

  /* ===== ONE: one save in flight ===== */
  fx.reset();
  {
    let release; const gate = new Promise((r) => { release = r; });
    const { context, page, writes } = await open({ enabled: true, respond: async (w, n) => { if (n === 1) await gate; return land(w); } });
    await press(page, 'sc-nav-opening'); await fill(page, 'sc-field-opening-response', 'Open to talking');
    await press(page, 'sc-nav-occupancy'); await page.getByTestId('sc-field-occupancy-occupancy').selectOption('Vacant').catch(() => {});
    await press(page, 'sc-nav-summary');
    await tid(page, 'sc-save').dblclick({ timeout: 4000 }).catch(() => {});
    await page.evaluate(() => { const b = document.querySelector('[data-testid="sc-save"]'); if (b) b.click(); });
    await page.waitForTimeout(600);
    check('ONE: while the first write is held, exactly one request is in flight and Save is disabled ("Saving…")', writes.length === 1 && (await tid(page, 'sc-save').isDisabled()) && (await tid(page, 'sc-save').textContent()) === 'Saving…', writes.length);
    release();
    for (let i = 0; i < 40 && writes.length < 2; i++) await page.waitForTimeout(100);
    await waitIdle(page);
    await page.waitForTimeout(500);
    check('ONE: after it finishes each item was sent exactly once (note, occupancy)', JSON.stringify(writes.map((w) => w.operation)) === JSON.stringify(['note.create', 'contact.occupancy']), writes.map((w) => w.operation));
    await context.close();
  }

  /* ===== G. layout with the plan open ===== */
  fx.reset();
  {
    const { context, page } = await open({ width: 1100, height: 800, enabled: true, respond: (w) => land(w) });
    await typeCall(page, { address: true });
    await press(page, 'sc-nav-summary');
    await page.getByTestId('sc-save-preview-note').locator('summary').click().catch(() => {});
    await tid(page, 'sc-save-panel').scrollIntoViewIfNeeded().catch(() => {});
    const m = await page.evaluate(() => {
      const wrap = document.querySelector('[data-testid="seller-conversation"]');
      const wr = wrap.getBoundingClientRect();
      const over = [...wrap.querySelectorAll('*')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > wr.right + 1 || r.left < wr.left - 1); }).map((el) => el.getAttribute('data-testid') || el.tagName).slice(0, 5);
      const main = document.querySelector('main');
      return { over, pageX: main.scrollWidth > main.clientWidth + 1 };
    });
    check('G: 1100x800 with the plan and note text open: nothing overflows sideways', m.over.length === 0 && !m.pageX, m);
    await context.close();
  }

  /* ===== H. totals ===== */
  check('H: zero foreign requests', log.foreign.length === 0, log.foreign.slice(0, 3));
  check('H: zero page errors', log.pageErrors.length === 0, log.pageErrors.slice(0, 3));

  await browser.close();
  await server.close();
  clearTimeout(watchdog);
  if (MUTATION && !mutationApplied) { console.error('FAILED: mutation not applied'); process.exit(3); }
  if (checks !== FLOOR) { console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}.`); process.exit(2); }
  console.log(`\nchecksRun=${checks} failures=${failures} floor=${FLOOR} ${failures === 0 ? 'OK' : 'FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FAIL  ', e); process.exit(1); });
