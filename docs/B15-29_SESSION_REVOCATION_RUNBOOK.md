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
| Authority anchor | `session-revocation/_authority` | `{"env":"<test\|production>","epoch":"<16-64 chars [A-Za-z0-9_-]>","kind":"iaos-session-revocation-authority","siteID":"<pinned id>","v":1}` | **operator only**. Code re-writes the *identical* bytes `onlyIfMatch` (which changes nothing and succeeds only where those bytes are current); it never creates, changes or deletes the anchor |

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
  switch is on), and the 8-hour behaviour returns.

## 5. Provisioning (requires separate authorization; not performed)

Per environment, in this order:

1. Remove `IAOS_SESSION_REVOCATION_SITE_ID` / `IAOS_SESSION_REVOCATION_TOKEN` if present. Create **no** credential.
2. **Create the anchor** in store `iaos-write-receipts` of the pinned site, key `session-revocation/_authority`, with
   the exact canonical JSON of section 2 and a fresh random epoch (for example 24 random bytes, base64url, 32
   characters). Use a conditional create (only if new). Read it back and compare byte for byte. Record its ETag.
3. Record the epoch, the time and the operator in the evidence folder. Never reuse an epoch.
4. Pass the live gates (section 8) on that site.
5. Only then may a separately reviewed config-only commit turn one sign-in on for that environment.

## 6. Restore, suspected loss, or emergency sign-out of everyone

Any restore of the receipts store, any suspected loss or tampering of session records, a store migration, any doubt
that the store is the intended one, or a lost device that cannot be signed out:

1. Write a NEW epoch into the anchor (same canonical shape, never a previous value). This is the only anchor change
   ever made, and only by an operator under authorization.
2. Effect: every session's anchor `If-Match: aetag` now fails at origin (412), so every session is revoked and every
   operator signs in once. A restored "active" session record cannot revive a session.
3. If the anchor itself was lost: every check fails 412 (revoked) and every sign-in is 503 until a new anchor with a
   new epoch is created as in section 5, step 2.
4. Record the old and new epoch, the reason and the time.

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
  and a fresh sign-in works; a confirmed Sign out is refused from another function instance at once.
