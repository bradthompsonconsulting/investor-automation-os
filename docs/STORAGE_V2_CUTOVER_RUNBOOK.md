# Storage v2 — cutover, publication and activation runbook (release procedure)

**Status:** implementation under review (Bones). **Nothing in this document is authorized to run.** Every
step below — credential changes, captures, the import, G5 narrowing, provider-semantics registration,
publication, activation, probes and any Production action — is a **separately authorized** release step
carried out only when Brad authorizes it. Production remains held.

Governing record (PR #131): storage correction plan v6 `#issuecomment-6042206665`, focused amendments
r1 `#issuecomment-6042504598`, r2 `#issuecomment-6042657986`, r3 `#issuecomment-6042879715`, and r4
`#issuecomment-6043033100` (approved by Bones); Brad's Owner-bypass decision `#issuecomment-6042966089`.
Design summary: [`STORAGE_V2_LIFECYCLE.md`](STORAGE_V2_LIFECYCLE.md).

## 1. Accepted exception — out-of-tool publication by a Netlify Owner

Brad's acceptance, verbatim:

```text
Only publications through the controlled publisher reliably
invalidate activation. A Netlify Owner can bypass that tool.
After an out-of-tool A → B → A publication, A may resume writes
under its earlier activation without fresh verification.

Brad understands that this could restore saving when the
release was intended to remain held.

Record this exception in the plan and release procedure.
Routine publishing and rollback must use the controlled tool.

This acceptance does NOT cover uncertain restore requests,
weaken write/uncertainty protections, or authorize coding,
publication, credential changes or Production release.
```

What this means operationally:

- **Routine publishing and rollback of `iaos-app-test` and `iaos-app` MUST use `iaos-publish`**
  (`app/scripts/iaos-publish.cjs`). No other route invalidates activation.
- **An Owner publication, rollback or unlock made outside the tool is an EXCEPTIONAL EVENT.** When one
  happens (or is suspected):
  1. Record it: time, actor, site, deploy ids involved, and the reason.
  2. **Assume saving may have resumed** under an earlier activation. Treat the release as not held until
     step 3 completes.
  3. Run `iaos-publish`'s full cycle (close → publish → activate, §4) to re-establish the guarantee, or
     leave admission closed (close only) if saving must stay paused.
- This is an **accepted exception, not a protection**. The test `OB-1` in
  `app/scripts/test-storage-admission.cjs` asserts the behaviour so it stays visible.
- The exception does **not** extend to uncertain controlled publications: an unresolved or unclassified
  attempt keeps admission closed (§4.4).

## 2. What enforces what (summary)

| Mechanism | Effect |
|---|---|
| New store `iaos-ownership-v2` | old code (including delayed deletes) cannot address any v2 record |
| `IAOS_GHL_TOKEN_V2` through `ghlToken()`, no fallback | every new-build GHL path uses the new credential; pre-v2 code rebuilt later finds none |
| Issuer-side revocation of every legacy GHL credential | already-built legacy deploys are rejected by GHL from that moment (says nothing about earlier submissions) |
| The write gate | published production deploy + open admission for THIS deploy (captured, echoed by the page) + kill switch + G5 + legacy block, before any ownership mutation or GHL call |
| `authz/admission` (one record) | tickets (Admit → Dispatching → settle) and publication attempts (T0–T9) by single compare-and-swap |
| Legacy blocks + G5 | never cleared by revocation, session expiry, elapsed time, a missing record or a missing log |

## 3. Cutover sequence (Test first; Production later under the same procedure)

Each step is separately authorized.

| Step | Action | Evidence to capture |
|---|---|---|
| **C0** | Read-only: confirm the Test credentials are not shared with Production; list env names | names listing |
| **C1** | Set `IAOS_GHL_TOKEN_V2` (T2), `IAOS_ATTEST_SECRET_V2` (≥ 32 chars), rotated `IAOS_WEBHOOK_SECRET_V2`, rotated app-write session names | names listing (never values) |
| **C2** | Jess merges. **Merging to main publishes Test** (auto-publish; the lock is accepted as release design only — no lock change is authorized). No admission record exists, so every write is refused (503) | a new-build GHL **read** works; a write returns 503 |
| **C3** | `iaos-cutover` `import_claim_owner` (one store-wide owner, forever) and `import_capture` S1; `g5_init` (default `{location: ALL}`) | owner record; S1 progress `done` |
| **C4** | Revoke every legacy GHL credential at the issuer; delete the old env names; update the webhook custom value. Record the time as `T_r` | GHL's own token listing showing only T2 (authoritative); a 401 per retired value; old names absent |
| **C5** | At `T_r` + 30 min or later (a precaution, never proof): `import_capture` S2, then S3; `import_dry_run`; `import_complete` with `T_r`. Then **reviewer approval of the manifest digest** | manifest digest, counts, `authz/cutover/v2` |
| **C6** | G5 audit delivered ([`G5_LEGACY_PATH_AUDIT.md`](G5_LEGACY_PATH_AUDIT.md)); narrowing records (`g5_narrow`, N1–N4 / AUDIT only) reviewed and approved; the resulting **table digest approved** | each narrowing record id; the approved table digest |
| **C7** | On the deploy that will take writes: the limit and latency probes (§6); then `iaos-publish` **close → publish → activate** (§4) | `L_obs`, latency percentiles, the five attestations, the activation id |
| **C8** | Spock's rerun on an **eligible** synthetic contact only (never `q2ygQtBXQSBezlU4WjNH`) | the four eligibility facts (plan v6 §10.5) |

**Any later publish needs C7 again** (through `iaos-publish`).

### Rollback (R0)

- R0 is the C2 deploy, with writes disabled. Any v2-family deploy also starts disabled until it is activated itself.
- Publishing a pre-v2 deploy is non-functional and safe: its credentials are revoked, and it addresses only the old store.
- Rebuilding pre-v2 code finds no credential.
- The cutover is one-way. Reintroducing a legacy credential name or value is prohibited without review.
- **A rollback is a publication: use `iaos-publish`** (§1).

## 4. Controlled publication with `iaos-publish`

Environment (operator side only): `IAOS_SITE_URL`, `IAOS_WRITE_SESSION`, `IAOS_WRITE_ORIGIN`,
`IAOS_READ_COOKIE`, and for `cycle`: `NETLIFY_SITE_ID`, `NETLIFY_PUBLISHER_TOKEN` (the dedicated
publisher identity — **never** placed in Netlify env or any function).

1. `iaos-publish init` — only if `authz/admission` does not exist yet (T0; creates it **closed**).
2. `iaos-publish cycle --pub <pubId> --target <deployId> --activation <id> --approval <ref> --revocation <ref> --g5-digest <approved digest>`
   is **one process** holding its private publisher token in memory from start to finish:
   T1 Close (admitted tickets revoked; dispatching/uncertain kept) → T2 Claim → T3 Dispatching →
   **exactly one** restore request, never retried (120 s timeout) → T4 Record response or T5 Mark unresolved →
   if APPLIED, the five `storage_capability` attestations from the **target** (nonce = `pubId:attemptSetDigest`)
   and T9 on the target. Exit 0 activated; 2 stopped safely (run `resume`); 3 blocked (unknown result).
3. `iaos-publish resume --activation <id> --approval <ref> --revocation <ref> --g5-digest <approved digest>`
   is how a NEW process recovers after the cycle's process is gone. It hands the cycle over to itself (T7): a
   never-sent `claimed` attempt is abandoned, and a `responded` attempt is kept with its stored response.
   It then reclassifies that stored response (T8, only under an approved semantics record) and activates (T9).
   It **never dispatches**; a `dispatching` or `unresolved` attempt stays blocking (exit 3). The private token is
   never written anywhere, so no command depends on an earlier process's token. The handover names the
   publication it read (`pubId`, target); the server refuses it inside the same compare-and-swap if another
   publication is in progress.
4. `iaos-publish next-attempt --pub <pubId> --target <deployId> --activation <id> --approval <ref> --revocation <ref> --g5-digest <approved digest>`
   continues the **same** publication after its last attempt ended **ABANDONED** (provably never sent) or
   **REJECTED** (approved semantics), with nothing outstanding. One process: T7 Handover bound to that
   publication, then **one** new attempt (new attemptId, T2 Claim → T3 → one restore → T4/T5), the history
   retained, and T9 if APPLIED. It refuses for any other publication or target (exit 1), while any attempt is
   outstanding (a `dispatching` or `unresolved` attempt: exit 3; never reset or resent), and after APPLIED
   (exit 2: run `resume`). A `cycle` with a new `pubId` stays refused while this publication holds admission.

### 4.4 When the result is not APPLIED

| State | Meaning | What is possible |
|---|---|---|
| `claimed` (process died before dispatching) | provably never sent | `resume` hands over and abandons it (T7); then `next-attempt` in the same publication |
| `dispatching` with no living sender | may have been sent | **nothing**: admission stays closed |
| `unresolved` (timeout, transport, abort, 5xx, 429, malformed, other deploy) | unknown | **nothing**: never terminal |
| `responded` (any 2xx/4xx without approved semantics) | evidence persisted, unclassified | `resume` once an approved semantics record classifies exactly that evidence (T7 keeps it, T8 classifies it) |
| `REJECTED` (approved semantics) | not applied, cannot apply later | `next-attempt`: a new attempt (new attemptId) in the same publication |

**Fail-closed limitation (stated, not hidden):** one network failure during a controlled publication can
disable writes indefinitely. Recovery needs request-specific provider evidence, a supported provider
guarantee, or a separately reviewed procedure approved by Brad and Jess. None is authorized here.

## 5. Release prerequisites (gated, later)

- **P5 — provider semantics.** Without an approved, immutable `authz/provider-semantics/<n>`
  (registered via `iaos-cutover register_semantics` with Bones's and Jess's approval references, each
  predicate citing its provider source), a controlled publication can never reach APPLIED, so
  activation is impossible and writes stay disabled. Netlify's documented `restoreSiteDeploy` 201 is not
  by itself sufficient for the "cannot apply later" clause.
- **Publisher identity permissions** (UNVERIFIED): the dedicated identity's publish, rollback, unlock,
  configuration, secret and other-site permissions, separately for Test and Production. If publishing
  requires broader authority, that finding returns for review — no silent escalation.
- Runtime `context.deploy.published` / `context.deploy.id` semantics (P3/G2): if missing or mistyped,
  writes fail closed; `storage_capability` reports both fields as evidence.
- Credential revocation evidence (C4), the import manifest approval (C5), the G5 table approval (C6),
  `L_obs ≥ 30 s` and the latency percentiles (C7).

## 6. Probes (Test only)

`storage-probe` (contention, cross-invocation read-your-write, the L1 lock race on probe keys, latency)
and `probe-limit` (`L_obs` heartbeats). They refuse unless `IAOS_ENV=test` on a published production
deploy with Brad's write session and the exact Test origin, use only `iaos-storage-probe` under
`probe/<runId>/`, import no GHL module, and are removed from every non-Test build by
`app/scripts/production-build-guard.cjs` (keyed on Netlify's build-time `SITE_NAME`).
If the measured p95 exceeds the model's 600 ms, or `L_obs < 30 s`, the budget rows return for review
before any write is enabled.

## 7. Stuck-lock steps (`release_unverified`, `held_*`)

- The page shows the warning from the server's durable status, never from memory.
- **Only same-operation recovery** releases a lock: the holder `opId`'s verified final record, a held record
  naming that `opId`, past its holder deadline, by compare-and-swap on the etag from its strong read. A
  call-log "Check again" on that operation does this automatically.
- **No `opId`, a legacy lock, or a quarantined subject:** no automatic release. Collect the evidence
  (contact id, the lock record's state and timestamps, the status read) and escalate to Brad or Jess.
  **There is no clearing authority.**
