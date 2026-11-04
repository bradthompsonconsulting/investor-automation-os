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

**Two stores (r5 restore containment, Bones HOLD on 3311102).** The session records live in the receipts store
`iaos-write-receipts` (restorable, like every receipt in it). The authority anchor lives ALONE in a dedicated store,
**`iaos-session-authority`**, key **`authority`** (`SESSION_AUTHORITY_STORE` / `AUTHORITY_KEY` in
`session-revocation.ts`), reached through the same `connectLambda` platform context (no new credential). The
authority store is **never restored**: no restore of the session store can write, revert or reopen the anchor. The r4
anchor location (key `session-revocation/_authority` in `iaos-write-receipts`) is **ignored**: no code reads or
writes it (offline checks H13, H17, H20, Z0b); bytes left there, or restored there, have no effect.

## 2. Records (canonical JSON, keys sorted, no whitespace, no timestamps)

| Record | Store / key | Content | Written by |
|---|---|---|---|
| Session | `iaos-write-receipts` / `session/<sha256("<env>:<sid>")>` | `{"env","epoch","kind":"iaos-session","sidDigest","state":"active"\|"revoked","v":1}` | code: created at sign-in (`onlyIfNew`), re-written with identical bytes on every check (`onlyIfMatch`), set to `revoked` by Sign out |
| Authority anchor | `iaos-session-authority` / `authority` (never restored) | `{"env":"<test\|production>","epoch":"<16-64 chars [A-Za-z0-9_-]>","kind":"iaos-session-revocation-authority","siteID":"<pinned id>","state":"open\|closed","v":1}` | **operator only**. Code re-writes the *identical* OPEN bytes `onlyIfMatch` (which changes nothing and succeeds only where those bytes are current); it never creates, changes or deletes the anchor |

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
2. **Create the anchor** in the dedicated store `iaos-session-authority` of the pinned site, key `authority`, with
   the exact canonical JSON of section 2, `"state":"open"` and a fresh random epoch generated at install time from a
   cryptographic source, at least 128 bits (for example 24 random bytes, base64url, 32 characters). Use a
   conditional create (only if new). Read it back and compare byte for byte. Record its ETag.
3. Record the epoch, the time and the operator in the evidence folder. Never reuse an epoch. Confirm the store
   `iaos-session-authority` holds exactly one key (`authority`), and that `iaos-session-authority` is NOT in any
   backup / restore / migration job's scope (record the job configuration).
4. Pass the live gates (section 8) on that site.
5. Only then may a separately reviewed config-only commit turn one sign-in on for that environment.

## 6. Restore containment, suspected loss, or emergency sign-out of everyone (r5: structural exclusion)

Applies to any restore of the session store `iaos-write-receipts`, any suspected loss or tampering of session
records, a store migration, any doubt that a store is the intended one, or a lost device that cannot be signed out.
Every step **requires separate authorization; not performed**.

Why this is safe by construction (r5, replacing the r4 "close, restore, re-close" procedure): under content-addressed
ETags (U1), restoring BOTH an old active session record and the old OPEN anchor bytes would restore matching ETags,
so a restored session could pass again. r5 removes that path structurally: the anchor is in a different store
(`iaos-session-authority`) that is **never in any restore scope**, so a restore cannot bring back, revert or reopen
it; and an old anchor restored into the session store at the r4 key is ignored by the code (offline check H17). The
CLOSED anchor is therefore a deny barrier that the restore cannot overwrite, held continuously from before the
restore until a new epoch is installed and verified.

The anchor states (section 2): **closed** = `{"env","epoch":<current epoch>,"kind","siteID","state":"closed","v":1}`
(canonical, keys sorted). **Open** = the same with `"state":"open"`.

**(f) Suspected loss or compromise -- close IMMEDIATELY.** The first action, before any diagnosis: write the CLOSED
anchor to `iaos-session-authority` / `authority` (same epoch is fine for closing) and read it back byte for byte.
From that write on, every sign-in answers 503 and every protected check fails 412 (revoked) on every instance.
**Exposure acknowledged, and it cannot be eliminated by any procedure:** anything authorized between the loss and its
detection (and requests already admitted before the close) is not recalled; closing bounds the exposure from the
moment of the write only. Record the time of detection and the time of the close. If the AUTHORITY store itself is
lost or suspected compromised: it is NOT restored. Provision a NEW anchor (section 5 step 2, new never-reused epoch
of at least 128 bits, `"state":"open"`) only after the cause is contained, which invalidates every session; until it
is provisioned the anchor is absent and everything is refused (sign-in 503, every check 412 -> revoked; offline
check H19).

**Planned restore:**

1. **(a) Close the anchor BEFORE the restore.** Write the closed anchor to `iaos-session-authority` / `authority`.
   Verify by reading it back byte for byte, then confirm from a fresh browser that sign-in answers "temporarily
   unavailable" (503) and that a previously signed-in page is refused (401 revoked) on its next request.
2. **(b) Restore ONLY the session store.** The restore target is the store `iaos-write-receipts` and nothing else.
   The authority store `iaos-session-authority` is structurally excluded: a different store, never in restore scope.
   **Operator check before starting, recorded in the evidence:** the restore job's target store name reads exactly
   `iaos-write-receipts`; no source or target in the job names `iaos-session-authority`; the authority anchor's bytes
   and ETag read immediately before the restore are recorded. Restored session records ("active" or not), and any
   old anchor bytes the backup carries at the r4 key `session-revocation/_authority`, have no effect: every check
   fails at the closed anchor in the authority store.
3. **(c) The anchor stays closed continuously during the whole restore** (every pass, if the tool works in passes).
   Nothing in the restore can reopen it, because nothing in the restore writes `iaos-session-authority`. After the
   final pass, read the authority anchor again and confirm it is byte-identical to the closed bytes (and the same
   ETag) recorded in step 2; if it is not, stop and treat it as step (f).
4. **(d) Install a NEW epoch, open, only AFTER the final restore -- one write.** Generate the epoch at install time from
   a cryptographic source, at least 128 bits (e.g. 24 random bytes, base64url), NEVER a previously used value
   (compare against the recorded epoch history). Write the open anchor with it to `iaos-session-authority` /
   `authority` in a single write (closed -> new epoch open). Every pre-restore session is refused: its `aetag` /
   epoch no longer match the anchor (412 -> revoked); everyone signs in once.
5. **(e) Verify across instances BEFORE announcing the reopen** (record each result with time and instance where
   visible). Checklist:
   - [ ] the anchor bytes read back exactly as written (new epoch, `"state":"open"`) from `iaos-session-authority`;
   - [ ] an OLD read cookie (signed in before the close) is refused by status (`revoked`), a reader (401) and the
         token mint (401), on at least two separate function invocations / instances;
   - [ ] an OLD saving token (minted before the close) is refused by a writer (401) on at least two instances;
   - [ ] a fresh sign-in succeeds, binds to the new epoch, mints and saves (fictional data only);
   - [ ] a Sign out of that fresh session is refused from another instance at once.
   Any failure: close the anchor again and stop. Do not announce the reopen until every box is checked.
6. Record the old and new epoch, the reason, every time above, the restore job configuration, and who performed
   each step.

**Emergency sign-out of everyone (no restore):** steps (f), (d), (e).

**Remaining dependency -- U2 (section 8).** All of the above relies on the store's origin evaluating `If-Match`
(live gate U2, safety-critical). If the origin ignored `If-Match`, a check could overwrite the CLOSED anchor with the
open bytes it is bound to (re-opening it) or a revoked session with active bytes. Structural exclusion removes the
restore path; it does not remove the U2 dependency. U2 must be proven on the hosted site before enabling.

Turning one sign-in off (rollback, section 4) is NOT a substitute for any step here: it does not change either
store, and turning it back on would accept any still-matching session again.

## 7. Retention

- Session records are never deleted by code. There is no TTL. Cleanup is **not authorized**.
- If cleanup is ever proposed, a record must not be removed before its session's fixed expiry (30 days after
  sign-in) + 24 h (the revoke-only handle lifetime) + a clock-skew allowance. Removing a record early is fail closed
  (its session is refused), never a revival.
- The anchor is never deleted and its store `iaos-session-authority` is never backed up into, restored or migrated
  with the session store. Rotating the epoch (section 6) is the only bulk invalidation.
- Old anchor bytes at the r4 key `session-revocation/_authority` in `iaos-write-receipts`, if any exist, are inert
  (no code names that key). Removing them is cleanup and is not authorized here.

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
- Plus: the anchor is present and valid in `iaos-session-authority` on each site, and that store is outside every
  backup / restore job; an epoch rotation signs out an existing session (401 revoked)
  and a fresh sign-in works; a confirmed Sign out is refused from another function instance at once; closing the
  anchor refuses sign-in (503) and an existing session (401) on every instance, and reopening with a new epoch
  keeps every older session refused (section 6 (d)).
- **U2 is safety-critical for the closed anchor too.** Every check re-writes the OPEN anchor bytes `onlyIfMatch`.
  If the origin ignored `If-Match`, a check could overwrite a CLOSED anchor with open bytes (re-opening it) or a
  revoked session with active bytes. U2 must be proven before enabling; offline tests cannot establish it.
