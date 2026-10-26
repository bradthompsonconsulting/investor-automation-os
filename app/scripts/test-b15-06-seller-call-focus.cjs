/**
 * B15-06 (Jess, 2026-10-26) -- Seller Call desktop keyboard focus and the
 * read-only Notes history panel.
 *
 * OFFLINE, MOCKED BROWSER: the real App (app-routes harness: real Layout and
 * its <main> scroll container) on the real Seller Call page, with GHL data
 * from scripts/harness/seller-call-offer-ready-fixture.cjs plus 40 invented
 * plain notes. Every function GET is answered from the fixture (unmodelled
 * GETs get a 404 and are counted); every non-localhost request is aborted;
 * every non-GET is refused and fails the run (the page writes nothing here).
 *
 * The sticky deal bar uses the accepted PR #147 clearance (lib/rail-clearance.ts):
 *   room = main.clientHeight - main padding-top - bar height - 8px
 *   need = tallest rendered, visible, enabled focusable control in <main>
 *          outside the bar and outside the side column while it is sticky
 *   room >= need -> sticky, scroll-padding-top = padding-top + bar + 8px;
 *   room <  need -> the bar scrolls with the page (measured fallback).
 * Checks, per viewport and panel state:
 *   1. Mode by the rule (recomputed here); sticky at 1440x900 in every state.
 *   2. Tab and Shift+Tab through the whole Seller Call shell: every focused
 *      control fully visible (vertical), none under the bar, the walk is
 *      non-vacuous (bar stuck), focus entering the stuck bar or the sticky
 *      side column moves nothing, every scroll call writes only
 *      <main>.scrollTop. Horizontal position is NOT asserted (deferred).
 *      While the bar is stuck, scrolling one of its controls into view other
 *      than by keyboard (Playwright's pointer path, as assistive technology
 *      would) moves nothing: the compact Call hid itself when it did. The
 *      sticky side column is measured and printed as NOTE, not asserted.
 *   3. The bar's figures, every answer value and the selected deal are the
 *      same after the walks.
 *   4. Fallback: a test-only growth of the bar past the room releases it;
 *      focus stays clear; removing it restores sticky with the focused
 *      control kept clear.
 *   5. Notes: starts closed; opens from the bar by keyboard and takes focus;
 *      lists this contact's notes newest first (system records summarized)
 *      with no new read; Escape and the close button return focus to the
 *      Notes button; script and Notes open together without overlap; the
 *      panel never shows another contact's notes while that contact loads.
 *   6. Cleanup: leaving Seller Call restores <main>'s previous scroll
 *      padding and leaves no listener; Contact -> Seller Call -> Contact
 *      hands over cleanly.
 *   7. 480x900: mode by the rule, no focused control under the bar (layout
 *      not asserted; the mobile redesign is deferred).
 *
 * SC_FOCUS_MUTATION=<name> rewrites SellerCallWorkspace.tsx /
 * lib/rail-clearance.ts IN THE DEV SERVER ONLY (no file is touched); see
 * scripts/test-b15-06-seller-call-focus-mutations.cjs.
 *
 *   node scripts/test-b15-06-seller-call-focus.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
require('./harness/ts-loader.cjs');
const fx = require('./harness/seller-call-offer-ready-fixture.cjs');

const APP = path.resolve(__dirname, '..');
const HARNESS = '/scripts/harness/app-routes/index.html';
const A = fx.CONTACT;
const B = 'syn-other-contact';
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const watchdog = setTimeout(() => { console.error('FAIL  did not finish within 14 minutes'); process.exit(1); }, 14 * 60_000);

const PLAIN = Array.from({ length: 40 }, (_, i) => ({ id: `syn-plain-${i}`, dateAdded: new Date(Date.UTC(2026, 8, 1 + (i % 28), 10 + (i % 7))).toISOString(),
  body: `Synthetic plain note ${i + 1}: seller mentioned timing and condition. Invented text for an offline check.` }));

const FITS = '      const fits = scroller.clientHeight - padTop - railHeight - RAIL_GAP >= need;\n';
const LISTEN = '    scroller.addEventListener("focusin", reveal);\n';
const MUTATIONS = {
  off: [['  useRailClearance(stickyBarEl, ".seller-call-side");\n', '\n']],
  nopinned: [['useRailClearance(stickyBarEl, ".seller-call-side")', 'useRailClearance(stickyBarEl)']],
  static: [['    [rail, scroller, rail.parentElement].forEach((el) => { if (el) observer?.observe(el); });\n', '\n'],
    ['    mutations?.observe(scroller, { subtree: true, childList: true, attributes: true, attributeFilter: RAIL_WATCHED });\n', '\n']],
  nocleanup: [['\n      scroller.style.scrollPaddingTop = previous;\n      rail.style.position', '\n      rail.style.position']],
  nofallback: [[FITS, '      const fits = true;\n'], [LISTEN, '\n']],
  noreveal: [[LISTEN, '\n']],
  nomargin: [['            className="seller-call-sticky-bar"\n', '\n']],
  railjump: [['      if (sticky() && rail.contains(el)) {\n', '      if (false) {\n'], ['            className="seller-call-sticky-bar"\n', '\n']],
  nopinnedreveal: [['      if (inPinned(el)) {\n', '      if (false) {\n']],
  nokeep: [['      if (kept) show(kept);\n', '\n']],
  nomodalitycleanup: [['      document.removeEventListener("keydown", onKey, true);\n', '\n']],
  notesopen: [['  const [notesOpen, setNotesOpen] = useState(false);\n', '  const [notesOpen, setNotesOpen] = useState(true);\n']],
  notesstale: [['notes={notesReady ? notes : null}', 'notes={notes}']],
  nofocusreturn: [['{ setNotesOpen(false); notesToggleRef.current?.focus(); }', '{ setNotesOpen(false); }']],
};
const MUTATION = process.env.SC_FOCUS_MUTATION || '';
if (MUTATION && !MUTATIONS[MUTATION]) { console.error(`FAIL  unknown SC_FOCUS_MUTATION ${MUTATION}`); process.exit(2); }
const MUTATION_FILES = ['/src/pages/SellerCallWorkspace.tsx', '/src/lib/rail-clearance.ts'];
const mutationTarget = new Map();
let mutationsDone = 0;
let mutationApplied = false;
if (MUTATION) {
  for (const m of MUTATIONS[MUTATION]) {
    const found = MUTATION_FILES.map((f) => [f, fs.readFileSync(path.join(APP, f), 'utf8').replace(/\r\n/g, '\n').split(m[0]).length - 1]).filter(([, n]) => n > 0);
    if (found.length !== 1 || found[0][1] !== 1) { console.error(`FAIL  mutation ${MUTATION}: target not found exactly once across ${MUTATION_FILES.join(', ')}`); process.exit(2); }
    mutationTarget.set(m, found[0][0]);
  }
}

let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` -- ${detail}` : ''}`); }
}

/* ---------- in-page probes (serialized into the page) ---------- */

const RULE_FOCUSABLE = "a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex='-1'])";
/* Bar mode, the clearance rule recomputed from geometry, and the scroll
   padding, measured half-way down the page (where a sticky bar is stuck). */
function barState(sel) {
  const main = document.querySelector('main');
  const bar = document.querySelector('[data-testid="seller-call-sticky-bar"]');
  const side = document.querySelector('.seller-call-side');
  const sideSticky = !!side && getComputedStyle(side).position === 'sticky';
  main.scrollTop = Math.round((main.scrollHeight - main.clientHeight) / 2);
  const m = main.getBoundingClientRect(); const r = bar.getBoundingClientRect();
  const padTop = parseFloat(getComputedStyle(main).paddingTop);
  const bs = getComputedStyle(bar);
  let need = 0;
  for (const el of main.querySelectorAll(sel)) {
    if (bar.contains(el) || el.disabled || !el.checkVisibility({ visibilityProperty: true }) || (sideSticky && side.contains(el))) continue;
    need = Math.max(need, el.getBoundingClientRect().height);
  }
  const room = main.clientHeight - padTop - r.height - 8;
  return {
    mode: bar.getAttribute('data-rail-mode'), position: bs.position, zIndex: bs.zIndex, top: bs.top,
    room: Math.round(room * 10) / 10, need: Math.round(need * 10) / 10, ruleSticky: room >= need, barHeight: Math.round(r.height),
    stuck: Math.abs(r.top - (m.top + padTop)) < 2 && main.scrollTop > 0,
    scrollPaddingTop: main.style.scrollPaddingTop, expected: `${Math.ceil(padTop + r.height + 8)}px`, sideSticky,
  };
}
/* Installed before the app loads: every scroll call made by page script, and
   whether anything OTHER than <main>.scrollTop moved during it. */
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
/* Scroll calls other than <main>.scrollTop. A side panel's own inner scroll
   (the browser keeping a focused note in view) is not a page script call. */
const badScroll = (log) => log.filter((l) => !(l.what === 'scrollTop' && l.el === 'main' && !l.othersMoved));

/* After a keyboard move: is the focused control FULLY inside the scroll
   viewport vertically (below the bar while it is stuck), and does any of 5
   points on it hit the bar? Vertical only. 0.5px allows subpixel rounding. */
function focusProbe() {
  const el = document.activeElement;
  const shell = document.querySelector('[data-testid="seller-call-shell"]');
  if (!el || !shell || !shell.contains(el)) return { inShell: false };
  const main = document.querySelector('main');
  const m = main.getBoundingClientRect();
  const bar = document.querySelector('[data-testid="seller-call-sticky-bar"]');
  const side = document.querySelector('.seller-call-side');
  const rr = bar.getBoundingClientRect();
  const b = el.getBoundingClientRect();
  let barPts = 0;
  for (const [x, y] of [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]].map(([fx, fy]) => [b.left + b.width * fx, b.top + b.height * fy])) {
    if (y < m.top || y > m.bottom || x < m.left || x > m.right) continue;
    const hit = document.elementFromPoint(x, y);
    if (hit && !(hit === el || el.contains(hit) || hit.contains(el)) && hit.closest('[data-testid="seller-call-sticky-bar"]')) barPts += 1;
  }
  const label = (el.getAttribute('data-testid') || el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 50);
  const barStuck = main.scrollTop > 0 && Math.abs(rr.top - (m.top + parseFloat(getComputedStyle(main).paddingTop))) < 2;
  const inSide = !!side && side.contains(el);
  const sideSticky = !!side && getComputedStyle(side).position === 'sticky';
  const viewTop = m.top + main.clientTop;
  const viewBottom = viewTop + main.clientHeight;
  const top = barStuck && !bar.contains(el) && !(inSide && sideSticky) ? Math.max(viewTop, rr.bottom) : viewTop;
  /* Inside a side panel the panel's own scroll box is the viewport. */
  const box = inSide ? el.closest('.full-script-panel, .seller-call-notes-panel') : null;
  const bb = box ? box.getBoundingClientRect() : null;
  const vTop = bb ? Math.max(top, bb.top) : top;
  const vBottom = bb ? Math.min(viewBottom, bb.bottom) : viewBottom;
  const fullyVisible = b.height > 0 && b.top >= vTop - 0.5 && b.bottom <= vBottom + 0.5;
  const fits = b.height <= vBottom - vTop + 1;
  /* Fits the whole viewport (or its panel) but not the band below a stuck bar:
     hidden behind the bar, never excused as "too tall" (the clearance rule
     guarantees the band holds every control while the bar is sticky). */
  const fitsView = b.height <= (bb ? Math.min(viewBottom, bb.bottom) - Math.max(viewTop, bb.top) : viewBottom - viewTop) + 1;
  return { inShell: true, inBar: bar.contains(el), inSide, sideSticky, barPts, label, barStuck, fullyVisible, fits, fitsView, scrollTop: main.scrollTop,
    rect: [Math.round(b.top * 10) / 10, Math.round(b.bottom * 10) / 10], visible: [Math.round(vTop * 10) / 10, Math.round(vBottom * 10) / 10] };
}
/* The bar's figures, every answer value in the workspace, the deal name. */
function pageState() {
  const bar = document.querySelector('[data-testid="seller-call-sticky-bar"]');
  const ws = document.querySelector('.seller-call-shell__main');
  const values = [...ws.querySelectorAll('input, textarea, select')].map((e) => `${e.getAttribute('data-testid') || e.getAttribute('placeholder') || e.name || e.tagName}=${e.type === 'checkbox' || e.type === 'radio' ? e.checked : e.value}`);
  /* The bar's left column: DealBar figures and the readiness badge (not the Call / Notes / Save buttons). */
  const left = bar && bar.firstElementChild && bar.firstElementChild.firstElementChild;
  return { figures: left ? left.innerText.split('\n').map((t) => t.trim()).filter(Boolean) : null, values, url: location.pathname };
}

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const tailwindcss = (await import('@tailwindcss/vite')).default;
  const { chromium } = require('playwright');
  const mutate = {
    name: 'seller-call-focus-mutation', enforce: 'pre',
    transform(code, id) {
      const file = MUTATION_FILES.find((f) => id.replace(/\\/g, '/').endsWith(f));
      if (!MUTATION || !file) return null;
      let out = code.replace(/\r\n/g, '\n');
      for (const [from, to] of MUTATIONS[MUTATION].filter((m) => mutationTarget.get(m) === file)) {
        if (out.split(from).length !== 2) throw new Error(`mutation ${MUTATION}: target not found exactly once`);
        out = out.replace(from, to);
        mutationsDone += 1;
      }
      mutationApplied = mutationsDone === MUTATIONS[MUTATION].length;
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
  const log = { writes: [], foreign: [], unmodelled: new Set(), pageErrors: [], notesReads: 0 };
  let delayFor = null;

  fx.reset();
  fx.state.notes.push(...PLAIN);

  async function open(width, height, start = `/contacts/${A}/seller-call`) {
    const context = await browser.newContext({ viewport: { width, height }, timezoneId: 'America/Chicago', locale: 'en-US' });
    await context.addInitScript(scrollLogger);
    const page = await context.newPage();
    page.on('pageerror', (e) => log.pageErrors.push(`${width}x${height}: ${String(e)}`));
    await context.route('**/*', async (rt) => {
      const r = rt.request();
      const url = r.url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return rt.continue();
      if (!url.includes('/.netlify/functions/')) { log.foreign.push(url); return rt.abort(); }
      const u = new URL(url);
      const fn = u.pathname.replace('/.netlify/functions/', '');
      const label = `${r.method()} ${fn}${u.searchParams.get('path') ? ` ${u.searchParams.get('path')}` : ''}`;
      if (r.method() !== 'GET') { log.writes.push(label); return rt.fulfill(json(405, { error: 'offline test refuses every write' })); }
      if (fn === 'app-read-session') return rt.fulfill(json(200, { signedIn: true, expiresAt: new Date(Date.now() + 3600_000).toISOString() }));
      const req = fx.classify(url, 'GET', null);
      if (req.kind === 'notes') log.notesReads += 1;
      if (delayFor && url.includes(delayFor)) await new Promise((res) => setTimeout(res, 2500));
      const a = fx.answer(req);
      if (a.status === 404 && /fixture does not model/.test(a.body.error || '')) log.unmodelled.add(label);
      return rt.fulfill(json(a.status, a.body));
    });
    await page.goto(`${base}${HARNESS}?start=${encodeURIComponent(start)}`);
    await page.waitForFunction(() => typeof window.__iaosAppSource === 'string', null, { timeout: 90000 });
    return { context, page };
  }
  const ready = async (page) => {
    await page.getByTestId('seller-call-sticky-bar').waitFor({ timeout: 60000 });
    await page.getByTestId('seller-call-notes-toggle').waitFor({ timeout: 60000 });
    await page.waitForFunction(() => document.querySelector('main').scrollHeight > document.querySelector('main').clientHeight * 1.5, null, { timeout: 60000 });
    await page.waitForTimeout(400);
  };
  const navigate = (page, to) => page.evaluate((p) => { window.history.pushState(null, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, to);

  const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
  async function walk(page, dir) {
    await page.evaluate(([d, sel]) => {
      const main = document.querySelector('main');
      main.scrollTop = d === 'back' ? main.scrollHeight : 0;
      const f = [...document.querySelector('[data-testid="seller-call-shell"]').querySelectorAll(sel)].filter((e) => !e.disabled && e.checkVisibility({ visibilityProperty: true }));
      (d === 'back' ? f[f.length - 1] : f[0]).focus();
      window.__scrollLog = [];
    }, [dir, FOCUSABLE]);
    const seen = [];
    let prev = null;
    for (let i = 0; i < 260; i += 1) {
      const v = await page.evaluate(focusProbe);
      if (!v.inShell) break;
      v.log = await page.evaluate(() => window.__scrollLog.splice(0));
      v.barJump = !!prev && v.inBar && prev.barStuck && v.scrollTop !== prev.scrollTop;
      v.sideJump = !!prev && v.inSide && v.sideSticky && v.scrollTop !== prev.scrollTop;
      seen.push(v);
      prev = v;
      await page.keyboard.press(dir === 'back' ? 'Shift+Tab' : 'Tab');
      await page.waitForTimeout(30);
    }
    return { total: seen.length, stuckSteps: seen.filter((v) => v.barStuck).length, sideSteps: seen.filter((v) => v.inSide).length,
      under: seen.filter((v) => !v.inBar && v.barPts > 0).map((v) => `${v.label} [${v.barPts}/5]`),
      hidden: seen.filter((v) => (v.fits && !v.fullyVisible) || (!v.fits && v.fitsView)).map((v) => `${v.label} [${v.rect.join('-')} vs ${v.visible.join('-')}]`),
      barJumps: seen.filter((v) => v.barJump).map((v) => `${v.label} scrollTop -> ${v.scrollTop}`),
      sideJumps: seen.filter((v) => v.sideJump).map((v) => `${v.label} scrollTop -> ${v.scrollTop}`),
      badScroll: seen.flatMap((v) => badScroll(v.log).map((l) => `${v.label}: ${JSON.stringify(l)}`)) };
  }

  async function barChecks(page, w, expect, previous = '') {
    await page.waitForTimeout(250);
    const s = await page.evaluate(barState, RULE_FOCUSABLE);
    const mode = s.ruleSticky ? 'sticky' : 'scrolls';
    check(`${w}: bar mode follows the clearance rule (room ${s.room}px vs tallest control ${s.need}px -> ${mode})`,
      s.mode === mode && (mode === 'sticky') === (s.position === 'sticky'), JSON.stringify(s));
    if (expect !== 'rule') check(`${w}: bar mode is ${expect}`, s.mode === expect, JSON.stringify(s));
    if (s.mode === 'sticky') {
      check(`${w}: bar sticky (position sticky, top 0, zIndex 10) and stuck`, s.position === 'sticky' && s.top === '0px' && s.zIndex === '10' && s.stuck, JSON.stringify(s));
      check(`${w}: main scroll-padding-top == padding-top + bar height + 8px`, s.scrollPaddingTop === s.expected, `actual ${s.scrollPaddingTop || '(none)'}, expected ${s.expected}, bar ${s.barHeight}px`);
    } else {
      check(`${w}: fallback -- the bar scrolls with the page (position relative, not stuck)`, s.position === 'relative' && !s.stuck, JSON.stringify(s));
      check(`${w}: fallback -- main's previous scroll padding is back (${previous || 'none'})`, s.scrollPaddingTop === previous, `actual ${s.scrollPaddingTop || '(none)'}`);
    }
    const before = await page.evaluate(pageState);
    for (const dir of ['forward', 'back']) {
      const r = await walk(page, dir);
      const key = dir === 'back' ? 'Shift+Tab' : 'Tab';
      check(`${w}: ${key} visits the Seller Call controls${s.mode === 'sticky' ? ' with the bar stuck' : ', bar never stuck'} (non-vacuous)`,
        r.total >= 20 && (s.mode === 'sticky' ? r.stuckSteps > 0 : r.stuckSteps === 0), `total ${r.total}, stuck steps ${r.stuckSteps}`);
      check(`${w}: ${key} leaves no focused control under the bar`, r.under.length === 0, r.under.slice(0, 8).join('; '));
      check(`${w}: ${key} -- every focused control fully visible (vertical)`, r.hidden.length === 0, r.hidden.slice(0, 8).join('; '));
      check(`${w}: ${key} -- entering the stuck bar moves nothing`, r.barJumps.length === 0, r.barJumps.join('; '));
      check(`${w}: ${key} -- entering the sticky side column moves nothing`, r.sideJumps.length === 0, r.sideJumps.join('; '));
      check(`${w}: ${key} -- every scroll call moved only <main>, vertically (scroll API log)`, r.badScroll.length === 0, r.badScroll.slice(0, 4).join('; '));
    }
    if (s.mode === 'sticky') {
      /* Not keyboard focus: a pointer click (Playwright's, a user's tool), assistive technology or scrollIntoView
         scrolls a control into view. A control of the stuck bar is already in view, so <main> must not move (the
         compact Call hid itself when it did). The sticky side column is measured and reported, not required. */
      /* Half-way down: the bar is stuck and the full Call is out of view, so the compact Call shows (it is revealed
         by an observer, hence the wait). */
      await page.evaluate(() => { const main = document.querySelector('main'); main.scrollTop = Math.floor((main.scrollHeight - main.clientHeight) / 2); });
      await page.waitForTimeout(300);
      const n = await page.evaluate(() => {
        const main = document.querySelector('main');
        const sel = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
        const pick = (root) => (root ? [...root.querySelectorAll(sel)] : []).filter((e) => !e.disabled && e.checkVisibility({ visibilityProperty: true }));
        let i = 0;
        for (const e of pick(document.querySelector('[data-testid="seller-call-sticky-bar"]'))) e.dataset.sivProbe = `bar-${i++}`;
        const side = document.querySelector('[data-testid="seller-call-side"]');
        if (side && getComputedStyle(side).position === 'sticky') for (const e of pick(side)) e.dataset.sivProbe = `side-${i++}`;
        const bar = document.querySelector('[data-testid="seller-call-sticky-bar"]').getBoundingClientRect();
        const padTop = parseFloat(getComputedStyle(main).paddingTop) || 0;
        return { start: main.scrollTop, compact: !!document.querySelector('[data-testid="call-with-airdroid-compact"][data-siv-probe]'), stuck: main.scrollTop > 0 && Math.abs(bar.top - (main.getBoundingClientRect().top + padTop)) < 2,
          ids: [...document.querySelectorAll('[data-siv-probe]')].map((e) => e.dataset.sivProbe) };
      });
      const moved = { bar: [], side: [] };
      for (const id of n.ids) {
        await page.evaluate((t) => { document.querySelector('main').scrollTop = t; }, n.start);
        await page.waitForTimeout(30);
        await page.locator(`[data-siv-probe="${id}"]`).scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        const r = await page.evaluate((pid) => {
          const e = document.querySelector(`[data-siv-probe="${pid}"]`);
          return { top: document.querySelector('main').scrollTop, win: window.scrollY,
            label: e.getAttribute('data-testid') || e.getAttribute('aria-label') || e.textContent.trim().slice(0, 30) };
        }, id);
        if (r.top !== n.start || r.win !== 0) moved[id.startsWith('bar-') ? 'bar' : 'side'].push(`${r.label} ${n.start} -> ${r.top}`);
      }
      await page.evaluate(() => { document.querySelectorAll('[data-siv-probe]').forEach((e) => { delete e.dataset.sivProbe; }); document.querySelector('main').scrollTop = 0; });
      const barCount = n.ids.filter((x) => x.startsWith('bar-')).length;
      check(`${w}: scrolling a stuck-bar control into view other than by keyboard (pointer, assistive technology) moves nothing (${barCount} controls)`,
        barCount >= 2 && n.compact && n.stuck && moved.bar.length === 0, `stuck ${n.stuck}, compact Call probed ${n.compact}; ${moved.bar.slice(0, 6).join('; ')}`);
      if (moved.side.length) console.log(`NOTE  ${w}: side column, scrolled into view other than by keyboard, moved the page for ${moved.side.length} control(s): ${moved.side.slice(0, 4).join('; ')}`);
    }
    const after = await page.evaluate(pageState);
    check(`${w}: figures, answers and the selected deal unchanged by the walks`, JSON.stringify(before) === JSON.stringify(after),
      JSON.stringify({ before: before.figures, after: after.figures, changed: before.values.filter((v, i) => v !== after.values[i]).slice(0, 4) }));
    return s;
  }
  const openScript = async (page) => { await page.getByTestId('view-full-script').click(); await page.getByTestId('full-script-drawer').waitFor(); await page.waitForTimeout(150); };
  /* Opens Notes if it is closed (pressing the button on an open panel would close it). */
  const openNotes = async (page) => { if ((await page.getByTestId('seller-call-notes-panel').count()) > 0) return; await page.getByTestId('seller-call-notes-toggle').focus(); await page.keyboard.press('Enter'); await page.getByTestId('seller-call-notes-panel').waitFor(); await page.waitForTimeout(150); };
  const openBadge = (page) => page.evaluate(() => { const d = document.querySelector('[data-testid="seller-call-sticky-bar"] details'); if (d) d.open = true; return !!d; });

  /* ═══ 1-3: desktop and laptop focus ═══ */
  const DESKTOP = [
    { w: 1440, h: 900, expect: 'sticky', script: false, notes: false, badge: false },
    { w: 1440, h: 900, expect: 'sticky', script: true, notes: true, badge: false },
    { w: 1440, h: 900, expect: 'sticky', script: false, notes: false, badge: true },
    { w: 1366, h: 768, expect: 'rule', script: true, notes: false, badge: false },
    { w: 1280, h: 800, expect: 'rule', script: false, notes: true, badge: false },
    { w: 1024, h: 768, expect: 'rule', script: true, notes: true, badge: false },
    { w: 768, h: 1024, expect: 'rule', script: false, notes: false, badge: false },
    { w: 480, h: 900, expect: 'rule', script: false, notes: false, badge: false },
  ];
  for (const c of DESKTOP) {
    /* The readiness details exist only while an item is open: for that state
       the seller price evidence is left out, so one category is unresolved. */
    const held = c.badge ? fx.state.notes.splice(fx.state.notes.findIndex((x) => x.id === 'ready-n-seller-price'), 1) : [];
    const { context, page } = await open(c.w, c.h);
    await ready(page);
    if (c.script) await openScript(page);
    if (c.notes) await openNotes(page);
    if (c.badge) check(`${c.w}x${c.h}: readiness details open inside the bar`, await openBadge(page));
    await barChecks(page, `${c.w}x${c.h}${c.script ? ' +script' : ''}${c.notes ? ' +notes' : ''}${c.badge ? ' +details' : ''}`, c.expect);
    await context.close();
    fx.state.notes.push(...held);
  }

  /* ═══ 4: measured fallback at 1440x900, and sticky's return ═══ */
  {
    const { context, page } = await open(1440, 900);
    await ready(page);
    await page.evaluate(() => {
      const g = document.createElement('div');
      g.setAttribute('data-test-growth', '');
      g.style.height = '700px';
      g.textContent = 'Test-only growth standing in for a bar taller than the room.';
      document.querySelector('[data-testid="seller-call-sticky-bar"]').appendChild(g);
    });
    await barChecks(page, '1440x900 grown past the room', 'scrolls');
    await page.evaluate(() => document.querySelector('[data-test-growth]').remove());
    await page.waitForTimeout(200);
    check('1440x900 growth removed: sticky returns without a reload',
      (await page.evaluate(() => document.querySelector('[data-testid="seller-call-sticky-bar"]').getAttribute('data-rail-mode'))) === 'sticky');
    /* A control taller than the room releases the pin (Jess 2026-10-25). It is
       added at the END of the workspace, so nothing above the focused control
       moves when it goes away. */
    await page.evaluate(() => {
      const t = document.createElement('textarea');
      t.setAttribute('data-test-tall', '');
      t.style.height = '1200px';
      document.querySelector('.seller-call-shell__main').appendChild(t);
    });
    await page.waitForTimeout(200);
    check('1440x900 a control taller than the room: the bar scrolls with the page',
      (await page.evaluate(() => document.querySelector('[data-testid="seller-call-sticky-bar"]').getAttribute('data-rail-mode'))) === 'scrolls');
    /* Keyboard focus on a control near the top of the view, then the tall control goes away. */
    const kept = await page.evaluate(([sel]) => {
      const main = document.querySelector('main');
      main.scrollTop = Math.round(main.scrollHeight / 3);
      const m = main.getBoundingClientRect();
      const f = [...document.querySelector('.seller-call-shell__main').querySelectorAll(sel)].filter((e) => !e.disabled && e.checkVisibility({ visibilityProperty: true }) && !e.closest('[data-testid="seller-call-sticky-bar"]'));
      const target = f.find((e) => { const r = e.getBoundingClientRect(); return r.top > m.top + 10 && r.top < m.top + 80; }) || f[Math.floor(f.length / 2)];
      const i = f.indexOf(target);
      f[Math.max(0, i - 1)].focus({ preventScroll: true });
      return target.getAttribute('data-testid') || target.tagName;
    }, [FOCUSABLE]);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(80);
    /* Keyboard focus must be on a workspace control, not in the bar. */
    for (let i = 0; i < 8 && (await page.evaluate(() => !!document.activeElement.closest('[data-testid="seller-call-sticky-bar"]'))); i += 1) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(60);
    }
    const focusedBefore = await page.evaluate(focusProbe);
    await page.evaluate(() => document.querySelector('[data-test-tall]').remove());
    await page.waitForTimeout(200);
    const v = await page.evaluate(focusProbe);
    const s = await page.evaluate(() => document.querySelector('[data-testid="seller-call-sticky-bar"]').getAttribute('data-rail-mode'));
    check(`1440x900 tall control removed: sticky returns and the keyboard-focused control (near ${kept}) is clear of the bar`,
      s === 'sticky' && v.inShell && !v.inBar && v.label === focusedBefore.label && v.barPts === 0 && v.fullyVisible, JSON.stringify({ mode: s, before: focusedBefore, v }));
    /* A pointer click places focus without any page scroll. */
    await page.evaluate(() => { window.__scrollLog = []; });
    const clickTarget = page.locator('.seller-call-shell__main input:not([disabled]), .seller-call-shell__main textarea:not([disabled])').nth(2);
    await clickTarget.scrollIntoViewIfNeeded();
    await page.evaluate(() => { window.__scrollLog = []; });
    await clickTarget.click();
    await page.waitForTimeout(120);
    const clickLog = await page.evaluate(() => window.__scrollLog.splice(0));
    check('1440x900 pointer: the click scrolls nothing', clickLog.length === 0, JSON.stringify(clickLog));
    await context.close();
  }

  /* ═══ 5: Notes panel ═══ */
  {
    const { context, page } = await open(1440, 900);
    await ready(page);
    const toggle = page.getByTestId('seller-call-notes-toggle');
    check('notes: starts closed (button collapsed, no panel)', (await toggle.getAttribute('aria-expanded')) === 'false' && (await page.getByTestId('seller-call-notes-panel').count()) === 0);
    const readsBefore = log.notesReads;
    const valuesBefore = await page.evaluate(pageState);
    await openNotes(page);
    const n = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="seller-call-notes-panel"]');
      const items = [...panel.querySelectorAll('[data-testid="seller-call-note"]')];
      return { focused: document.activeElement === panel, count: items.length, text: items.map((i) => i.textContent),
        expanded: document.querySelector('[data-testid="seller-call-notes-toggle"]').getAttribute('aria-expanded') };
    });
    check('notes: opens from the bar by keyboard, takes focus, button expanded', n.focused && n.expanded === 'true', JSON.stringify({ focused: n.focused, expanded: n.expanded }));
    check(`notes: lists this contact's ${fx.state.notes.length} notes`, n.count === fx.state.notes.length, `count ${n.count}`);
    const dates = await page.evaluate(() => [...document.querySelectorAll('[data-testid="seller-call-note"]')].map((i) => Date.parse(i.firstChild.textContent)));
    check('notes: newest first', dates.every((d, i) => i === 0 || dates[i - 1] >= d), dates.slice(0, 5).join(','));
    check('notes: system records read as their summary (IAOS record), plain notes as written', n.text.some((t) => t.includes('IAOS record')) && n.text.some((t) => t.includes('Synthetic plain note 1:')));
    check('notes: no new notes read and no write to open the panel', log.notesReads === readsBefore && log.writes.length === 0, `reads ${readsBefore} -> ${log.notesReads}`);
    await openScript(page);
    const g = await page.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const sc = r('[data-testid="full-script-drawer"]'); const nt = r('[data-testid="seller-call-notes-panel"]'); const ws = r('.seller-call-shell__main');
      const script = document.querySelector('[data-testid="full-script-drawer"]');
      return { overlap: sc.bottom > nt.top + 0.5, beside: sc.left >= ws.right && nt.left >= ws.right, scriptH: Math.round(sc.height), notesH: Math.round(nt.height),
        scriptScrolls: script.scrollHeight > script.clientHeight, closeVisible: (() => { const c = r('[data-testid="full-script-close"]'); return c.top >= sc.top && c.bottom <= sc.bottom; })() };
    });
    check('notes + script at 1440x900: both beside the workspace, no overlap, each usable (script scrolls, close visible)', !g.overlap && g.beside && g.scriptH > 150 && g.notesH > 150 && g.scriptScrolls && g.closeVisible, JSON.stringify(g));
    await page.getByTestId('seller-call-notes-panel').focus();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    const esc = await page.evaluate(() => ({ panel: !!document.querySelector('[data-testid="seller-call-notes-panel"]'), script: !!document.querySelector('[data-testid="full-script-drawer"]'),
      focus: document.activeElement && document.activeElement.getAttribute('data-testid') }));
    check('notes: Escape inside closes Notes only; focus returns to the Notes button', !esc.panel && esc.script && esc.focus === 'seller-call-notes-toggle', JSON.stringify(esc));
    await openNotes(page);
    await page.getByTestId('seller-call-notes-close').click();
    await page.waitForTimeout(120);
    const closed = await page.evaluate(() => ({ panel: !!document.querySelector('[data-testid="seller-call-notes-panel"]'), focus: document.activeElement && document.activeElement.getAttribute('data-testid') }));
    check('notes: the close button closes it; focus returns to the Notes button', !closed.panel && closed.focus === 'seller-call-notes-toggle', JSON.stringify(closed));
    const valuesAfter = await page.evaluate(pageState);
    check('notes: answers, figures and deal unchanged by opening and closing panels', JSON.stringify(valuesBefore) === JSON.stringify(valuesAfter));

    /* Contact isolation: B's reads are held back; the open panel must never show A's notes for B. */
    await openNotes(page);
    delayFor = B;
    await navigate(page, `/contacts/${B}/seller-call`);
    const samples = [];
    for (let i = 0; i < 10; i += 1) {
      samples.push(await page.evaluate(() => {
        const p = document.querySelector('[data-testid="seller-call-notes-panel"]');
        return p ? { present: true, plainA: p.textContent.includes('Synthetic plain note'), loading: !!p.querySelector('[data-testid="seller-call-notes-loading"]'), count: p.querySelectorAll('[data-testid="seller-call-note"]').length } : { present: false };
      }));
      await page.waitForTimeout(150);
    }
    check('notes isolation: while the next contact loads, the open panel shows loading, never the previous contact\'s notes (non-vacuous)',
      samples.every((s) => !s.present || (!s.plainA && s.count === 0)) && samples.some((s) => s.present && s.loading), JSON.stringify(samples.slice(0, 4)));
    await page.waitForTimeout(3000);
    const bView = await page.evaluate(() => { const p = document.querySelector('[data-testid="seller-call-notes-panel"]'); return p ? { empty: !!p.querySelector('[data-testid="seller-call-notes-empty"]'), plainA: p.textContent.includes('Synthetic plain note') } : null; });
    check('notes isolation: after the next contact loads, its own (empty) history shows', !!bView && bView.empty && !bView.plainA, JSON.stringify(bView));
    delayFor = null;
    await navigate(page, `/contacts/${A}/seller-call`);
    await page.waitForFunction((count) => document.querySelectorAll('[data-testid="seller-call-note"]').length === count, fx.state.notes.length, { timeout: 30000 }).catch(() => {});
    const back = await page.evaluate(() => document.querySelectorAll('[data-testid="seller-call-note"]').length);
    check('notes isolation: back on the first contact its notes return', back === fx.state.notes.length, `count ${back}`);
    await context.close();
  }
  /* Tablet: the side column stacks above the workspace, never sticky. */
  {
    const { context, page } = await open(1024, 768);
    await ready(page);
    await openScript(page);
    await openNotes(page);
    const t = await page.evaluate(() => {
      const side = document.querySelector('.seller-call-side'); const ws = document.querySelector('.seller-call-shell__main').getBoundingClientRect();
      const s = side.getBoundingClientRect(); const vh = window.innerHeight;
      const hs = ['[data-testid="full-script-drawer"]', '[data-testid="seller-call-notes-panel"]'].map((q) => document.querySelector(q).getBoundingClientRect().height);
      return { position: getComputedStyle(side).position, above: s.bottom <= ws.top + 0.5, capped: hs.every((h) => h <= vh * 0.4 + 1), hs: hs.map(Math.round) };
    });
    check('1024x768: script and Notes stack above the workspace, static, each at most 40vh', t.position === 'static' && t.above && t.capped, JSON.stringify(t));
    await context.close();
  }

  /* ═══ 6: cleanup and handover ═══ */
  async function mainListeners(page) {
    const cdp = await page.context().newCDPSession(page);
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'document.querySelector("main")' });
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    await cdp.detach();
    return listeners.map((l) => l.type);
  }
  async function modalityListeners(page) {
    const cdp = await page.context().newCDPSession(page);
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'document', objectGroup: 'sc' });
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    const out = listeners.filter((l) => ['keydown', 'pointerdown'].includes(l.type) && l.handler && /keyTask|byKeyboard/.test(l.handler.description || '')).map((l) => l.type);
    await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'sc' });
    await cdp.detach();
    return out;
  }
  {
    const { context, page } = await open(1440, 900);
    await ready(page);
    const onPage = await page.evaluate(() => document.querySelector('main').style.scrollPaddingTop);
    check('cleanup: on Seller Call the bar has set main\'s scroll padding', /px$/.test(onPage), onPage);
    await navigate(page, '/pipeline');
    await page.waitForTimeout(800);
    const away = await page.evaluate(() => ({ pad: document.querySelector('main').style.scrollPaddingTop, bar: !!document.querySelector('[data-testid="seller-call-sticky-bar"]') }));
    check('cleanup: away from Seller Call, main\'s previous scroll padding (none) is back', !away.bar && away.pad === '', JSON.stringify(away));
    check('cleanup: no focus listener left on <main>', !(await mainListeners(page)).includes('focusin'));
    check('cleanup: no keydown/pointerdown modality listener left on the document', (await modalityListeners(page)).length === 0);
    await navigate(page, `/contacts/${A}`);
    await page.getByTestId('deal-rail').waitFor({ timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(600);
    const onContact = await page.evaluate(() => ({ rail: document.querySelector('[data-testid="deal-rail"]')?.getAttribute('data-rail-mode') ?? null, pad: document.querySelector('main').style.scrollPaddingTop }));
    await navigate(page, `/contacts/${A}/seller-call`);
    await ready(page);
    const onSc = await page.evaluate(() => ({ bar: document.querySelector('[data-testid="seller-call-sticky-bar"]').getAttribute('data-rail-mode'), pad: document.querySelector('main').style.scrollPaddingTop }));
    await navigate(page, `/contacts/${A}`);
    await page.getByTestId('deal-rail').waitFor({ timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(600);
    const again = await page.evaluate(() => ({ rail: document.querySelector('[data-testid="deal-rail"]')?.getAttribute('data-rail-mode') ?? null, pad: document.querySelector('main').style.scrollPaddingTop }));
    await navigate(page, '/pipeline');
    await page.waitForTimeout(800);
    const end = await page.evaluate(() => document.querySelector('main').style.scrollPaddingTop);
    check('handover: Contact -> Seller Call -> Contact -> away; each page owns the padding, nothing leaks at the end',
      onContact.rail !== null && onSc.bar !== null && again.rail === onContact.rail && again.pad === onContact.pad && end === '',
      JSON.stringify({ onContact, onSc, again, end }));
    await context.close();
  }

  if (MUTATION) check(`mutation ${MUTATION} applied in the dev server`, mutationApplied);
  check('offline: no writes, no foreign requests, no page errors', log.writes.length === 0 && log.foreign.length === 0 && log.pageErrors.length === 0,
    JSON.stringify({ writes: log.writes.slice(0, 4), foreign: log.foreign.slice(0, 4), pageErrors: log.pageErrors.slice(0, 4) }));
  console.log(`unmodelled GETs answered 404: ${log.unmodelled.size} (${[...log.unmodelled].slice(0, 6).join('; ')})`);
  await browser.close();
  await server.close();
  clearTimeout(watchdog);
  console.log(`\nB15-06 Seller Call focus + Notes${MUTATION ? ` [MUTATION ${MUTATION}]` : ''}: ${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(`FAIL  ${e.stack || e}`); process.exit(1); });
