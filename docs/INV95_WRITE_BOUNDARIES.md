# INV-95 — write boundary inventory and rollout gate

Baseline: a32b4d165c8211e7a9a9c9c3e90eaea2e637e9cc, fetched and matched to origin refs/heads/main on 2026-09-18 UTC. The initial baseline was 2cb8d1b9da9c3f86b5ab35bf53d330af8d6609e0; the isolated branch was fast-forwarded after INV-67 merged. The initial security tranche did not change INV-67 files; the V1 correction
below retires its obsolete runtime writers while preserving computation.

Authority: AGENTS.md; INV-95 read directly from Linear including Brad's application identity and root webhook rulings; existing IAOS_PIPELINE_WRITE_SAFETY_AUDIT.md; Brad's 2026-09-18 V1 correction: direct PDF population and manual GHL upload/send. The earlier Test-template binding interpretation is superseded. INV-95's narrow operation rulings govern this change; they do not authorize workflow or stage writes. Board #13 and voice authorization remain separate.

## OBSERVED — runtime before/after inventory

Sources: baseline app/src/lib/ghl.ts, app/src/pages/Pipeline.tsx, app/netlify/functions/ghl-proxy.ts, the three contract endpoints, ghl-disposition.ts, and root netlify/functions/*.ts. Historical pre-correction source scan: [write-path-scan.txt](evidence/inv95/write-path-scan.txt).

| Before | After named server operation | Allowed destination / guard |
|---|---|---|
| contacts.setLastCallAttempt via generic PUT | contact.lastCallAttempt | Only DATE and precise timestamp pair; fresh contact/location; exact paired readback |
| contacts.setCallbackDatetime via generic PUT | contact.callback | Only DATE and precise callback pair; set or clear; exact readback |
| contacts.setPropertyNotes | contact.propertyNotes | Only property notes TEXT |
| contacts.setArv | contact.arv | Only existing legacy contact ARV MONETARY field; no repair field |
| contacts.setCallDisposition | contact.disposition | Only existing six disposition choices |
| contacts.setCallRouting | contact.routing | Only two routing choices; nurture requires No Answer/Voicemail |
| contacts.setDispositionAt | contact.dispositionAt | Only timestamp; confirmed disposition and Follow Up callback prerequisite |
| contacts.setOccupancyStatus | contact.occupancy | Existing three choices or clear; SINGLE_OPTIONS serialization |
| notes.create (Dashboard, Contact/Seller Call/Contract workspaces, callback, ARV history) | note.create | Only body on validated contact; canonical structured carriers parsed, opportunity ownership checked; malformed reserved headers rejected |
| tasks.complete | task.complete | Exact task/contact, only completed=true; independent exact task readback |
| Opportunity asking price | opportunity.askingPrice | Only own askingPrice field, existing amount/clear semantics |
| Approved ARV | opportunity.arv | Only own ARV field; positive amount; valuation note must match fresh amount; existing Brad Thompson display name retained |
| Approved repairs | opportunity.repairs | Only own Repairs field, nonnegative amount; no restored contact repair writer |
| Current Offer | opportunity.currentOffer | Only provisioned field; positive amount; Agreement Reached freezes it |
| Assignment mode | opportunity.assignmentMode | Only existing exact option labels |
| Underwriting batch | opportunity.underwriting | Only End Buyer Max Price, Seller MAO and Assignment Mode; per-field readback retained |
| TREC projections and Seller Count | Retired | No contract.projection writer; canonical computation retained for direct PDF population |
| Draft request | Retired | No contract.draftRequest writer or workflow-request control |
| Contract reservation note endpoint | Retired endpoint | POST requires app identity, then returns 410; no GHL or Blob access |
| Contract send endpoint | Retired endpoint | POST requires app identity, then returns 410; no template-send request exists |
| Contract send readback | ghl-contract-send-readback (read only) | App identity and Test gates; exact document/recipient/sender/location; duplicate identities refused |
| Pipeline Move To / updateStage | Removed | No stage writer remains in browser or generic proxy |
| Generic proxy POST/PUT forwarding | Removed | Proxy accepts allowlisted GET only, no body or extra envelope fields; all other methods rejected |
| Root motivation-score | Dedicated S2S authenticated score operation | Only motivation_score, deal_score, combined_score, data_completeness_score plus hot/warm/low add/remove; fresh target; four-field and bucket readback; scoring algorithm unchanged |
| Root phone-lookup | Dedicated S2S authenticated lookup-result operation | Existing provider lookup/mapping behavior; exact fresh contact phone match; unique phone_type field definition; only that field and exact readback |
| App ghl-disposition webhook | Existing dedicated S2S disposition operation | Existing customData contract, six dispositions, known contact; serialized dedupe, exact note and timestamp-pair readback; note-success/attempt-failure retry retained |
| scripts/rescore-all.ts caller | Dedicated score secret header | Explicit credential file only; missing/short secret refuses before network in write mode; existing target/mutation/dry-run gates retained |

All app mutations use the distinct iaos-app-write session, not voice credentials. Each operation has exact envelope/argument keys. Generic field, method, path, workflow, tags (outside scoring), stage and do_not_mail mutation are unavailable. Authentication/allowlist configuration fails closed.

Structured notes retain their existing carriers. System-derived authorization, send acceptance, provider lifecycle, execution and disposition handoff evidence is independently checked against fresh canonical GHL evidence. Human facts and the existing manual executed-PDF hash/visual-attestation bridge remain operator attestations; this change does not introduce document storage or claim server custody of PDF bytes. Corrections, rescissions and resend/decline records reuse existing model guards.

Security receipts in the app's iaos-write-receipts Netlify Blob store contain hashes, field identifiers and request outcomes, not copied business records. GHL remains the business system of record. Atomic per-contact locks serialize retained application writes and disposition dedupe. A process interruption leaves a lock closed; it must not be expired or deleted blindly. Root score/phone operations retain convergent repeated assignments; their payloads have no event ID and this change does not invent one or change provider lookup behavior.

## OBSERVED — maintenance and non-GHL paths

The source scan also includes manually invoked inert-proof scripts, INV-67 field provisioning scripts, INV-70 migration/proof scripts and rescore-all. They are not browser/runtime proxy entrypoints. None was executed. Historical scripts using proxy PUT now receive 403; they are not a bypass and require separately authorized future proof tooling. Direct administrative scripts retain their existing explicit mutation gates and credentials; they are outside the runtime implementation scope. Root/provider helpers and mailer-digest's email POST are not browser GHL forwarding. No mailer or voice files were changed.

## V1 architecture ruling - 2026-09-18

Brad retired contract.projection and contract.draftRequest as GHL writes.
The canonical contract-ghl-projection-model.ts and buildContractProjectionPlan
remain unchanged computation for direct PDF population. Their names do not
authorize GHL merge-field writes or template binding.

Automated template reserve/execute is structurally retired, not feature-flagged.
The browser has no send/reserve or projection/draft writer. The workspace
instructs the operator to review the populated PDF, upload it to GHL Documents
& Contracts and send manually. The notice does not assert Contract Sent.

Application authentication, GET-only proxy, non-contract named writes, generic
receipts/locks, independent document readback, note validation, webhook auth
and disposition hardening remain. Historical carriers and validation remain
readable; their existence does not authorize the retired operations.

No new PDF generation, manual-send ledger, provider integration, or rollout
is introduced by this correction. No GHL/configuration mutation is authorized.
## Configuration/deployment plan — not executed; merge gate

| Surface / caller | Required configuration | Proof required before merge or later authorized rollout |
|---|---|---|
| App Google write sign-in | IAOS_APP_WRITE_GOOGLE_CLIENT_ID, IAOS_APP_WRITE_SESSION_SECRET (at least 32 characters), IAOS_APP_WRITE_BRAD_EMAILS | Confirm Brad-owned allowlist, Google web client and authorized app origin; distinct audience iaos-app-write; voice settings unchanged; absent/invalid configuration denies writes |
| Root motivation-score | IAOS_MOTIVATION_WEBHOOK_SECRET (at least 32 characters), existing GHL_API_TOKEN and IAOS_ENV | Inventory every authorized caller; provision a distinct secret through approved secret management; each caller supplies X-IAOS-Secret before endpoint enforcement is deployed |
| Root phone-lookup | IAOS_PHONE_LOOKUP_WEBHOOK_SECRET (at least 32 characters), existing GHL_API_TOKEN / IAOS_ENV and unchanged provider configuration | CONTACT_WORKSPACE_SPEC_v2.md §5.6 documents Phone Type Validation's Contact Created caller and canonical contactId/phone body, historically unauthenticated. Verify current caller and header capability; coordinated secret/header rollout is mandatory |
| rescore-all | IAOS_MOTIVATION_WEBHOOK_SECRET in its explicitly named credential file | New preflight prevents a partial bulk run caused by a missing secret; do not run until separately authorized; dry-run semantics preserved |
| App disposition | Existing IAOS_WEBHOOK_SECRET and GHL_PRIVATE_API_KEY / IAOS_ENV | Existing caller header remains compatible; new app session cannot authorize it |
| App security receipts | Netlify Blob runtime binding for iaos-write-receipts | Verify runtime availability in an authorized isolated environment; conditional-create and strong-read support; root phone/score have no new Blob dependency |

Rollout sequence, requiring separate authorization: (1) inspect caller registry and configuration names without exposing values; (2) provision each root secret and caller header first, while old handler tolerates the added header; (3) provision app auth and receipt runtime bindings; (4) prove caller/header/target pairing in an authorized isolated test without real-contact effects; (5) record caller owners, endpoint, environment, exact payload, header-present evidence and validation time; (6) only then approve merge/deployment. This task authorizes neither these operational changes nor a deployment. Do not temporarily accept unauthenticated calls as a migration fallback.

If no safe test mechanism exists for a caller, merge stays blocked pending an authorized rollout window. Never log secret values or tokens. For a crashed write lock, first identify the request, inspect GHL readback and ledger evidence, determine whether an irreversible send occurred, then obtain specific operational authorization before releasing that security lock. Rolling code back must not be used to reopen unauthenticated writes.

UNKNOWN: current live caller registry, installed secrets/header values, Google origin setup, and deployed Blob binding availability. Repository evidence cannot prove those live settings. The plan establishes a fail-closed pre-merge gate; it is not a claim that missing-secret rollout continuity has already been proven.

## Verification

Run node app/scripts/test-inv95.cjs for affected offline suites; CI runs it in addition to all existing authoritative checks. Literal local outputs and exit codes are in evidence/inv95/. Mocked handler tests intercept every outbound call; no GHL, provider, Production or deployment call was made by these tests. The existing Windows exit-contract runtime limitation is not repaired; authoritative Ubuntu CI must provide that result.

Use [skip netlify] in the commit message and PR title to suppress branch and preview deployment while GitHub CI runs, per [Netlify deploy controls](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/#skip-a-deploy). No deployment setting changes are part of this issue.

## Historical provider-free Test checkpoint - superseded V1 scope

The following two checkpoints preserve earlier observations, not current
authorization. Template binding, merge-field population and automated send
are retired by the V1 ruling above. The earlier cleanup statement applies
only before the later provisioning checkpoint. No Test proof resumes here.

Authority: Brad authorized a narrower provider-free Test gate in this task.
This supersedes the earlier no-Test-configuration authorization statement only
for isolated Test work. Production, provider access, successful contract send,
Board 9/13 changes and merge remain prohibited. PR 78 remains draft.

### 1. Proven offline (OBSERVED)

Current origin/main was fetched and matched to the remote ref:
`a32b4d165c8211e7a9a9c9c3e90eaea2e637e9cc`.
Implementation head inspected: `480abc848f2a5ecc2c9ae983490f79b0d2c38af1`.
The 22 affected suites passed again, with literal output and exit codes in
[provider-free-offline.txt](evidence/inv95/provider-free-offline.txt).
The run uses mocked Google, GHL, provider and Blob responses. Mocked phone
success is not a live provider call or a deployed integration proof.

Covered offline: application identity and audience rejection, absent config,
expired sessions, Google claim/allowlist rejection, named operation contracts,
identity/field/path/transition rejection, generic proxy write rejection,
replay/duplicate handling, ambiguous/partial readback refusal, dedicated
webhook authentication, canonical TREC binding and existing Test send gates.
The receipt mock proves application handling of conditional-create results;
it does not prove Netlify's deployed storage consistency or availability.
Voice source, shared GHL config and both netlify.toml files are unchanged.
The earlier CI-attachment claim was not verified during reconciliation;
fresh Ubuntu CI for the correction remains required after an authorized push.

### 2. Isolated Test runtime (OBSERVED / UNKNOWN)

OBSERVED in the authenticated Netlify management UI, without revealing secrets:

- Existing project: `iaos-app-test`, under team `brad-l9cfmku`.
- Project URL: https://app.netlify.com/projects/iaos-app-test/overview
- Its published main is a32b4d1. This is not the INV-95 runtime.
- Deployment search filtered to `codex/inv-95-write-boundaries` returned
  `No deploys found`. No PR 78 preview URL was returned or invoked.
- Environment-variable inventory showed only IAOS_ENV and IAOS_VOICE_ENABLED.
  IAOS_ENV's Deploy Previews value was explicitly observed as `test`.
  The voice value was not revealed or changed.
- GHL_PRIVATE_API_KEY and the three IAOS_APP_WRITE_* variables were absent
  from that visible project inventory. No secret values were inspected.
- The manual Trigger deploy menu offered Deploy project / without cache,
  with no PR-specific selection. Neither action was invoked.
- The repository is connected to multiple Netlify projects. The PR's
  [skip netlify] marker was retained; removing it is not a Test-site-only
  deployment control. No other project's configuration was accessed.

INFERRED: the existing Test project's preview is a suitable candidate after
safe deployment and configuration are established. It is not yet a proven
runtime. The expected PR-number URL convention is not proof of a deploy.

UNKNOWN: Google web-client identity and authorized preview origin, Brad's
Google-verified email, deployed auth behavior, GHL Test credential binding,
Blob availability/atomicity/strong readback, and live caller continuity.
The Netlify account email is not proof of Brad's Google application identity.
No live proof in the requested provider-free scope is claimed completed.

The app preview deploys app/netlify/functions; root phone/score handlers live
under netlify/functions. An app preview alone cannot prove those root
endpoints. They need a separately isolated Test deployment for live negative
webhook probes; never use the public marketing endpoint for this gate.

### Blob isolation and safe resumption

The code uses getStore("iaos-write-receipts"). Netlify documents getStore as
site-wide, shared across deploy contexts, not a preview-isolated store:
https://docs.netlify.com/build/data-and-storage/netlify-blobs/
Thus do not use a preview on the Production app project for this proof.
Use only the separate Test project, unique disposable request/contact IDs,
and record each created receipt key for exact cleanup. Never empty a shared
store or delete an unresolved contact lock without readback investigation.
No Blob was created, read or deleted in this gate attempt.

Required before resumption: establish an exact-head preview on iaos-app-test
only, without triggering other projects; securely provision a GHL key limited
to Test location SoTgVoaFGHtBdRFvXWQV and a separate Google web client with the
verified preview origin; establish Brad's Google email. Configure only the
preview context: IAOS_ENV=test, GHL_PRIVATE_API_KEY,
IAOS_APP_WRITE_GOOGLE_CLIENT_ID, IAOS_APP_WRITE_SESSION_SECRET (32+ characters),
IAOS_APP_WRITE_BRAD_EMAILS, and IAOS_WEBHOOK_SECRET for disposition proof.
Do not paste secret values into the task or reuse voice authorization.

App requests require Authorization: Bearer with audience iaos-app-write;
webhook requests require X-IAOS-Secret. The isolated root Test runtime would
also need GHL_API_TOKEN and its dedicated IAOS_MOTIVATION_WEBHOOK_SECRET /
IAOS_PHONE_LOOKUP_WEBHOOK_SECRET. Successful phone lookup stays excluded.
No provider credentials should be provisioned for this gate.

Before any live write: verify location and disposable ownership, record exact
before state, use an approved inert non-provider operation, independently
read back, then restore/delete only the disposable proof records and exact
receipts. Remove temporary preview secrets/capability afterward. No rollback
may restore unauthenticated writes. No existing Test contact is automatically
classified as disposable merely because it is in the Test location.

### 3. Deferred integration proof: successful phone lookup

Brad explicitly excluded live Twilio-backed success. Preserve provider
behavior. This is a deferred integration proof, not a provider-free gate
failure. Offline success and live authentication rejection are distinct.

### 4. Historical deferred send proof - superseded, not a V1 gate

Brad explicitly excluded successful sending pending Board 9 population
promotion. POPULATION_NOT_VERIFIED and the fixed approved-recipient gate
remain intact. Canonical TREC binding has offline proof; no live send is
claimed. This is a deferred integration proof, not a provider-free failure.

### Cleanup and disposition

No deployment, environment mutation, GHL record creation/write, Blob mutation,
provider call, Production access or credential exposure occurred. Cleanup and
rollback are therefore not required. Only this report and offline evidence
were changed. Missing runtime/configuration evidence keeps the provider-free
gate incomplete independently of the two approved deferred integrations.
Recommendation: Block review-ready promotion; keep PR 78 draft. Do not silently
waive acceptance or caller-continuity requirements for either deferred proof.

## Historical Test credential provisioning checkpoint - 2026-09-18 UTC

This update supersedes the earlier unprovisioned configuration findings.
Brad clarified that no voice OAuth project or client was ever provisioned:
INV-93 stopped before operational provisioning. No existing voice client was
reused or modified. The source voice authorization remains unchanged.

OBSERVED in Google Cloud and Netlify UI:

- Personal owner selected by Brad: bradt75@gmail.com.
- Created project IAOS Test Authentication, ID iaos-test-authentication,
  under No organization. No billing or free trial was activated.
- Brad completed the Google API Services policy consent interactively.
- OAuth audience is External, publishing status Testing, with exactly one
  test user: brad@bradthompsonconsulting.com.
- Created one Web client: IAOS Test Application Write - INV-95.
- Its sole JavaScript origin is https://iaos-app-test.netlify.app, verified
  from the existing Test project's Netlify management page. No redirect URI
  was configured: app/public/app-write-login.js uses the GSI callback.
- No PR-preview origin was guessed or added. An exact-head preview is still
  required before adding its verified origin and proving live sign-in.
- Stored IAOS_APP_WRITE_GOOGLE_CLIENT_ID, IAOS_APP_WRITE_BRAD_EMAILS and
  IAOS_APP_WRITE_SESSION_SECRET in project iaos-app-test. Each was marked
  secret, Functions scope only, with one value in Deploy Previews only.
  Production, branch, local and agent-runner values were left unset.
- Created GHL integration IAOS INV-95 Provider-Free Test Gate in Test
  location SoTgVoaFGHtBdRFvXWQV, with only contacts.readonly and
  contacts.write (2 of 162 scopes). No existing integration was altered.
- Its token was transferred directly in memory into GHL_PRIVATE_API_KEY,
  marked secret, Functions / Deploy Previews only on iaos-app-test.
  No token, client ID or signing-secret value is included in this evidence.

The OAuth client secret is not used by this Google ID-token callback flow.
It was not transferred to Netlify, written to a file or emitted in output.
Google creation-screen observations were suppressed and redacted before
reporting; credential values were not included in screenshots or logs.

Current fetched origin/main is now
585ff6e9a29a0e4f13dfc8bb9abfdb091a269290 (merged INV-67 PR 79).
INV-95 implementation head remains 480abc848f2a5ecc2c9ae983490f79b0d2c38af1.
The worktree has only documentation/evidence changes at this checkpoint.

UNKNOWN / remaining: exact-head Test deployment, deployed Google login,
Blob proof, live disposable GHL boundary/readback proof and cleanup.
No disposable business record or Blob has yet been created or mutated.
The temporary Test integration and preview configuration are retained only
while this authorized gate is actively in progress; revoke/remove after
proof or record an explicit retention ruling. They are not a completed
cleanup claim. PR 78 stays draft and both integration exclusions remain.

## Correction preflight and evidence - 2026-09-18

OBSERVED locally: codex/inv-95-write-boundaries at
480abc848f2a5ecc2c9ae983490f79b0d2c38af1; local origin/main at
585ff6e9a29a0e4f13dfc8bb9abfdb091a269290. Only the reconciled report
and untracked provider-free-offline.txt preceded this correction.

Authority: Brad accepted Jeff's immediately preceding independent remote
verification of those SHAs and PR 78 OPEN/draft. Bones did not independently
verify the remote: fetch failed on FETCH_HEAD permission (255), and ls-remote
failed to connect to GitHub (128). No FETCH_HEAD permission change was made.

Earlier offline output is preserved in provider-free-offline.txt. It records
the obsolete path's pre-correction tests and is not current V1 acceptance.
Correction output and per-command exit codes: v1-correction-local.txt.
No live authenticated write, deployment, GHL mutation, or contract send is
claimed. Runtime Test proof remains incomplete and paused.

OBSERVED: the complete affected runner passed: INV-95 suites=26 failed=0,
exit=0. This includes 75 named-boundary, 19 webhook, 12 ledger, 308 canonical
projection, 21 reserve-retirement, 21 execute-retirement, 13 structural
retirement and 8 independent readback checks, plus retained regressions.
The first run found three obsolete UI assertions; that failed run is kept
in the log before the corrected full rerun. No computation tests were removed.

OBSERVED: app typecheck/build, root-function typecheck and all other local
CI checks passed except the unchanged Windows exit-contract runtime check:
checksRun=37 failures=6 floor=37, exit=1. Its POSIX-shell status failures
match the already-recorded Windows limitation; Ubuntu confirmation is still
required. Literal output: v1-correction-ci-local.txt.

OBSERVED: contract-ghl-projection-model.ts is byte-unchanged from the starting
head. App auth, note validation, webhook auth, disposition hardening, document
readback and root handlers remain unchanged. Generic receipts/locks remain;
only the retired projection-specific receipt helpers were removed.

UNKNOWN: fresh remote main/head and Ubuntu CI for this correction. Push is
pending remote verification; PR 78 remains last-known OPEN/draft.
Recommendation: FAIL / not merge-ready until remote verification, push,
fresh Ubuntu CI and the outstanding authorized rollout gates are satisfied.

## Exact correction file inventory

- app/netlify/functions/ghl-contract-send-execute.ts
- app/netlify/functions/ghl-contract-send-reserve.ts
- app/netlify/functions/ghl-proxy.ts
- app/netlify/functions/ghl-write.ts
- app/netlify/functions/lib/write-contracts.ts
- app/netlify/functions/lib/write-receipts.ts
- app/scripts/lib/test-retired-contract-endpoint.cjs
- app/scripts/test-contract-draft-request.cjs
- app/scripts/test-contract-ghl-projection.cjs
- app/scripts/test-contract-send-canonical-carriers.cjs
- app/scripts/test-contract-send-execute.cjs
- app/scripts/test-contract-send-reserve.cjs
- app/scripts/test-contract-workspace-wiring.cjs
- app/scripts/test-ghl-seller-count-transport-write.cjs
- app/scripts/test-inv95.cjs
- app/scripts/test-write-boundaries.cjs
- app/src/lib/ghl.ts
- app/src/pages/ContractWorkspace.tsx
- docs/INV95_WRITE_BOUNDARIES.md
- docs/evidence/inv95/provider-free-offline.txt
- docs/evidence/inv95/v1-correction-ci-local.txt
- docs/evidence/inv95/v1-correction-local.txt

## Origin boundary correction - local only

Authenticated ghl-write POST requests now require one canonical HTTPS
Origin exactly equal to IAOS_APP_WRITE_ALLOWED_ORIGIN. Authentication runs
first to preserve 401 for unauthenticated callers; Origin failure returns
403 before request parsing, GHL reads/writes or Blob access.
There is no missing-Origin server exception. Host, Referer and forwarded
headers are not trust fallbacks. Retired handlers remain unchanged.

This proof's proposed configuration is Functions scope, exact branch only:
IAOS_APP_WRITE_ALLOWED_ORIGIN =
https://codex-inv-95-write-boundaries--iaos-app-test.netlify.app
No configuration was changed. The deployed old head lacks this correction.

Origin is a browser boundary, not a replacement for bearer identity:
a non-browser client can forge Origin. No CORS permission is added.
Absent/invalid configuration denies authenticated writes, including after
future deployment, until the exact approved origin is provisioned.

Prepared Chrome procedure:
[Note-only proof](INV95_NOTE_ONLY_PROCEDURE.md).
It requires a reviewed binding to the existing in-memory appWriteFetch;
no token export, normal note control, or contact-field mutation.
No live proof or cleanup was executed by this correction.

### Local verification result

OBSERVED: node app/scripts/test-inv95.cjs completed with
INV-95 suites=26 failed=0, exit=0; 106 boundary checks passed.
Literal suite output is retained in evidence/inv95/origin-boundary-local.txt.
All outbound dependencies in these suites are mocked.

OBSERVED: targeted TypeScript check of app-write-origin.ts passed (exit=0)
from app/. Full application typecheck returned exit=2 because existing
dependency modules are unavailable in this checkout; it is not claimed green.
No dependency files were changed to bypass that failure.
git diff --check passed (exit=0).

OBSERVED: the prepared Chrome factory was evaluated only in a mocked Node
VM. It made no calls at binding time, submitted only note.create to the
designated contact, replayed byte-identical JSON, retained one note, and
refused repeat initial execution and a wrong page origin (exit=0).
This is not a live authenticated Chrome or Blob proof.

Status: local uncommitted correction. No push, deployment, configuration
change, live write, contact change, cleanup or merge.

### 2026-09-18 bodyless-GET proxy correction (local only)

OBSERVED: Brad's Chrome contact GET was refused with HTTP 403 and
"Writes require named operations", by "iaos-proxy-allowlist".
The first proxy guard returned before GHL access. The note helper stopped
at this preflight read, before any note POST or Blob receipt operation.
The live event.isBase64Encoded value remains INFERRED, not captured.
Offline reproduction confirmed that the encoding flag alone rejected
an otherwise permitted empty-body GET at base commit
f717aa7478bfc0eb59a8dcb58d94c4896d466b9d.

Correction: reject bodies other than undefined, null, or the empty string;
encoding metadata alone is no longer a rejection reason. Non-GET methods,
extra query keys, path allowlists and location gates remain enforced.
Authentication, Origin, named-write handlers and retired paths are unchanged.

OBSERVED: both contact and notes GETs now have regression coverage for
absent/null/empty bodies and absent/false/true encoding flags. Nonempty
plain/encoded and invalid-type bodies, write methods, extra query keys,
foreign location aliases and disallowed paths refuse before upstream
or Blob access. Successful mocked reads remain GET-only with no writes.

Command: node app/scripts/test-inv95.cjs
192 offline boundary checks passed
INV-95 suites=26 failed=0
exit=0
Full literal stdout/stderr is appended to
 evidence/inv95/origin-boundary-local.txt; prior evidence is preserved.
Expected negative-test error messages appear in the captured stderr.

This entry supersedes earlier local-status statements for this correction
only. Local correction authorized for commit; publication and live proof
remain pending. No live retry, note, receipt, configuration change,
deployment, push, Production access, cleanup or merge in this work.
The earlier Chrome helper is already marked attempted; do not retry it
or regenerate a request for a live proof without the next explicit gate.

## 2026-09-18: Lambda Blob context initialization (local only)

OBSERVED: ghl-write now calls connectLambda(event) inside its guarded
write block, after method/authentication/Origin/request validation and
before Blob access. Missing or invalid context remains fail-closed.
No receipt, lock, readback, location, or operation contract was changed.

OBSERVED: the boundary suite uses installed @netlify/blobs for Lambda
initialization and store construction, with a real SDK read through an
intercepted transport. Storage mutations remain in-memory fixtures.
Cases cover valid context, absent context, malformed encoding/JSON, null,
missing token/site, previous-invocation context, and early rejection.
The existing contract-ledger harness now supplies synthetic Lambda
context and uses the real initializer so its retained regressions run.

Literal validation output, including failed tooling attempts and their
follow-up checks, is appended to evidence/inv95/origin-boundary-local.txt.
Prior evidence is preserved. No live proof, remote write, publication,
configuration change, or cleanup of live artifacts occurred.

INFERRED: missing initialization caused the previous live generic 409.
The real SDK reproduced that response offline; the swallowed live
exception was not captured. Live success of this correction is UNKNOWN.

OBSERVED final local validation: 26 suites green, 203 boundary checks;
app tsc/Vite build, root-function typecheck, and CI offline/security
checks green. Runtime exit contract: 37/37 with Git Bash on process PATH.
Initial tooling failures remain in the literal evidence; no configuration
was changed to resolve them. This correction is local only.
