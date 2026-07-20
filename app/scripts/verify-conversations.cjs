/* Live verification — Conversations phase (read-only inbox).
   COMMITTED to the repo (previously lived in scratchpad and went stale-pinned
   twice). RE-PIN `EXPECTED` to the bundle under test on every run: build the
   commit AND its parent, prove the hashes DISCRIMINATE, poll prod to the
   expected hash, then run (§9.2 bundle gate). Read-only: thread list + message
   history render; ZERO writes. Fails LOUD (non-zero) on any no-run.
   Floor = literal check() count — COUNT it from this file, never assume.
   Currently 14 (10 read-only §6.1 + 3 collapse §6.2 + 1 positive inner-label §8.1). */
const { chromium } = require("playwright");

const ORIGIN   = "https://app.investorautomationos.com";
const EXPECTED = "index-D7eW48eb.js"; // §8.1 commit (h1 "Conversations" → "History"). RE-PIN every run.
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

  // ── Audits ──
  const gets = fnReqs.filter((r) => r.method === "GET");
  const writes = fnReqs.filter((r) => ["POST", "PUT", "PATCH", "DELETE"].includes(r.method));
  const listAll = fnReqs.filter((r) => r.fn === "ghl-contacts");
  const convReqs = fnReqs.filter((r) => r.fn === "ghl-conversations");
  const ccReqs = fnReqs.filter((r) => r.fn === "ghl-contact-conversations");
  check("write-audit-attached", gets.length > 0 && convReqs.length > 0 && ccReqs.length > 0,
    `GETs=${gets.length} ghl-conversations=${convReqs.length} ghl-contact-conversations=${ccReqs.length}`);
  check("zero-writes", writes.length === 0, `writes=${JSON.stringify(writes.map((w) => `${w.method} ${w.fn}`))}`);
  check("no-listall-on-path", listAll.length === 0, `ghl-contacts(listAll)=${listAll.length}`);
  await browser.close();

  console.log(`\nchecksRun=${checksRun} failures=${failures.length} ${failures.length ? JSON.stringify(failures) : ""}`);
  if (checksRun < 14) { console.log("ABORT — harness ran too few checks; treat as FAILED"); process.exit(2); }
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error("HARNESS THREW:", (e && e.stack) || e); process.exit(3); });
