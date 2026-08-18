#!/usr/bin/env node
/**
 * verify-proxy-boundary.cjs — Gate 1 NEGATIVE security boundary.
 *
 * The four live harnesses prove allowed traffic still works. This one proves
 * forbidden traffic stays forbidden. Without it, a future "the app needed
 * this route" edit to ghl-proxy's ALLOW map silently reopens the hole.
 *
 * Node only. No Playwright, no browser, NO BUNDLE PIN — it exercises the
 * function layer rather than the served bundle, so it needs no repin after a
 * deploy and can run unattended.
 *
 * A 403 IS NOT ENOUGH. OBSERVED 2026-08-18, pre-allowlist: GHL itself answers
 * 403 for a foreign location id, so two probes passed while no allowlist
 * existed. Every refusal check therefore requires BOTH status 403 AND the
 * proxy's own marker `iaos-proxy-allowlist` in the body. A 403 raised upstream
 * fails the check.
 *
 * SAFETY, two independent grounds, stated honestly.
 *   1. Every write-method probe targets a path that MUST be refused, so no
 *      outbound GHL request occurs ONCE THE ALLOWLIST IS DEPLOYED.
 *   2. Every probe uses a deliberately non-existent identifier, so even a
 *      total allowlist failure cannot reach a real record.
 * Ground 1 does NOT hold on a pre-allowlist run: OBSERVED 2026-08-18, the
 * write probes were forwarded to GHL and rejected upstream (400/422). Nothing
 * was modified, and ground 2 is the only reason. Do not weaken ground 2.
 *
 * Bodies are read ONLY on 403, where the payload is either the proxy's marker
 * or an upstream refusal. Never read on 2xx, so a successful read of a
 * sensitive endpoint cannot pass through this harness.
 *
 * Run:  node app/scripts/verify-proxy-boundary.cjs
 * Exit: 0 ok · 1 failures · 2 wrong check count · 3 threw · 4 name collision
 */

const ORIGIN = process.env.IAOS_ORIGIN
  || "https://app.investorautomationos.com";
const PROXY = `${ORIGIN}/.netlify/functions/ghl-proxy`;

// The configured production location. Must match app/shared/ghl-config.ts.
const LOC = "jmHG4B8RdzwpfqruNf68";

// Deliberately non-existent identifiers. No real record can be reached.
const FAKE_ID  = "ZZZZnotarealid000000";
const FAKE_LOC = "ZZZZnotarealloc00000";

// The proxy's self-identifying refusal marker.
const MARKER = "iaos-proxy-allowlist";

const FLOOR = 10;

let checksRun = 0;
let failures  = 0;
const seen = new Set();

function check(name, ok, detail) {
  if (seen.has(name)) {
    console.log(`ABORT — duplicate check name ${name}`);
    process.exit(4);
  }
  seen.add(name);
  checksRun += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
}

async function probe(method, path) {
  const url = path === null
    ? PROXY
    : `${PROXY}?path=${encodeURIComponent(path)}`;
  const res = await fetch(url, { method });
  let byProxy = false;
  if (res.status === 403) {
    byProxy = (await res.text()).includes(MARKER);
  }
  return { status: res.status, byProxy };
}

/** A refusal counts only when the proxy itself refused. */
function refused(r) {
  return r.status === 403 && r.byProxy;
}

function why(r) {
  if (r.status !== 403) return `got=${r.status} (upstream, not refused)`;
  return r.byProxy ? "got=403 by proxy" : "got=403 but NOT from the proxy";
}

(async () => {
  // ── The credential-exfiltration chain ────────────────────────────────
  let r = await probe("GET", `/locations/${LOC}/customValues`);
  check("boundary-customvalues-refused", refused(r),
    `${why(r)} — Custom Values hold a credential in plaintext`);

  r = await probe(
    "GET",
    `/contacts/${FAKE_ID}/../locations/${LOC}/customValues`,
  );
  check("boundary-compound-path-refused", refused(r),
    `${why(r)} — refused by non-match, not normalization`);

  // ── Methods ──────────────────────────────────────────────────────────
  r = await probe("DELETE", `/contacts/${FAKE_ID}`);
  check("boundary-delete-refused", refused(r),
    `${why(r)} — no caller anywhere issues DELETE`);

  // ── Unlisted paths ───────────────────────────────────────────────────
  r = await probe("GET", "/users");
  check("boundary-arbitrary-path-refused", refused(r), why(r));

  r = await probe("PUT", `/locations/${LOC}/customValues/${FAKE_ID}`);
  check("boundary-unlisted-write-refused", refused(r),
    `${why(r)} — write to a path outside the allowlist`);

  r = await probe("POST", `/contacts/${FAKE_ID}/tags`);
  check("boundary-unlisted-post-refused", refused(r), why(r));

  // ── Location scoping. GHL also answers 403 here, so the marker is what
  //    proves the proxy refused rather than the upstream. ───────────────
  r = await probe("GET", `/locations/${FAKE_LOC}/customFields`);
  check("boundary-foreign-location-path-refused", refused(r), why(r));

  r = await probe("GET", `/opportunities/search?location_id=${FAKE_LOC}`);
  check("boundary-foreign-location-query-refused", refused(r), why(r));

  // ── Preserved pre-Gate-1 contract ────────────────────────────────────
  r = await probe("GET", null);
  check("boundary-missing-path-400", r.status === 400, `got=${r.status}`);

  // ── Positive control ─────────────────────────────────────────────────
  r = await probe("GET", `/locations/${LOC}/customFields`);
  check("boundary-allowlisted-read-succeeds", r.status === 200,
    `got=${r.status} — a refusal here means the allowlist is too tight`);

  console.log(
    `checksRun=${checksRun} failures=${failures} floor=${FLOOR}`,
  );
  if (checksRun !== FLOOR) {
    console.log(`ABORT — expected exactly ${FLOOR} checks, ran ${checksRun}`);
    process.exit(2);
  }
  if (failures) process.exit(1);
  console.log("BOUNDARY GREEN");
})().catch((e) => {
  console.error("VERIFY-PROXY-BOUNDARY ERROR:", e.message);
  process.exit(3);
});
