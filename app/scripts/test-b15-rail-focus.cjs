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
 *   need = tallest visible, enabled focusable control in <main> outside the rail
 * room >= need -> "sticky": position sticky / top 0 / zIndex 1, stuck, Seller
 *   MAO cell fully visible, scroll-padding-top == padding-top + rail + 8px.
 * room <  need -> "scrolls": the rail scrolls with the page (position relative),
 *   main's PREVIOUS scroll padding is back; permanent MAO visibility is relaxed
 *   (documented, not asserted).
 * Every step checks the page's mode against this rule recomputed here, and
 * every Tab / Shift+Tab step checks the focused control is FULLY inside the
 * scroll viewport vertically (below the stuck rail when it is stuck) and that
 * none of 5 points on it hits the rail. Horizontal overflow at 480px (fixed
 * sidebar, min-width cards) is a separately DEFERRED issue and is NOT asserted.
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
 *      observing or listening on <main> after exit.
 *
 * RAIL_FOCUS_MUTATION=<name> rewrites ContactWorkspace.tsx IN THE DEV SERVER
 * ONLY (no file is touched) to prove these checks catch a broken fix:
 *   off          -- the hook is not called (the original defect)
 *   static       -- padding set once, never tracked
 *   nocleanup    -- the previous value is not restored on exit
 *   nodisconnect -- the observer is not disconnected on exit
 *   nofallback   -- the a0fd10a implementation: always sticky, no reveal
 *   noreturn     -- once released, the rail never becomes sticky again
 *   noreveal     -- keyboard focus is not brought fully into view
 *   nolistenercleanup -- the focus listener is left on <main> after exit
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

const MUTATIONS = {
  off: [['  const railSticky = useRailScrollPadding(railEl);\n', '  const railSticky = true;\n']],
  static: [['    [rail, scroller, rail.parentElement].forEach((el) => { if (el) observer?.observe(el); });\n', '\n']],
  nocleanup: [['      scroller.style.scrollPaddingTop = previous;\n', '\n']],
  nodisconnect: [['      observer?.disconnect();\n', '\n']],
  nofallback: [['      const fits = scroller.clientHeight - padTop - railHeight - RAIL_GAP >= need;\n', '      const fits = true;\n'],
    ['    scroller.addEventListener("focusin", reveal);\n', '\n']],
  noreturn: [['      setSticky(fits);\n', '      setSticky((s) => s && fits);\n']],
  noreveal: [['    scroller.addEventListener("focusin", reveal);\n', '\n']],
  nolistenercleanup: [['      scroller.removeEventListener("focusin", reveal);\n', '\n']],
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
    if (rail.contains(el) || el.disabled || el.offsetParent === null) continue;
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
  return { inWorkspace: true, inRail: rail.contains(el), railPts, label, railStuck, fullyVisible,
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
  async function walk(page, dir) {
    await page.evaluate(([d, sel]) => {
      const main = document.querySelector('main');
      main.scrollTop = d === 'back' ? main.scrollHeight : 0;
      const f = [...document.querySelector('[data-testid="contact-workspace"]').querySelectorAll(sel)].filter((e) => !e.disabled && e.offsetParent !== null);
      (d === 'back' ? f[f.length - 1] : f[0]).focus();
    }, [dir, FOCUSABLE]);
    const seen = [];
    for (let i = 0; i < 120; i += 1) {
      const v = await page.evaluate(focusUnderRail);
      if (!v.inWorkspace) break;
      seen.push(v);
      await page.keyboard.press(dir === 'back' ? 'Shift+Tab' : 'Tab');
      await page.waitForTimeout(40);
    }
    return { total: seen.length, stuckSteps: seen.filter((v) => v.railStuck).length,
      under: seen.filter((v) => !v.inRail && v.railPts > 0).map((v) => `${v.label} [${v.railPts}/5]`),
      hidden: seen.filter((v) => !v.fullyVisible).map((v) => `${v.label} [${v.rect.join('-')} vs ${v.visible.join('-')}]`) };
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
