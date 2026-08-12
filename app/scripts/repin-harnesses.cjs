/* Re-pin the EXPECTED bundle hash across all three verification harnesses in
   one command.

   WHY THIS EXISTS. The §9.2 bundle gate requires every harness to name the
   bundle it was run against, and that pin lives in THREE files. Edited by
   hand it has drifted on three separate occasions — each time a deploy
   re-pinned the harness under test and left the others behind, so the next
   run aborted at its gate against a bundle nobody had verified. One command
   that moves all three together removes the failure mode.

   USAGE
     node app/scripts/repin-harnesses.cjs
       Reads the served hash from ORIGIN/index.html with a cache-buster,
       using the SAME regex the harnesses' own bundle gates use. This is the
       normal path: it pins to what production actually serves, so a pin can
       never name a bundle that was never deployed.

     node app/scripts/repin-harnesses.cjs index-ABC123.js
       Uses the supplied hash instead — for pinning ahead of a deploy, when
       the local build's hash is known but Netlify has not published yet.

   VALIDATE-ALL-THEN-WRITE. Every file is read and checked before any file is
   written. A partial re-pin is WORSE than none: two harnesses would then
   verify a different bundle than the third, which is exactly the drift this
   script exists to prevent, and it would look like a completed re-pin. Any
   abort writes nothing at all.

   Line endings are preserved byte-for-byte — fs writes the string as given,
   with no CRLF translation. (A Python version of this task silently rewrote
   every line ending on Windows; that is the specific hazard being avoided.)

   Read-only against the network: a single GET of index.html, nothing else. */
const fs = require("fs");
const path = require("path");

const ORIGIN = "https://app.investorautomationos.com";

// Repo-root-relative, resolved from THIS file's location so the script works
// from any working directory.
const TARGETS = [
  "verify-contacts.cjs",
  "verify-conversations.cjs",
  "verify-dashboard.cjs",
].map((f) => path.join(__dirname, f));

// The pin's own shape, and the assignment that carries it. The assignment is
// matched by PATTERN, not by its current value — the caller never has to know
// the old hash, which is what made the hand-edits error-prone.
const HASH_RE = /^index-[A-Za-z0-9_-]+\.js$/;
const EXPECTED_RE = /^(const EXPECTED\s*=\s*")(index-[A-Za-z0-9_-]+\.js)(")/gm;

// The same extraction the harness bundle gates use, so this script and they
// can never disagree about what "the served hash" means.
const SERVED_RE = /assets\/(index-[A-Za-z0-9_-]+\.js)/;

function abort(reason, code) {
  console.log(`ABORT — ${reason}. Nothing written.`);
  process.exit(code);
}

(async () => {
  // ── 1. Resolve the new hash ────────────────────────────────────────────────
  let hash = process.argv[2];
  let source;
  if (hash) {
    source = "argument";
  } else {
    source = `${ORIGIN}/index.html`;
    let idx;
    try {
      const res = await fetch(`${ORIGIN}/index.html?cb=${Math.random()}`, {
        headers: { "Cache-Control": "no-cache" },
      });
      if (!res.ok) abort(`GET index.html returned ${res.status}`, 1);
      idx = await res.text();
    } catch (e) {
      abort(`could not fetch index.html: ${(e && e.message) || e}`, 1);
    }
    hash = (idx.match(SERVED_RE) || [])[1];
    if (!hash) abort("no bundle reference found in the served index.html", 1);
  }

  if (!HASH_RE.test(hash)) {
    abort(`"${hash}" is not a bundle filename (expected index-<hash>.js)`, 1);
  }
  console.log(`new hash: ${hash}   source: ${source}`);

  // ── 2-4. Read and validate ALL targets before writing ANY ─────────────────
  const plan = [];
  for (const file of TARGETS) {
    const name = path.basename(file);

    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (e) {
      abort(`${name}: cannot read (${(e && e.code) || e})`, 2);
    }

    const matches = [...text.matchAll(EXPECTED_RE)];
    if (matches.length !== 1) {
      abort(`${name}: expected exactly one EXPECTED assignment, found ${matches.length}`, 2);
    }

    const oldHash = matches[0][2];
    plan.push({ file, name, text, oldHash, noop: oldHash === hash });
  }

  // ── 5. All validated — now write ──────────────────────────────────────────
  // Only files that actually change are written, so a no-op run leaves mtimes
  // untouched and produces no diff.
  for (const item of plan) {
    if (item.noop) continue;
    const next = item.text.replace(EXPECTED_RE, `$1${hash}$3`);
    try {
      fs.writeFileSync(item.file, next, "utf8");
    } catch (e) {
      // Reaching here means an earlier write may have succeeded. Say so
      // plainly rather than reporting a clean failure — the tree is now in
      // exactly the mixed state this script exists to prevent.
      console.log(`ABORT — ${item.name}: write failed (${(e && e.code) || e}).`);
      console.log("WARNING — earlier files in this run MAY already be written. Check `git diff` before rerunning.");
      process.exit(3);
    }
  }

  // ── 6. Re-read and report what is actually on disk now ────────────────────
  let bad = 0;
  for (const item of plan) {
    const after = fs.readFileSync(item.file, "utf8");
    const now = ([...after.matchAll(EXPECTED_RE)][0] || [])[2] || "(none)";
    const state = item.noop ? "unchanged (already pinned)" : `${item.oldHash} -> ${now}`;
    if (now !== hash) bad++;
    console.log(`  ${item.name.padEnd(26)} ${state}`);
  }

  if (bad > 0) abort(`${bad} file(s) do not carry the new hash after writing`, 4);

  const changed = plan.filter((p) => !p.noop).length;
  console.log(`OK — ${changed} changed, ${plan.length - changed} already pinned, ${plan.length} total.`);
  process.exit(0);
})().catch((e) => {
  console.error("THREW:", (e && e.stack) || e);
  process.exit(5);
});
