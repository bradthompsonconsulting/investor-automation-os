/**
 * B15-20b (provisional; B15-20 / INV-129 callback family) -- the Seller Call
 * scheduled-callback status line, RENDERED.
 *
 * Offline. Vite serves scripts/harness/seller-call-callback-status (the REAL
 * Contact and Seller Call pages, real GHL client, real stylesheet) in headless
 * Chromium with the page clock fixed at Fri Oct 30 2026, 10:00 AM CDT. Every
 * /.netlify/functions request is answered from an in-memory FICTIONAL fixture
 * (harness/seller-call-callback-status/fixture.cjs); Seller Call writes run
 * through the REAL durable barrier module and land only in memory; anything
 * else is aborted and counted.
 *
 * Proves: the line sits under the Contact link and header and above the deal
 * bar; today, future and overdue (amber) callbacks; a callback whose time
 * passes while the page is open turns Overdue without a reload; none, set but
 * unreadable, still checking (record pending) and couldn't be loaded (read
 * failed); a Follow-Up saved in this visit updates the line at once and the
 * Pass consequence names the same time; a pending Follow-Up for one contact
 * never shows on the next contact, nor does the previous contact's value while
 * the next one loads; recording Pass leaves the line on the same callback; the
 * deal bar's cells are unchanged; no write except the Follow-Up and Pass the
 * test performs, no GHL hand-off, no other request.
 *
 * NEGATIVE CONTROL: `node scripts/test-seller-call-callback-status-rendered.cjs --before=<rev>`
 * renders <rev>'s Seller Call page (via `git show`) and must FAIL (exit 1) --
 * e.g. --before=aabffe3, which has no status line. Waits on the line never
 * throw, so the control fails its checks rather than stopping early.
 */
const path = require('node:path');
const { createFixture } = require('./harness/seller-call-callback-status/fixture.cjs');

const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE = beforeArg ? beforeArg.slice('--before='.length) : null;

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 23;
let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

const NOW = '2026-10-30T15:00:00.000Z';            // Fri Oct 30 2026, 10:00 AM CDT (fictional "now")
const CB_TODAY = '2026-10-30T19:30:00.000Z';       // 2:30 PM CDT
const CB_FUTURE = '2026-11-03T15:00:00.000Z';      // Tue Nov 3, 9:00 AM CST
const CB_OVERDUE = '2026-10-30T14:00:00.000Z';     // 9:00 AM CDT
const AMBER = 'rgb(245, 158, 11)';
const PASS_BASE = 'Records the pass. No seller messages.';
const watchdog = setTimeout(() => { console.error('FAIL  the suite did not finish within 6 minutes -- stopped'); process.exit(1); }, 6 * 60_000);

async function main() {
  const fx = createFixture();
  fx.reset({ cbToday: CB_TODAY, cbFuture: CB_FUTURE, cbOverdue: CB_OVERDUE, cbBad: 'not-a-date' });
  if (BEFORE) console.log(`NEGATIVE CONTROL: rendering the Seller Call page from ${BEFORE}; this run must fail.`);
  const h = await fx.start({ before: BEFORE, now: NOW });
  const { page } = h;
  const go = (to) => page.evaluate((t) => window.__iaosNavigate(t), to);
  const text = () => page.locator('body').innerText();
  const until = async (fn, label, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(50); }
    throw new Error(`timed out waiting for ${label}`);
  };
  /** Never throws: the negative control has no line to wait for. */
  const soft = async (fn, ms = 8000) => { try { return await until(fn, 'status line', ms); } catch { return false; } };
  const status = () => page.evaluate(() => {
    const el = document.querySelector('[data-testid="seller-call-callback-status"]');
    return el ? { state: el.getAttribute('data-callback-state'), text: el.innerText.trim(), color: getComputedStyle(el).color } : null;
  });
  const statusIs = (want) => soft(async () => { const s = await status(); return !!s && s.state === want; });
  const writes = (contact, op) => fx.state.log.filter((r) => r.kind === 'write' && r.contact === contact && (!op || r.op === op));
  /** Leave for a blank route first, so every scenario mounts the page afresh and reads its record. */
  const fresh = async () => { await go('/'); await page.waitForTimeout(150); await page.clock.setSystemTime(new Date(NOW)); };
  /** A held request's arrival, bounded so a missing request fails instead of hanging. */
  const arrived = (h, label) => Promise.race([h.hit, new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out waiting for ${label}`)), 20000))]);
  const scOpen = async (id, first) => {
    await fresh();
    await go(`/contacts/${id}/seller-call`);
    await until(async () => (await text()).includes(`${first} deal`), `${first} Seller Call`);
  };
  const passText = async () => {
    await until(async () => (await page.getByTestId('call-outcome-pass-toggle').count()) > 0, 'Pass toggle');
    if ((await page.getByTestId('call-outcome-pass-consequence').count()) === 0) await page.getByTestId('call-outcome-pass-toggle').click();
    return (await page.getByTestId('call-outcome-pass-consequence').innerText()).trim();
  };
  const closePass = async () => { if ((await page.getByTestId('call-outcome-pass-consequence').count()) > 0) await page.getByTestId('call-outcome-pass-toggle').click(); };
  const recordFollowUp = async (local) => {
    await page.getByTestId('call-outcome-follow-up-toggle').click();
    await page.getByTestId('call-outcome-follow-up-at').fill(local);
    await page.getByTestId('call-outcome-follow-up-confirm').click();
  };

  try {
    check('harness renders the expected Seller Call source', (await page.evaluate(() => window.__iaosSellerCallSource)) === (BEFORE ? 'before' : 'current'));

    // ═══ Today, placement ═══
    await scOpen('cbToday', 'Tessa');
    await statusIs('today');
    const sToday = await status();
    check('today: "Scheduled callback: Today, 2:30 PM" (info)', !!sToday && sToday.text === 'Scheduled callback: Today, 2:30 PM' && sToday.color !== AMBER, sToday);
    const place = await page.evaluate(() => {
      const r = (el) => (el ? el.getBoundingClientRect() : null);
      const back = [...document.querySelectorAll('a')].find((a) => a.textContent.trim() === 'Contact');
      const s = r(document.querySelector('[data-testid="seller-call-callback-status"]'));
      const bar = r(document.querySelector('[data-testid="seller-call-sticky-bar"]'));
      const h1 = r([...document.querySelectorAll('h1')].find((x) => x.textContent.trim() === 'Seller Call'));
      return s && bar && h1 && back ? { belowBack: s.top >= r(back).bottom, belowTitle: s.top >= h1.bottom, aboveBar: s.bottom <= bar.top } : null;
    });
    check('placement: under the Contact link and the Seller Call header, above the deal bar', !!place && place.belowBack && place.belowTitle && place.aboveBar, place);
    const barText = (await page.getByTestId('seller-call-sticky-bar').innerText()).toUpperCase();
    const labels = ['ARV', 'REPAIRS', 'SELLER POSITION', 'CURRENT OFFER', 'TARGET', 'MAX', 'SPREAD'].map((l) => barText.indexOf(l));
    check('the deal bar still shows its seven cells in order, and not the callback', labels.every((i, k) => i >= 0 && (k === 0 || i > labels[k - 1])) && !barText.includes('SCHEDULED CALLBACK'), labels);
    const pToday = await passText();
    check('Pass consequence names the same callback the line shows (Oct 30, 2:30 PM)', pToday.includes('Your callback for Oct 30, 2:30 PM stays scheduled') && !!sToday && sToday.text.endsWith('2:30 PM'), pToday);
    await closePass();

    // ═══ Future, overdue, none, unreadable ═══
    await scOpen('cbFuture', 'Felix');
    await statusIs('later');
    const sFuture = await status();
    check('future: "Scheduled callback: Tue, Nov 3, 9:00 AM"', !!sFuture && sFuture.text === 'Scheduled callback: Tue, Nov 3, 9:00 AM', sFuture);
    await scOpen('cbOverdue', 'Olive');
    await statusIs('overdue');
    const sOver = await status();
    check('overdue: "Scheduled callback: Overdue, was Today, 9:00 AM" in amber', !!sOver && sOver.text === 'Scheduled callback: Overdue, was Today, 9:00 AM' && sOver.color === AMBER, sOver);
    await scOpen('cbNone', 'Nora');
    await statusIs('none');
    check('none: "No callback scheduled"', ((await status()) || {}).text === 'No callback scheduled', await status());
    await scOpen('cbBad', 'Uma');
    await statusIs('unreadable');
    const sBad = await status();
    check('set but unreadable: says so and shows no time', !!sBad && sBad.text === 'Scheduled callback: set, time unreadable. Check the contact page.' && !/\d:\d\d/.test(sBad.text), sBad);

    // ═══ A callback whose time passes while the page is open ═══
    fx.reset({ cbToday: '2026-10-30T15:00:20.000Z' });   // 10:00 AM + 20 s
    await scOpen('cbToday', 'Tessa');
    await statusIs('today');
    const sBeforeTick = await status();
    await page.clock.runFor(31_000);
    await statusIs('overdue');
    const sAfterTick = await status();
    check('time passing: Today, 10:00 AM turns Overdue on the 30 s clock, with no reload',
      !!sBeforeTick && sBeforeTick.text === 'Scheduled callback: Today, 10:00 AM' && !!sAfterTick && sAfterTick.text === 'Scheduled callback: Overdue, was Today, 10:00 AM', { sBeforeTick, sAfterTick });

    // ═══ Checking while this contact's record is pending; couldn't be loaded when it fails ═══
    fx.reset({ cbToday: CB_TODAY });
    const held = fx.hold((r) => r.kind === 'detail' && r.contact === 'cbToday');
    await fresh();
    await go('/contacts/cbToday/seller-call');
    await arrived(held, 'the held record read');
    await statusIs('checking');
    const sChecking = await status();
    held.release();
    await statusIs('today');
    check('record pending: "Checking for a scheduled callback…", then this contact\'s callback once it loads',
      !!sChecking && sChecking.text === 'Checking for a scheduled callback…' && ((await status()) || {}).text === 'Scheduled callback: Today, 2:30 PM', sChecking);
    fx.state.failNext.push((r) => r.kind === 'detail' && r.contact === 'cbNone');
    await fresh();
    await go('/contacts/cbNone/seller-call');
    await until(async () => (await text()).includes('Could not load this deal'), 'fetch error');
    await statusIs('unavailable');
    check('read failed: "Callback status couldn\'t be loaded" (no time, no other contact\'s value)', ((await status()) || {}).text === "Callback status couldn't be loaded", await status());

    // ═══ Follow-Up in this visit ═══
    fx.reset({ cbFuture: CB_FUTURE });
    await scOpen('cbNone', 'Nora');
    await statusIs('none');
    await page.evaluate(() => { window.__sameVisit = 'yes'; });
    await recordFollowUp('2026-10-31T10:00');
    await until(async () => writes('cbNone', 'note.create').length === 2, 'Follow-Up notes');
    await statusIs('tomorrow');
    const sFollow = await status();
    check('Follow-Up saved: the line shows "Tomorrow, 10:00 AM" at once, in the same visit (no reload)',
      !!sFollow && sFollow.text === 'Scheduled callback: Tomorrow, 10:00 AM' && (await page.evaluate(() => window.__sameVisit)) === 'yes', sFollow);
    check('the Follow-Up wrote exactly one callback, to this contact, in memory only', writes('cbNone', 'contact.callback').length === 1 && fx.state.db.cbNone.fields.size > 0, writes('cbNone'));
    const pFollow = await passText();
    check('Pass consequence names the same new callback (Oct 31, 10:00 AM)', pFollow.includes('Your callback for Oct 31, 10:00 AM stays scheduled'), pFollow);
    await closePass();

    // ═══ Contact isolation ═══
    fx.reset({ cbFuture: CB_FUTURE });
    await scOpen('cbNone', 'Nora');
    await statusIs('none');
    const cbWrite = fx.hold((r) => r.kind === 'write' && r.contact === 'cbNone' && r.op === 'contact.callback');
    await recordFollowUp('2026-10-31T10:00');
    await arrived(cbWrite, 'the first contact\'s callback write');
    const futureRead = fx.hold((r) => r.kind === 'detail' && r.contact === 'cbFuture');
    await go('/contacts/cbFuture/seller-call');
    await arrived(futureRead, 'the next contact\'s record read');
    const sMid = await status();
    check('switching with the first contact\'s Follow-Up pending: while the next record loads the line is "checking", never the first contact\'s time',
      !!sMid && sMid.state === 'checking' && !/10:00 AM|Oct 31|Tomorrow/.test(sMid.text), sMid);
    futureRead.release();
    cbWrite.release();
    await until(async () => (await text()).includes('Felix deal'), 'Felix Seller Call');
    await until(async () => writes('cbNone', 'note.create').length === 2, 'the first contact\'s Follow-Up to finish');
    await statusIs('later');
    await page.waitForTimeout(400);
    const sNext = await status();
    check('after the first contact\'s Follow-Up lands: the next contact shows ITS callback only (Tue, Nov 3)',
      !!sNext && sNext.text === 'Scheduled callback: Tue, Nov 3, 9:00 AM', sNext);
    await scOpen('cbNone', 'Nora');
    await statusIs('tomorrow');
    check('back on the first contact: its own saved callback (read from its record)', ((await status()) || {}).text === 'Scheduled callback: Tomorrow, 10:00 AM', await status());

    // ═══ Pass outcome ═══
    fx.reset({ cbToday: CB_TODAY });
    await scOpen('cbToday', 'Tessa');
    await statusIs('today');
    await passText();
    await page.getByTestId('call-outcome-pass-reason').fill('Fictional: seller is not ready to sell this year.');
    await soft(async () => !(await page.getByTestId('call-outcome-pass-confirm').isDisabled()));
    await page.getByTestId('call-outcome-pass-confirm').click();
    await until(async () => writes('cbToday', 'note.create').length >= 1, 'Pass note');
    await page.waitForTimeout(600);
    const sAfterPass = await status();
    const passNote = fx.state.db.cbToday.notes.map((n) => n.body).find((b) => /pass/i.test(b) && b.includes('Fictional: seller is not ready'));
    check('Pass recorded (in memory): the outcome note holds the fictional reason', !!passNote, fx.state.db.cbToday.notes.map((n) => n.body.slice(0, 80)));
    check('after Pass the line still names the same callback (Pass does not clear it), and the stored callback is unchanged',
      !!sAfterPass && sAfterPass.text === 'Scheduled callback: Today, 2:30 PM' && writes('cbToday', 'contact.callback').length === 0, { sAfterPass, w: writes('cbToday').map((w) => w.op) });

    // ═══ Boundaries ═══
    const kinds = [...new Set(fx.state.log.map((r) => r.kind))].sort();
    const allowed = ['call-log-barrier', 'current-offer-barrier', 'detail', 'ghl-contact-conversations', 'ghl-opportunities', 'ghl-underwriting-policy', 'notes', 'write'];
    check('only the known Seller Call reads and the performed writes were requested', kinds.every((k) => allowed.includes(k)), kinds);
    check('nothing left the machine and no GHL hand-off', fx.state.foreign.length === 0 && fx.state.handoffs.length === 0, { foreign: fx.state.foreign, handoffs: fx.state.handoffs });
    check('no page errors', h.pageErrors.length === 0, h.pageErrors);
  } catch (e) {
    console.error(`FAIL  ${e.message}`);
    failures += 1;
  }

  console.log('');
  console.log(`checksRun=${checks} failures=${failures} floor=${FLOOR}${BEFORE ? ` (negative control vs ${BEFORE})` : ''}`);
  clearTimeout(watchdog);
  await h.stop();
  if (checks !== FLOOR) { console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}.`); process.exit(2); }
  if (failures > 0) { console.error('FAILED'); process.exit(1); }
  console.log('OK');
  process.exit(0);
}

main().catch((e) => { console.error(`FAIL  startup: ${e && e.stack || e}`); process.exit(2); });
