# Netlify function surface audit

Opened 2026-08-06. Records observed properties of the deployed function
surface. Findings only; no remediation is authorized by this document.

## Provenance markers

Findings in this document use one of four provenance markers. The
marker states how the finding was established, not how confident it is.

- OBSERVED -- established by a file read, command output, wire
  response, or UI reading in the working transcript.
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
