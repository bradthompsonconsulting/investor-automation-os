# INV-95 — write boundary inventory and rollout gate

Baseline: a32b4d165c8211e7a9a9c9c3e90eaea2e637e9cc, fetched and matched to origin refs/heads/main on 2026-09-18 UTC. The initial baseline was 2cb8d1b9da9c3f86b5ab35bf53d330af8d6609e0; the isolated branch was fast-forwarded after INV-67 merged. No INV-67 files were changed by this issue.

Authority: AGENTS.md; INV-95 read directly from Linear including Brad's application identity and root webhook rulings; existing IAOS_PIPELINE_WRITE_SAFETY_AUDIT.md; Brad's explicit Test-only canonical TREC/template binding approval in this task. INV-95's narrow operation rulings govern this change; they do not authorize workflow or stage writes. Board #13 and voice authorization remain separate.

## OBSERVED — runtime before/after inventory

Sources: baseline app/src/lib/ghl.ts, app/src/pages/Pipeline.tsx, app/netlify/functions/ghl-proxy.ts, the three contract endpoints, ghl-disposition.ts, and root netlify/functions/*.ts. Current complete source scan: [write-path-scan.txt](evidence/inv95/write-path-scan.txt).

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
| TREC projections and Seller Count | contract.projection | Test only; server resolves field IDs and recomputes exact canonical plan and seller count; no client field IDs |
| Draft request | contract.draftRequest | Test only; Idle/absent to Requested; current canonical projection, accepted-price cross-check and server readback proof required; duplicate Requested rejected |
| Contract reservation note endpoint | ghl-contract-send-reserve | Separate app identity; configured Test contact/template/sender/population gates; canonical authorization plus full content currency; atomic contact lock and fresh conflict check |
| Contract send endpoint | ghl-contract-send-execute | Same Test gates; named immutable payload; single-use attempt receipt; independent document readback; uncertainty never reported confirmed |
| Contract send readback | ghl-contract-send-readback (read only) | App identity and Test gates; exact document/recipient/sender/location; duplicate identities refused |
| Pipeline Move To / updateStage | Removed | No stage writer remains in browser or generic proxy |
| Generic proxy POST/PUT forwarding | Removed | Proxy accepts allowlisted GET only, no body or extra envelope fields; all other methods rejected |
| Root motivation-score | Dedicated S2S authenticated score operation | Only motivation_score, deal_score, combined_score, data_completeness_score plus hot/warm/low add/remove; fresh target; four-field and bucket readback; scoring algorithm unchanged |
| Root phone-lookup | Dedicated S2S authenticated lookup-result operation | Existing provider lookup/mapping behavior; exact fresh contact phone match; unique phone_type field definition; only that field and exact readback |
| App ghl-disposition webhook | Existing dedicated S2S disposition operation | Existing customData contract, six dispositions, known contact; serialized dedupe, exact note and timestamp-pair readback; note-success/attempt-failure retry retained |
| scripts/rescore-all.ts caller | Dedicated score secret header | Explicit credential file only; missing/short secret refuses before network in write mode; existing target/mutation/dry-run gates retained |

All app mutations use the distinct iaos-app-write session, not voice credentials. Each operation has exact envelope/argument keys. Generic field, method, path, workflow, tags (outside scoring), stage and do_not_mail mutation are unavailable. Authentication/allowlist configuration fails closed.

Structured notes retain their existing carriers. System-derived authorization, send acceptance, provider lifecycle, execution and disposition handoff evidence is independently checked against fresh canonical GHL evidence. Human facts and the existing manual executed-PDF hash/visual-attestation bridge remain operator attestations; this change does not introduce document storage or claim server custody of PDF bytes. Corrections, rescissions and resend/decline records reuse existing model guards.

Security receipts in the app's iaos-write-receipts Netlify Blob store contain hashes, field identifiers and request outcomes, not copied business records. GHL remains the business system of record. Atomic per-contact locks serialize application writes/reservations and disposition dedupe. A process interruption leaves a lock closed; it must not be expired or deleted blindly. Root score/phone operations retain convergent repeated assignments; their payloads have no event ID and this change does not invent one or change provider lookup behavior.

## OBSERVED — maintenance and non-GHL paths

The source scan also includes manually invoked inert-proof scripts, INV-67 field provisioning scripts, INV-70 migration/proof scripts and rescore-all. They are not browser/runtime proxy entrypoints. None was executed. Historical scripts using proxy PUT now receive 403; they are not a bypass and require separately authorized future proof tooling. Direct administrative scripts retain their existing explicit mutation gates and credentials; they are outside the runtime implementation scope. Root/provider helpers and mailer-digest's email POST are not browser GHL forwarding. No mailer or voice files were changed.

## Approved Test-only identity binding

The canonical document name and source remain CONTRACT_DOCUMENT_TEMPLATE_NAME / CONTRACT_DOCUMENT_TEMPLATE_SOURCE from contract-document-model.ts. Brad explicitly authorized binding that canonical authorization to the already-configured Test GHL template ID. Reserve/execute verify the canonical name/source and content independently; requestedTemplateId must still equal the configured GHL template ID. The configured provider display name/source are not substituted for canonical authorization. Production, approved Test recipient, sender and population gates are unchanged. No configuration ID or template was edited.

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
