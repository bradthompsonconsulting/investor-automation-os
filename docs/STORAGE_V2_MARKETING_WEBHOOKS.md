# Marketing-site GHL webhooks under storage v2: specification for review

**Status:** a proposal. **The exception is NOT CLEARED** (Bones, review of `e982ed0`, item A).

**Interim state on this branch** (Bones finding 6, fixed): both webhooks are **uniformly held**.
- An authenticated request gets `503 "… held pending review; nothing was written"` **before** the provider
  lookup and before any GHL read or write.
- `motivation-score`'s tag add/remove calls now go through the same gated boundary as its score fields,
  never a direct fetch, so no partial write is possible.
- This is a **loss of functionality**, held fail-closed until a reviewed write path is accepted.

## Why they break under v2

`phone-lookup` and `motivation-score` live on the **marketing site** (`investor-automation-os`, repo-root
`netlify/functions/`). That is a separate Netlify site with its own Blob stores and its own GHL
credential (`GHL_API_TOKEN`). Both import the **app's** GHL boundary
(`app/netlify/functions/lib/ghl-write-boundary.ts`) for their contact field writes.

Under v2 that boundary refuses any mutation that does not arrive through the app's write gate. A
marketing-site function cannot pass that gate, for two reasons:
- **No access to the app's records.** The gate's records (`authz/admission`, G5, cutover) live in the
  **app** site's `iaos-ownership-v2` store. A function on another site has no Blobs access to it.
- **No activation to capture.** Activation is per app deployment.

`motivation-score` also adds and removes tags with a **direct** `fetch`, outside the boundary.

**Ruled constraint:** keep the approved functionality through an explicitly scoped, reviewed path. There
is no blanket bypass of v2.

## Endpoint 1: `POST /api/phone-lookup` (root `netlify/functions/phone-lookup.ts`)

| Aspect | Current behaviour (code at `3de480e`, unchanged on this branch) |
|---|---|
| Caller | GHL workflow "Phone Type Validation" `4ed31e4a-8c95-45f9-bb3b-0376eb0927ef`, historically on Contact Created (`INV95_WRITE_BOUNDARIES.md` line 100; live pairing UNKNOWN there) |
| Authentication | `requireWebhook(event, "IAOS_PHONE_LOOKUP_WEBHOOK_SECRET")`: header `X-IAOS-Secret`, a secret of at least 32 characters, compared in constant time over SHA-256. App sessions are never accepted. Failure gives `401 "Webhook authorization refused"` |
| Request shape | exactly `{contactId, phone}`, otherwise 400. `contactId` must be identifier-shaped |
| Target check | a fresh GHL read of the contact; `contact.phone` must equal `phone` exactly, otherwise 403 before any provider call |
| Provider call | Twilio Lookup v2 `line_type_intelligence` (GET). A provider failure maps to `Unknown`; it is never a refusal |
| **Record scope** | one contact (`contactId`) in `getConfig(IAOS_ENV).locationId` |
| **Allowed fields** | exactly one: the unique custom field whose `fieldKey` is `contact.phone_type` (or `phone_type`), resolved at run time from `GET /locations/{id}/customFields`. Ambiguous or missing gives 500 with no write. Values: `Mobile`, `Landline`, `VoIP`, `Unknown` |
| **Tags** | none |
| GHL mutation | `PUT /contacts/{id}` with `customFields:[{id: phone_type, field_value}]`, then an exact readback |
| **Workflow effects** | phone_type is read by the Phone Type Validation workflow (its caller). Whether **writing** phone_type fires any other GHL workflow is UNKNOWN: it is not API-derivable, and no inert-proof is recorded for it in `INV95_WRITE_BOUNDARIES.md` |
| **Retry behaviour** | any non-2xx (refusal, GHL failure, readback mismatch) returns 500 or 4xx. Whether the GHL webhook action retries on non-2xx is **UNVERIFIED** for this workflow (the disposition endpoint's comments assert GHL "backs off and re-fires on any non-2xx"; that is not established for this caller). The write is idempotent: same contact, same value for the same line type. A retry repeats the Twilio lookup (cost) and rewrites the same value |
| Uncertainty | a lost GHL response gives 500. There is no durable record, so a later run simply rewrites the value |

## Endpoint 2: `POST /api/motivation-score` (root `netlify/functions/motivation-score.ts`)

| Aspect | Current behaviour |
|---|---|
| Callers | the Seller 0 scoring workflow, and the `rescore-all` operator script (`INV95_WRITE_BOUNDARIES.md` lines 98–99; live pairing UNKNOWN there) |
| Authentication | `requireWebhook(event, "IAOS_MOTIVATION_WEBHOOK_SECRET")`, same scheme as above; failure gives 401 |
| Request shape | exactly `{contactId}`, otherwise 400 or 500 (the handler also reads `contact_id`/`id`/`data.contactId`, but `exact(data, ["contactId"])` then refuses any other shape) |
| Target check | a fresh GHL contact read (identity and location) before anything else |
| **Record scope** | one contact in the configured location |
| **Allowed fields** | exactly four: `motivation_score` (resolved by `fieldKey` at run time), `deal_score`, `combined_score`, `data_completeness_score` (config ids). Finite numbers only; a duplicate id is refused |
| **Allowed tags** | exactly one of `hot`, `warm`, `low` is **added**; the other two are **removed** (`POST` and `DELETE /contacts/{id}/tags`, by direct `fetch`, run in parallel with the field PUT). Tags are refused if they are outside the set, empty or duplicated |
| GHL mutations | one field PUT (through the boundary, with readback), one tag POST and one tag DELETE (direct). A final fresh read must show exactly the chosen bucket tag, otherwise 500 |
| **Workflow effects** | hot/warm/low are the separately governed **scoring tags**. `AGENTS.md` names them as a reviewed workflow input (`INV95_WRITE_BOUNDARIES.md`), so adding or removing one can enroll or advance the contact in GHL workflows by design. The four score fields: workflow effect UNKNOWN (no inert-proof recorded) |
| **Retry behaviour** | any failure gives 500; caller retry is UNVERIFIED. The scoring algorithm is deterministic for unchanged inputs, so a retry rewrites the same values. Tag add/remove is idempotent, but a partial failure (fields written, a tag call failed) is reported as 500, and the next run converges |
| Uncertainty | there is no durable record. The tag POST and DELETE run concurrently and are not individually confirmed: only the final read is checked |

## Proposed scoped path (for review; not implemented)

1. **A separate module, `lib/marketing-write-paths.ts`.** It holds exactly two named operations,
   `writePhoneType(contactId, value)` and `writeScoresAndBucket(contactId, scores, bucket)`. Each one
   enforces its own allowlist: the field ids and value types, and the tag set above. It issues its own
   GHL requests with the caller's `GHL_API_TOKEN`, with request timeouts and an exact readback. **The
   app boundary keeps "no gate, no mutation" unchanged.**
2. **Only the two root functions may use it.** A static test asserts:
   - only those two functions import the module;
   - no app function imports it;
   - its effect classes (`custom_field:<phone_type>`, the four score field ids, `tag`) are **disjoint**
     from every effect class a v2-gated operation declares.
3. **The tag writes move into this module.** Today they are direct fetches in `motivation-score`.
   Putting them under the same allowlist leaves no ungoverned GHL mutation in the repository; the G5-2
   static scan is extended to the repo root.
4. **What the scoped path does not do.**
   - **No v2 admission tickets or G5 for these writes.** Rationale for review: the marketing site cannot
     read the app's `authz/` store, and these effects do not overlap any v2-protected effect, so a
     marketing write cannot race a call-log or Current Offer save.
   - **Risk retained:** an uncertain marketing write is not durably recorded. That is unchanged from today.
5. **Credential.** `GHL_API_TOKEN` is not one of the 14 `GHL_PRIVATE_API_KEY` consumers. Whether its
   value is one of the legacy credentials that C4 revokes is **UNKNOWN**. It must be settled in the C0
   credential inventory: revoking it would stop both webhooks.

**Decisions requested from Bones:**
- whether disjoint effect classes are sufficient grounds to keep these writes outside admission and G5;
- whether a scoring-tag change, which drives GHL workflows, needs any additional control.

## Review result (Bones, item A) and the evidence required before any exception

**The disjoint-fields argument is insufficient.**
- Scoring tags drive GHL workflows by design.
- The workflow effects of the score fields and of `phone_type` are UNKNOWN.

Bones's offline counterexample attached a simulated workflow note effect to the real handler's tag POST
while an uncertain note ticket existed: the overlapping effect occurred. That is not evidence of the live
configuration. It does show that field names cannot establish separation.

**Required before an exception can be considered** (each a gated, read-only evidence step; none
authorized here):
1. **Callers:** every caller of each webhook (workflow ids, the operator script), with the credential
   each uses, and `GHL_API_TOKEN`'s place in the C0 credential inventory.
2. **Transitive effects:** every downstream workflow triggered by each written field and tag, and what
   those workflows do: notes, touch, routing, opportunities, stages, messages, tags.
   **Unknown overlap = denied.**
3. **Retry and partial failure:** each caller's retry behaviour on non-2xx, and each partial-failure state
   (fields written but tags not, or the reverse). Deterministic scores and idempotent tag membership do
   not establish workflow idempotency or terminal request outcomes.
4. **A boundary design covering all of the above**, reviewed by Bones and ruled by Jess before
   implementation.
