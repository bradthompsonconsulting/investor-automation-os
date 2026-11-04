# B15-29 Session Authority Runbook (INV-137)

Status: candidate. One IAOS sign-in is OFF in both environments (`oneLogin: ONE_LOGIN_DISABLED`). Nothing in this
document has been performed. Every live step below **requires separate authorization; not performed**.

Design: r5 "conditional-write session authority" (Jeff, 2026-11-04) with the r6 lifetime ruling (Captain, fixed
30-day session). What r6 changed is in `docs/B15-29_DESIGN_r6_30_DAY.md`.

## 1. Purpose

With one IAOS sign-in on, every session has a server-side record in the existing receipts store
`iaos-write-receipts` (`app/netlify/functions/lib/session-revocation.ts`). Every protected read, every write, token
issue and the status endpoint authorize **only from conditional writes evaluated at the store's origin**: a read is
never used to authorize. Explicit Sign out revokes the session server-side immediately.

The store is reached through the platform's own per-invocation Lambda context (`connectLambda(event)`), the same
path as the `claimWrite` receipts, the call-log / Current Offer barriers and the supplemental-read budget. **There is
no credential to provision**: r5 removed `IAOS_SESSION_REVOCATION_SITE_ID` and `IAOS_SESSION_REVOCATION_TOKEN`. If
either is still set on a site, delete it; the code no longer reads it.

## 2. Records (canonical JSON, keys sorted, no whitespace, no timestamps)

| Record | Key | Content | Written by |
|---|---|---|---|
| Session | `session/<sha256("<env>:<sid>")>` | `{"env","epoch","kind":"iaos-session","sidDigest","state":"active"\|"revoked","v":1}` | code: created at sign-in (`onlyIfNew`), re-written with identical bytes on every check (`onlyIfMatch`), set to `revoked` by Sign out |
| Authority anchor | `session-revocation/_authority` | `{"env":"<test\|production>","epoch":"<16-64 chars [A-Za-z0-9_-]>","kind":"iaos-session-revocation-authority","siteID":"<pinned id>","state":"open\|closed","v":1}` | **operator only**. Code re-writes the *identical* OPEN bytes `onlyIfMatch` (which changes nothing and succeeds only where those bytes are current); it never creates, changes or deletes the anchor |

r4: `state` is REQUIRED. An anchor without it (the r3 shape) is invalid: every sign-in is unavailable (503) until an
operator installs an anchor with `"state":"open"` and a new epoch. A **closed** anchor refuses every sign-in (503,
`authority_closed`), and every check fails (412 -> revoked) because the bytes no longer match the open bytes each
session is bound to. Closing and reopening are operator actions only (section 6).

Identical content is byte-identical, so a re-write of identical bytes keeps the same ETag **if** the store's ETags
are content-addressed (live gate U1).

## 3. What the code enforces

| Environment | `IAOS_ENV` | Pinned site id (public) | Netlify site |
|---|---|---|---|
| Test | `test` | `07ca1f1a-60fd-4229-a076-528970957912` | iaos-app-test |
| Production | `production` | `19fcbf6a-7c3c-40e3-af20-bd077f0f8ec8` | iaos-app |

The ids are a frozen constant (`SESSION_REVOCATION_SITE_IDS` in `app/shared/ghl-config.ts`, the identifier
boundary). Changing one is a reviewed code change, never configuration.

- **Binding.** `IAOS_ENV` exactly `test|production`; exactly one `x-nf-site-id` request header, under that lowercase
  name (the one `connectLambda` reads), equal to the pinned id; a Lambda Blobs context on the event. Otherwise
  unavailable (503 / Sign out not confirmed), with zero store requests.
- **Sign-in** (after Google verification): read the anchor, validate it (this env, the pinned site, canonical);
  re-write its identical bytes `onlyIfMatch: <read etag>` (200 only -> anchor ETag `aetag`); create the session
  record `onlyIfNew` for a new random sid (200 only -> session ETag `setag`). The signed session carries
  `sid, epoch, aetag, setag`. Anything else: 503, no session, no `Set-Cookie`.
- **Check** (token mint, every protected reader and writer, status), in parallel under one 3 s deadline, one attempt
  each: identical active session bytes `onlyIfMatch: setag`, identical anchor bytes `onlyIfMatch: aetag`. Both 200
  -> authorized. Either 412 -> **revoked** (401). Anything else or late -> **unavailable** (503).
- **Sign out** (revoke-only handle; target = the handle's sid; no `Set-Cookie`): the revoked bytes unconditionally,
  then the same bytes `onlyIfMatch: <that answer's ETag>`. "Signed out" only if both are 200. Idempotent.
- **Authorization seam** (`lib/authorization.ts`): evaluated on every protected request in addition to the session
  check; today it delegates exactly to `IAOS_APP_READ_BRAD_EMAILS` / `IAOS_APP_WRITE_BRAD_EMAILS`.

## 4. Decisions recorded

- **D-B1 / D-B2 (r5 sliding session: 30-minute idle + 7-day cap): SUPERSEDED** by the Captain's r6 ruling before
  implementation. Not built: no idle window, no heartbeat, no renew endpoint.
- **D-R6-1 lifetime.** One sign-in is valid for exactly 30 days from authentication (`exp = authAt + 30 days`). No
  request, mint or status check extends it. After it: sign in again.
- **D-R6-2 cookie.** Persistent: `Max-Age` = seconds left to `exp` (closing the browser does not sign out).
- **D-R6-3 devices.** Each sign-in is its own session; Sign out revokes only that session (no all-device sign-out).
  The only bulk sign-out is the epoch rotation (section 6), which signs out **everyone**.
- **D-R6-4 token.** The 900 s saving token renews silently and never outlives the session: it carries the session's
  `exp` (`pexp`), writers refuse it after `pexp`, and its reported lifetime is `min(900 s, time left)`.
- **Closed browser / closed tab.** With the persistent cookie, closing the browser keeps the operator signed in for
  the rest of the 30 days. A device left signed in is therefore a real exposure if it is shared or lost: use
  **Sign out** on it (server-side, immediate), or the epoch rotation in an emergency.
- **Rollback.** Turning one sign-in off makes every 30-day session invalid at once (it is accepted only while the
  switch is on), and the 8-hour behaviour returns. r4: every One-Login-bound saving token is refused at once as
  well -- `requireAppWriter` accepts the bound shape (its own audience `iaos-app-write-session`) only while the
  switch is on, whatever the token's own expiry -- and any read cookie carrying a sid / epoch / ETag claim is
  refused. Legacy (8-hour cookie, popup-issued saving token) behaviour is unchanged. Rollback is NOT a substitute for
  restore containment (section 6): it does not touch the store.

## 5. Provisioning (requires separate authorization; not performed)

Per environment, in this order:

1. Remove `IAOS_SESSION_REVOCATION_SITE_ID` / `IAOS_SESSION_REVOCATION_TOKEN` if present. Create **no** credential.
2. **Create the anchor** in store `iaos-write-receipts` of the pinned site, key `session-revocation/_authority`, with
   the exact canonical JSON of section 2, `"state":"open"` and a fresh random epoch generated at install time from a
   cryptographic source, at least 128 bits (for example 24 random bytes, base64url, 32 characters). Use a
   conditional create (only if new). Read it back and compare byte for byte. Record its ETag.
3. Record the epoch, the time and the operator in the evidence folder. Never reuse an epoch.
4. Pass the live gates (section 8) on that site.
5. Only then may a separately reviewed config-only commit turn one sign-in on for that environment.

## 6. Restore containment, suspected loss, or emergency sign-out of everyone (r4)

Applies to any restore of the receipts store, any suspected loss or tampering of session records, a store
migration, any doubt that the store is the intended one, or a lost device that cannot be signed out. Every step
**requires separate authorization; not performed**. Why the order matters: under content-addressed ETags (U1),
restoring BOTH an old active session record and the old anchor bytes would restore matching ETags, so a restored
session could pass again. Authorization must therefore be blocked BEFORE the restore, stay blocked throughout, and
reopen only with an epoch no session was ever bound to.

The anchor states (section 2): **closed** = `{"env","epoch":<current epoch>,"kind","siteID","state":"closed","v":1}`
(canonical, keys sorted). **Open** = the same with `"state":"open"`.

**(e) Immediate containment on suspected loss.** The first action, before any diagnosis: write the CLOSED anchor
(same epoch is fine for closing). From that write on, every sign-in answers 503 and every protected check fails
412 (revoked) on every instance. Exposure acknowledged: anything authorized BEFORE the loss was detected (and
requests already admitted before the close) is not recalled; closing bounds the exposure from the moment of the
write only. Record the time of detection and the time of the close.

**Planned restore:**

1. **(a) Close BEFORE restoring.** Write the closed anchor. Verify by reading it back byte for byte, then confirm
   from a fresh browser that sign-in answers "temporarily unavailable" (503) and that a previously signed-in
   page is refused (401 revoked) on its next request.
2. **(b) Restore, EXCLUDING the anchor.** The restore MUST exclude the key `session-revocation/_authority`. If the
   restore tool cannot exclude a key, then IMMEDIATELY after each restore pass re-write the closed anchor (and read
   it back) before doing anything else; keep it closed until step 3. Restored session records ("active" or not)
   are harmless while the anchor is closed: every check fails at the anchor write. A window between a tool's
   restore of the old open anchor and the re-write of the closed anchor is an exposure window: keep it as short
   as possible and record it.
3. **(c) Install a NEW epoch, open, only AFTER the final restore.** Generate the epoch at install time from a
   cryptographic source, at least 128 bits (e.g. 24 random bytes, base64url), NEVER a previously used value
   (compare against the recorded epoch history). Write the open anchor with it. Every session bound to any older
   epoch now fails its anchor `If-Match` (412 -> revoked); everyone signs in once.
4. **(d) Verify before declaring the system open** (record each result with time and instance where visible):
   - the anchor bytes read back exactly as written (new epoch, `"state":"open"`);
   - an OLD read cookie (signed in before the close) is refused by status (`revoked`), a reader (401), and the
     token mint (401), on at least two separate function invocations / instances;
   - an OLD saving token (minted before the close) is refused by a writer (401) on at least two instances;
   - a fresh sign-in succeeds, binds to the new epoch, mints and saves (fictional data only);
   - a Sign out of that fresh session is refused from another instance at once.
   Any failure: close the anchor again and stop.
5. Record the old and new epoch, the reason, every time above, and who performed each step.

**Emergency sign-out of everyone (no restore):** steps (e), (c), (d).

**Anchor lost entirely:** every check fails 412 (revoked) and every sign-in is 503 (fail closed). Recreate it only
as section 5 step 2 with a NEW epoch and `"state":"open"`, after any restore it is part of, then step (d).

Turning one sign-in off (rollback, section 4) is NOT a substitute for any step here: it does not change the store,
and turning it back on would accept any still-matching session again.

## 7. Retention

- Session records are never deleted by code. There is no TTL. Cleanup is **not authorized**.
- If cleanup is ever proposed, a record must not be removed before its session's fixed expiry (30 days after
  sign-in) + 24 h (the revoke-only handle lifetime) + a clock-skew allowance. Removing a record early is fail closed
  (its session is refused), never a revival.
- The anchor is never deleted. Rotating the epoch (section 6) is the only bulk invalidation.

## 8. Live gates (not performed; offline tests use a fake Blob service)

- **U1 content-addressed ETags.** Writing identical bytes keeps the same ETag. If false, the second check of every
  session fails 412 (everyone appears signed out): fail closed, not a security failure; offline check A12 shows it.
  Fallback design if U1 fails: carry the new ETag forward per request (costlier; cross-tab churn) -- needs review.
- **U2 origin evaluation.** `If-Match` / `If-None-Match` are evaluated at origin through the Lambda edge context
  (412 on mismatch, including against a stale cached read), and a PUT answer carries the new `ETag` header.
- **U3 cost / latency.** Two conditional writes per protected request fit the 3 s check / 5 s sign-in and Sign out
  budgets at normal and slow times; write quota and cost are acceptable.
- **U4 `x-nf-site-id`.** Present, single, lowercase and equal to the pinned id on EVERY function that runs the check,
  on both sites. If absent anywhere, that function fails closed and the design must be revisited before enabling.
- Plus: the anchor is present and valid on each site; an epoch rotation signs out an existing session (401 revoked)
  and a fresh sign-in works; a confirmed Sign out is refused from another function instance at once; closing the
  anchor refuses sign-in (503) and an existing session (401) on every instance, and reopening with a new epoch
  keeps every older session refused (section 6 (d)).
- **U2 is safety-critical for the closed anchor too.** Every check re-writes the OPEN anchor bytes `onlyIfMatch`.
  If the origin ignored `If-Match`, a check could overwrite a CLOSED anchor with open bytes (re-opening it) or a
  revoked session with active bytes. U2 must be proven before enabling; offline tests cannot establish it.
