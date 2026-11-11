# B15-29 design r6: one sign-in, fixed 30-day session (INV-137)

Captain product ruling, 2026-11-04. It supersedes design r5 §4 (sliding session). Everything else in r5 stands.
Candidate only: `oneLogin` stays DISABLED in both configs; no credential, no live probe, no push.

## What changed vs r5

| r5 (§4, not built) | r6 (built) |
|---|---|
| Read session `exp = now + 30 min`, re-issued by a renew call | `exp = authAt + 30 days`, fixed at the Google sign-in, **never re-issued or extended** |
| Absolute cap `aexp = sign-in + 7 days` (D-B1) | No cap claim: the fixed `exp` is the only limit |
| Session cookie (no `Max-Age`); closing the browser ends it | **Persistent** cookie: `Max-Age` = seconds left to `exp`; closing the browser keeps the operator signed in |
| Client heartbeat every 5 min + on focus / visibility / online | **None** |
| Renew endpoint (POST on app-read-session) | **None** -- the only `Set-Cookie` in one-sign-in code is the Google sign-in |
| Idle expiry after 30 min with no open tab (D-B2) | No inactivity timeout of any kind |
| Saving token `exp = min(900 s, session exp)` | Kept: the token carries `pexp` = the session's `exp`, writers refuse it after `pexp`, and its reported lifetime is `min(900 s, time left)` |

## Kept from r5 (unchanged)

- H1 conditional-write authority: `connectLambda(event)` + the receipts store; sign-in = anchor read + identical-bytes
  `onlyIfMatch` confirm + session `onlyIfNew`; check = two parallel identical-bytes `onlyIfMatch` writes (412 =
  revoked, else unavailable); Sign out = unconditional revoked write + `onlyIfMatch` readback write. No API token,
  no `IAOS_SESSION_REVOCATION_*` variables. Reads never authorize. No code writes different anchor bytes.
- r2/r4: site pin + `x-nf-site-id`, anchor validation, epoch (restore rotation), revoke-only handle, no
  `Set-Cookie` on Sign out, sid-less / unbound refusal, Origin / `Sec-Fetch-Site` / marker checks, allowlists,
  environment binding, Variant S, L1 / L2.

## New in r6

- **Authorization seam** `app/netlify/functions/lib/authorization.ts`: `authorize({sub, email}, "read" | "write")`.
  It is evaluated on every protected request (readers, writers, the token mint) in addition to -- never instead
  of -- the session check, so a disabled or cancelled account can later be refused while its 30-day session is
  still valid. Today it delegates exactly to `IAOS_APP_READ_BRAD_EMAILS` / `IAOS_APP_WRITE_BRAD_EMAILS`: no new
  store, no billing, no behaviour change. Session expiry is never used as account or subscription validation. A
  seam refusal answers 403 `reason: "not_authorized"`.
- **Devices.** Each sign-in is an independent session (own sid, own record). Sign out revokes only that session.
- **Rollback safety.** The 30-day session shape (the one carrying the store ETags) is accepted only while one
  sign-in is on for that environment; switching it off invalidates every 30-day session at once. r4 (Bones R3-1):
  the same holds for the saving token -- the bound token has its own audience (`iaos-app-write-session`) and exact
  claim set, and `requireAppWriter` refuses it whenever one sign-in is off (so does `sessionWriteRefusal`, zero
  I/O); off, any read cookie with a sid / epoch / ETag claim is refused too. Legacy credentials are unchanged.
- **Page timer.** A 30-day expiry exceeds `setTimeout`'s 2^31-1 ms limit; the page's expiry wait is capped at one
  day and re-armed, so the browser never re-checks in a loop.

## r4 corrections (Bones HOLD on 7262e15)

- **R3-1 rollback boundary** -- see Rollback safety above.
- **R3-2 re-login isolation.** A deliberate reauthentication discards the cached and pending saving token at once
  (each mint is bound to the session generation); saving waits until the read gate has the NEW session confirmed.
  The status answer carries non-secret keyed tags of the operator and the session (`operator`, `session`; no email,
  no sid). A different session discards the old session's tokens; a different operator also remounts the routed app,
  clears operator-scoped page data (`app/src/lib/operator-partition.ts`) and shows a neutral notice. Same operator:
  unsaved work kept. The sign-out handle always comes from the newest status answer.
- **Delayed status.** Status requests are sequenced; an older answer, or one from an earlier generation, is discarded.
- **Restore containment (H2).** The anchor carries a required `state` ("open" | "closed"); closed refuses sign-in
  and every check. Procedure: runbook section 6.
- **Reminder wording.** "within N days" (whole days left, rounded up) / "within 24 hours": never overstated.

## Complexity removed

The heartbeat timer and its focus / visibility / online triggers, the 60 s throttle and bounded backoff, the renew
endpoint with its own marker and body, the sliding-cookie re-issue, the `aexp` claim and its verification, and the
"closed-tab expires within 30 minutes" behaviour. None of it was committed.

## Accepted trade-offs (for review)

- A device left signed in stays signed in for up to 30 days, across browser restarts. Mitigations: explicit Sign out
  (server-side, immediate, per device); the epoch rotation signs everyone out.
- The per-request cost of the r5 check is unchanged (two conditional writes; live gate U3).

## Live gates (unchanged from r5, separate authorization)

U1 content-addressed ETags; U2 origin evaluation of `If-Match` / `If-None-Match` via the Lambda edge context and
an `ETag` header on PUT answers; U3 latency / quota / cost; U4 `x-nf-site-id` presence. See
`docs/B15-29_SESSION_REVOCATION_RUNBOOK.md` §8.
