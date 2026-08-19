#!/usr/bin/env node
"use strict";
/**
 * netlify-status.cjs — Gate 3 observer. Removes the human from between a
 * GitHub push and Netlify deployment state.
 *
 * Answers, per production site, without anyone opening a browser:
 *   Q1  what happened to the repo tip?      (deployed / skipped / failed / ...)
 *   Q2  is the published deploy the right one?
 * EXPECTED_BEHIND is the COMPOSITE of INTENTIONAL_SKIP + PUBLISH_CURRENT. It
 * is derived, never asserted, so "behind but fine" cannot be claimed without
 * both halves independently holding.
 *
 * THE DEPLOY LEDGER IS AUTHORITATIVE. This file does NOT reconstruct the
 * netlify.toml `ignore` rules. It cannot: $CACHED_COMMIT_REF is Netlify's last
 * BUILT commit and is invisible from here, and app/netlify.toml's `-- .` scope
 * depends on a base directory set in the Netlify UI, which the repo cannot
 * verify. Any local replication would be a second, drifting implementation of
 * a rule whose inputs are unobservable. So we read what Netlify decided
 * instead of re-deciding it.
 *
 * INTENTIONAL_SKIP has exactly ONE predicate in V1: the exact observed error
 * message. `deploy_time` is recorded as EVIDENCE ONLY and is deliberately NOT
 * part of the test. OBSERVED 2026-08-19 across 200 deploys (100 per site):
 * only two states exist, `ready` and `error`, and all 99 error deploys carry
 * that one message verbatim, every one of them with `deploy_time` absent.
 * A skip message arriving WITH deploy_time present has never been seen; if it
 * ever is, it lands in warnings[] as a newly observed case for a human
 * classification decision. Discover the distinction; do not architect it.
 *
 * KNOWN FALSE-RED EDGE — THE GRACE CLOCK. Grace is measured from the tip
 * commit's committer timestamp, which is NOT when it was pushed. After an
 * amend, rebase, or cherry-pick, a commit authored yesterday and pushed thirty
 * seconds ago reads as far past a 5-minute grace and returns NOT_SEEN_STALE on
 * a completely normal push. There is no clean fix in a stateless observer —
 * it would need push-event state this file deliberately does not keep. If you
 * see NOT_SEEN_STALE seconds after a rebase-and-push, this is why. Re-run
 * after Netlify picks the commit up, or raise --grace-seconds for that run.
 * `tipTimeSource` in the JSON records which clock produced the verdict.
 *
 * PAGINATION BLOCKS CLASSIFICATION ONLY WHEN THE WINDOW IS ACTUALLY SHORT.
 * A full page is not by itself evidence of truncation. What matters is whether
 * the fetched window reaches back PAST the tip commit's timestamp: if the
 * oldest deploy we hold predates the tip, then a tip with no deploy record was
 * genuinely never seen, and that is reportable. OBSERVED 2026-08-19: both
 * production sites return a full 100-deploy window as their steady state, so
 * keying on fullness alone made NOT_SEEN_STALE permanently unreachable — the
 * observer could never report the one failure it most needs to catch.
 *
 * FLOOR RULE, for this file's tests and any successor.
 *   On FIRST authorship the floor may be set from the first complete
 *   successful authored run. That is the baseline.
 *   After a baseline exists the floor may NEVER be changed merely to make a
 *   changed run pass. It moves only when checks are deliberately ADDED or
 *   REMOVED as an authored decision, and the reason belongs in the commit.
 *   A floor edited to match a surprising run is not a floor.
 *
 * SEVERITY PRECEDENCE is unhealthy > cannot_observe > indeterminate > healthy.
 * Unhealthy deliberately outranks cannot_observe: if one site is genuinely
 * failing while another is unreadable, a scheduler must ALERT on the failure
 * rather than retry past it. The unreadable site is still reported per-site
 * and in warnings[], so it is never silently dropped.
 *
 * READ-ONLY BY CONSTRUCTION, not by intent. The Netlify PAT carries write
 * authority; nothing about the credential enforces this. What enforces it:
 * getJson() is the ONLY fetch call site in this file, its method is the
 * hardcoded string 'GET', and no http/https/axios/node-fetch module is
 * imported anywhere. The GitHub tip is read through `gh api` with no -X and
 * no --method, which is a GET. netlify-status.test.cjs asserts all of this
 * statically against this file's own source.
 *
 * We NEVER call /accounts/{slug}/env — that endpoint returns secret VALUES.
 * This line exists so the non-use is grep-able.
 * We NEVER call GET /sites to enumerate — that would pull the out-of-scope
 * site goall-turnovercost back into scope by accident. The two in-scope ids
 * are hardcoded below.
 *
 * Run:   node scripts/netlify-status.cjs [--json] [--grace-seconds=N]
 * Exit:  0 healthy · 1 unhealthy · 2 cannot observe · 3 indeterminate by timing
 *
 * Missing, invalid, or expired auth is exit 2 with retryable:false and can
 * NEVER present as healthy.
 */

const { execFileSync } = require("node:child_process");

const SCHEMA_VERSION = 1;
const NETLIFY_API = "https://api.netlify.com/api/v1";
const PER_PAGE = 100;
const DEFAULT_GRACE_SECONDS = 300;
const GITHUB_REPO = "bradthompsonconsulting/investor-automation-os";
const GITHUB_BRANCH = "main";

// Resolved once via GET /sites on 2026-08-19 and hardcoded here so this file
// never enumerates the account. Keyed on id because Netlify site NAMES are
// mutable in the UI while ids are stable.
const SITES = [
  // investorautomationos.com — the marketing site.
  { name: "investor-automation-os", id: "08aeedcf-84c5-4a23-8d23-f5eb3712520a" },
  // app.investorautomationos.com — the IAOS application.
  { name: "iaos-app", id: "19fcbf6a-7c3c-40e3-af20-bd077f0f8ec8" },
  // goall-turnovercost (d7dae056-...) is OUT OF SCOPE and deliberately absent.
];

/** The exact observed no-content-change message. Sole INTENTIONAL_SKIP test. */
const SKIP_MESSAGE =
  "Failed during stage 'checking build content for changes': " +
  "Canceled build due to no content change";

/**
 * Positive allowlist of deploy states.
 *
 * OBSERVED 2026-08-19: only `ready` and `error` appear in 200 deploys. Every
 * other member of IN_FLIGHT_STATES is INFERRED from Netlify's documented
 * lifecycle and has never been seen here. That is precisely why the default
 * branch falls to UNKNOWN_STATE / exit 2: this allowlist is thinly exercised
 * and will eventually meet a state nobody predicted. The default IS the safety
 * mechanism, not a formality.
 */
const IN_FLIGHT_STATES = new Set([
  "new", "pending_review", "accepted", "enqueued", "building",
  "uploading", "uploaded", "preparing", "prepared", "processing",
  "processed", "retrying",
]);

const SEVERITY_RANK = {
  unhealthy: 0,
  cannot_observe: 1,
  indeterminate: 2,
  healthy: 3,
};
const SEVERITY_EXIT = {
  healthy: 0,
  unhealthy: 1,
  cannot_observe: 2,
  indeterminate: 3,
};

class ObserverError extends Error {
  constructor(code, message, retryable) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

// ── Pure classifier ────────────────────────────────────────────────────────
// No I/O, no network, no clock. Everything it needs arrives in `input`, which
// is exactly the shape the committed fixtures carry.

/**
 * @param {object} input
 *   site               {name, id}
 *   tip                {sha, committedAtIso}
 *   nowIso             string
 *   graceSeconds       number
 *   publishedDeployId  string|null
 *   deploys            newest-first array of
 *                      {id, commit_ref, state, context, branch,
 *                       error_message, deploy_time, created_at, updated_at}
 *   deploysWindowFull  boolean — the fetched page was full, so more may exist
 */
function classify(input) {
  const warnings = [];

  // Context/branch filtering lives HERE rather than in the caller so it is
  // part of the tested contract. A deploy-preview must never answer Q1.
  const deploys = (input.deploys || []).filter(
    (d) => d.context === "production" && d.branch === GITHUB_BRANCH,
  );

  // ── Q1: what happened to the tip? ────────────────────────────────────────
  const tipDeploys = deploys.filter((d) => d.commit_ref === input.tip.sha);
  const tipDeploy = tipDeploys.length > 0 ? tipDeploys[0] : null;
  if (tipDeploys.length > 1) {
    warnings.push(
      `${input.site.name}: ${tipDeploys.length} production deploys share the ` +
      `tip commit; classified on the newest (${tipDeploys[0].id}).`,
    );
  }

  // Does the fetched window reach back PAST the tip commit? If it does, the
  // absence of a deploy for the tip is a fact rather than an artifact of the
  // page size, even when the page came back full.
  //
  // The earlier form failed closed on deploysWindowFull alone. OBSERVED
  // 2026-08-19: both production sites return a full 100-deploy window as their
  // STEADY STATE, so that made NOT_SEEN_STALE unreachable in production — the
  // observer could never report "Netlify never saw this commit", which is one
  // of the failures it exists to catch. A permanently unreachable RED branch
  // is a false GREEN wearing a fail-closed costume.
  //
  // Uses the oldest PRODUCTION deploy rather than the oldest raw one. If
  // filtering removed older previews, that is a conservative lower bound on
  // reach and biases toward declaring truncation, which is the safe direction.
  const oldestDeploy = deploys.length ? deploys[deploys.length - 1] : null;
  const oldestMs = oldestDeploy && oldestDeploy.created_at
    ? Date.parse(oldestDeploy.created_at)
    : null;
  const tipMs = Date.parse(input.tip.committedAtIso);
  const windowReachesBackToTip = !input.deploysWindowFull
    || (oldestMs !== null && Number.isFinite(oldestMs) && oldestMs < tipMs);

  let q1;
  if (tipDeploy === null) {
    if (!windowReachesBackToTip) {
      // The window is full AND its oldest entry is newer than the tip commit,
      // so deploys may exist beyond it. "Not found" cannot be distinguished
      // from "not fetched". Fail closed.
      q1 = "PAGINATION_TRUNCATED";
    } else {
      const ageSeconds = (Date.parse(input.nowIso) - tipMs) / 1000;
      q1 = ageSeconds <= input.graceSeconds ? "NOT_YET_SEEN" : "NOT_SEEN_STALE";
    }
  } else if (IN_FLIGHT_STATES.has(tipDeploy.state)) {
    q1 = "IN_FLIGHT";
  } else if (tipDeploy.state === "ready") {
    q1 = "DEPLOYED";
  } else if (tipDeploy.state === "error") {
    if (tipDeploy.error_message === SKIP_MESSAGE) {
      q1 = "INTENTIONAL_SKIP";
      if (tipDeploy.deploy_time !== null && tipDeploy.deploy_time !== undefined) {
        warnings.push(
          `${input.site.name}: NEWLY OBSERVED — a deploy carries the ` +
          `no-content-change message WITH deploy_time=${tipDeploy.deploy_time}. ` +
          `Every skip observed to date had deploy_time absent. This may be a ` +
          `genuine post-build content dedupe rather than an ignore-rule skip. ` +
          `Bring it back for a classification decision; do not assume.`,
        );
      }
    } else {
      q1 = "DEPLOY_FAILURE_CANDIDATE";
    }
  } else {
    q1 = "UNKNOWN_STATE";
  }

  // ── Q2: is the published deploy the newest ready one? ────────────────────
  const readyDeploys = deploys.filter((d) => d.state === "ready");
  let q2;
  if (!input.publishedDeployId || readyDeploys.length === 0) {
    q2 = "PUBLISH_UNKNOWN";
  } else if (readyDeploys[0].id === input.publishedDeployId) {
    q2 = "PUBLISH_CURRENT";
  } else {
    q2 = "PUBLISH_LAGGING";
  }

  // ── Composite. Order is the severity precedence. ─────────────────────────
  let composite;
  let severity;
  if (q1 === "PAGINATION_TRUNCATED" || q1 === "UNKNOWN_STATE") {
    composite = q1;
    severity = "cannot_observe";
  } else if (q2 === "PUBLISH_UNKNOWN") {
    composite = "PUBLISH_UNKNOWN";
    severity = "cannot_observe";
  } else if (q1 === "DEPLOY_FAILURE_CANDIDATE" || q1 === "NOT_SEEN_STALE") {
    composite = q1;
    severity = "unhealthy";
  } else if (q2 === "PUBLISH_LAGGING") {
    composite = "PUBLISH_LAGGING";
    severity = "unhealthy";
  } else if (q1 === "IN_FLIGHT" || q1 === "NOT_YET_SEEN") {
    composite = q1;
    severity = "indeterminate";
  } else if (q1 === "INTENTIONAL_SKIP") {
    composite = "EXPECTED_BEHIND";
    severity = "healthy";
  } else {
    composite = "DEPLOYED";
    severity = "healthy";
  }

  // Retrying helps only when time is the missing ingredient. A build failure,
  // an unrecognized state, and a truncated window all need a human or a code
  // change; retrying those forever is the failure mode this field prevents.
  const retryable = severity === "indeterminate";

  const publishedDeploy = input.publishedDeployId
    ? deploys.find((d) => d.id === input.publishedDeployId) || null
    : null;

  return {
    name: input.site.name,
    id: input.site.id,
    q1,
    q2,
    composite,
    severity,
    retryable,
    evidence: {
      tipDeployId: tipDeploy ? tipDeploy.id : null,
      tipDeployState: tipDeploy ? tipDeploy.state : null,
      tipDeployErrorMessage: tipDeploy ? (tipDeploy.error_message ?? null) : null,
      // Evidence only — NOT a classification predicate in V1.
      tipDeployTimeSeconds: tipDeploy ? (tipDeploy.deploy_time ?? null) : null,
      tipDeployWallSeconds: tipDeploy ? wallSeconds(tipDeploy) : null,
      tipDeployCreatedAt: tipDeploy ? (tipDeploy.created_at ?? null) : null,
      publishedDeployId: input.publishedDeployId || null,
      publishedCommit: publishedDeploy ? publishedDeploy.commit_ref : null,
      newestReadyDeployId: readyDeploys.length ? readyDeploys[0].id : null,
      productionDeploysInWindow: deploys.length,
      deploysWindowFull: Boolean(input.deploysWindowFull),
      windowOldestCreatedAt: oldestDeploy ? (oldestDeploy.created_at ?? null) : null,
      windowReachesBackToTip,
    },
    warnings,
  };
}

/** Wall-clock seconds between created_at and updated_at, when both exist. */
function wallSeconds(d) {
  if (!d.created_at || !d.updated_at) return null;
  const ms = Date.parse(d.updated_at) - Date.parse(d.created_at);
  return Number.isFinite(ms) ? Math.round(ms / 1000) : null;
}

/** Worst severity across sites, by SEVERITY_RANK. */
function worstSeverity(siteResults) {
  let worst = "healthy";
  for (const s of siteResults) {
    if (SEVERITY_RANK[s.severity] < SEVERITY_RANK[worst]) worst = s.severity;
  }
  return worst;
}

/** Build the canonical result object. The human view renders FROM this. */
function buildResult(parts) {
  const overallSeverity = worstSeverity(parts.sites);
  const driving = parts.sites.filter((s) => s.severity === overallSeverity);
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAtIso: parts.nowIso,
    graceSeconds: parts.graceSeconds,
    tip: parts.tip,
    overall: {
      status: overallSeverity,
      exitCode: SEVERITY_EXIT[overallSeverity],
      retryable: driving.some((s) => s.retryable),
    },
    sites: parts.sites,
    warnings: parts.warnings,
  };
}

// ── I/O shell ──────────────────────────────────────────────────────────────

/**
 * The ONLY network call site in this file. Method is the hardcoded string
 * 'GET'. Errors re-emit a status code and a fixed message and NEVER the raw
 * error or request object — some clients attach request headers, which carry
 * the bearer token.
 */
async function getJson(url, token) {
  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
  } catch {
    throw new ObserverError("NETWORK", "network error contacting Netlify", true);
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new ObserverError(
        "AUTH",
        `Netlify rejected the credential (HTTP ${res.status}). ` +
        "Retrying will not help; the token needs replacing.",
        false,
      );
    }
    if (res.status === 404) {
      throw new ObserverError(
        "SITE_NOT_FOUND",
        "Netlify returned HTTP 404 for a hardcoded site id",
        false,
      );
    }
    throw new ObserverError(
      "HTTP",
      `Netlify GET returned HTTP ${res.status}`,
      res.status >= 500 || res.status === 429,
    );
  }
  try {
    return await res.json();
  } catch {
    throw new ObserverError("PARSE", "Netlify response was not valid JSON", true);
  }
}

const GH_BIN = process.env.NETLIFY_STATUS_GH
  || "C:\\Program Files\\GitHub CLI\\gh.exe";

/**
 * Authoritative tip from the GitHub API. NEVER local HEAD — unpushed commits
 * would name a tip Netlify can never deploy, a permanent false RED. `gh api`
 * with no -X and no --method is a GET.
 */
function readTipFromGitHub() {
  const out = execFileSync(
    GH_BIN,
    ["api", `repos/${GITHUB_REPO}/commits/${GITHUB_BRANCH}`],
    { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] },
  );
  const commit = JSON.parse(out);
  return {
    sha: commit.sha,
    committedAtIso: commit.commit.committer.date,
    source: "github-api",
    tipTimeSource: "github:commit.committer.date",
  };
}

/**
 * Fallback only, and only with a loud warning. Reads the remote-tracking ref
 * as it already stands on disk. Deliberately does NOT run `git fetch` —
 * fetching mutates local refs and violates the read-only posture even though
 * it is not a Netlify write, which means this ref can be arbitrarily stale.
 */
function readTipFromOriginMain() {
  const git = (args) =>
    execFileSync("git", args, {
      encoding: "utf8",
      timeout: 15000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  return {
    sha: git(["rev-parse", `origin/${GITHUB_BRANCH}`]),
    committedAtIso: git(["show", "-s", "--format=%cI", `origin/${GITHUB_BRANCH}`]),
    source: "origin/main-fallback",
    tipTimeSource: "git:origin/main committer date",
  };
}

function resolveTip(warnings) {
  try {
    return readTipFromGitHub();
  } catch {
    // Never surface the subprocess error object; it can echo argv and env.
    warnings.push(
      "TIP SOURCE DEGRADED — the GitHub API was unreachable via gh, so the " +
      "tip came from the local origin/main ref. That ref is NOT fetched by " +
      "this observer and may be arbitrarily stale, so every verdict below is " +
      "relative to a possibly-old tip. Treat a GREEN result as unconfirmed.",
    );
  }
  try {
    return readTipFromOriginMain();
  } catch {
    throw new ObserverError(
      "NO_TIP",
      "could not determine the repo tip from either the GitHub API or origin/main",
      false,
    );
  }
}

async function observeSite(site, token) {
  const siteJson = await getJson(`${NETLIFY_API}/sites/${site.id}`, token);
  const deploysJson = await getJson(
    `${NETLIFY_API}/sites/${site.id}/deploys?per_page=${PER_PAGE}`,
    token,
  );
  const deploys = (Array.isArray(deploysJson) ? deploysJson : []).map((d) => ({
    id: d.id,
    commit_ref: d.commit_ref,
    state: d.state,
    context: d.context,
    branch: d.branch,
    error_message: d.error_message ?? null,
    deploy_time: d.deploy_time ?? null,
    created_at: d.created_at ?? null,
    updated_at: d.updated_at ?? null,
  }));
  return {
    publishedDeployId:
      (siteJson.published_deploy && siteJson.published_deploy.id) || null,
    deploys,
    deploysWindowFull: deploys.length >= PER_PAGE,
  };
}

// ── Rendering. Human text is derived from the canonical object, in the same
//    process, so the two views cannot drift. ──────────────────────────────────

function renderHuman(result) {
  const lines = [];
  lines.push(
    `NETLIFY STATUS  tip=${result.tip.sha.slice(0, 7)}  ` +
    `source=${result.tip.source}  grace=${result.graceSeconds}s`,
  );
  lines.push("");
  for (const s of result.sites) {
    lines.push(`${s.name}`);
    lines.push(`  verdict     ${s.composite}  [${s.severity}]`);
    lines.push(`  tip outcome ${s.q1}`);
    lines.push(`  publish     ${s.q2}`);
    const e = s.evidence;
    lines.push(
      `  evidence    tipDeploy=${e.tipDeployId || "none"} ` +
      `state=${e.tipDeployState || "-"} ` +
      `deploy_time=${e.tipDeployTimeSeconds ?? "absent"} ` +
      `wall=${e.tipDeployWallSeconds ?? "-"}s`,
    );
    lines.push(
      `              published=${e.publishedDeployId || "none"} ` +
      `commit=${e.publishedCommit ? e.publishedCommit.slice(0, 7) : "-"} ` +
      `newestReady=${e.newestReadyDeployId || "none"} ` +
      `window=${e.productionDeploysInWindow}${e.deploysWindowFull ? " FULL" : ""}`,
    );
    if (e.tipDeployErrorMessage) {
      lines.push(`              message="${e.tipDeployErrorMessage}"`);
    }
    lines.push("");
  }

  // warnings[] surface EVEN ON A GREEN RUN. Anything healthy-but-notable is
  // invisible otherwise, which would defeat the point of distinguishing it.
  const allWarnings = result.warnings.concat(
    ...result.sites.map((s) => s.warnings),
  );
  if (allWarnings.length) {
    lines.push(`WARNINGS (${allWarnings.length})`);
    for (const w of allWarnings) lines.push(`  ! ${w}`);
    lines.push("");
  } else {
    lines.push("WARNINGS  none");
    lines.push("");
  }

  lines.push(
    `OVERALL ${result.overall.status.toUpperCase()}  ` +
    `exit=${result.overall.exitCode}  retryable=${result.overall.retryable}`,
  );
  return lines.join("\n");
}

function emitFailure(asJson, code, message, retryable) {
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    overall: {
      status: "cannot_observe",
      exitCode: SEVERITY_EXIT.cannot_observe,
      retryable,
    },
    error: { code, message },
    sites: [],
    warnings: [message],
  };
  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`NETLIFY STATUS — CANNOT OBSERVE (${code})`);
    console.log(`  ${message}`);
    console.log(
      `OVERALL CANNOT_OBSERVE  exit=${SEVERITY_EXIT.cannot_observe}  ` +
      `retryable=${retryable}`,
    );
  }
  return SEVERITY_EXIT.cannot_observe;
}

async function main(argv) {
  const asJson = argv.includes("--json");
  const graceArg = argv.find((a) => a.startsWith("--grace-seconds="));
  const graceSeconds = graceArg
    ? Number(graceArg.split("=")[1])
    : DEFAULT_GRACE_SECONDS;
  if (!Number.isFinite(graceSeconds) || graceSeconds < 0) {
    return emitFailure(asJson, "BAD_ARG", "--grace-seconds must be a non-negative number", false);
  }

  // Token from the environment ONLY. Never argv — argv is world-readable in
  // the process list. Never a file. Never printed.
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (!token) {
    return emitFailure(
      asJson,
      "NO_TOKEN",
      "NETLIFY_AUTH_TOKEN is not set in the environment",
      false,
    );
  }

  const warnings = [];
  let tip;
  try {
    tip = resolveTip(warnings);
  } catch (e) {
    return emitFailure(asJson, e.code || "NO_TIP", e.message, e.retryable === true);
  }

  // Captured ONCE, before any site is read, so a push landing mid-run cannot
  // make the two sites disagree about what the tip is.
  const nowIso = new Date().toISOString();

  const siteResults = [];
  for (const site of SITES) {
    let observed;
    try {
      observed = await observeSite(site, token);
    } catch (e) {
      if (!(e instanceof ObserverError)) throw e;
      return emitFailure(
        asJson,
        e.code,
        `${site.name}: ${e.message}`,
        e.retryable === true,
      );
    }
    siteResults.push(
      classify({
        site,
        tip: { sha: tip.sha, committedAtIso: tip.committedAtIso },
        nowIso,
        graceSeconds,
        publishedDeployId: observed.publishedDeployId,
        deploys: observed.deploys,
        deploysWindowFull: observed.deploysWindowFull,
      }),
    );
  }

  const result = buildResult({
    nowIso,
    graceSeconds,
    tip: {
      sha: tip.sha,
      committedAtIso: tip.committedAtIso,
      source: tip.source,
      tipTimeSource: tip.tipTimeSource,
    },
    sites: siteResults,
    warnings,
  });

  console.log(asJson ? JSON.stringify(result, null, 2) : renderHuman(result));
  return result.overall.exitCode;
}

module.exports = {
  classify,
  buildResult,
  renderHuman,
  worstSeverity,
  SKIP_MESSAGE,
  SCHEMA_VERSION,
  SEVERITY_EXIT,
  DEFAULT_GRACE_SECONDS,
};

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => {
      // Last-resort guard. Print the message only, never the error object.
      console.log(`NETLIFY STATUS — CANNOT OBSERVE (UNEXPECTED)`);
      console.log(`  ${e && e.message ? e.message : "unknown failure"}`);
      console.log("OVERALL CANNOT_OBSERVE  exit=2  retryable=false");
      process.exit(2);
    });
}
