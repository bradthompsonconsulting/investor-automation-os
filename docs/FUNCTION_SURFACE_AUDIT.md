# Netlify function surface audit

Opened 2026-08-06. Records observed properties of the deployed function
surface. Findings only; no remediation is authorized by this document.

## Provenance markers

Findings in this document use one of four provenance markers. The
marker states how the finding was established, not how confident it is.

- OBSERVED -- established by direct observation from a named
  source. Every OBSERVED finding states its source: for example a
  repository read, terminal output, a wire response, or the live
  application. Sources differ in what they can reach. A finding
  unavailable to one source is not thereby unestablished.
- VENDOR DOC -- established by authoritative vendor documentation,
  cited with title, URL, and access date. Not presented as runtime
  observation and not independently verified against this deployment
  unless separately stated.
- INFERRED -- a conclusion drawn from one or more cited observations.
  The observations it rests on are named.
- UNKNOWN -- not established by the available evidence.

An unmarked statement is not treated as an evidence-backed finding
unless its provenance is stated in context.

## Inventory correction

Earlier sessions carried "seven unauthenticated Netlify functions" as a
standing item. That figure is not accurate. OBSERVED 2026-08-06:

- netlify/functions/ (repo root) -- 4 files, 921 lines:
  deal-submit.ts (201), mao-webhook.ts (209),
  motivation-score.ts (410), phone-lookup.ts (101)
- app/netlify/functions/ -- 10 files, 1061 lines:
  ghl-calendar-events.ts (109), ghl-contact-conversations.ts (149),
  ghl-contact.ts (62), ghl-contacts.ts (80),
  ghl-conversations.ts (147), ghl-disposition.ts (188),
  ghl-mailers.ts (40), ghl-opportunities.ts (104),
  ghl-proxy.ts (53), mailer-digest.ts (129)
- app/netlify/functions/lib/ -- 2 files, 427 lines:
  contact-parse.ts (119), mailer-shared.ts (308)

Sixteen files, 2409 lines. Fourteen are entrypoints; the two files in
lib/ are helpers. The provenance of the earlier figure of seven is
UNKNOWN; whether it once described an unauthenticated subset rather
than a total was not established.

Thirteen of the fourteen entrypoints are unread as of this entry. Only
ghl-mailers.ts has been characterized.

### Inventory as of 2026-08-13

deal-submit.ts and mao-webhook.ts were retired on 2026-08-13 (deleted;
see their entries below). Recounted from the repository after the
deletion rather than by subtracting from the 2026-08-06 figures --
several per-file line counts had drifted independently of this change,
so the older numbers above are kept as the 2026-08-06 record and are
not restated as current. OBSERVED 2026-08-13:

- netlify/functions/ (repo root) -- 2 files, 511 lines:
  motivation-score.ts (410), phone-lookup.ts (101)
- app/netlify/functions/ -- 10 files, 1078 lines:
  ghl-calendar-events.ts (112), ghl-contact-conversations.ts (152),
  ghl-contact.ts (62), ghl-contacts.ts (82),
  ghl-conversations.ts (150), ghl-disposition.ts (188),
  ghl-mailers.ts (40), ghl-opportunities.ts (108),
  ghl-proxy.ts (53), mailer-digest.ts (131)
- app/netlify/functions/lib/ -- 2 files, 444 lines:
  contact-parse.ts (133), mailer-shared.ts (311)

Fourteen files, 2033 lines. Twelve are entrypoints; the two files in
lib/ are helpers.

Of the twelve remaining entrypoints, four have been characterized in
this document -- ghl-mailers.ts, mailer-digest.ts, ghl-disposition.ts
and ghl-proxy.ts. Eight are unread. The two retired functions
accounted for two of the four entries in the write-capable
authentication survey below, which now covers two.

### Inventory as of 2026-08-19

Recounted from the repository at Gate 4B-5, not derived by adding to
the 2026-08-13 figures.

- netlify/functions/ (repo root) -- 2 files, 518 lines:
  motivation-score.ts (417), phone-lookup.ts (101)
- app/netlify/functions/ -- 12 files, 1350 lines:
  ghl-calendar-events.ts (112), ghl-contact-conversations.ts (152),
  ghl-contact.ts (62), ghl-contacts.ts (82),
  ghl-conversations.ts (150), ghl-disposition.ts (188),
  ghl-mailers.ts (40), ghl-opportunities.ts (111),
  ghl-proxy.ts (170), ghl-underwriting-policy.ts (94),
  iaos-runtime-config.ts (55), mailer-digest.ts (134)
- app/netlify/functions/lib/ -- 2 files, 444 lines:
  contact-parse.ts (133), mailer-shared.ts (311)

Sixteen files, 2312 lines. FOURTEEN are entrypoints; the two files in
lib/ are helpers.

Two were added since 2026-08-13: ghl-underwriting-policy.ts and, at
Gate 4B-5, iaos-runtime-config.ts.

**Fourteen is correct for the first time, and was wrong every previous
time it was asserted.** PRODUCT_BACKLOG.md has claimed a fourteen-
entrypoint surface since before it was ever true. At the revision where
that sentence was written the entrypoint count was TWELVE; fourteen was
the count of *.ts FILES, which includes the two lib/ helpers that are
not entrypoints. The figure is now right by arithmetic rather than by
coincidence, and is recorded here so nobody later reads the agreement
between the two documents as corroboration. It is not: one was wrong
and has been corrected.

**iaos-runtime-config.ts (Gate 4B-5)** -- GET only, no credential, no
inbound authentication. Serves the browser a projection of shared
config so the frontend artifact no longer carries a build-time
selector. getConfig runs at module scope, so an absent or unrecognized
IAOS_ENV kills the function at load rather than serving a default.
Response is configuration identifiers only -- no token, no secret, no
server-only key, no contact data of any kind -- which is PB-D57's
positive-allowlist rule. Cache-Control: private, no-store.

## ghl-mailers.ts -- publicly reachable without inbound authentication

OBSERVED, app/netlify/functions/ghl-mailers.ts read whole at 40 lines:

- No inbound authentication of any kind. The handler handles OPTIONS
  with status 204 and rejects non-GET requests with status 405, then
  proceeds directly to buildMailerDigest(token).
- CORS is Access-Control-Allow-Origin: "*".
- The token is the server-held GHL_PRIVATE_API_KEY, read from
  process.env. This is an outbound credential to GHL and does not gate
  the caller.
- On success the digest is returned as JSON with status 200.

An unauthenticated GET to /.netlify/functions/ghl-mailers on the
deployed site therefore returns the digest to any caller.

## Response shape

OBSERVED, app/netlify/functions/lib/mailer-shared.ts, MailerTaskRow at
:51-65 and MailerDigest at :73:

Public-record-derived fields: contactName, address, hasAddress,
companyName, hasBusinessName.

CRM-derived fields: taskId, contactId, tier ("hot" | "warm" | "low"),
mailerType, touchNumber, dueDate, dueDateCT, completed. The digest
structure itself -- thisWeekReady, thisWeekBusiness, overdue,
noAddress -- is workflow state.

The underlying names and addresses originate in public records. The
tier assignment, touch count, and due-date state do not; they are
internal judgments about named individuals. This is the basis for
treating the endpoint as internal rather than public.

## Two consumers, different auth needs

OBSERVED:

- app/src/lib/ghl.ts:621 issues
  fetch("/.netlify/functions/ghl-mailers") with no options object. The
  call supplies no explicit authorization header, token, or custom
  credential. A same-origin fetch may still send cookies by default;
  the handler reads and verifies no cookie or session, so nothing the
  browser sends is checked.
- app/netlify/functions/lib/mailer-shared.ts:2-3 records that the
  helper is imported by ghl-mailers.ts (app page API) and by
  mailer-digest.ts (Friday email), so both read one code path.

The browser caller supplies no explicit secret, which rules out a
static key in the frontend bundle. The email path has no user session.
Any scheme built for one consumer must be checked against the other.

## Undecided

The authentication approach is UNDECIDED. Netlify-level access
control, an app session verified in the function, a signed cookie, and
removing the email path from the public HTTP surface are all live
options and none has been chosen. Runtime behavior is unchanged
pending that decision.

## Method note

The read of ghl-mailers.ts line 22 arrived truncated in transit,
consistent with the column-105 loss recorded in JEFF_OUTPUT_RULES.md.
The truncation was in the transport, not the file. Long lines in this
audit were read with cut -c1-95 to stay under that window.

## Write-capable functions -- inbound authentication survey

OBSERVED 2026-08-06. Four write-capable or send-capable functions
read. Reads were windowed at structural anchors and piped through
cut -c1-95 to stay under the transport window described in the
method note.

### mailer-digest.ts

OBSERVED: registered in app/netlify.toml:28 as
[functions."mailer-digest"] with schedule = "0 13 * * 5". That is
13:00 UTC year-round, which is 08:00 during CDT and 07:00 during CST.

VENDOR DOC (Netlify, "Scheduled Functions",
https://docs.netlify.com/build/functions/scheduled-functions/,
accessed 2026-08-06): scheduled functions deployed with a cron
schedule are not directly URL-invocable in production; manual
production runs occur through the Run now control in the
authenticated Netlify UI. This platform behavior was not empirically
tested against this deployment.

OBSERVED: the handler signature at :94 is async () with no
parameters, so it receives no request object and cannot inspect
method, headers, or body.

OBSERVED, :94-101: two guard returns precede the try block. Both are
environment checks -- if (!token) returns 500 and if (!resendKey)
returns 500. Neither is derived from a request. Past that point the
handler builds the digest, resolves the recipient from the
mailer_digest_recipient GHL custom value, POSTs to Resend, and
returns 200.

OBSERVED: the docblock at :7-8 states the function can be hit
directly by URL for manual testing. Read against the vendor
documentation cited above, that holds only under local development
tooling and is misleading as written.

INFERRED from the vendor documentation and the observed handler
signature: no public production URL surface is expected. This was not
independently verified against the deployed function.

### ghl-disposition.ts

OBSERVED: handler at :143 takes event: any. Auth runs before the GHL
token is read and before any payload parsing.

- Requires IAOS_WEBHOOK_SECRET from process.env; returns 500 if
  unset rather than proceeding unauthenticated.
- Reads the x-iaos-secret request header, both casings.
- Returns 401 if absent or non-matching.

OBSERVED: secretMatches is defined at :53 and called at :152. It
hashes both sides to a fixed 32 bytes with SHA-256 before
timingSafeEqual, so the comparison is constant-time and no length is
leaked.

OBSERVED: three fetch calls in this file. markAttempt issues a PUT to
/contacts/{id} at :62 whose body sets only LAST_CALL_ATTEMPT_ID and
LAST_CALL_ATTEMPT_PRECISE_ID. createNote POSTs { body } to
/contacts/{id}/notes at :76. A third call at :90 is a GET of the same
notes collection, used by the dedupe guard, and is not a write.

INFERRED from the two observed write calls: the writes correspond to
the named writes setLastCallAttempt and notes.create. No tags, no
pipeline stage, and no offer_ fields appear in either body.

INFERRED from the observed ordering and comparison implementation:
inbound authentication is present before GHL access and uses a
fixed-length timing-safe comparison.

### deal-submit.ts -- RETIRED 2026-08-13

RETIRED 2026-08-13. The file was deleted from netlify/functions/. The
findings below are preserved as the record of what was deployed; they
describe no current endpoint. Retirement evidence: no caller in the
repository, no matching GHL webhook among the three configured, and
zero Netlify invocations across the full 7-day log retention window.
The unauthenticated write path recorded here was closed by deletion
rather than by adding authentication.

OBSERVED: handler at :90 takes event: any. Through :125 there is no
caller verification of any kind.

- Access-Control-Allow-Origin is "*".
- OPTIONS returns 204, non-POST returns 405, invalid JSON returns 400.
- No secret, no header check, no session.

OBSERVED: this authentication-focused read covered the handler
through :125. PB-D47 separately recorded the later contact-creation
and opportunity-creation path from the complete 201-line file read;
that decision was closed by deletion on 2026-08-13 when this function
was retired, its subject having been the five contact-model field IDs
in this file's opportunity payload. No caller verification occurred
before those writes began.

OBSERVED: a grep across the file for the alternatives handler,
httpMethod, SECRET, secretMatches, statusCode: 401 and
statusCode: 403 returned three lines -- :90, :96 and :100 -- matching
handler and httpMethod. No line matched SECRET, secretMatches,
statusCode: 401 or statusCode: 403.

INFERRED from the observations recorded for this function: an
anonymous POST can reach the contact and opportunity write path using
the server-held GHL credential.

### mao-webhook.ts -- RETIRED 2026-08-13

RETIRED 2026-08-13. The file was deleted from netlify/functions/. The
findings below are preserved as the record of what was deployed; they
describe no current endpoint. Retirement evidence: no caller in the
repository, no matching GHL webhook among the three configured, and
zero Netlify invocations across the full 7-day log retention window.
Two further grounds specific to this function: its 70%-rule formula is
obsolete under the underwriting model now being designed, and its
parser read value/fieldValue, which GHL does not return for NUMERICAL
opportunity fields, so the write path characterized below was
unreachable in practice. The unauthenticated write path was closed by
deletion rather than by adding authentication. The formula itself is
recorded in the master architecture reference under PARKED / VERIFY.

OBSERVED: handler at :102 takes event: any. Non-POST returns 405;
invalid JSON returns 400.

OBSERVED: grep -c for cors, access-control and OPTIONS returned 0.
There is no CORS handling and no OPTIONS branch.

OBSERVED: through :140 the handler normalises an opportunity ID from
four candidate payload shapes, then applies loop-breaking logic
against INPUT_FIELD_IDS. Nothing in that range verifies the caller.

OBSERVED: grep across the file for SECRET returned no matches.

INFERRED from the observations recorded for this function: an
anonymous POST reaches the handler. The write path beyond :140 is
unread.

### Comparison

OBSERVED: among the four functions characterized in this section, the
shared-secret pattern appears only in ghl-disposition.ts. The
repository as a whole has not been surveyed for it.

Two of those four, deal-submit.ts and mao-webhook.ts, were retired on
2026-08-13. The survey now covers two live functions, mailer-digest.ts
and ghl-disposition.ts. The observation above is left as written
because it records what was found at the time.

INFERRED from the four entries in this section as they stood: the two
retired functions were the only ones of the four that an anonymous
POST could reach and drive to a GHL write -- ghl-disposition.ts
verifies a shared secret, and mailer-digest.ts is scheduled with no
public production URL surface expected. Their removal therefore closes
the anonymous-write exposure this section recorded, but by deletion
rather than by adopting the pattern, so it establishes nothing about
that pattern's adoption elsewhere. ghl-mailers.ts and ghl-proxy.ts,
characterized outside this section, are unaffected.

INFERRED from the ghl-disposition reads: a working inbound-auth
pattern for server-to-server callers already exists in this codebase.
It does not resolve the ghl-mailers.ts case, whose caller is a
browser and cannot hold a shared secret.

Remediation remains UNDECIDED and unauthorized by this document.

### Not yet read

motivation-score.ts and phone-lookup.ts in netlify/functions/, and
seven read-oriented functions in app/netlify/functions/ including
ghl-proxy.ts.

## ghl-proxy.ts -- unauthenticated general-purpose GHL pass-through

OBSERVED 2026-08-06, app/netlify/functions/ghl-proxy.ts read whole at
53 lines.

- handler at :25 takes event: any. OPTIONS returns 204. No other gate
  precedes the forward: no secret, no header check, no session.
- CORS is Access-Control-Allow-Origin: "*", with
  Access-Control-Allow-Methods listing GET, POST, PUT, DELETE and
  OPTIONS.
- The forwarded path is read from event.queryStringParameters.path.
  The only validation is that it is non-empty; a 400 is returned when
  it is absent.
- The request URL is formed by concatenation: GHL_BASE + path, where
  GHL_BASE is https://services.leadconnectorhq.com.
- The outbound method is event.httpMethod, passed through verbatim.
- Authorization is Bearer with GHL_PRIVATE_API_KEY, falling back to
  GHL_API_TOKEN.
- The caller body is forwarded when the method is POST or PUT.
- The GHL status code and response body are returned to the caller
  unchanged.

OBSERVED: the file docblock at :8-9 states that Phase A passes through
any GHL path and is single-user and wide open, and that Phase B will
validate an OAuth token in this function before forwarding. The
current state is therefore a documented deliberate decision with a
named successor, not an oversight.

INFERRED from the observations recorded for this function: an
anonymous caller can direct any HTTP method at any path under
GHL_BASE and have it executed with the private integration token. The
scope of what that permits is bounded by the token's own permissions.

UNKNOWN: the permissions granted to GHL_PRIVATE_API_KEY have not been
enumerated. No claim is made here about which specific GHL endpoints
or operations a caller could reach.

The architectural restrictions this project applies to GHL writes --
for example avoiding tag changes, pipeline stage moves, offer_ fields
and workflow triggers -- are implemented in client code. They are
examples of constraints the proxy itself does not enforce. Whether a
caller bypassing that client code could perform any of them depends on
the token permissions recorded as UNKNOWN above.

Historical context does not reduce current exposure. The function is
deployed and reachable.

Remediation remains UNDECIDED and unauthorized by this document.
