# B15-29 Session Revocation Runbook (INV-137)

Status: candidate. One IAOS sign-in is OFF in both environments (`oneLogin: ONE_LOGIN_DISABLED`). Nothing in this
document has been performed. Every live step below **requires separate authorization; not performed**.

## 1. Purpose

Sign out with one IAOS sign-in revokes a session server-side by writing a revocation record
`session-revocation/<sha256(kind:env:sid)>` in the existing receipts store `iaos-write-receipts`
(`app/netlify/functions/lib/session-revocation.ts`). Every protected read, every write, token issue and the status
endpoint check that record.

The absence of a record means "not revoked" **only when it comes from the intended authority**. Bones H2: an empty
store, a wrong store, or a store restored to a state missing records (tombstones) must look like an outage, never
like a valid absence. This runbook defines that authority, how it is provisioned, rotated, restored and retained.

## 2. Authority binding (what the code enforces)

| Environment | `IAOS_ENV` | Pinned revocation site id (public) | Netlify site |
|---|---|---|---|
| Test | `test` | `07ca1f1a-60fd-4229-a076-528970957912` | iaos-app-test |
| Production | `production` | `19fcbf6a-7c3c-40e3-af20-bd077f0f8ec8` | iaos-app |

The ids are a frozen constant (`PINNED_REVOCATION_SITES`) in the module. Changing one is a reviewed code change,
never configuration. Every operation is **unavailable** (503 / Sign out not confirmed) unless all of these hold:

1. `IAOS_ENV` is exactly `test` or `production`.
2. `IAOS_SESSION_REVOCATION_SITE_ID` equals that environment's pinned id, and `IAOS_SESSION_REVOCATION_TOKEN` is set.
3. The request carries exactly one `x-nf-site-id` header (the platform's runtime site id, the header
   `@netlify/blobs` `connectLambda` reads; header name case-insensitive) equal to the pinned id.
4. The authority anchor `session-revocation/_authority` is read (strong, single attempt, inside the same
   3 s check / 5 s Sign out budget, in parallel with the record read) and is exactly:

   ```json
   {"env":"<test|production>","epoch":"<16-64 chars [A-Za-z0-9_-]>","kind":"iaos-session-revocation-authority","siteID":"<pinned id>","v":1}
   ```

   Canonical JSON (keys sorted, no whitespace). Absent, malformed, other env or other site: unavailable.
5. The session's (and the saving token's) bound `epoch` equals the anchor's current `epoch`. A mismatch is
   treated as **revoked** (401, sign in again), not as unavailable.

No code path creates, modifies or deletes the anchor (asserted by a static scan and a whole-run request check in
`app/scripts/test-b15-29-one-login-server.cjs`, check H12 and Z).

Sign-in (`app-read-session` POST, one sign-in on) verifies the Google identity first, then reads the anchor. If the
anchor is not valid no session is issued (503 `state:"unavailable"`, no `Set-Cookie`). The new session carries the
anchor's epoch, and the saving token minted from it carries the same epoch.

The epoch is an opaque label, not a secret. Knowing it does not let anyone forge a session (sessions and tokens are
HMAC-signed).

## 3. Provisioning (requires separate authorization; not performed)

Per environment, in this order:

1. **Credential scope.** Create the Blobs credential used as `IAOS_SESSION_REVOCATION_TOKEN` with the narrowest
   scope the provider allows for the pinned site. Record who holds it and where it is stored. See section 8: the
   credential type is NOT settled by this document.
2. **Environment variables** on the pinned site only: `IAOS_SESSION_REVOCATION_SITE_ID` = the pinned id,
   `IAOS_SESSION_REVOCATION_TOKEN`. Never set the other environment's id.
3. **Create the anchor** in store `iaos-write-receipts` of the pinned site, key `session-revocation/_authority`,
   with the exact canonical JSON above and a fresh random epoch (for example 24 random bytes, base64url, 32
   characters). Use a conditional create (only if new). Read it back and compare byte for byte.
4. Record the epoch, the time and the operator in the evidence folder. Do not reuse an epoch, ever.
5. Only then may a separately reviewed config-only commit turn one sign-in on for that environment.

## 4. Credential rotation (overlap)

1. Create the new credential (same scope).
2. Set it as `IAOS_SESSION_REVOCATION_TOKEN` and redeploy; the old credential stays valid during the overlap.
3. Verify on the deployed site: status, one read, one token mint and one acknowledged Sign out succeed, and a
   signed-out session is refused (section 7).
4. Revoke the old credential. Verify again.
5. Rotating the credential does not change the anchor or the epoch; sessions survive it.

## 5. Restore or suspected loss of records

Any restore of the receipts store, any suspected loss of revocation records, a store migration, or any doubt that
the store is the intended one:

1. Write a NEW epoch into the anchor (same canonical shape, never a previous value). This is the only anchor change
   ever made, and only by an operator under authorization.
2. Effect: every session and saving token issued under an older epoch is refused as revoked; every operator signs
   in once. Revocations lost in the restore therefore cannot revive a credential issued before them.
3. If the anchor itself was lost, every check is unavailable (fail closed) until a new anchor with a new epoch is
   created as in section 3, step 3.
4. Record the old and new epoch, the reason and the time.

## 6. Retention

- Records are never deleted by code. There is no TTL. Optional cleanup is **not authorized**.
- If cleanup is ever proposed, the minimum retention of a record is: the latest expiry of the parent session it
  revokes (8 h after issue) + 24 h (the revoke-only handle lifetime) + clock skew allowance; a record must never be
  removed while any credential it revokes, or any handle that can still re-send it, can be unexpired.
- The anchor is never deleted. Rotating the epoch (section 5) is the only bulk invalidation.

## 7. Live verification still required (not performed; offline tests use a fake Blob service)

- Freshness: after an acknowledged Sign out, a strong read from a different function instance sees the record
  immediately (API-mode read-after-write).
- Latency: the anchor + record check fits the 3 s budget and Sign out (anchor + create + readback) fits 5 s, at
  normal and slow times.
- Conditional create: `onlyIfNew` refuses an existing key (412) and the code never trusts its `modified` result
  (the readback decides).
- Header presence: `x-nf-site-id` is present, single and equal to the pinned id on EVERY function that calls the
  check (Lambda-compatibility functions included), on both sites. If it is absent anywhere, that function fails
  closed and the design must be revisited before enabling.
- Anchor: present and valid on each site; an absent or foreign anchor yields 503, never access.
- Epoch rotation: rotating the epoch signs out an existing session (401 revoked) and a fresh sign-in works.

## 8. Not resolved here

The token-credential conflict is **NOT resolved** by this document: design r4 says "no personal API token", while
the module reaches the store with an explicit API token (`IAOS_SESSION_REVOCATION_TOKEN`). That question (Bones H1)
is escalated separately; nothing above authorizes creating or using any token.
