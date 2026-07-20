/* Live verification — Conversations phase (read-only inbox).
   COMMITTED to the repo (previously lived in scratchpad and went stale-pinned
   twice). RE-PIN `EXPECTED` to the bundle under test on every run: build the
   commit AND its parent, prove the hashes DISCRIMINATE, poll prod to the
   expected hash, then run (§9.2 bundle gate). Read-only: thread list + message
   history render; ZERO writes. Fails LOUD (non-zero) on any no-run.
   Floor = literal check() count — COUNT it from this file, never assume.
   Currently 20 (10 §6.1 + 3 collapse §6.2 + 1 inner-label §8.1 + 1 top-bar title
   + 5 layout §8.2/§8.4/§8.6: three-sections, section-placement, notes-data-driven
   (empty), notes-populated, empty-text). */
const { chromium } = require("playwright");

const ORIGIN   = "https://app.investorautomationos.com";
const EXPECTED = "index-B6PPkWme.js"; // §8.2/§8.4/§8.6 three-section layout + notes. RE-PIN to the bundle under test every run.
const TARGET   = "05gYdxJcyNTCKWTwkbbs"; // john sanchez — has the 1 inbound SMS + emails; a scoping + SMS + delta fixture
const THREADS_URL = `${ORIGIN}/.netlify/functions/ghl-conversations?scope=all`;
const MSGS_URL    = `${ORIGIN}/.netlify/functions/ghl-contact-conversations?id=${TARGET}`;
const SHOWN_TYPES = ["TYPE_EMAIL", "TYPE_SMS"];

let checksRun = 0;
const failures = [];
function check(name, cond, detail = "") {
  checksRun++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  if (!cond) failures.push(name);
}

// Reads the three thread-pane sections (§8.2) from the DOM, keyed by their uppercase
// header label (Notes/Text/Email): row count, empty-state text, and whether the STOP
// SMS is inside. Used for the layout + placement + empty-state checks.
async function readSections(page) {
  return page.evaluate(() => {
    const titles = ["Notes", "Text", "Email"];
    const out = {};
    const headers = [...document.querySelectorAll("div")].filter((d) => d.style && d.style.textTransform === "uppercase");
    for (const h of headers) {
      const span = h.querySelector("span");
      const title = span ? span.textContent.trim() : "";
      if (!titles.includes(title)) continue;
      const body = h.nextElementSibling;
      const rowsWrap = body ? [...body.children].find((c) => c.style && c.style.flexDirection === "column") : null;
      out[title] = {
        rowCount:  rowsWrap ? rowsWrap.children.length : 0,
        emptyText: (!rowsWrap && body) ? body.textContent.trim() : "",
        hasSTOP:   !!(body && /STOP/.test(body.textContent)),
      };
    }
    return out;
  });
}

(async () => {
  // ── Bundle gate (§9.2) — prod serves the code under test ──
  const idx = await (await fetch(`${ORIGIN}/index.html?cb=${Math.random()}`, { headers: { "Cache-Control": "no-cache" } })).text();
  const liveHash = (idx.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/) || [])[1] || "NONE";
  check("bundle-gate-runtime", liveHash === EXPECTED, `live=${liveHash} expected=${EXPECTED}`);
  if (liveHash !== EXPECTED) { console.log("ABORT — prod not serving code under test"); process.exit(1); }

  // ── Ground truth from the endpoints ──
  const threads = await (await fetch(THREADS_URL)).json();
  const threadsOk = Array.isArray(threads) && (threads.length === 0 || ["conversationId","contactId","contactName","lastMessageDirection"].every((k) => k in threads[0]));
  check("threads-endpoint-ok", threadsOk, `count=${Array.isArray(threads) ? threads.length : "(not array)"}`);
  const N = Array.isArray(threads) ? threads.length : -1;
  const johnIndex = Array.isArray(threads) ? threads.findIndex((t) => t.contactId === TARGET) : -1;

  const msgs = await (await fetch(MSGS_URL)).json();
  const total = msgs.messages.length;
  const shown = msgs.messages.filter((m) => SHOWN_TYPES.includes(m.messageType)).length;
  const smsInbound = msgs.messages.filter((m) => m.messageType === "TYPE_SMS" && m.direction === "inbound").length;
  const smsCount   = msgs.messages.filter((m) => m.messageType === "TYPE_SMS").length;
  const emailCount = msgs.messages.filter((m) => m.messageType === "TYPE_EMAIL").length;

  // Notes ground truth — the SAME read-only path the app uses (§8.6, Option A):
  // GET ghl-proxy?path=/contacts/:id/notes. GET only; the browser's own proxy request
  // is audited by METHOD in zero-writes below (this harness-side fetch is not).
  const NOTES_URL = `${ORIGIN}/.netlify/functions/ghl-proxy?path=${encodeURIComponent(`/contacts/${TARGET}/notes`)}`;
  const notesGT = ((await (await fetch(NOTES_URL)).json()).notes ?? []).length;

  // Empty-state fixture (§8.4) — Neelima Bale: emails, ZERO SMS. Her Text section
  // must render "No texts." Ground truth via the SAME GET-only dedicated function
  // (ghl-contact-conversations), NOT the generic proxy.
  const NEELIMA = "FiIT0hUaxVCIuokQpZuc";
  const neeMsgs = await (await fetch(`${ORIGIN}/.netlify/functions/ghl-contact-conversations?id=${NEELIMA}`)).json();
  const neeSms  = neeMsgs.messages.filter((m) => m.messageType === "TYPE_SMS").length;
  // Neelima is ALSO the populated-notes fixture (§8.6) — OBSERVED 12 notes (john has 0,
  // Brad Thompson has 0). Notes.rowCount must match this and be > 0. Same GET proxy path.
  const NEE_NOTES_URL = `${ORIGIN}/.netlify/functions/ghl-proxy?path=${encodeURIComponent(`/contacts/${NEELIMA}/notes`)}`;
  const neeNotesGT = ((await (await fetch(NEE_NOTES_URL)).json()).notes ?? []).length;

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 2560, height: 1440 } });
  const page = await ctx.newPage();
  const fnReqs = [];
  page.on("request", (r) => {
    const m = r.url().match(/\/\.netlify\/functions\/([^/?]+)/);
    if (m) fnReqs.push({ method: r.method(), fn: m[1] });
  });

  await page.goto(`${ORIGIN}/conversations`, { waitUntil: "load" });
  // DONE: thread list rendered N buttons (atomic map once threads resolve).
  await page.waitForFunction((n) => {
    const col = [...document.querySelectorAll("div")].find((d) => d.style && d.style.flex && d.style.flex.includes("360px"));
    return !!col && col.querySelectorAll("button").length === n;
  }, N, { timeout: 45000 });

  const domCount = await page.evaluate(() => {
    const col = [...document.querySelectorAll("div")].find((d) => d.style && d.style.flex && d.style.flex.includes("360px"));
    return col ? col.querySelectorAll("button").length : -1;
  });
  check("threadlist-count-matches", domCount === N, `dom=${domCount} endpoint=${N}`);
  check("target-thread-present", johnIndex >= 0, `johnIndex=${johnIndex} of ${N}`);

  // §8.1 — inner PAGE label changed to "History"; the OUTER chrome (Sidebar nav
  // item) stays "Conversations". Positive assertion of the change itself, not
  // just "the other checks didn't break". One check (both conditions) → floor +1.
  const labels = await page.evaluate(() => ({
    h1: [...document.querySelectorAll("h1")].map((h) => (h.textContent || "").trim()),
    navConversations: [...document.querySelectorAll("a")].some((a) => (a.textContent || "").trim() === "Conversations"),
  }));
  check("inner-label-history-outer-conversations",
    labels.h1.includes("History") && !labels.h1.includes("Conversations") && labels.navConversations,
    `h1s=${JSON.stringify(labels.h1)} navConversations=${labels.navConversations}`);

  // Header top-bar title — the dark app-bar <h2> reads the page name ("Conversations")
  // on /conversations, no longer the "IAOS" fallback (Header.tsx TITLES key added).
  const topBar = await page.evaluate(() =>
    [...document.querySelectorAll("h2")].map((h) => (h.textContent || "").trim()),
  );
  check("top-bar-title-conversations", topBar.includes("Conversations"), `h2s=${JSON.stringify(topBar)}`);

  // Click the target thread by its endpoint-order index (DOM renders in endpoint order).
  await page.evaluate((idx) => {
    const col = [...document.querySelectorAll("div")].find((d) => d.style && d.style.flex && d.style.flex.includes("360px"));
    col.querySelectorAll("button")[idx].click();
  }, johnIndex);
  // Right pane: the Workspace deep-link appears in the header the instant the
  // thread is selected (BEFORE the messages GET resolves), so it proves selection
  // but NOT that messages rendered. Wait for the message bubbles themselves
  // (Sent/Received meta labels) — if they never render, this throws → loud fail.
  await page.waitForFunction((id) => !!document.querySelector(`a[href$="/contacts/${id}"]`), TARGET, { timeout: 30000 });
  await page.waitForFunction(
    () => [...document.querySelectorAll("span")].some((s) => s.textContent === "Sent" || s.textContent === "Received"),
    { timeout: 30000 },
  );

  const right = await page.evaluate((id) => {
    const link = document.querySelector(`a[href$="/contacts/${id}"]`);
    const bubbles = [...document.querySelectorAll("span")].filter((s) => s.textContent === "Sent" || s.textContent === "Received").length;
    const stop = [...document.querySelectorAll("div")].find((d) => /(^|\s)STOP(\s|$)/.test(d.textContent) && d.textContent.length < 200);
    // The STOP bubble: find the meta row that has both "Received" and a "Sms" channel near the STOP body.
    const stopBubble = [...document.querySelectorAll("div")].find((d) => /STOP/.test(d.textContent) && /Received/.test(d.textContent) && /Sms/i.test(d.textContent) && d.textContent.length < 200);
    return { hasLink: !!link, bubbles, hasStop: !!stop, stopIsInboundSms: !!stopBubble };
  }, TARGET);

  check("thread-scoped-by-id", right.hasLink, `Workspace link → /contacts/${TARGET} present=${right.hasLink}`);
  check("message-delta", right.bubbles === shown && total !== shown,
    `endpointTotal=${total} shown=${shown} filtered=${total - shown} domBubbles=${right.bubbles}`);
  check("inbound-sms-renders", smsInbound >= 1 && right.stopIsInboundSms,
    `endpointInboundSms=${smsInbound} domStopInboundSms=${right.stopIsInboundSms}`);

  // ── §8.2/§8.4 three-section layout (Notes | Text top row, Email full width) ──
  const secs = await readSections(page);
  check("three-sections-present",
    !!secs.Notes && !!secs.Text && !!secs.Email,
    `headers=${JSON.stringify(Object.keys(secs))}`);
  // Channels segregated: SMS ONLY in Text, emails ONLY in Email, STOP in Text not Email.
  check("section-placement",
    !!secs.Text && !!secs.Email &&
    secs.Text.rowCount === smsCount && secs.Email.rowCount === emailCount &&
    secs.Text.hasSTOP === true && secs.Email.hasSTOP === false,
    `text{rows=${secs.Text && secs.Text.rowCount},stop=${secs.Text && secs.Text.hasSTOP}}==sms=${smsCount} | email{rows=${secs.Email && secs.Email.rowCount},stop=${secs.Email && secs.Email.hasSTOP}}==email=${emailCount}`);

  // Notes render DATA-DRIVEN (§8.6): Notes.rowCount == the notes-endpoint count. Notes
  // load independently of messages, so wait for the Notes section to leave "Loading…".
  await page.waitForFunction(() => {
    const h = [...document.querySelectorAll("div")].find((d) => d.style && d.style.textTransform === "uppercase"
      && d.querySelector("span") && d.querySelector("span").textContent.trim() === "Notes");
    const body = h && h.nextElementSibling;
    return body && !/Loading/.test(body.textContent);
  }, { timeout: 30000 });
  const notesResolved = await readSections(page);
  check("notes-section-data-driven",
    !!notesResolved.Notes && notesResolved.Notes.rowCount === notesGT,
    `domNotes=${notesResolved.Notes && notesResolved.Notes.rowCount} endpointNotes=${notesGT}`);

  // ── Collapse (email line-clamp + Expand; SMS never collapses) ──
  // Expand/Show-less buttons exist ONLY in email bubbles (thread-list buttons
  // carry names/previews, not that text). Body = the button's previous sibling.
  const collapse = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].filter((b) => b.textContent === "Expand" || b.textContent === "Show less");
    let clampedEmail = false;
    if (btns.length) { const body = btns[0].previousElementSibling; clampedEmail = !!body && body.scrollHeight > body.clientHeight + 1; }
    const sms = [...document.querySelectorAll("div")].find((d) => /STOP/.test(d.textContent) && /Sms/i.test(d.textContent) && /Received/.test(d.textContent) && d.textContent.length < 200);
    const smsBody = sms ? [...sms.querySelectorAll("div")].pop() : null;
    return {
      expandCount: btns.length,
      clampedEmail,
      smsFound: !!sms,
      smsHasButton: sms ? !!sms.querySelector("button") : null,
      smsBodyClamped: smsBody ? smsBody.scrollHeight > smsBody.clientHeight + 1 : null,
    };
  });
  check("email-clamped-and-expandable", collapse.expandCount >= 1 && collapse.clampedEmail === true,
    `expandButtons=${collapse.expandCount} firstEmailBodyOverflowing=${collapse.clampedEmail}`);
  check("sms-not-collapsed", collapse.smsFound === true && collapse.smsHasButton === false && collapse.smsBodyClamped === false,
    `smsFound=${collapse.smsFound} smsHasExpandBtn=${collapse.smsHasButton} smsBodyClamped=${collapse.smsBodyClamped}`);

  // Click Expand → body un-clamps, button becomes "Show less".
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent === "Expand"); if (b) b.click(); });
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent === "Show less"), { timeout: 5000 });
  const afterExpand = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent === "Show less");
    const body = btn ? btn.previousElementSibling : null;
    return { btnText: btn ? btn.textContent : null, bodyClampedAfter: body ? body.scrollHeight > body.clientHeight + 1 : null };
  });
  check("expand-reveals-full", afterExpand.btnText === "Show less" && afterExpand.bodyClampedAfter === false,
    `btn=${afterExpand.btnText} bodyStillClamped=${afterExpand.bodyClampedAfter}`);

  // ── §8.4 empty-state — switch to Neelima Bale (emails, 0 SMS) → Text "No texts." ──
  const neeIndex = Array.isArray(threads) ? threads.findIndex((t) => t.contactId === NEELIMA) : -1;
  let neeText = null, neeNotes = null;
  if (neeIndex >= 0 && neeSms === 0) {
    await page.evaluate((idx) => {
      const col = [...document.querySelectorAll("div")].find((d) => d.style && d.style.flex && d.style.flex.includes("360px"));
      col.querySelectorAll("button")[idx].click();
    }, neeIndex);
    // Wait for the Text section to reach Neelima's terminal empty state ("No texts.").
    // John's Text (which has the STOP bubble) never shows this, so it can't race in.
    await page.waitForFunction(() => {
      const h = [...document.querySelectorAll("div")].find((d) => d.style && d.style.textTransform === "uppercase"
        && d.querySelector("span") && d.querySelector("span").textContent.trim() === "Text");
      const body = h && h.nextElementSibling;
      return body && /No texts\./.test(body.textContent);
    }, { timeout: 30000 });
    // Notes load independently — wait for Neelima's Notes section to leave "Loading…".
    // The Text wait above already committed selection to Neelima (notes were reset to
    // Loading on select), so john's stale "No notes." can't race in.
    await page.waitForFunction(() => {
      const h = [...document.querySelectorAll("div")].find((d) => d.style && d.style.textTransform === "uppercase"
        && d.querySelector("span") && d.querySelector("span").textContent.trim() === "Notes");
      const body = h && h.nextElementSibling;
      return body && !/Loading/.test(body.textContent);
    }, { timeout: 30000 });
    const neeSecs = await readSections(page);
    neeText  = neeSecs.Text;
    neeNotes = neeSecs.Notes;
  }
  check("empty-text-section",
    neeIndex >= 0 && neeSms === 0 && !!neeText && neeText.rowCount === 0 && neeText.emptyText === "No texts.",
    `neeIndex=${neeIndex} endpointSms=${neeSms} domTextRows=${neeText && neeText.rowCount} emptyText="${neeText && neeText.emptyText}"`);
  // Populated-notes fixture (§8.6): Neelima has REAL notes — Notes.rowCount == endpoint, >0.
  // Closes the john N=0 gap (that check proved wiring + empty; this proves the >0 render).
  check("notes-populated-data-driven",
    neeNotesGT > 0 && !!neeNotes && neeNotes.rowCount === neeNotesGT,
    `endpointNotes=${neeNotesGT} domNotes=${neeNotes && neeNotes.rowCount}`);

  // ── Audits ──
  const gets = fnReqs.filter((r) => r.method === "GET");
  const writes = fnReqs.filter((r) => ["POST", "PUT", "PATCH", "DELETE"].includes(r.method));
  const listAll = fnReqs.filter((r) => r.fn === "ghl-contacts");
  const convReqs = fnReqs.filter((r) => r.fn === "ghl-conversations");
  const ccReqs = fnReqs.filter((r) => r.fn === "ghl-contact-conversations");
  const proxyReqs = fnReqs.filter((r) => r.fn === "ghl-proxy"); // the NOTES read path (§8.6, Option A)
  // write-audit now also requires the notes read (ghl-proxy GET) to have gone out.
  check("write-audit-attached", gets.length > 0 && convReqs.length > 0 && ccReqs.length > 0 && proxyReqs.length > 0,
    `GETs=${gets.length} ghl-conversations=${convReqs.length} ghl-contact-conversations=${ccReqs.length} ghl-proxy/notes=${proxyReqs.length}`);
  // zero-writes filters ALL captured fnReqs by METHOD — ghl-proxy (the NOTES read)
  // included — so a write via the generic proxy would be caught here too. This is
  // the safety basis for Option A (§8.6): read-only enforced by method, not by the
  // proxy being GET-locked.
  check("zero-writes", writes.length === 0, `writes=${JSON.stringify(writes.map((w) => `${w.method} ${w.fn}`))}`);
  check("no-listall-on-path", listAll.length === 0, `ghl-contacts(listAll)=${listAll.length}`);
  await browser.close();

  console.log(`\nchecksRun=${checksRun} failures=${failures.length} ${failures.length ? JSON.stringify(failures) : ""}`);
  if (checksRun < 20) { console.log("ABORT — harness ran too few checks; treat as FAILED"); process.exit(2); }
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error("HARNESS THREW:", (e && e.stack) || e); process.exit(3); });
