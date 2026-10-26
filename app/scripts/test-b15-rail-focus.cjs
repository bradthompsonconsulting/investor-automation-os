/**
 * Narrow-width F3 + F1 (2026-10-25) -- keyboard focus is always FULLY visible
 * in the scroll viewport and never under the deal rail, and the
 * identity-header badge/chips wrap inside the card.
 * OFFLINE, MOCKED BROWSER: the real App (app-routes harness, real Layout and
 * its <main> scroll container) in headless Chromium with invented data. Every
 * function GET is answered from the fixture below (unmodelled GETs get a 404
 * and are counted); every non-localhost request is aborted; every non-GET is
 * refused and fails the run.
 *
 * The fixture contact carries 40 notes so the page is tall enough for the rail
 * to STICK at every width, 1440 included; each focus walk asserts it did.
 *
 * CLEARANCE RULE (Jess 2026-10-25, after PR #147 CI): the rail stays sticky only
 * while, stuck, it leaves room for the tallest focusable control:
 *   room = main.clientHeight - main padding-top - rail height - 8px
 *   need = tallest rendered, visible, enabled focusable control in <main>
 *          outside the rail, never capped (a user-enlarged textarea releases
 *          the pin, desktop included -- Jess 2026-10-25)
 * room >= need -> "sticky": position sticky / top 0 / zIndex 1, stuck, Seller
 *   MAO cell fully visible, scroll-padding-top == padding-top + rail + 8px.
 * room <  need -> "scrolls": the rail scrolls with the page (position relative),
 *   main's PREVIOUS scroll padding is back; permanent MAO visibility is relaxed
 *   (documented, not asserted).
 * Every step checks the page's mode against this rule recomputed here. Every
 * Tab / Shift+Tab step checks that the focused control
 *   - is FULLY inside the scroll viewport vertically (below the rail when it is
 *     stuck), when it can fit; a control taller than that band (an enlarged
 *     textarea) must instead show its caret line, and stay still;
 *   - has none of 5 points under the rail;
 *   - did not move the page when focus entered the STUCK rail (Spock);
 * and that every scroll call the page made in that step was a vertical write
 * to <main> that moved nothing else (scroll API log, installed before the app
 * loads; it records the window, every ancestor of <main> and main.scrollLeft
 * around each call). Horizontal overflow at 480px (fixed sidebar, min-width
 * cards) is a separately DEFERRED issue and is NOT asserted.
 *
 *   1. Fresh load at 480/640/768/1024/1440 (900 tall): sticky everywhere.
 *   2. Width resize WITHOUT reload, 1440 -> 480 and 480 -> 1440: sticky.
 *   3. Rail growth with no resize at the last width (mode by the rule), then the
 *      growth removed: sticky again.
 *   4. Window HEIGHT changes without reload: 480 wide 900 -> 600 (scrolls) ->
 *      900 (sticky) -> grown (rule) -> grown at 600 (scrolls) -> ungrown at 900
 *      (sticky); 1440 wide 900 -> 520 -> 900 (sticky throughout).
 *   5. Leave and come back, from sticky AND from the fallback: main's previous
 *      scroll padding is restored on exit (a sentinel set while away survives),
 *      the fallback itself leaves the previous value in place, nothing keeps
 *      observing or listening on <main> or the document after exit.
 *   6. Pointer (Bones 1): clicking a textarea cut at the bottom edge places the
 *      caret where clicked, a drag selects, and neither scrolls; keyboard focus
 *      after pointer use is still brought fully into view.
 *   7. Entering the stuck rail (Spock 1), 480 and 1440: Tab and Shift+Tab onto
 *      the rail's control do not move the page; a scripted
 *      focus({preventScroll}) is not moved either.
 *   8. Keyboard focus held while the fallback returns to sticky (Spock 2): the
 *      control stays reachable and clear of the rail, moved at most to the
 *      edge of the visible band, and nothing keeps moving.
 *   9. Oversized textarea (Bones 2, Jess), 1440 and 480: enlarged past the room
 *      the rail scrolls, once, without flapping; Tab and Shift+Tab into it show
 *      the caret line (start and end), make no custom adjustment and settle;
 *      typing and arrow keys keep the caret in view; shrunk back, sticky
 *      returns with the focused box clear of the rail.
 *  10. A taller control enabled, or made visible, with no size change (Bones
 *      3): the mode switches before the next task, i.e. before keyboard focus
 *      can need it; Tab then shows it whole; reverting restores sticky.
 *
 * RAIL_FOCUS_MUTATION=<name> rewrites ContactWorkspace.tsx IN THE DEV SERVER
 * ONLY (no file is touched) to prove these checks catch a broken fix:
 *   off          -- the hook is not called (the original defect)
 *   static       -- nothing tracked: padding and mode set once
 *   nocleanup    -- the previous value is not restored on exit
 *   nodisconnect -- the ResizeObserver is not disconnected on exit
 *   nomodisconnect -- the MutationObserver is not disconnected on exit
 *   nofallback   -- the a0fd10a implementation: always sticky, no reveal
 *   noreturn     -- once released, the rail never becomes sticky again
 *   noreveal     -- no focus handling (no reveal, no rail lift)
 *   nolistenercleanup -- the focus listener is left on <main> after exit
 *   pointerreveal -- the reveal ignores modality (pointer focus scrolls)
 *   intoview     -- the 5b57be0 reveal: scrollIntoView (moves more than <main>.scrollTop)
 *   railjump     -- no padding lift for focus entering the stuck rail
 *   nobound      -- the reveal also adjusts controls taller than the band
 *   nomutations  -- no MutationObserver: enable/show without resize is missed
 *   nokeep       -- focus not kept clear when sticky returns
 *   nomodalitycleanup -- the keydown listener is left on the document
 * Run them with scripts/test-b15-rail-focus-mutations.cjs.
 *
 *   node scripts/test-b15-rail-focus.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const APP = path.resolve(__dirname, '..');
const HARNESS = '/scripts/harness/app-routes/index.html';
const WIDTHS = [480, 640, 768, 1024, 1440];
const HEIGHT = 900;
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const watchdog = setTimeout(() => { console.error('FAIL  did not finish within 12 minutes'); process.exit(1); }, 12 * 60_000);

const FITS = '      const fits = scroller.clientHeight - padTop - railHeight - RAIL_GAP >= need;\n';
const LISTEN = '    scroller.addEventListener("focusin", reveal);\n';
const MUTATIONS = {
  off: [['  useRailClearance(railEl);\n', '\n']],
  static: [['    [rail, scroller, rail.parentElement].forEach((el) => { if (el) observer?.observe(el); });\n', '\n'],
    ['    mutations?.observe(scroller, { subtree: true, childList: true, attributes: true, attributeFilter: RAIL_WATCHED });\n', '\n']],
  nocleanup: [['\n      scroller.style.scrollPaddingTop = previous;\n      rail.style.position', '\n      rail.style.position']],
  nodisconnect: [['      observer?.disconnect();\n', '\n']],
  nomodisconnect: [['      mutations?.disconnect();\n', '\n']],
  nofallback: [[FITS, '      const fits = true;\n'], [LISTEN, '\n']],
  noreturn: [[FITS, FITS.replace('>= need;', '>= need && rail.dataset.railMode !== "scrolls";')]],
  noreveal: [[LISTEN, '\n']],
  nolistenercleanup: [['      scroller.removeEventListener("focusin", reveal);\n', '\n']],
  pointerreveal: [['      if (keyTask) show(el);\n', '      show(el);\n']],
  intoview: [['      if (keyTask) show(el);\n', '      if (keyTask) el.scrollIntoView({ block: "nearest", inline: "nearest" });\n']],
  railjump: [['      if (sticky() && rail.contains(el)) {\n', '      if (false) {\n']],
  nobound: [['      if (b.height > bottom - top + 1) return;\n', '\n']],
  nomutations: [['    mutations?.observe(scroller, { subtree: true, childList: true, attributes: true, attributeFilter: RAIL_WATCHED });\n', '\n']],
  nokeep: [['      if (kept) show(kept);\n', '\n']],
  nomodalitycleanup: [['      document.removeEventListener("keydown", onKey, true);\n', '\n']],
};
const MUTATION = process.env.RAIL_FOCUS_MUTATION || '';
if (MUTATION && !MUTATIONS[MUTATION]) { console.error(`FAIL  unknown RAIL_FOCUS_MUTATION ${MUTATION}`); process.exit(2); }
let mutationApplied = false;

let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` -- ${detail}` : ''}`); }
}

const PEOPLE = {
  scored: { id: 'syn-scored', firstName: 'Syn', lastName: 'Scored', address1: '12 Example St', city: 'Testville', state: 'TX', postalCode: '75001',
    tags: ['warm'], combinedScore: 82, motivationScore: 64, dealScore: 37 },
  unscored: { id: 'syn-unscored', firstName: 'Syn', lastName: 'Unscored', address1: '', city: '', state: '', postalCode: '',
    tags: [], combinedScore: null, motivationScore: null, dealScore: null },
};
const NOTES = Array.from({ length: 40 }, (_, i) => ({ id: `syn-note-${i}`, dateAdded: new Date(Date.UTC(2026, 8, 1 + i, 15)).toISOString(),
  body: `Synthetic note ${i + 1}: spoke with seller about timing and condition; follow up next week. Invented text for an offline layout check.` }));
const oppFor = (p) => `syn-opp-${p.id}`;
const contactRow = (p) => ({ id: p.id, firstName: p.firstName, lastName: p.lastName, phone: '+15550100001', email: `${p.id}@example.invalid`,
  address1: p.address1, city: p.city, state: p.state, postalCode: p.postalCode, dateAdded: '2026-09-01T00:00:00.000Z', tags: p.tags, dndSettings: {},
  motivationScore: p.motivationScore, dealScore: p.dealScore, combinedScore: p.combinedScore, completenessScore: null, callbackDatetime: null, callbackDatetimePrecise: null,
  lastCallAttempt: null, lastCallAttemptPrecise: null, propertyAddress: '', phoneStatus: '', callDisposition: '', callRouting: '', dispositionAt: null });
const pipeline = () => ({ pipelineId: 'syn-pipeline', stages: [{ id: 'syn-st-new', name: 'New Lead - Seller' }],
  opportunities: Object.values(PEOPLE).map((p) => ({ id: oppFor(p), contactId: p.id, contactName: `${p.firstName} ${p.lastName}`,
    opportunityName: `${p.firstName} ${p.lastName}`, phone: '+15550100001', email: `${p.id}@example.invalid`, stageId: 'syn-st-new', customFields: [] })) });

function answer(p, fn, u) {
  const q = u.searchParams.get('path') || '';
  switch (fn) {
    case 'app-read-session': return json(200, { signedIn: true, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    case 'ghl-opportunities': return json(200, pipeline());
    case 'ghl-contact': return json(200, contactRow(p));
    case 'ghl-underwriting-policy': return json(200, { values: [] }); /* as test-b15-26-provisional-repairs.cjs */
    case 'ghl-proxy':
      if (q === `/contacts/${p.id}/notes`) return json(200, { notes: p.id === 'syn-scored' ? NOTES : [] });
      if (q === `/contacts/${p.id}`) return json(200, { contact: { ...contactRow(p), customFields: [] } });
      if (q === `/opportunities/${oppFor(p)}`) return json(200, { opportunity: { id: oppFor(p), contactId: p.id, pipelineStageId: 'syn-st-new', customFields: [] } });
      return null;
    default: return null;
  }
}

/* Rail mode, the clearance rule recomputed from geometry, MAO cell and scroll
   padding, measured half-way down the page (where a sticky rail is stuck). */
const RULE_FOCUSABLE = "a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex='-1'])";
function railState(sel) {
  const main = document.querySelector('main');
  const rail = document.querySelector('[data-testid="deal-rail"]');
  main.scrollTop = Math.round((main.scrollHeight - main.clientHeight) / 2);
  const m = main.getBoundingClientRect(); const r = rail.getBoundingClientRect();
  const padTop = parseFloat(getComputedStyle(main).paddingTop);
  const rs = getComputedStyle(rail);
  let need = 0;
  for (const el of main.querySelectorAll(sel)) {
    if (rail.contains(el) || el.disabled || !el.checkVisibility({ visibilityProperty: true })) continue;
    need = Math.max(need, el.getBoundingClientRect().height);
  }
  const room = main.clientHeight - padTop - r.height - 8;
  const mao = document.querySelector('[data-testid="rail-cell-seller-mao"]');
  const b = mao ? mao.getBoundingClientRect() : null;
  const hit = b ? document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) : null;
  return {
    mode: rail.getAttribute('data-rail-mode'), position: rs.position,
    room: Math.round(room * 10) / 10, need: Math.round(need * 10) / 10, ruleSticky: room >= need,
    railHeight: Math.round(r.height),
    sticky: rs.position === 'sticky' && rs.top === '0px' && rs.zIndex === '1',
    stuck: Math.abs(r.top - (m.top + padTop)) < 2 && main.scrollTop > 0,
    maoVisible: !!b && b.top >= m.top && b.bottom <= m.bottom && !!hit && mao.contains(hit),
    scrollPaddingTop: main.style.scrollPaddingTop,
    expected: `${Math.ceil(padTop + r.height + 8)}px`,
  };
}
function chipState() {
  const card = document.querySelector('[data-testid="identity-header"]');
  const group = document.querySelector('[data-testid="identity-scores"]');
  const cs = getComputedStyle(card);
  const contentRight = card.getBoundingClientRect().right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
  const chips = [...group.children].map((c) => c.getBoundingClientRect());
  /* Rows by vertical overlap, not equal tops: the badge and the chips differ in
     height by a pixel or two and are centre-aligned. */
  const rows = [];
  for (const c of chips) { const row = rows.find((r) => c.top < r.bottom && c.bottom > r.top); if (row) { row.top = Math.min(row.top, c.top); row.bottom = Math.max(row.bottom, c.bottom); } else rows.push({ top: c.top, bottom: c.bottom }); }
  return { count: chips.length, pastCardPx: Math.max(0, Math.round(Math.max(...chips.map((c) => c.right)) - contentRight)),
    lines: rows.length, tops: chips.map((c) => Math.round(c.top * 10) / 10), heights: chips.map((c) => Math.round(c.height * 10) / 10) };
}

/* Installed before the app loads: every scroll call made by page script, with
   whether anything OTHER than <main>.scrollTop moved during it (the window,
   main.scrollLeft, every ancestor of <main>). The suite clears it before each
   keyboard step; its own scroll writes happen outside those windows. */
function scrollLogger() {
  window.__scrollLog = [];
  const others = () => {
    const main = document.querySelector('main');
    const out = [window.scrollX, window.scrollY];
    if (main) { out.push(main.scrollLeft); for (let e = main.parentElement; e; e = e.parentElement) out.push(e.scrollLeft, e.scrollTop); }
    return out.join();
  };
  const name = (el) => (el === window ? 'window' : el.tagName.toLowerCase());
  const wrap = (el, what, fn) => { const before = others(); const r = fn(); window.__scrollLog.push({ what, el: name(el), othersMoved: others() !== before }); return r; };
  for (const m of ['scrollIntoView', 'scrollTo', 'scrollBy', 'scroll']) {
    const o = Element.prototype[m];
    Element.prototype[m] = function (...a) { return wrap(this, m, () => o.apply(this, a)); };
  }
  for (const m of ['scrollTo', 'scrollBy', 'scroll']) { const o = window[m]; window[m] = function (...a) { return wrap(window, m, () => o.apply(window, a)); }; }
  for (const prop of ['scrollTop', 'scrollLeft']) {
    const d = Object.getOwnPropertyDescriptor(Element.prototype, prop);
    Object.defineProperty(Element.prototype, prop, { configurable: true, get() { return d.get.call(this); }, set(v) { wrap(this, prop, () => d.set.call(this, v)); } });
  }
}
const badScroll = (log) => log.filter((l) => !(l.what === 'scrollTop' && l.el === 'main' && !l.othersMoved));

/* After a keyboard move: is the focused control FULLY inside the scroll
   viewport vertically (below the rail while it is stuck), and does any of 5
   points on it hit the rail? A control outside the viewport fails the first
   test; the 5-point test alone would score it 0 and pass it. Vertical only:
   horizontal overflow at 480px is deferred. 0.5px allows subpixel rounding. */
function focusUnderRail() {
  const el = document.activeElement;
  const ws = document.querySelector('[data-testid="contact-workspace"]');
  if (!el || !ws || !ws.contains(el)) return { inWorkspace: false };
  const main = document.querySelector('main');
  const m = main.getBoundingClientRect();
  const rail = document.querySelector('[data-testid="deal-rail"]');
  const rr = rail.getBoundingClientRect();
  const b = el.getBoundingClientRect();
  let railPts = 0;
  for (const [x, y] of [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]].map(([fx, fy]) => [b.left + b.width * fx, b.top + b.height * fy])) {
    if (y < m.top || y > m.bottom || x < m.left || x > m.right) continue;
    const hit = document.elementFromPoint(x, y);
    if (hit && !(hit === el || el.contains(hit) || hit.contains(el)) && hit.closest('[data-testid="deal-rail"]')) railPts += 1;
  }
  const label = (el.getAttribute('data-testid') || el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 50);
  const railStuck = main.scrollTop > 0 && Math.abs(rr.top - (m.top + parseFloat(getComputedStyle(main).paddingTop))) < 2;
  const viewTop = m.top + main.clientTop;
  const viewBottom = viewTop + main.clientHeight;
  const top = railStuck && !rail.contains(el) ? Math.max(viewTop, rr.bottom) : viewTop;
  const fullyVisible = b.height > 0 && b.top >= top - 0.5 && b.bottom <= viewBottom + 0.5;
  /* A control taller than the visible band cannot be shown whole: its caret
     line must be visible instead (textarea; a mirror div gives the line box). */
  const fits = b.height <= viewBottom - top + 1;
  let caret = null;
  if (el.tagName === 'TEXTAREA') {
    const cs = getComputedStyle(el);
    const div = document.createElement('div');
    for (const k of ['boxSizing', 'width', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle', 'textTransform', 'wordSpacing', 'tabSize', 'textIndent']) div.style[k] = cs[k];
    Object.assign(div.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', height: 'auto' });
    div.textContent = el.value.slice(0, el.selectionStart);
    const mark = document.createElement('span'); mark.textContent = '\u200b'; div.appendChild(mark);
    document.body.appendChild(div);
    const lineTop = b.top + parseFloat(cs.borderTopWidth) + mark.offsetTop - el.scrollTop;
    const line = [lineTop, lineTop + mark.offsetHeight];
    div.remove();
    caret = { pos: el.selectionStart, line: line.map((x) => Math.round(x * 10) / 10), visible: line[0] >= top - 0.5 && line[1] <= viewBottom + 0.5 };
  }
  /* Where the page's keyboard reveal puts a control it moves down: main's scroll padding edge. */
  const padEdge = Math.round((viewTop + (parseFloat(getComputedStyle(main).scrollPaddingTop) || 0)) * 10) / 10;
  return { inWorkspace: true, inRail: rail.contains(el), railPts, label, railStuck, fullyVisible, fits, caret, scrollTop: main.scrollTop, padEdge,
    rect: [Math.round(b.top * 10) / 10, Math.round(b.bottom * 10) / 10], visible: [Math.round(top * 10) / 10, Math.round(viewBottom * 10) / 10] };
}

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const tailwindcss = (await import('@tailwindcss/vite')).default;
  const { chromium } = require('playwright');
  const mutate = {
    name: 'rail-focus-mutation', enforce: 'pre',
    transform(code, id) {
      if (!MUTATION || !id.replace(/\\/g, '/').endsWith('/src/pages/ContactWorkspace.tsx')) return null;
      const src = code.replace(/\r\n/g, '\n');
      let out = src;
      for (const [from, to] of MUTATIONS[MUTATION]) {
        if (out.split(from).length !== 2) throw new Error(`mutation ${MUTATION}: target not found exactly once`);
        out = out.replace(from, to);
      }
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
  const log = { writes: [], foreign: [], unmodelled: [], pageErrors: [] };

  async function open(person, width) {
    const context = await browser.newContext({ viewport: { width, height: HEIGHT }, timezoneId: 'America/Chicago', locale: 'en-US' });
    await context.addInitScript(scrollLogger);
    const page = await context.newPage();
    page.on('pageerror', (e) => log.pageErrors.push(`${person.id}@${width}: ${String(e)}`));
    await context.route('**/*', async (rt) => {
      const r = rt.request();
      const url = r.url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return rt.continue();
      if (!url.includes('/.netlify/functions/')) { log.foreign.push(url); return rt.abort(); }
      const u = new URL(url);
      const fn = u.pathname.replace('/.netlify/functions/', '');
      const label = `${r.method()} ${fn}${u.searchParams.get('path') ? ` ${u.searchParams.get('path')}` : ''}`;
      if (r.method() !== 'GET') { log.writes.push(label); return rt.fulfill(json(405, { error: 'offline test refuses every write' })); }
      const a = answer(person, fn, u);
      if (a) return rt.fulfill(a);
      log.unmodelled.push(label);
      return rt.fulfill(json(404, { error: `fixture does not model ${label}` }));
    });
    await page.goto(`${base}${HARNESS}?start=${encodeURIComponent(`/contacts/${person.id}`)}`);
    await page.waitForFunction(() => typeof window.__iaosAppSource === 'string', null, { timeout: 90000 });
    await ready(page);
    return { context, page };
  }
  async function ready(page) {
    await page.getByTestId('deal-rail').waitFor({ timeout: 60000 });
    await page.getByTestId('identity-scores').waitFor({ timeout: 60000 });
    await page.waitForFunction(() => document.querySelector('main').scrollHeight > document.querySelector('main').clientHeight * 2, null, { timeout: 60000 });
    await page.waitForTimeout(300);
  }

  const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
  let adjustments = 0;
  async function walk(page, dir) {
    await page.evaluate(([d, sel]) => {
      const main = document.querySelector('main');
      main.scrollTop = d === 'back' ? main.scrollHeight : 0;
      const f = [...document.querySelector('[data-testid="contact-workspace"]').querySelectorAll(sel)].filter((e) => !e.disabled && e.offsetParent !== null);
      (d === 'back' ? f[f.length - 1] : f[0]).focus();
      window.__scrollLog = [];
    }, [dir, FOCUSABLE]);
    const seen = [];
    let prev = null;
    for (let i = 0; i < 120; i += 1) {
      const v = await page.evaluate(focusUnderRail);
      if (!v.inWorkspace) break;
      v.log = await page.evaluate(() => window.__scrollLog.splice(0));
      v.railJump = !!prev && v.inRail && prev.railStuck && v.scrollTop !== prev.scrollTop;
      adjustments += v.log.filter((l) => l.el === 'main' && l.what === 'scrollTop').length;
      seen.push(v);
      prev = v;
      await page.keyboard.press(dir === 'back' ? 'Shift+Tab' : 'Tab');
      await page.waitForTimeout(40);
    }
    return { total: seen.length, stuckSteps: seen.filter((v) => v.railStuck).length,
      under: seen.filter((v) => !v.inRail && v.railPts > 0).map((v) => `${v.label} [${v.railPts}/5]`),
      hidden: seen.filter((v) => v.fits && !v.fullyVisible).map((v) => `${v.label} [${v.rect.join('-')} vs ${v.visible.join('-')}]`),
      tall: seen.filter((v) => !v.fits && !(v.caret && v.caret.visible)).map((v) => `${v.label} caret ${JSON.stringify(v.caret)}`),
      railJumps: seen.filter((v) => v.railJump).map((v) => `${v.label} scrollTop -> ${v.scrollTop}`),
      badScroll: seen.flatMap((v) => badScroll(v.log).map((l) => `${v.label}: ${JSON.stringify(l)}`)) };
  }

  /* One step: mode by the clearance rule, rail / padding / MAO for that mode,
     then Tab and Shift+Tab walks. expect: 'sticky' | 'scrolls' | 'rule' (the
     rule decides; used where fonts move a case across the line).
     previous: main's scroll padding before the Contact page set any. */
  async function railChecks(page, w, expect = 'sticky', previous = '') {
    await page.waitForTimeout(250);
    const s = await page.evaluate(railState, RULE_FOCUSABLE);
    const mode = s.ruleSticky ? 'sticky' : 'scrolls';
    check(`${w}: rail mode follows the clearance rule (room ${s.room}px vs tallest control ${s.need}px -> ${mode})`,
      s.mode === mode && (mode === 'sticky') === (s.position === 'sticky'), JSON.stringify(s));
    if (expect !== 'rule') check(`${w}: rail mode is ${expect}`, s.mode === expect, JSON.stringify(s));
    if (s.mode === 'sticky') {
      check(`${w}: rail sticky (position sticky, top 0, zIndex 1) and stuck`, s.sticky && s.stuck, JSON.stringify(s));
      check(`${w}: Seller MAO cell fully visible while the rail is stuck`, s.maoVisible, JSON.stringify(s));
      check(`${w}: main scroll-padding-top == padding-top + rail height + 8px`, s.scrollPaddingTop === s.expected, `actual ${s.scrollPaddingTop || '(none)'}, expected ${s.expected}, rail ${s.railHeight}px`);
    } else {
      check(`${w}: fallback -- the rail scrolls with the page (position relative, not stuck)`, s.position === 'relative' && !s.stuck, JSON.stringify(s));
      check(`${w}: fallback -- main's previous scroll padding is back (${previous || 'none'})`, s.scrollPaddingTop === previous, `actual ${s.scrollPaddingTop || '(none)'}`);
    }
    for (const dir of ['forward', 'back']) {
      const r = await walk(page, dir);
      const key = dir === 'back' ? 'Shift+Tab' : 'Tab';
      check(`${w}: ${key} visits the workspace controls${s.mode === 'sticky' ? ' with the rail stuck' : ', rail never stuck'} (non-vacuous)`,
        r.total >= 10 && (s.mode === 'sticky' ? r.stuckSteps > 0 : r.stuckSteps === 0), `total ${r.total}, stuck steps ${r.stuckSteps}`);
      check(`${w}: ${key} leaves no focused control under the rail`, r.under.length === 0, r.under.join('; '));
      check(`${w}: ${key} -- every focused control fully visible in the scroll viewport (vertical)`, r.hidden.length === 0, r.hidden.join('; '));
      check(`${w}: ${key} -- a focused control taller than the visible band shows its caret line`, r.tall.length === 0, r.tall.join('; '));
      check(`${w}: ${key} -- entering the stuck rail moves nothing`, r.railJumps.length === 0, r.railJumps.join('; '));
      check(`${w}: ${key} -- every scroll call moved only <main>, vertically (scroll API log)`, r.badScroll.length === 0, r.badScroll.slice(0, 4).join('; '));
    }
    return s;
  }

  /* Test-only rail growth: extra text in one non-MAO cell. */
  const grow = (page) => page.evaluate(() => {
    const before = document.querySelector('[data-testid="deal-rail"]').getBoundingClientRect().height;
    const cell = [...document.querySelectorAll('[data-testid^="rail-cell-"]')].find((c) => c.getAttribute('data-testid') !== 'rail-cell-seller-mao');
    const extra = document.createElement('div');
    extra.setAttribute('data-test-growth', '');
    extra.textContent = 'Test-only extra text standing in for a value replacing a waiting text. '.repeat(3);
    cell.appendChild(extra);
    return Math.round(before);
  });
  const railHeight = (page) => page.evaluate(() => Math.round(document.querySelector('[data-testid="deal-rail"]').getBoundingClientRect().height));
  /* Chromium-only: event listeners registered on <main> itself (CDP). */
  async function mainListeners(page) {
    const cdp = await page.context().newCDPSession(page);
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'document.querySelector("main")' });
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    await cdp.detach();
    return listeners.map((l) => l.type);
  }

  /* Chromium-only: capture keydown/pointerdown listeners on the document whose
     handler is the Contact page's modality tracker (identified by its source). */
  async function modalityListeners(page) {
    const cdp = await page.context().newCDPSession(page);
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'document', objectGroup: 'rf' });
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    const out = [];
    for (const l of listeners) {
      if (!['keydown', 'pointerdown'].includes(l.type) || !l.handler) continue;
      if (/keyTask|byKeyboard/.test(l.handler.description || '')) out.push(l.type);
    }
    await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'rf' });
    await cdp.detach();
    return out;
  }
  const TA = '[data-testid="call-log-notes"]';
  const settle = async (page, n = 8) => {
    const xs = [];
    for (let i = 0; i < n; i += 1) { xs.push(await page.evaluate(() => document.querySelector('main').scrollTop)); await page.waitForTimeout(40); }
    return xs;
  };
  /* Focus a control the way the keyboard does: its tab-order neighbour gets a
     scripted focus({preventScroll}), then one real Tab / Shift+Tab. */
  async function tabInto(page, sel, key) {
    await page.evaluate(([s, k, all]) => {
      const t = document.querySelector(s);
      const f = [...document.querySelector('[data-testid="contact-workspace"]').querySelectorAll(all)].filter((e) => !e.disabled && e.checkVisibility({ visibilityProperty: true }));
      f[f.indexOf(t) + (k === 'Tab' ? -1 : 1)].focus({ preventScroll: true });
      window.__scrollLog = [];
    }, [sel, key, FOCUSABLE]);
    await page.keyboard.press(key);
    await page.waitForTimeout(60);
  }

  try {
    /* 1. Fresh load at each width. */
    for (const width of WIDTHS) {
      const { context, page } = await open(PEOPLE.scored, width);
      const w = `fresh ${width}px`;
      await railChecks(page, w);
      const c = await page.evaluate(chipState);
      check(`${w}: badge and chips inside the header card`, c.count === 4 && c.pastCardPx === 0, JSON.stringify(c));
      if (width >= 1024) check(`${w}: badge and chips on one line`, c.lines === 1, JSON.stringify(c));
      await page.evaluate(() => { const m = document.querySelector('main'); m.scrollTop = 0; m.scrollLeft = 0; });
      await page.screenshot({ path: path.join(OUT, `fresh-${width}-top.png`) });
      await context.close();
    }
    {
      const { context, page } = await open(PEOPLE.unscored, 480);
      const c = await page.evaluate(chipState);
      check('unscored contact 480px: badge and chips inside the header card', c.count === 4 && c.pastCardPx === 0, JSON.stringify(c));
      await context.close();
    }

    /* 2 + 3. Resize without reload, both directions, then rail growth. */
    for (const order of [[1440, 1024, 768, 640, 480], [480, 640, 768, 1024, 1440]]) {
      const tag = order[0] === 1440 ? 'down' : 'up';
      const { context, page } = await open(PEOPLE.scored, order[0]);
      await page.evaluate(() => { window.__noReload = true; });
      for (const width of order) {
        if (width !== order[0]) await page.setViewportSize({ width, height: HEIGHT });
        await railChecks(page, `resize ${tag} ${width}px`);
        await page.screenshot({ path: path.join(OUT, `resize-${tag}-${width}.png`) });
      }
      check(`resize ${tag}: the page was never reloaded`, await page.evaluate(() => window.__noReload === true));
      const last = order[order.length - 1];
      const before = await grow(page);
      const after = await railHeight(page);
      check(`grow ${tag} ${last}px: the rail grew with no resize`, after > before + 20, `before ${before}, after ${after}`);
      await railChecks(page, `grow ${tag} ${last}px`, 'rule');
      await page.screenshot({ path: path.join(OUT, `grow-${tag}-${last}.png`) });
      await page.evaluate(() => document.querySelector('[data-test-growth]').remove());
      await railChecks(page, `ungrown ${tag} ${last}px`, 'sticky');
      check(`grow ${tag}: the page was never reloaded`, await page.evaluate(() => window.__noReload === true));
      await context.close();
    }

    /* Height changes WITHOUT reload: into the fallback and back, with growth. */
    {
      const { context, page } = await open(PEOPLE.scored, 480);
      await page.evaluate(() => { window.__noReload = true; });
      await railChecks(page, 'height 480x900', 'sticky');
      await page.setViewportSize({ width: 480, height: 600 });
      await railChecks(page, 'height 480x600', 'scrolls');
      await page.screenshot({ path: path.join(OUT, 'height-480x600.png') });
      await page.setViewportSize({ width: 480, height: HEIGHT });
      await railChecks(page, 'height 480x600 -> 900', 'sticky');
      await grow(page);
      await railChecks(page, 'height 480x900 grown', 'rule');
      await page.setViewportSize({ width: 480, height: 600 });
      await railChecks(page, 'height 480x600 grown', 'scrolls');
      await page.evaluate(() => document.querySelector('[data-test-growth]').remove());
      await page.setViewportSize({ width: 480, height: HEIGHT });
      await railChecks(page, 'height 480x900 ungrown', 'sticky');
      check('height 480: the page was never reloaded', await page.evaluate(() => window.__noReload === true));
      await context.close();
    }
    {
      const { context, page } = await open(PEOPLE.scored, 1440);
      await page.evaluate(() => { window.__noReload = true; });
      for (const h of [HEIGHT, 520, HEIGHT]) {
        await page.setViewportSize({ width: 1440, height: h });
        await railChecks(page, `height 1440x${h}`, 'sticky');
      }
      check('height 1440: the page was never reloaded', await page.evaluate(() => window.__noReload === true));
      await context.close();
    }

    /* 4. Away and back through the sidebar and browser history. */
    {
      const { context, page } = await open(PEOPLE.scored, 1024);
      await page.evaluate(() => { window.__mainNode = document.querySelector('main'); });
      await railChecks(page, 'before leaving 1024px');
      const onPage = await modalityListeners(page);
      check('on the Contact page: the keydown and pointerdown modality listeners are registered (non-vacuous)', onPage.includes('keydown') && onPage.includes('pointerdown'), JSON.stringify(onPage));
      await page.locator('aside').getByText('Deal Calculator', { exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[data-testid="deal-rail"]'), null, { timeout: 30000 });
      await page.waitForTimeout(400);
      const away = await page.evaluate(() => ({ same: document.querySelector('main') === window.__mainNode, pad: document.querySelector('main').style.scrollPaddingTop }));
      check('away (Deal Calculator): same <main>, its scroll padding back to the previous value (none)', away.same && away.pad === '', JSON.stringify(away));
      /* Resizes while away must not bring the padding back. */
      await page.setViewportSize({ width: 640, height: HEIGHT });
      await page.waitForTimeout(400);
      const awayResized = await page.evaluate(() => document.querySelector('main').style.scrollPaddingTop);
      check('away, after a resize: still no scroll padding (nothing left observing)', awayResized === '', `actual ${awayResized}`);
      const awayListeners = await mainListeners(page);
      check('away: no focus listener left on <main>', !awayListeners.includes('focusin'), JSON.stringify(awayListeners));
      const awayModality = await modalityListeners(page);
      check('away: no keydown/pointerdown modality listener left on the document', awayModality.length === 0, JSON.stringify(awayModality));
      /* A value the page did not set must survive the Contact page's next exit. */
      await page.evaluate(() => { document.querySelector('main').style.scrollPaddingTop = '7px'; });
      await page.goBack();
      await ready(page);
      await railChecks(page, 'back on the Contact page 640px');
      await page.goForward();
      await page.waitForFunction(() => !document.querySelector('[data-testid="deal-rail"]'), null, { timeout: 30000 });
      await page.waitForTimeout(400);
      const restored = await page.evaluate(() => document.querySelector('main').style.scrollPaddingTop);
      check('away again: main\'s previous scroll padding (7px) restored, not cleared or left at the rail value', restored === '7px', `actual ${restored || '(none)'}`);
      await page.setViewportSize({ width: 1440, height: HEIGHT });
      await page.waitForTimeout(400);
      const restoredResized = await page.evaluate(() => document.querySelector('main').style.scrollPaddingTop);
      check('away again, after a resize: still 7px', restoredResized === '7px', `actual ${restoredResized || '(none)'}`);
      await context.close();
    }
    /* 5. Leave and return while in the FALLBACK. */
    {
      const { context, page } = await open(PEOPLE.scored, 480);
      await page.setViewportSize({ width: 480, height: 600 });
      await railChecks(page, 'fallback before leaving 480x600', 'scrolls');
      await page.locator('aside').getByText('Deal Calculator', { exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[data-testid="deal-rail"]'), null, { timeout: 30000 });
      await page.waitForTimeout(400);
      const away = await page.evaluate(() => document.querySelector('main').style.scrollPaddingTop);
      check('fallback, away: main\'s scroll padding is the previous value (none)', away === '', `actual ${away || '(none)'}`);
      check('fallback, away: no focus listener left on <main>', !(await mainListeners(page)).includes('focusin'));
      await page.evaluate(() => { document.querySelector('main').style.scrollPaddingTop = '7px'; });
      await page.goBack();
      await ready(page);
      await railChecks(page, 'fallback, back on the Contact page 480x600', 'scrolls', '7px');
      await page.setViewportSize({ width: 480, height: HEIGHT });
      await railChecks(page, 'fallback -> sticky after return 480x900', 'sticky');
      await page.goForward();
      await page.waitForFunction(() => !document.querySelector('[data-testid="deal-rail"]'), null, { timeout: 30000 });
      await page.waitForTimeout(400);
      const restored = await page.evaluate(() => document.querySelector('main').style.scrollPaddingTop);
      check('fallback, away again: main\'s previous scroll padding (7px) restored', restored === '7px', `actual ${restored || '(none)'}`);
      await context.close();
    }
    /* 6. Pointer focus: no extra scroll; caret and selection where the pointer put them. */
    {
      const { context, page } = await open(PEOPLE.scored, 480);
      await page.locator(TA).fill('line one\nline two\nline three');
      const cutAtBottom = () => page.evaluate((sel) => {
        const t = document.querySelector(sel); const m = document.querySelector('main');
        document.activeElement.blur();
        t.scrollTop = 0;
        const view = m.getBoundingClientRect().top + m.clientTop + m.clientHeight;
        m.scrollTop += t.getBoundingClientRect().bottom - (view + 20);
        window.__scrollLog = [];
        const b = t.getBoundingClientRect(); const cs = getComputedStyle(t);
        return { top: b.top, left: b.left, bottom: b.bottom, view, scrollTop: m.scrollTop, line: parseFloat(cs.lineHeight) || 16,
          x0: b.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth), y0: b.top + parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth) };
      }, TA);
      const after = () => page.evaluate((sel) => { const t = document.querySelector(sel); return { focused: document.activeElement === t, sel: [t.selectionStart, t.selectionEnd],
        scrollTop: document.querySelector('main').scrollTop, log: window.__scrollLog.splice(0),
        cutPx: Math.round(t.getBoundingClientRect().bottom - (document.querySelector('main').getBoundingClientRect().top + document.querySelector('main').clientTop + document.querySelector('main').clientHeight)) }; }, TA);
      const c = await cutAtBottom();
      check('pointer 480px: the notes textarea starts cut at the bottom edge (non-vacuous)', c.bottom > c.view + 10 && c.top < c.view, JSON.stringify(c));
      await page.mouse.click(c.x0 + 30, c.y0 + c.line * 1.5);
      await page.waitForTimeout(150);
      const a1 = await after();
      check('pointer 480px: a click focuses the textarea and puts the caret on the clicked line (line two)', a1.focused && a1.sel[0] === a1.sel[1] && a1.sel[0] >= 9 && a1.sel[0] <= 17, JSON.stringify(a1));
      check('pointer 480px: the click scrolls nothing (no extra reveal)', a1.scrollTop === c.scrollTop && a1.log.length === 0, JSON.stringify({ before: c.scrollTop, ...a1 }));
      const c2 = await cutAtBottom();
      await page.mouse.move(c2.x0 + 1, c2.y0 + c2.line * 0.5);
      await page.mouse.down();
      await page.mouse.move(c2.x0 + 40, c2.y0 + c2.line * 1.5, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(150);
      const a2 = await after();
      check('pointer 480px: a drag selects from line one into line two', a2.focused && a2.sel[0] === 0 && a2.sel[1] > 9, JSON.stringify(a2));
      /* The browser may scroll a few px to follow the selection; that is its
         own behaviour. The page must add nothing: no scroll call, and the box
         is still cut at the bottom edge (no reveal). */
      check('pointer 480px: the drag makes no scroll call and reveals nothing (the box is still cut at the bottom edge)', a2.log.length === 0 && a2.cutPx > 0, JSON.stringify({ before: c2.scrollTop, ...a2 }));
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await page.waitForTimeout(80);
      const k = await page.evaluate(focusUnderRail);
      check('pointer 480px, then Shift+Tab / Tab back: keyboard focus on the textarea is fully visible again', k.label === 'call-log-notes' && k.fullyVisible && k.railPts === 0, JSON.stringify(k));
      await context.close();
    }

    /* 7. Entering the stuck rail (Spock 1). */
    for (const width of [480, 1440]) {
      const { context, page } = await open(PEOPLE.scored, width);
      for (const key of ['Shift+Tab', 'Tab']) {
        const s0 = await page.evaluate(([k, all]) => {
          const m = document.querySelector('main');
          const mid = Math.round((m.scrollHeight - m.clientHeight) / 2);
          m.scrollTop = mid;
          const btn = document.querySelector('[data-testid="deal-rail"]').querySelector(all);
          const f = [...document.querySelector('[data-testid="contact-workspace"]').querySelectorAll(all)].filter((e) => !e.disabled && e.offsetParent !== null);
          f[f.indexOf(btn) + (k === 'Tab' ? -1 : 1)].focus({ preventScroll: true });
          window.__scrollLog = [];
          return { set: mid, scrollTop: m.scrollTop, target: btn.getAttribute('data-testid') || btn.textContent.trim() };
        }, [key, FOCUSABLE]);
        await page.waitForTimeout(80);
        const s1 = await page.evaluate(() => document.querySelector('main').scrollTop);
        check(`rail entry ${width}px ${key}: a scripted focus({preventScroll}) is not moved`, s0.scrollTop === s0.set && s1 === s0.set, JSON.stringify({ ...s0, later: s1 }));
        await page.keyboard.press(key);
        await page.waitForTimeout(80);
        const v = await page.evaluate(focusUnderRail);
        const log = await page.evaluate(() => window.__scrollLog.splice(0));
        check(`rail entry ${width}px ${key}: focus on the stuck rail's control (${s0.target}) and the page did not move`, v.inRail && v.railStuck && v.fullyVisible && v.scrollTop === s0.set && badScroll(log).length === 0,
          JSON.stringify({ before: s0.set, v, log }));
        const st = await page.evaluate(railState, RULE_FOCUSABLE);
        check(`rail entry ${width}px ${key}: scroll padding back to padding-top + rail + 8px after the frame`, st.scrollPaddingTop === st.expected, JSON.stringify(st));
      }
      /* Leaving the rail downward again is ordinary keyboard focus. */
      await page.evaluate(() => { const m = document.querySelector('main'); m.scrollTop = Math.round((m.scrollHeight - m.clientHeight) / 2); });
      await page.keyboard.press('Tab');
      await page.waitForTimeout(80);
      const out = await page.evaluate(focusUnderRail);
      check(`rail entry ${width}px: Tab out of the rail shows the next control below it`, !out.inRail && out.fullyVisible && out.railPts === 0, JSON.stringify(out));
      await context.close();
    }

    /* 8. Keyboard focus held while the fallback returns to sticky (Spock 2). */
    for (const place of ['low', 'high']) {
      const { context, page } = await open(PEOPLE.scored, 480);
      await page.setViewportSize({ width: 480, height: 600 });
      await railChecks(page, `keep ${place}: fallback 480x600`, 'scrolls');
      await tabInto(page, TA, 'Tab');
      const before = await page.evaluate(([sel, where]) => {
        const t = document.querySelector(sel); const m = document.querySelector('main');
        const top = m.getBoundingClientRect().top + m.clientTop;
        const b = t.getBoundingClientRect();
        m.scrollTop += where === 'high' ? b.top - (top + 10) : b.bottom - (top + m.clientHeight - 10);
        window.__scrollLog = [];
        return { focused: document.activeElement === t, scrollTop: m.scrollTop, top: t.getBoundingClientRect().top };
      }, [TA, place]);
      await page.setViewportSize({ width: 480, height: HEIGHT });
      await page.waitForTimeout(300);
      /* Measure the focus first: railState scrolls the page to measure. */
      const v = await page.evaluate(focusUnderRail);
      const log = await page.evaluate(() => window.__scrollLog.splice(0));
      const xs = await settle(page);
      const st = await page.evaluate(railState, RULE_FOCUSABLE);
      check(`keep ${place}: sticky again at 480x900 with keyboard focus still on the notes textarea`, before.focused && st.mode === 'sticky' && v.label === 'call-log-notes', JSON.stringify({ before, mode: st.mode, focus: v.label }));
      check(`keep ${place}: the focused control is fully visible and clear of the stuck rail`, v.fullyVisible && v.railPts === 0, JSON.stringify(v));
      check(`keep ${place}: moved only to the edge of the visible band (scroll padding edge or bottom), by a vertical <main> write, or not at all`,
        badScroll(log).length === 0 && (log.length === 0 || Math.abs(v.rect[0] - v.padEdge) <= 1 || Math.abs(v.rect[1] - v.visible[1]) <= 1), JSON.stringify({ before, log, v }));
      if (place === 'high') check('keep high: the control was under the returning rail, so it was moved (non-vacuous)', log.length > 0, JSON.stringify(log));
      check(`keep ${place}: nothing keeps moving afterwards`, xs.every((x) => x === xs[0]), JSON.stringify(xs));
      for (const key of ['Tab', 'Shift+Tab']) {
        await page.keyboard.press(key);
        await page.waitForTimeout(80);
        const n = await page.evaluate(focusUnderRail);
        check(`keep ${place}: ${key} afterwards reaches a control fully visible and clear of the rail`, n.inWorkspace && n.fullyVisible && (n.inRail || n.railPts === 0), JSON.stringify(n));
      }
      await context.close();
    }

    /* 9. Oversized textarea: the user enlarges it past the room (Jess: the pin
       may be released, desktop included). */
    for (const width of [1440, 480]) {
      const { context, page } = await open(PEOPLE.scored, width);
      const w = `oversized ${width}px`;
      await page.locator(TA).fill(Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n'));
      await page.evaluate((sel) => {
        const rail = document.querySelector('[data-testid="deal-rail"]');
        window.__modes = [];
        new MutationObserver(() => window.__modes.push(rail.getAttribute('data-rail-mode'))).observe(rail, { attributes: true, attributeFilter: ['data-rail-mode'] });
        document.activeElement.blur();
        /* What the resize handle writes: an inline height. */
        document.querySelector(sel).style.height = `${document.querySelector('main').clientHeight + 300}px`;
      }, TA);
      await page.waitForTimeout(600);
      const s = await page.evaluate(railState, RULE_FOCUSABLE);
      check(`${w}: enlarged past the room, the rail scrolls (rule: room ${s.room}px vs ${s.need}px)`, s.mode === 'scrolls' && !s.ruleSticky && s.position === 'relative', JSON.stringify(s));
      check(`${w}: one switch, no flapping`, JSON.stringify(await page.evaluate(() => window.__modes)) === '["scrolls"]', JSON.stringify(await page.evaluate(() => window.__modes)));
      for (const [key, at] of [['Tab', 'start'], ['Shift+Tab', 'end']]) {
        await page.evaluate(([sel, k, a]) => {
          const t = document.querySelector(sel); const m = document.querySelector('main');
          const pos = a === 'start' ? 0 : t.value.length;
          t.setSelectionRange(pos, pos);
          const top = m.getBoundingClientRect().top + m.clientTop;
          const b = t.getBoundingClientRect();
          /* Start off-screen on the side the key comes from. */
          m.scrollTop += k === 'Tab' ? b.top - (top + m.clientHeight + 40) : b.bottom - (top - 40);
        }, [TA, key, at]);
        await tabInto(page, TA, key);
        const xs = await settle(page);
        const v = await page.evaluate(focusUnderRail);
        const log = await page.evaluate(() => window.__scrollLog.splice(0));
        check(`${w}: ${key} in, caret at the ${at}: the textarea is taller than the band and its caret line is visible`,
          v.label === 'call-log-notes' && !v.fits && v.caret && v.caret.visible && v.caret.pos === (at === 'start' ? 0 : v.caret.pos) && v.railPts === 0, JSON.stringify(v));
        check(`${w}: ${key} in: no custom adjustment for a control that cannot be shown whole, and it settles`,
          log.length === 0 && xs.every((x) => x === xs[0]), JSON.stringify({ log, xs }));
        const typed = await page.evaluate((sel) => document.querySelector(sel).value.length, TA);
        await page.keyboard.type('x');
        for (let i = 0; i < 3; i += 1) await page.keyboard.press(at === 'start' ? 'ArrowDown' : 'ArrowUp');
        await page.waitForTimeout(80);
        const ys = await settle(page);
        const k2 = await page.evaluate(focusUnderRail);
        check(`${w}: ${key} in: typing and arrow keys work and keep the caret line visible, settled`,
          (await page.evaluate((sel) => document.querySelector(sel).value.length, TA)) === typed + 1 && k2.caret && k2.caret.visible && ys.every((y) => y === ys[0]), JSON.stringify({ k2, ys }));
      }
      /* Shrunk back with keyboard focus still in it. */
      await page.evaluate((sel) => { window.__scrollLog = []; document.querySelector(sel).style.height = ''; }, TA);
      await page.waitForTimeout(400);
      const back = await page.evaluate(railState, RULE_FOCUSABLE);
      check(`${w}: shrunk back, sticky returns (rule) with padding restored`, back.mode === 'sticky' && back.ruleSticky && back.scrollPaddingTop === back.expected, JSON.stringify(back));
      /* A real shrink is a pointer drag, so nothing re-reveals the box; the
         keyboard must still reach it whole. */
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await page.waitForTimeout(80);
      const v = await page.evaluate(focusUnderRail);
      check(`${w}: shrunk back, Shift+Tab / Tab returns to the textarea fully visible and clear of the rail`, v.label === 'call-log-notes' && v.fullyVisible && v.railPts === 0, JSON.stringify(v));
      check(`${w}: modes seen: scrolls, then sticky`, JSON.stringify(await page.evaluate(() => window.__modes)) === '["scrolls","sticky"]', JSON.stringify(await page.evaluate(() => window.__modes)));
      await context.close();
    }

    /* 10. A taller control enabled / made visible with no size change. */
    {
      const { context, page } = await open(PEOPLE.scored, 1440);
      const s0 = await page.evaluate(railState, RULE_FOCUSABLE);
      const h = Math.round(s0.room + 40);
      await page.evaluate((height) => {
        const box = document.createElement('div');
        box.setAttribute('data-test-tall-box', '');
        box.style.height = `${height + 20}px`;
        const t = document.createElement('textarea');
        t.setAttribute('data-testid', 'test-tall');
        t.style.height = `${height}px`;
        t.disabled = true;
        box.appendChild(t);
        document.querySelector('[data-testid="contact-workspace"]').appendChild(box);
      }, h);
      await page.waitForTimeout(300);
      const s1 = await page.evaluate(railState, RULE_FOCUSABLE);
      check(`no-resize 1440px: a disabled ${h}px control (room ${s1.room}px) leaves the rail sticky`, s1.mode === 'sticky' && s1.ruleSticky, JSON.stringify(s1));
      for (const how of ['enabled', 'made visible']) {
        if (how === 'made visible') {
          await page.evaluate(() => { const t = document.querySelector('[data-testid="test-tall"]'); t.style.visibility = 'hidden'; t.disabled = false; });
          await page.waitForTimeout(300);
          const s2 = await page.evaluate(railState, RULE_FOCUSABLE);
          check('no-resize 1440px: the tall control hidden (visibility) leaves the rail sticky', s2.mode === 'sticky' && s2.ruleSticky, JSON.stringify(s2));
        }
        const r = await page.evaluate(async (way) => {
          const t = document.querySelector('[data-testid="test-tall"]');
          const rail = document.querySelector('[data-testid="deal-rail"]');
          const sizes = () => [t.parentElement.getBoundingClientRect().height, rail.parentElement.getBoundingClientRect().height, document.querySelector('main').clientHeight, rail.getBoundingClientRect().height].join();
          const before = sizes();
          if (way === 'enabled') t.disabled = false; else t.style.visibility = 'visible';
          await Promise.resolve();
          return { mode: rail.getAttribute('data-rail-mode'), position: getComputedStyle(rail).position, sameSizes: sizes() === before };
        }, how);
        check(`no-resize 1440px: ${how} with no size change -> the rail scrolls before the next task (before keyboard focus can need it)`,
          r.mode === 'scrolls' && r.position === 'relative' && r.sameSizes, JSON.stringify(r));
        await tabInto(page, '[data-testid="test-tall"]', 'Tab');
        const v = await page.evaluate(focusUnderRail);
        check(`no-resize 1440px: ${how}, Tab shows it whole (it fits without the stuck rail)`, v.label === 'test-tall' && v.fits && v.fullyVisible && v.railPts === 0, JSON.stringify(v));
        await page.evaluate(() => document.activeElement.blur());
        const r2 = await page.evaluate(async (way) => {
          const t = document.querySelector('[data-testid="test-tall"]');
          if (way === 'enabled') t.disabled = true; else t.style.visibility = 'hidden';
          await Promise.resolve();
          return document.querySelector('[data-testid="deal-rail"]').getAttribute('data-rail-mode');
        }, how);
        check(`no-resize 1440px: ${how} reverted -> sticky again before the next task`, r2 === 'sticky', r2);
      }
      await page.evaluate(() => document.querySelector('[data-test-tall-box]').remove());
      await railChecks(page, 'no-resize 1440px: test control removed', 'sticky');
      await context.close();
    }
    check(`the keyboard reveal made vertical <main> adjustments during the walks (non-vacuous): ${adjustments}`, adjustments > 0);
  } catch (e) {
    check('run completed', false, String(e && e.message || e).split('\n')[0]);
  }
  if (MUTATION) check(`mutation ${MUTATION} applied in the dev server`, mutationApplied);
  check('offline: no writes, no foreign requests, no page errors',
    log.writes.length === 0 && log.foreign.length === 0 && log.pageErrors.length === 0, JSON.stringify({ writes: log.writes, foreign: log.foreign, pageErrors: log.pageErrors }));
  console.log(`unmodelled GETs answered 404: ${log.unmodelled.length}${log.unmodelled.length ? ` (${[...new Set(log.unmodelled)].join('; ')})` : ''}`);
  console.log(`\nB15 narrow-width rail focus + chip wrap${MUTATION ? ` [MUTATION ${MUTATION}]` : ''}: ${checks - failures}/${checks} checks passed`);
  clearTimeout(watchdog);
  await browser.close().catch(() => {});
  await server.close().catch(() => {});
  process.exit(failures ? 1 : 0);
}
const OUT = process.env.RAIL_FOCUS_SHOTS || path.join(require('node:os').tmpdir(), 'b15-rail-focus');
fs.mkdirSync(OUT, { recursive: true });
main();
